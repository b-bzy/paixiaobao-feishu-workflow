# 优惠券三源 P0：DeepSeek 识别与确认后模板生成设计

**日期：** 2026-10-10  
**状态：** 已实现；待 P0 外部验证  
**范围：** 当前单用户 P0 三源飞书测试流程  
**目标分支：** `p0-three-source-direct-http`

## 1. 背景

当前 P0 三源流程能够接收配券表、商品白名单和可选黑名单，使用确定性规则识别字段、由业务员确认来源映射，再生成标准附件。现有识别逻辑对固定表头和已登记的五个名单券档依赖较强；实际业务 Excel 可能采用任意布局，优惠券类型、字段或名单 Sheet 无法唯一识别。

本设计在 P0 中增加 DeepSeek 辅助识别，但不改变以下事实源和授权边界：

- 原始 Excel、业务员补充和业务员确认是业务事实来源；
- DeepSeek 只能提供候选，不能决定优惠券类型、字段事实、名单映射、模板、权限或审批结果；
- 标准 Excel 必须在第二轮补充与来源确认完成后，由确定性模板引擎生成；
- 当前 P0 继续保持 `draft-only`，不得创建或提交飞书原生 OA；
- 源 Excel 不得直接成为 OA 审批附件。

## 2. 已确认的产品决定

1. P0 允许把上传工作簿的业务内容完整发送给 DeepSeek。
2. DeepSeek 在文件上传后自动调用，不要求用户额外点击“AI 识别”。
3. 采用“方案 B”：每个工作簿、每个 revision 最多发送一次完整请求，不做分块识别。
4. 超时、限流、上下文过长、网络失败或无效 JSON 时，回退到确定性识别和人工映射，不阻断第二轮补充。
5. AI 审计只保留模型、耗时、状态、请求/响应 hash、结构化候选和来源坐标；不保留完整 prompt、response 或额外工作簿副本。
6. 正常情况下，一次提报只包含一种优惠券。
7. 检测到多种优惠券属于上传异常；不得拆成多套提报。第二轮必须让业务员选择本次实际优惠券。
8. 优惠券类型无法识别或存在歧义时，第二轮必须让业务员确认类型。
9. 第二轮确认并补齐字段前，DeepSeek 只做识别，不生成 Excel。
10. 第二轮确认后，DeepSeek 不再参与生成；标准 Excel 由本地确定性模板引擎生成并回读验证。

## 3. 目标与非目标

### 3.1 目标

- 支持任意布局但有效的 `.xlsx` 优惠券源表的候选识别。
- 把优惠券类型未知、多券异常、字段缺失和名单映射歧义集中到第二轮处理。
- 正常路径只生成一种优惠券对应的一份标准配券表和一份标准白名单。
- 已上传有效黑名单时生成对应标准黑名单；明确无黑名单时只保留审计记录。
- 每个候选、确认值、模板和产物都能追溯到 owner、revision、source hash 和来源坐标。
- AI 不可用时保持现有确定性/人工流程可用。

### 3.2 非目标

- 不在 P0 支持批量提报或一次生成多种优惠券。
- 不开放所有 `reference/templates/` 中的券型。
- 不让 DeepSeek 写入、修改或生成 Excel 二进制文件。
- 不实现标准配券表截图 `calcImage`。
- 不创建、重试创建或提交飞书原生 OA。
- 不把 P0 结果表述为 R2、生产或原生 OA 能力。

## 4. 模板范围

### 4.1 P0 已启用模板

P0 只启用：

- `docs/oa-ticket-reimbursement-materials/reference/templates/配券信息表-常规满减券.xlsx`
- `docs/oa-ticket-reimbursement-materials/reference/templates/商品明细白名单-多券档SKU-v1.xlsx`，仅作为单券档名单输出的受控蓝本
- `docs/oa-ticket-reimbursement-materials/reference/templates/商品明细黑名单-多券档SKU-v1.xlsx`，仅在上传有效黑名单时使用

其余 Excel 文件只是已保存的参考模板。在对应字段模型、公式、验证和回归测试完成前，不得出现在 P0 可生成类型列表中。

### 4.2 单券档名单输出

现有白/黑名单模板包含五个固定示例 Sheet。五个 Sheet 不是业务容量或券档白名单，P0 不得据此限制券档，也不得把来源券档错误映射到最相近的示例名称。

