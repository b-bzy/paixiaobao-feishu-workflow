# 三源优惠券本地 E2E 测试器设计

## 1. 背景与目标

飞书生产环境中的文件上传、消息事件、卡片回调、权限和人工操作成本较高，当前
逐次手工测试又经常在后半段才暴露 Excel、AI 回填、revision、幂等或模板问题。
本设计建立一套可重复执行的本地服务级 E2E 测试器，在部署飞书前覆盖三源优惠券
流程的大多数业务和运行时风险。

本地测试器必须从脱敏 Excel 输入开始，经过与线上同源的任务、AI 候选投影、第二轮
确认、模板生成和产物回读，最终生成机器可读与中文验收报告。它不得调用飞书、
Drive、Base、Approval 或创建原生 OA。

## 2. 范围与非目标

### 2.1 范围

- 配券表、白名单和可选黑名单的 Excel fixture 生成；
- 任意布局 Excel 的规则识别和 AI 响应回放；
- 当前三源任务、revision、确认快照、worker 和 effect 流程；
- PostgreSQL 持久任务、receipt、outbox、lease 和幂等；
- MinIO canonical bytes、冻结产物和 hash 回读；
- 第二轮中文问题、一次性卡片投影和 owner/revision 校验；
- 标准配券表、名单工作簿和截图生成；
- 失败、超时、重复、重启和未知结果测试。

### 2.2 非目标

- 不验证真实飞书 App、tenant、open_id、权限或事件订阅；
- 不验证 Vercel Protection、Preview 域名或公网回调；
- 不上传 Drive/Base，不创建 Approval 实例；
- 不把本地通过描述成飞书 E2E 或生产上线；
- 不默认把完整业务工作簿发送给 DeepSeek。

## 3. 总体方案

采用双层测试架构。

### 3.1 快速层：无 Docker

默认命令：

```bash
pnpm test:coupon-three-source:e2e-local:fast
```

覆盖 Excel 解析、AI 固定响应回放、第二轮字段投影、领域状态机、模板生成和工作簿
回读。测试使用内存或文件级 fake，不访问网络，适合每次修改后快速执行。

### 3.2 耐久层：Docker 基础设施

默认命令：

```bash
pnpm test:coupon-three-source:e2e-local:durable
```

复用仓库现有 `pnpm infra:up` 启动 PostgreSQL 和 MinIO。Nitro 代码与 worker 仍在
本机运行，不额外容器化应用。该层验证 migration、持久 receipt、任务 lease、
outbox/effect、对象存储、worker 重启、重复投递和并发确认。

Docker 只承载外部依赖。这样既能验证真实持久化语义，也保留本机断点、日志和快速
代码迭代能力。

### 3.3 聚合入口

```bash
pnpm test:coupon-three-source:e2e-local
```

依次执行快速层和耐久层，最后生成统一报告。Docker 或依赖未就绪时必须明确失败，
不能把耐久层跳过后仍报告“完整通过”。

### 3.4 可选 DeepSeek 契约层

```bash
pnpm test:coupon-three-source:e2e-local:deepseek
```

只有显式调用该命令并存在本地密钥时，才允许向 DeepSeek 发送脱敏合成 fixture。
默认测试使用已登记的请求/响应 fixture 回放。真实调用只验证 schema、坐标证据、
超时和错误处理，不把模型结果直接升级为业务事实。

## 4. 数据流

```text
case manifest
  → 生成或读取脱敏 Excel
  → 模拟飞书标准化文件事件
  → durable receipt / task / revision
  → AI 响应回放或规则降级
  → 服务端坐标与业务规则校验
  → 一张第二轮确认投影
  → 模拟 owner 补充与确认
  → canonical package
  → 标准模板生成
  → MinIO 写入与回读
  → Excel/PNG/hash/revision 校验
  → JSON + Markdown 报告
```

飞书 gateway 使用 fake，只记录意图和稳定幂等键。测试必须断言同一个逻辑消息、
卡片或附件 effect 最多产生一次。

## 5. Fixture 结构

每个测试用例由一个 manifest 描述，不依赖文件名推断预期：

```ts
interface CouponThreeSourceE2eCase {
  id: string;
  title: string;
  tags: string[];
  inputs: {
    couponWorkbook: string;
    whitelistWorkbook?: string;
    blacklistWorkbook?: string;
    aiReplay?: string;
    ownerReplies?: Array<Record<string, string>>;
  };
  expected: {
    terminalState: string;
    revision: number;
    secondRoundCardCount: number;
    userFacingErrorCode?: string;
    sheetRows?: Record<string, number>;
    artifactRoles?: string[];
    nativeOaCreated: false;
  };
}
```

