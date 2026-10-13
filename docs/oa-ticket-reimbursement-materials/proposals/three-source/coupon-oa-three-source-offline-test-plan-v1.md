# 三源优惠券 OA 本地离线测试方案 v1

- **状态**：已完成第一轮合成数据验证（不接入飞书）
- **适用范围**：`coupon-oa-three-source-v1` 的“常规满减券 + SKU + 五券档名单”切片
- **测试入口**：`pnpm test:coupon-three-source:offline`
- **数据原则**：仅使用测试代码在内存中生成的合成、脱敏 XLSX 与 PNG 元数据；不读取或写入业务源文件。

## 目标与边界

本轮证明本地领域逻辑可以在**没有任何飞书网络、身份、Base、Drive 或审批实例副作用**的情况下完成：

```text
合成配券表、白名单、黑名单/无黑名单确认、测算图片元数据
  → 规则候选识别
  → 第一次确认门禁
  → 白黑名单重叠处理
  → 标准配券表、五券档标准名单
  → OA 预填快照
  → 纯本地审批表单编码/差异比较
  → 模拟第二次确认（明确 oaCreated: false）
```

这不是飞书联调，不能据此断言真实审批实例已创建、文件已上传或权限已配置。

## 当前实现的离线保护

实现目录：`server/lib/coupon-oa/three-source/`

- 不导入 Drive、Base、消息、审批客户端、提交服务或事件路由；
- 测试中替换全局 `fetch`，任何网络请求都会立即失败；
- 所有源文件和生成附件只保存在进程内存；
- 最终确认函数只返回本地确认 hash 与 `oaCreated: false`。

纯本地调用的 `approval-schema.ts` 仅做表单编码与差异比较；它不读取审批定义、不申请 tenant token，也不创建或回读审批实例。

## 测试矩阵

| 编号 | 场景 | 预期结果 |
| --- | --- | --- |
| T01 | 错位表头、说明行、字段别名的任意布局配券表 | 识别常规满减字段和数据行，保留来源定位 |
| T02 | 非标准 Sheet 名、SKU/券档列及商品名/链接附加列 | 自动识别白名单或黑名单候选，不依赖文件名 |
| T03 | SKU 文本前导零 | `00123` 原样进入标准五券档附件，单元格格式为文本 |
| T04 | 白名单必传 | 缺失或问题名单不能进入 canonical package |
| T05 | 未上传黑名单 | 必须显式确认“本次无黑名单”；确认后不生成伪造的空黑名单附件 |
| T06 | 已上传但无效的黑名单 | 公式、公式前缀、数值型 SKU、多个 ID、重复或空 ID 被拦截；绝不降级为无黑名单 |
| T07 | 白黑名单重叠 | 无决定时阻断；白名单优先和黑名单优先按业务决定剔除另一侧 SKU；“返回修改源文件”阻断生成 |
| T08 | 名单列歧义 | 同等 ID 候选阻断，等待最小化映射确认 |
| T09 | 版本、映射与模板 | 过期 revision、来源定位/映射改变和名单模板 fingerprint 改变均阻断 |
| T10 | 标准附件 | 生成配券表、白名单和可选黑名单；重新打开验证 5 个 Sheet、`A1=sku`、文本格式与行数据 |
| T11 | OA 预填快照 | 费用、ROI、日期、渠道、附件 hash、黑名单状态、重叠决定来自同一 revision；源文件不成为正式附件 |
| T12 | 本地审批编码合约 | 使用虚拟审批定义编码并差异比较，不产生 API 请求 |
| T13 | 零副作用 | `fetch` 调用数为零，模拟第二次确认固定返回 `oaCreated: false` |
| T14 | 多 Sheet 重复 SKU | 同一 Sheet 内按首次出现位置去重；跨 Sheet 相同 SKU 分别保留；规则映射和 AI 区域路径行为一致 |

## 执行步骤

```bash
pnpm typecheck:server
pnpm test:coupon-activity-copy
pnpm test:coupon-three-source:offline
pnpm exec vitest run --exclude '.claude/**'
```

全量测试在本仓库应使用 `--exclude '.claude/**'`，避免嵌套临时 worktree 被 Vitest 当作独立项目扫描。

## 第一轮验收结果

第一轮命令：

```text
pnpm typecheck:server
pnpm test:coupon-activity-copy
pnpm test:coupon-three-source:offline
```

验收条件：

- 类型检查通过；
- 离线测试全部通过；
- 任何 `fetch` 调用都会使测试失败；
- 不存在真实 OA 创建路径；
- 白/黑名单输出经过 ExcelJS round-trip 验证。

## 尚未验证，且不得由离线结果推断为已通过的项目