确定性生成器使用已登记模板的第一个 Sheet 作为版式蓝本：

1. 校验模板 asset SHA-256；
2. 只保留一个 Sheet；
3. 将 Sheet 重命名为已确认优惠券的规范名称，例如 `满100减1`；
4. A1 保持 `sku`；
5. 从 A2 起逐行写入该优惠券的 SKU，并强制文本格式；
6. 删除其余示例 Sheet；
7. 回读验证 Sheet 名、表头、SKU 顺序、行数、文本格式和产物 hash。

名单实际容量由登记模板的数据区和生成器校验决定，不从示例 Sheet 数量推导。

### 4.3 标准配券表输出

一次提报只生成一种常规满减券。现有 `generateRegularFullReductionWorkbook` 继续负责：

- 使用已登记的常规满减券模板；
- 按已确认渠道生成一行或两行；
- 保持活动 ID、批次 ID、putKey、PC/M 端领券链接为空；
- 使用确定性公式生成优惠券名称、优惠比例、预估费用和 ROI；
- 删除模板说明行；
- 回读验证表头、行数、空白回填列和公式列。

## 5. 识别模型

### 5.1 工作簿输入

服务端只接受通过现有文件 Gate 的 `.xlsx`。解析器不得执行宏、外部链接或公式。发送给 DeepSeek 的内容包括：

- 文件角色候选、文件名和 source SHA-256；
- Sheet 名；
- 非空单元格的坐标、显示值和必要的公式/缓存值标记；
- 结构化输出 schema 和 P0 已支持的券型定义。

不得发送：

- 飞书 App Secret、bridge secret、open ID；
- Base/Drive token；
- 数据库、对象存储或管理端凭证；
- 与当前工作簿无关的环境配置。

工作簿中的文本一律视为不可信数据，即使单元格包含类似指令的内容，也不得改变系统 prompt、工具调用、权限、模板或提交行为。

### 5.2 DeepSeek 输出

输出必须通过严格 JSON schema 解析，至少包含：

- 文件角色候选；
- 优惠券类型候选；
- 单个或多个优惠券候选及其来源坐标；
- 字段候选、置信依据和来源坐标；
- 白/黑名单的 Sheet、标识列、ID 维度和可能对应的优惠券；
- 缺失字段、歧义和警告。

DeepSeek 不返回模板文件、不返回最终业务事实，也不返回“允许生成”或“允许提交”的决策。

### 5.3 本地验证与合并

DeepSeek 响应只有通过以下校验后才能成为候选：

- source hash 与当前 revision 一致；
- 引用的 Sheet、行、列和单元格真实存在；
- 数值、日期、比例、枚举和 ID 维度满足本地 schema；
- 优惠券门槛大于面额；
- 多券候选没有被静默合并；
- 名单候选没有被静默去重或跨券档混用；
- AI 值不能覆盖更高优先级的已确认源值。

候选合并优先级为：

```text
业务员当前 revision 的明确确认
  > 业务员有理由的显式覆盖
  > 原始 Excel 的确定性映射值
  > 业务员对源表缺失字段的补充
  > 已通过坐标验证的 AI 候选
```

## 6. 优惠券类型和多券异常

优惠券识别状态：

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| `unique` | 只有一个可靠候选 | 第二轮预填并要求业务员整体确认 |
| `ambiguous` | 存在多个合理券型候选 | 第二轮必选券型 |
| `unknown` | 无法识别券型 | 第二轮必选已启用券型 |
| `multiple_coupons` | 同一材料存在多个优惠券 | 第二轮必选本次实际优惠券及名单 Sheet |
| `unsupported` | 已识别但 P0 未登记生成规则 | 阻断生成，提示改用已支持流程或修正材料 |

P0 的可选券型初始只有 `常规满减券`。用户确认类型后，服务端按该类型重新计算缺失字段和名单映射。用户选择记录为 `ownerConfirmed`，不得伪装成 Excel 原值或 AI 事实。

多券异常时：

- 不自动拆分多套草稿；
- 不默认选择第一行、第一个 Sheet 或置信度最高候选；
- 展示每个候选的规范名称、来源 Sheet/单元格、可能的名单 Sheet 和 SKU 数量；
- 用户选择一个优惠券及其对应名单映射；
- 未选候选记录为本次排除，不进入 canonical package 或生成产物。

## 7. 第二轮补充与来源确认

第二轮卡片包含：