生成器使用固定种子，保证 Excel bytes、数据顺序和预期可重复。测试 fixture 必须脱敏，
不得从 `cases/` 或 `drafts/` 复制真实业务数据到 Git。

## 6. 测试矩阵

### 6.1 Excel 结构

- 表头位于第 1、2、10 行；
- SKU 位于 A、C、Z 列；
- 说明行、空行、隐藏行和额外列；
- 合并单元格和重复表头；
- 任意 Sheet 名、空 Sheet 和额外 Sheet；
- 多个疑似 SKU 列；
- 损坏、加密、空工作簿和超限文件；
- `.xls`、CSV 或伪装扩展名必须明确拒绝。

### 6.2 SKU 与名单

- 文本、合法数字、前导零和科学计数法；
- 超过 Excel 15 位可靠精度；
- 同 Sheet 重复自动去重；
- 跨 Sheet 相同 SKU 分别保留；
- 公式、公式前缀、多个 SKU、空值和混合类型；
- 白名单/黑名单重叠的三种 owner 决策；
- 未上传黑名单与已上传无效黑名单不得混淆。

### 6.3 券档和业务字段

- 1、4、5、10 个券档；
- 任意满减组合、同门槛不同面额；
- 配券表和名单 Sheet 顺序不同；
- 缺失或额外券档；
- 严选、寄卖、POP；
- 超扣条件字段；
- 缺年份、非法日期、跨年日期和多种日期表达；
- 单一活动点位、多券率冲突和 owner 补充；
- 活动名称/背景完整、缺失和 AI 候选需确认。

### 6.4 AI 契约

- 高置信度完整候选；
- 低置信度、缺字段和冲突候选；
- 不存在的 Sheet、越界单元格和伪造证据；
- 非法 JSON、schema 版本错误和重复区域；
- 超时、限流、鉴权错误和服务错误；
- AI 与确定性校验冲突；
- AI 失败后规则降级仍需明确标记来源。

### 6.5 状态、幂等和恢复

- 文件消息重复投递；
- 同角色文件替换产生新 revision；
- 同一卡片重复点击；
- 旧 revision 卡片点击；
- `/clear` 后重新开始；
- worker 在识别、生成和上传前后重启；
- effect 已执行但响应丢失；
- 两个 worker 竞争同一 lease；
- 相同 owner 并行任务隔离；
- 第二轮卡片最多一次，附件最多生成一次。

### 6.6 产物

- 模板 ID、版本和 fingerprint；
- Sheet 名、顺序和行数；
- SKU 文本格式与前导零；
- 标准名单只保留 SKU 列；
- 配券表公式和值回读；
- PNG 来源绑定同一 revision 和配券产物 hash；
- 源文件绝不进入 OA 附件角色；
- 所有生成产物重新打开后可读。

### 6.7 首期 Excel 用例目录

首期生成不少于 **64 个 case manifest**。每个 case 至少包含一份配券表或名单
Excel；完整成功路径包含配券表、白名单和可选黑名单，因此实际生成的 `.xlsx`
数量会超过 100 份。成功生成、业务待补充和安全阻断三类必须分别覆盖。

#### A. 文件与上传包异常（8 个）

| ID | Excel / 上传异常 | 预期 |
| --- | --- | --- |
| F01 | 标准 `.xlsx` 基准包 | 完整生成 |
| F02 | 0 字节文件 | 稳定错误码，要求重新上传 |
| F03 | 可打开 ZIP 但缺少 workbook part | 判定损坏，不进入 AI |
| F04 | 密码保护工作簿 | 明确提示移除密码 |
| F05 | 旧 `.xls` 格式 | 明确提示转换为 `.xlsx` |
| F06 | CSV/HTML 内容伪装成 `.xlsx` | MIME/文件签名校验拒绝 |
| F07 | 超过文件大小和行数上限 | 上传阶段 fail closed |
| F08 | 同名文件重复上传：相同 bytes 与不同 bytes | 相同 bytes 幂等；不同 bytes 新 revision |

#### B. 工作簿布局差异（14 个）