1. 飞书 Bot 卡片、消息鉴权和用户身份；
2. Base 草稿、Drive 冻结/下载、附件 `file_code`、权限与 403 解阻；
3. 真实审批定义、原生 OA 创建、幂等、回读和提交后差异；
4. 真实模型对大量未知源表的识别质量；本轮使用确定性字段别名和候选规则；
5. 未确认的业务映射：活动点位来源、活动日期映射、渠道文案、业务模式/超扣点来源、折扣券公式、跨券档 SKU 与第六券档规则；
6. 测算图片内容识别；当前只验证其作为必传附件元数据被登记，不解析图片。

飞书集成只能在本地测试稳定后，在独立 feature flag 与真实审批定义确认后开始。

## 经授权的本地 DeepSeek 识别（独立于纯离线测试）

这不是离线模式，也不属于 `pnpm test` 或 CI：只有业务方明确授权把完整逻辑工作簿内容发送给 DeepSeek 后，才可执行带 `--use-deepseek` 的命令。此模式仍然**不得调用飞书**，并且不会创建原生 OA。

```bash
# 只在已得到完整源表外发授权时执行；读取本地 .env.local 的 DEEPSEEK_API_KEY
pnpm recognize:coupon-three-source:deepseek -- \
  --case-dir <Git 忽略的 case 目录> \
  --use-deepseek \
  --output-suffix <唯一后缀>
```

模型输出只是候选。后续应复用已保存的聚合响应做本地重验证，不得为修复本地 schema 而重新发送源表：

```bash
pnpm recognize:coupon-three-source:deepseek -- \
  --case-dir <同一 case 目录> \
  --reuse-ai-run <同一 case/local-output 下的既有 AI 运行目录> \
  --selected-identifier SKU \
  --confirm-no-blacklist \
  --output-suffix <新的唯一后缀>
```

复用模式校验当前源文件 SHA-256、模型候选坐标、表头语义、券档关系和已确认的标识维度/无黑名单决定；它的网络策略为 `local-audit-reverification`，DeepSeek 和飞书调用数均为 0。仅当输出的 `mappingConfirmationStatus` 为 `ready_for_practice_generation` 时，才可将它绑定到本地练习生成器：

```bash
pnpm run:coupon-three-source:local-case -- \
  --case-dir <同一 case 目录> \
  --ai-mapping-run <重验证输出目录>/ai-recognition-run.json \
  --output-suffix <新的唯一后缀>
```

生成器会再次检查 AI 审查的源文件 hash、四券档对齐、`SKUID` 选择和“无黑名单”确认，并把审查文件及其 hash 写入本地 OA 草稿的 `aiMappingReview`。无论是否绑定 AI 审查，输出始终是 `practice_final_non_submittable`、`networkCalls: 0`、`oaCreated: false`。

## 活动名称与活动背景候选

活动文案功能把配券表 K 列原值、可领时间、源券档，以及白名单的型号/类别辅助元数据分开保存。它不会把“预计券率”自动等同于预计领用率、预计使用率或优惠比例，也不会把 Sheet 名/型号观察结果直接升级为业务策略。

本地练习先使用 case-local 的业务上下文生成待确认候选：

```bash
pnpm run:coupon-three-source:local-case -- \
  --case-dir <同一 case 目录> \
  --activity-copy-context <case 内的 activity-copy-context.json> \
  --output-suffix <新的唯一后缀>
```

输出的 `activity-narrative-candidate.json` 会包含 `factsHash`、`contextHash`、`candidateHash`、源活动名称、候选标题/背景和 blockers。仅当候选没有 blockers，业务员才可在下一次本地运行中明确传入同一 hash：

```bash
pnpm run:coupon-three-source:local-case -- \
  --case-dir <同一 case 目录> \
  --activity-copy-context <同一 context 文件> \
  --confirm-activity-copy <candidateHash> \
  --output-suffix <新的唯一后缀>
```

该确认只把文案写入本地练习草稿的 `selectedValue`；不会改变 `submissionReady: false`、不会调用网络，也不会创建 OA。

对任意布局表格，DeepSeek 可在已有完整外发授权下提出结构化品类/型号别名候选。先由本地运行生成事实文件，再显式传入两份 case-local 文件：

```bash
pnpm recognize:coupon-three-source:deepseek -- \
  --case-dir <同一 case 目录> \
  --use-deepseek \
  --activity-copy-context <case 内的 activity-copy-context.json> \
  --activity-copy-facts <local-output 目录>/activity-copy-facts.json \
  --output-suffix <唯一后缀>
```

活动文案 AI 只接收和输出事实/别名/分组候选；审计记录绑定 context、facts、prompt、模型、请求、响应和 proposal hash。无证据、源 hash 变化、未覆盖源券档、券率语义未确认或型号/券额冲突都必须保持 `needs_confirmation`。此类候选可写入本地**待审核草稿**并显示 blockers，但不得被 `--confirm-activity-copy` 选中、不得标记为最终 OA 背景。
