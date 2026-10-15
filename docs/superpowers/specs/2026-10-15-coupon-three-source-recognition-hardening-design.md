# 优惠券三源识别链路加固设计

> 日期：2026-10-15  
> 状态：需求方已确认，实施中  
> 目标分支：`p0-three-source-direct-http`  
> 范围：三源 P0/P1 共用的文件入口、AI-primary 识别、名单解析、历史状态兼容、用户错误反馈与受保护 Preview 真测

## 1. 背景与问题

业务员上传配券表和商品白名单后，飞书卡片出现：

```text
Cannot read properties of undefined (reading 'sheets')
```

真环境诊断已经证明 DeepSeek 能读取本次工作簿并返回候选；报错不能据此解释为
“Excel 格式不确定”或“模型不能识别”。当前链路存在多层问题：

1. 内部 TypeError、ExcelJS 和文件解析错误可能原样显示给业务员；
2. 部分入口在 AI 运行前要求规则先唯一判定文件角色；
3. AI-primary 成功后仍无条件混入规则识别的优惠券候选；
4. AI 只返回部分名单区域时，其他有效 Sheet 可能被忽略；
5. AI 响应中一个分区不合规会导致整份候选被丢弃；
6. 旧 Base 草稿缺少新数组或对象字段时，卡片与名单代码可能直接解引用
   `undefined`；
7. 非 `.xlsx` 文件可能错误进入图片处理并收到 PNG/JPEG 错误；
8. 名单覆盖需要校验，但不能退化为固定券档名称或 Sheet 名白名单。

本设计修复整条识别链路，不扩大原生 OA、权限或生产范围。

## 2. 目标与成功标准

- 截图中的两份有效 `.xlsx` 可进入 AI-primary 识别，不再出现 `sheets` 崩溃；
- 用户只看到稳定、可行动的中文错误，不看到异常类型、堆栈或 SDK 文案；
- DeepSeek 负责语义候选，服务端依据原始文件确定性验证并复制事实；
- AI 结果有效时规则不与其竞争，规则只在 AI 缺失或无效时降级；
- 任意合法券档名和名单 Sheet 均可参与识别，不使用固定名称 allowlist；
- 每个确认券档都有明确的名单来源映射，额外业务分组不因名称不同被拒绝；
- AI 部分成功时保留有效分区，并对缺失部分继续确定性发现或要求确认；
- 历史 Base 草稿可安全读取、渲染、回调和续办；
- 离线、DeepSeek、卡片审计和飞书 CLI 真测均通过；
- 全程保持 draft-only，原生 OA kill switch 关闭。

## 3. 方案选择

### 3.1 采用：分层加固现有链路

在现有领域模型、AI effect、Base 草稿和卡片流程上修复边界：文件分类、AI 分区
校验、确定性证据验证、状态规范化和安全错误投影。该方案覆盖已发现问题，同时
避免在 P0 真测窗口重写整个状态机。

### 3.2 不采用：仅捕获 `sheets` TypeError

单点补空值只能消除当前症状，不能解决旧状态、部分 AI 响应、错误文件路由和
内部错误泄露，后续会以不同字段再次崩溃。

### 3.3 不采用：重写三源状态机

全面重写能统一模型，但会同时改变事件、持久化、卡片和测试合同，超出本次修复
的风险和时间范围。

## 4. 文件入口与分类

所有附件先由一个显式分类器归入：

- `excel_xlsx`：扩展名和实际内容可作为 OOXML 工作簿读取；
- `image`：当前允许的 PNG/JPEG 图片或图片消息；
- `unsupported_spreadsheet`：`.xls`、`.csv`、`.ods` 等当前未支持格式；
- `unsupported_file`：其他附件；
- `invalid_file`：扩展名与内容不符、损坏、加密、空工作簿或超出限制。

分类结果决定处理器，未知附件不得默认进入测算图片路径。当前产品能力仍只接受
`.xlsx`；其他表格格式返回中文转换提示，而不是在本次静默扩容。

Excel 读取异常在适配层转成稳定错误码，例如：

- `WORKBOOK_UNREADABLE`
- `WORKBOOK_ENCRYPTED_OR_UNSUPPORTED`
- `WORKBOOK_EMPTY`
- `FILE_TYPE_UNSUPPORTED`

错误对象保留 `cause` 供脱敏日志诊断，但用户卡片只使用错误码对应的中文文案。