| ID | Excel 布局 | 预期 |
| --- | --- | --- |
| L01 | 表头在第 1 行 | 自动识别 |
| L02 | 表头在第 2 行，上方有标题 | 自动识别并保留证据 |
| L03 | 表头在第 10 行，上方有说明和空行 | 自动识别 |
| L04 | 两层合并表头 | AI 候选 + 坐标校验；无法唯一时一次追问 |
| L05 | 数据区域存在纵向合并单元格 | 不静默复制值；提示具体业务字段 |
| L06 | 字段按纵向键值对排列 | AI 映射，不依赖横向表头 |
| L07 | 券档按列展开的矩阵布局 | AI 映射为标准券档数组 |
| L08 | 同一 Sheet 有两个独立数据表 | 选择有证据的主表；歧义时追问 |
| L09 | 表格中间出现重复表头 | 跳过重复表头，不当作数据 |
| L10 | 大量空行、空列和尾部格式残留 | 只读取有效区域 |
| L11 | 隐藏行或隐藏列包含业务数据 | 显示风险提示，不静默忽略 |
| L12 | 隐藏 Sheet、封面 Sheet、说明 Sheet | 只使用有证据的业务 Sheet |
| L13 | SKU 位于 A、C、Z 列的三组变体 | 均可识别 |
| L14 | Sheet 名为随机业务用语或日期 | 不依赖固定券档注册表 |

#### C. 字段、数值和日期异常（16 个）

| ID | 字段/数据异常 | 预期 |
| --- | --- | --- |
| C01 | 标准中文字段名 | 自动映射 |
| C02 | 常见别名、英文名和中英混合字段 | AI 首选映射并保存证据 |
| C03 | 活动名称缺失 | AI 生成候选，第二轮可修改 |
| C04 | 活动背景缺失 | AI 生成候选，第二轮可修改 |
| C05 | 活动开始日期缺失 | 第二轮中文追问 |
| C06 | 活动结束日期缺失 | 第二轮中文追问 |
| C07 | 日期只有 `9.30-10.10`，没有年份 | 不自动定案，第二轮确认年份 |
| C08 | 跨年日期 `12.20-1.5` | 明确起止年份并校验顺序 |
| C09 | 日期含时间、中文日期、Excel 日期序号混用 | 统一规范化 |
| C10 | 非法日期、结束早于开始 | 阻断并提示正确格式 |
| C11 | 百分比为 `5%`、`0.05`、`5` 三种格式 | 按字段语义统一并回显 |
| C12 | 金额含 `¥`、逗号、中文单位“万” | 规范化后校验原始证据 |
| C13 | 数字为中文大写、全角字符或带空格 | 可安全转换则回填，否则追问 |
| C14 | 必填数值为空、零、负数或异常大值 | 分别返回稳定错误码 |
| C15 | 公式单元格有缓存值、无缓存值、缓存过期 | 只接受可验证值；不可验证时阻断 |
| C16 | 同一字段出现两列且值冲突 | 不自动选一列，合并到一次第二轮确认 |

#### D. SKU、白名单和黑名单异常（16 个）

| ID | 名单异常 | 预期 |
| --- | --- | --- |
| S01 | 文本 SKU | 原样保留 |
| S02 | 15 位以内合法数字 SKU | 无损转文本 |
| S03 | 文本前导零 SKU | 保留前导零 |
| S04 | 科学计数法显示但底层可验证 | 无损时接受，否则阻断 |
| S05 | 超过 Excel 15 位可靠精度的数字 | 阻断，要求文本格式重传 |
| S06 | 同一 Sheet 重复 SKU | 保留首次出现，自动去重 |
| S07 | 不同 Sheet 出现相同 SKU | 每个 Sheet 分别保留 |
| S08 | 一个单元格使用逗号、空格或换行包含多个 SKU | 阻断并定位单元格 |
| S09 | SKU 列包含空值、空格和 `N/A` | 空白跳过或按规则提示，不生成伪 SKU |
| S10 | SKU 公式、公式前缀和超链接 | 公式拒绝；纯文本链接不当作 SKU |
| S11 | SKU 单元格被纵向合并 | 不把一个 SKU 扩散到多行 |
| S12 | 同时存在 SKU、SPU、商品编码候选列 | AI 给出证据；低置信度一次追问 |
| S13 | 额外商品名、价格、型号、链接等几十列 | 标准产物只保留 SKU |
| S14 | 白名单和黑名单重叠 | 三种 owner 决策分别验证 |
| S15 | 黑名单未上传、空黑名单、损坏黑名单 | 三种状态不得混淆 |
| S16 | 名单包含 1、4、5、10 个自由命名 Sheet | 全部保留名称、顺序和独立 SKU 集合 |