1. 优惠券类型；
2. 多券异常时的本次优惠券选择；
3. 配券字段、来源坐标和显式覆盖；
4. 缺失 OA 字段的补充；
5. 白名单 Sheet、SKU 列、ID 维度和数量；
6. 黑名单 Sheet/列/维度，或“本次无黑名单”；
7. 白黑名单重叠和处理决定；
8. AI 降级提示、警告和 blocker。

若用户先选择优惠券后才能确定剩余缺失字段，服务端可重新渲染同一个“第二轮补充与来源确认”阶段。这是同一业务阶段内的继续补充，不新增第三轮业务确认。

只有以下条件全部满足，才显示并接受“确认来源并生成标准附件”：

- owner、revision 和卡片 action 均为当前值；
- 优惠券类型已确认且为 P0 支持类型；
- 只保留一个优惠券；
- 所有必填字段已解析或由 owner 补充；
- 白名单映射唯一且有效；
- 黑名单状态已明确；
- overlap 决定已完成；
- 无未解决 blocker。

任何文件、类型、字段、覆盖、名单映射、黑名单状态或 overlap 决定变化都会创建新 revision，使旧卡片、确认和产物失效。

## 8. 运行架构与幂等

“自动调用”不等于在飞书事件同步入口执行 AI。同步入口只能校验、持久接收并快速返回；DeepSeek 调用必须在事件 receipt 之后由后台任务执行。

P0 数据流：

```text
Feishu 文件事件
  → bridge 验签与标准化转发
  → 服务端持久保存 receipt / 更新当前 draft revision
  → enqueue recognize_workbook task
  → 快速返回事件处理结果
  → P0 worker 读取同 revision 文件
  → 每个工作簿一次 DeepSeek 请求
  → 本地 schema/坐标校验
  → 保存结构化候选和 AI 审计摘要
  → 发送或更新第二轮卡片
```

AI effect 的语义幂等键至少绑定：

```text
draft_id + revision + source_role + source_sha256 + model + prompt_version
```

同一幂等键不得自动重复外发。响应丢失或结果未知时标记失败并使用本地回退；只有新 revision 或用户明确的重新识别动作才允许新请求。

该后台执行要求不把 Mac long-connection bridge 变成 AI worker，也不依赖 Vercel 请求返回后的非耐久后台任务。实现应复用现有 task/outbox/effect 边界；若当前 P0 尚未接通该边界，必须先完成最小接入，不能把 AI 调用塞回同步路由。

## 9. 生成与回读验证

第二轮确认后，服务端创建绑定 owner、revision 和 source hashes 的 canonical package。生成过程不再调用 DeepSeek：

1. 根据已确认券型选择登记模板；
2. 校验模板 SHA-256；
3. 生成标准配券表；
4. 生成单券档标准白名单；
5. 如黑名单状态为 `uploaded`，生成单券档标准黑名单；
6. 重新打开全部生成文件；
7. 校验字段、公式、Sheet、SKU、文本格式、行数和 hash；
8. 保存模板 ID/version、生成规则版本和产物审计元数据；
9. 只有全部验证成功后才把生成产物上传到 P0 Drive 文件夹并进入最终预览。

任一生成或回读步骤失败时，当前 revision 保持失败/待修正状态，不得返回成功、上传部分附件或创建 OA 草稿成功记录。

## 10. AI 失败与业务错误

| 场景 | P0 行为 |
| --- | --- |
| DeepSeek 超时、限流、网络错误 | 记录失败摘要，回退确定性识别和人工映射 |
| DeepSeek 上下文过长 | 不分块、不自动重试，回退本地流程 |
| DeepSeek JSON/schema 无效 | 丢弃响应候选，回退本地流程 |
| AI 引用不存在的坐标 | 丢弃对应候选并记录 warning |
| 优惠券类型未知/歧义 | 第二轮要求 owner 确认 |
| 多券异常 | 第二轮要求选择一个优惠券和对应名单 |
| 未支持券型 | fail closed，不使用“最接近”模板 |
| 白名单映射不唯一 | 第二轮要求选择；确认前不生成 |
| SKU 为空、公式、多个 ID 或前导零风险 | blocker，要求修正来源文件 |
| 黑名单未上传 | 必须明确确认“本次无黑名单” |
| 白黑名单重叠 | 必须选择已发布的 overlap 决定 |
| 模板 hash 或回读验证失败 | fail closed，不上传产物 |
| 重复点击、旧卡片或其他 owner | 幂等返回或拒绝，不重复生成/发卡 |