## 5. AI-primary 材料识别顺序

### 5.1 上传阶段

上传阶段只完成文件 Gate、source hash、受控存储和 revision 更新。每个合法
`.xlsx` 先保存为未分配角色的材料，不要求规则先唯一判断配券表、白名单或
黑名单。

用户点击“材料已上传完毕，开始统一识别”后，系统对当前 revision 的全部 Excel
发起一次批量 AI recognition effect。

### 5.2 AI 提议与服务端验证

DeepSeek 可以提议：

- 文件角色；
- 模板与全部券档；
- 标准业务字段；
- 白名单、黑名单的 Sheet、SKU 列和数据区域；
- 活动文案候选。

服务端必须重新读取 source hash 对应的原始 bytes，并验证文件、Sheet、坐标、
单元格值、类型、枚举、日期、金额、SKU 安全和候选完整性。AI 不直接写入 SKU，
不决定权限、审批、OA 路由或附件资格。

### 5.3 角色决议

角色按以下顺序决议：

1. 当前 revision 内通过证据校验的唯一 AI 角色；
2. AI 缺失或无效时，使用确定性规则的唯一候选；
3. AI 与规则冲突、多文件竞争同一角色或证据不足时，由 owner 在统一二轮卡确认。

服务端仍检查白名单必传、黑名单可选但需明确确认、同一角色冲突和当前 owner /
revision。取消“规则不唯一则禁止启动 AI”的前置门禁。

## 6. AI 结果的分区校验与降级

AI JSON 顶层只验证对象和版本；以下分区分别执行 schema 与证据校验：

- `roleCandidates`
- `templateCandidates`
- `tierCandidates`
- `fieldCandidates`
- `skuRegionCandidates`
- 活动文案候选

一个分区失败只产生对应问题码，不丢弃其他已通过分区。每个有效候选保存 source
hash、证据和 prompt/version 信息。问题摘要不得包含完整 prompt、响应、SKU 或
员工信息。

AI-primary 合并规则改为：

- AI 分区有效且覆盖该职责时，只使用 AI 候选；
- AI 分区缺失、无效或超时，规则才为该分区提供 `rule_fallback` 候选；
- 规则不得向有效 AI 优惠券集合无条件追加行；
- owner 在当前 revision 的明确输入优先于 AI 和规则；
- AI 与规则冲突不得静默选择，进入统一二轮确认。

## 7. 动态名单、部分区域与覆盖

名单继续遵循“AI 识别区域 + 确定性复制”：AI 指出 Sheet、SKU 列、数据边界和
业务分组，服务端从原工作簿逐格读取并校验 SKU。

当 AI 返回至少一个有效 SKU 区域时，解析器仍需枚举其余 Sheet：

1. 已被有效 AI 区域覆盖的范围按 AI 证据读取；
2. 未被覆盖的 Sheet 使用确定性 SKU 区域发现；
3. AI 与规则区域重叠时按同一坐标去重；
4. 无法唯一确定的 Sheet 进入一次 owner 确认，不能静默忽略。

覆盖 Gate 不比较固定名称。它检查：

- 每个确认券档是否存在明确的名单来源映射；
- 每个纳入生成的名单 Sheet 是否有确定的输出分组；
- 多 Sheet 对同一券档、额外业务分组或无法匹配的 Sheet 是否已由 owner 明确确认；
- 白黑名单交集和重复 SKU 是否按现有规则解决。

名单 Sheet 无同名配券档不是天然错误；系统不得恢复仓库内五个示例 Sheet 的
固定 allowlist。

## 8. 历史草稿兼容

新增单一 `normalizeCouponThreeSourcePilotDraft` 入口，在 Base `State JSON` 读取后、
进入领域服务前执行。它至少规范化：

- task 中的产物、确认图片、待确认图片和已处理操作 ID；
- `recognitions` 及其 AI 状态、候选数组和问题数组；
- `selections`、名单 Sheet 映射和 owner 输入；
- 卡片投递状态、validation issues 和 artifacts；
- 新增字段的版本默认值。

规范化必须是纯函数、幂等且不产生外部写入。历史记录不批量改写；只有后续正常
保存时才按新 schema 写回。无法安全迁移的未知 schema fail closed，并返回中文
“草稿版本无法继续，请保留材料并联系处理”，不得猜测字段。

