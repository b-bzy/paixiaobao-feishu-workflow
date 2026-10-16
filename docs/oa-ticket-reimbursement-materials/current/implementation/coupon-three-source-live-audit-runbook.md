# 三源提报「真环境审计」Runbook

> 定位:开发/测试辅助工具的用法说明。两个脚本都只读业务数据、不发 OA、
> 不改草稿状态;真发审计发送的卡片会立即撤回。
> 事故背景见 2026-10-15:select_static 的 `label`/`default_value` 非法属性
> 与公式单元格 `[object Object]` 两类格式缺陷,单测全绿却线上必现。

## 为什么"真发"不可替代

飞书卡片 schema 的权威判定只在线上:非法属性会在 im 发送接口返回
`ErrCode 200621 parse card json err — unknown property "xxx", path: …`,
带精确 JSON path,一锤定音。同类投递型拒收还有**属性超长**:组件 `name`
超过 100 字符报 `ErrCode 11310 name exceed the default maximum 100`
(2026-10-16 事故:确认按钮 name 拼了全量 64 位上下文哈希,~119 字符,
所有映射表单卡被拒、发卡 effect 重试烧完进死信,用户永远停在"AI 识别中")。
结构化单测(cards-schema.test.ts 的属性白名单 + name/default_value 长度
门禁)负责防"已知"回归,真发审计负责发现"未知"——两者缺一不可。
工作簿识别同理:真实 Excel 里的公式、全角字符、粘贴残留只有灌进真实管线
才暴露。

## 工具一:卡片真发审计

```bash
# 干跑:验证全部 16+ 种卡片形态的构建器不抛错(不需要飞书环境)
pnpm audit:cards

# 真发:逐张真实调用 im 发送接口,发完立即撤回(需要飞书环境)
set -a && source .local/local-round.env && set +a
export FEISHU_AUDIT_TARGET_OPEN_ID="ou_xxx"        # 或用 --draft 自动取
pnpm audit:cards -- --send

# 附加用真实 Base 草稿渲染(能暴露"存了某个选择/字段后才触发"的形态)
pnpm audit:cards -- --send --draft /tmp/导出草稿.json
pnpm audit:cards -- --send --only mapping           # 只跑名字匹配的卡片
```

`--draft` 文件的导出方法:

```bash
set -a && source .local/local-round.env && set +a
lark-cli base +record-list --as bot \
  --base-token "$FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN" \
  --table-id tbl1MYo5Ga4B95Ey --json > /tmp/records.json
# 从 records.json 取活跃草稿(排除 Canceled/DraftOnlyConfirmed),拼成:
# { ...State JSON 原样, "ownerOpenId": "<Owner Open ID 列>", "recordId": "<rec id>" }
# 注意:ownerOpenId 在 Base 独立列,不在 State JSON 里!
```

结果判读:`PASS (已撤回)` = 该形态线上可发;`FAIL` 带飞书原始 200621 报错
(含 path)——把 path 指到的组件属性对进 `cards-schema.test.ts` 的白名单
修正,先真发验证再更新白名单。

## 工具二:真实工作簿识别审计

用户给出真实 `.xlsx` 后,提交测试**之前**先跑:

```bash
pnpm audit:workbook -- path/to/配券表.xlsx --json /tmp/audit.json
```

按真实管线逐层输出:

1. **材料角色判定**——能否唯一识别,还是需要人工确认;
2. **满减券档发现**——数据行是否可被发现;
3. **公式单元格扫描**——无缓存结果的公式线上必然读不到值,
   每个都标注 Sheet!单元格地址(线上靠 AI 推导回退兜底);
4. **字段命中与格式探针**——每个字段的表头命中、样例值、
   数字/比例/日期转换结果(✗ 即线上会要求人工补充的字段);
5. **名单列识别**——SKU/券档列是否存在;
6. **确认演练**——无 AI、无人工补充的最坏情况下,确认会抛出的
   与线上一致的中文校验问题(即第 3 步横幅内容)。

判读:第 3 节的公式清单 + 第 4 节的 ✗ 项 + 第 6 节的字段问题,
就是"用户上传后会遇到什么"的完整预告;有 ✗ 时优先改表头/格式,
改不了的确认识认路径(AI 推导、第 3 步人工输入)能接住。

## 排障工作流(用户报"卡住/没反应"时的固定动作)

1. **Base 直读定位节点**:`lark-cli base +record-list` 读活跃草稿 State JSON,
   看 task.status、recognitions.*.ai.status、mappingCardDelivery、
   failureReason——确定卡在哪一步;
2. **卡片能否发出**:把该草稿导出 → `pnpm audit:cards -- --send --draft …`
   若真发 FAIL,即投递类故障(200621 属性非法 / 11310 name 超长),
   按报错里的 path/ErrMsg 修卡片;干跑(`pnpm audit:cards`)现在也
   静态拦截 name>100 与 default_value>800 两类已知上限;
3. **数据能否识别**:拿用户的原始 Excel → `pnpm audit:workbook`,
   若确认演练报字段问题,即解析类故障,按字段修表头/格式或确认 AI 推导;
4. 修复后在本地以同一草稿真发验证,再提交部署。

附加判读：用户卡片出现 TypeError、`Cannot read properties`、ExcelJS、Drive/Base
或 SDK 原始英文错误即为失败，即使流程已停止也不能算安全降级。兼容旧草稿导出时，
应额外删除候选数组或名单 `sheets` 选择对象做回归，确认卡片渲染和名单解析都只
使用规范化默认值。AI 只返回部分名单 Sheet 时，审计结果必须同时列出其余可由
确定性规则发现的 Sheet，不能因已有一个 AI 区域就提前结束。

## 红线与脱敏

- 真实表格、导出草稿、审计 JSON 只放 `/tmp` 或 Git 忽略目录;
  不要提交进仓库,不要整份粘贴到 issue/文档。
- 真发审计只发合成内容(除了 `--draft` 渲染的真实草稿卡),
  发送后立即撤回;撤回失败的卡片要手动清理。
- 两个脚本均不创建草稿、不触发 OA、不改任何业务状态。