#### E. 券档、角色和不规范上传操作（10 个）

| ID | 业务员操作/业务异常 | 预期 |
| --- | --- | --- |
| B01 | 只有一个券档 | 生成单券档标准产物 |
| B02 | 十个券档且顺序不同 | 全部保留，不限死五档 |
| B03 | 配券表有券档但名单缺少对应 Sheet | 一次第二轮确认或要求补材料 |
| B04 | 名单多出配券表没有的 Sheet | 明确提示额外券档，不静默丢弃 |
| B05 | 同门槛不同面额、相似名称 | 按完整券档事实区分 |
| B06 | 面额大于门槛、数量/频次不符合规则 | 服务端强校验阻断 |
| B07 | 把白名单当配券表、把配券表当白名单上传 | AI 角色识别后纠正；歧义时一次追问 |
| B08 | 连续上传多份白名单后又点击旧卡片 | 只允许当前 revision 和当前 owner |
| B09 | `/clear` 后再次上传同一批文件 | 旧任务结束，新任务重新建 revision |
| B10 | 重复点击识别、确认和生成按钮 | 一张第二轮卡、每类附件一次 |

## 6.8 非 Excel 但必须联动的异常

下列场景复用上述 Excel，不额外计算为 64 个 Excel case：

- DeepSeek 成功、低置信度、非法坐标、伪造证据、schema 错误、超时、限流和鉴权失败；
- 严选无图、寄卖/POP 用户图片、自动截图回退、图片顺序和非法 MIME；
- worker 在识别前、识别后、生成前、对象存储写入后重启；
- receipt 重复、lease 竞争、effect 响应丢失、数据库连接中断和 MinIO 暂时不可用；
- 两个 owner 并行提报、同 owner 两个会话、旧 revision 卡片和越权点击。

## 7. 断言与终态

每个用例必须同时断言：

- task 状态、revision 和当前 owner；
- AI/规则候选来源和证据；
- 第二轮卡片数量及中文字段；
- 预期错误码，不依赖整段错误字符串；
- artifact role、hash、模板版本和行数；
- receipt、outbox、effect 和 lease 记录；
- 飞书 fake gateway 的调用次数及幂等键；
- `networkCalls`、`nativeOaCreated` 和源文件未改变；
- 成功路径达到 `ReadyForLocalConfirmation`；
- 异常路径在 manifest 指定状态 fail closed。

本地测试中的最终确认仍固定 `nativeOaCreated: false`。任何用例都不得调用原生 OA。

## 8. 报告和调试产物

每次运行在 Git 忽略目录生成：

```text
outputs/coupon-three-source-e2e/<run-id>/
├── fixtures/
├── artifacts/
├── screenshots/
├── per-case/
│   └── <case-id>/result.json
├── test-results.json
└── 本地E2E验收报告.md
```

报告按成功、待补充、预期阻断和非预期失败分类。非预期失败必须显示阶段、稳定错误码、
预期/实际状态、revision、相关 artifact/effect ID；不得输出密钥、完整事件 payload、
open_id 或真实业务内容。

## 9. Docker 能发现的问题

Docker 耐久层能够额外发现：

- migration 顺序、校验和与 schema 漂移；
- PostgreSQL 唯一约束和事务边界错误；
- receipt/outbox/effect 幂等冲突；
- lease 过期、续租、抢占和 worker 重启问题；
- MinIO bytes/hash/content-type/路径问题；
- 服务重启后状态丢失；
- 并发点击和重复事件导致的重复副作用。

它不能发现真实飞书权限、真实文件 token、回调签名配置、Vercel Protection、Drive、
Base 或 Approval API 的租户差异。因此本地全部通过后，仍需少量飞书手工 smoke test，
但手工测试只覆盖平台集成，不再承担业务组合穷举。

## 10. 完成标准

1. 快速层和耐久层均可由单一命令重复执行；
2. 至少 64 个 fixture manifest，覆盖本设计矩阵；
3. 成功路径生成并回读标准配券表、名单和必要截图；
4. 重复事件、点击和 worker 重启不产生重复卡片或附件；
5. 所有失败均有稳定错误码和中文说明；
6. 测试报告明确区分本地验证和飞书未验证项；
7. `pnpm lint`、`pnpm typecheck`、相关 Vitest 和构建验证通过；若被无关既有问题阻断，
   必须单独记录，不得伪报通过。