卡片、callback、名单解析和续办代码不得直接假设可选嵌套对象存在。类似
`selection?.sheets[name]` 的访问改为对 `selection?.sheets?.[name]` 或规范化后的必需
结构访问，并有旧状态回归用例。

## 9. 安全错误投影

建立领域错误到用户错误的唯一投影函数。用户可见内容包括：

- 简短标题；
- 当前阶段；
- 是否保留现有材料；
- 下一步动作（修改格式、重新上传、补充确认或联系处理）；
- 脱敏 request/error reference。

用户卡片不得拼接任意 `error.message`。日志可记录稳定错误码、阶段、request ID、
task ID、revision 和异常类型，但不得记录完整 payload、文件内容、SKU、file key、
open ID、密钥或 DeepSeek 完整响应。

未知异常统一显示“系统未完成本次处理，已保留当前材料，请稍后重试或联系处理”，
并保持失败状态可诊断。不得吞错后返回成功，也不得继续生成、上传或交接 OA 草稿。

## 10. 保留的确定性 Gate

本次只移除错误的前置或固定名称限制，以下 Gate 保持：

- 文件格式、大小、加密、可读性和 source hash；
- 当前 owner、revision、旧卡、重复事件和幂等；
- P0 仅支持常规满减券与 SKU 名单；
- 日期、金额、比例、数量和业务规则；
- 缺失事实、无黑名单、名单映射和交集的 owner 确认；
- 源名单永不直接进入 OA 附件；
- 标准产物冻结、hash、readback 和附件角色；
- native OA kill switch、allowlist 和 draft-only 边界。

## 11. 测试策略

### 11.1 单元与集成回归

至少覆盖：

- 截图同类配券表和名单布局；
- 旧草稿缺少 `sheets`、候选数组、AI 状态或选择对象；
- AI 全量成功、局部 schema 失败、部分 Sheet、超时和无效坐标；
- AI 有效时不混入规则优惠券行；
- AI 无效时规则按分区降级；
- 任意券档名、额外 Sheet、一个券档多 Sheet 和不匹配名称；
- 损坏、加密、空 `.xlsx`，以及 `.xls`、`.csv`、伪装图片；
- 所有异常均投影为安全中文错误；
- 重复消息、重复 callback、旧卡、revision 变化和 worker 重试。

### 11.2 本地 Gate

执行受影响 Vitest、完整三源测试、离线 E2E、DeepSeek lane、`audit:workbook`、
`audit:cards`、Biome、typecheck、build 和 `git diff --check`。真实业务文件和导出的
Base 状态仅可位于 `/tmp` 或 Git 忽略目录。

### 11.3 飞书 CLI 真测

本地 Gate 全部通过后创建 Conventional Commit，使用干净 revision 执行受保护
Preview 部署并回读完整 SHA。只启动一个 `lark-cli` consumer 和一个受控 worker。

真测顺序：

1. 核对 allowlist、pilot 和 AI-primary 测试窗口；
2. 核对 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`；
3. 发送 `/OA优惠券提报`；
4. 上传脱敏配券表和白名单，点击统一识别；
5. 通过 AI effect 诊断和 Base 直读证明 DeepSeek 被实际调用；
6. 核对角色、全部券档、所有名单 Sheet、二轮卡和安全错误文案；
7. 生成标准附件并核对 hash/readback；
8. 仅走到隔离 OA 测试稿预览，不执行正式发送；
9. 核对没有原生 OA instance code/link；
10. 关闭 pilot，停止 bridge/worker，保存脱敏结论。

卡片真发审计产生的测试消息必须立即撤回；撤回失败时停止并人工清理。

## 12. 文档与架构影响

本设计落实 ADR-0012 的 AI-primary 顺序，并保持 ADR-0010/0013 的本机 P0、
draft-only 和原生 OA fail-closed 边界，不改变 PostgreSQL、对象存储、Base、Drive
或 Approval 的事实源职责，因此预计不新增 ADR。

实施时同步：

- 当前产品基线中的文件格式、AI/规则顺序和用户错误行为；
- 当前实现基线中的状态规范化、分区校验和安全错误投影；
- P0 runbook 的回归矩阵与真测判读；
- 脱敏 fixture 和测试说明。

若实现中发现必须改变事件入口、持久事实源、外部副作用或原生 OA 时机，立即停止
并新增 ADR，不在本修复中静默扩大范围。