## 11. 配置与安全

新增 P0 专用、默认关闭的 feature flag；具体名称在实现计划中统一写入 `.env.example`。DeepSeek key、base URL 和 model 继续使用服务端环境变量，不进入客户端、卡片、日志、文档或测试快照。

启用条件：

- 仅 Preview/P0 环境；
- 仅当前 P0 allowlist 用户；
- 原生 OA 和生产三源开关保持关闭；
- DeepSeek secret 只在服务端 secret store；
- 明确超时、响应大小和错误分类；
- 日志不得出现完整工作簿内容、prompt、response、员工敏感信息或密钥。

AI 审计摘要包含：

- provider、model、prompt version；
- started_at、completed_at、duration_ms、status；
- request SHA-256、response SHA-256；
- validated candidate IDs 和来源坐标；
- fallback 原因；
- 不含完整原始请求或响应。

## 12. 模块边界

建议代码职责：

| 模块 | 职责 |
| --- | --- |
| `server/lib/feishu/deepseek-client.ts` 或新的通用 gateway | HTTP、超时、响应大小和 provider 错误；不放领域规则 |
| `server/lib/coupon-oa/three-source/ai-recognition.ts` | 请求 schema、候选 schema、prompt version、响应解析和本地坐标验证 |
| `server/lib/coupon-oa/three-source/recognition.ts` | 现有确定性识别和 AI 候选合并 |
| `server/lib/coupon-oa/three-source/types.ts` | 券型状态、多券异常、AI 摘要和 owner 确认契约 |
| `server/lib/feishu/coupon-oa/three-source/cards.ts` | 第二轮类型/优惠券/字段/名单确认卡 |
| `server/lib/control-plane/` | recognition task、effect、lease、幂等和重试边界 |
| `server/lib/excel-template-engine/` | 确定性配券表和单券档名单生成、模板指纹和回读验证 |
| `server/lib/feishu/coupon-oa/three-source/service.ts` | 编排，不承载 AI prompt 或 Excel 领域逻辑 |

## 13. 测试与验收

实现至少覆盖：

1. 单一常规满减券被识别，第二轮确认后生成配券表和单 Sheet 白名单。
2. 券型无法识别，第二轮由用户确认常规满减券，补齐字段后生成。
3. 同一配券表出现多个优惠券，第二轮选择其中一个，只生成所选优惠券产物。
4. 多券异常未选择时不能生成。
5. DeepSeek 超时、429、上下文错误、无效 JSON 和不存在坐标均回退本地流程。
6. 工作簿单元格包含 prompt injection 文本时，不改变 schema、模板或副作用。
7. AI 候选不能覆盖确定性值或 owner 已确认值。
8. 未支持券型不能使用相似模板生成。
9. 白名单公式、数值型前导零风险、空值、多个 ID 和重复策略均 fail closed。
10. 黑名单缺失必须显式确认；无黑名单时不生成空附件。
11. 重复事件、重复点击、worker 重启和 lease 竞争不重复外发 AI、不重复生成或发卡。
12. 旧 revision、错误 owner 和篡改 action 被拒绝。
13. 模板 SHA-256、生成文件公式、Sheet、SKU、文本格式和 hash 回读验证。
14. 日志和测试快照不包含完整 prompt、response、工作簿内容或 secret。
15. P0 全流程保持 native OA 创建/提交为关闭状态。

验证命令应包含受影响测试、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，并在 mock/fake 环境覆盖全部外部 DeepSeek、Feishu、Drive 和 Base 调用。真实 P0 E2E 必须在本地测试通过、用户单独确认外部测试后执行。

## 14. 文档与架构记录

实现前需新增 ADR，记录：

- 在 P0 中引入 DeepSeek 作为非事实源的候选识别服务；
- 完整工作簿外发的已确认范围和隐私边界；
- AI 必须异步执行且不能进入事件同步入口；
- 一次提报只允许一个优惠券；
- 第二轮确认后才允许确定性模板生成；
- P0 feature flag、回退和 kill switch。

同时更新当前产品基线、实现基线、P0 runbook、`.env.example` 和相关 rollout Gate。设计和计划本身不授权部署、修改 Vercel/Feishu 配置或执行真实外部业务副作用。
