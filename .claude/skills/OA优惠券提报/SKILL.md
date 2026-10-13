---
name: OA优惠券提报
description: 优惠券 OA 综合提报合同。以配券表为字段第一来源，收集必传白名单、可选黑名单，生成已填充标准配券表截图，完成来源映射、黑名单缺省/重叠决策、标准产物与 OA 预填的两次确认。Claude Code 中仅执行本地零副作用评审和底稿准备；飞书 Bot 目标入口为 /OA优惠券提报，必须由受认证服务端执行。用户输入 /OA优惠券提报，或说「优惠券提报」「配券表白名单黑名单提 OA」时使用。
---

# OA 优惠券提报（综合版）

> **唯一命令**：`/OA优惠券提报`。
>
> **执行平面必须区分**：本文件在 Claude Code 中定义本地交互和零副作用校验；它不是飞书 Bot 可自动加载的运行时代码。飞书端的同名命令必须由 `server/lib/feishu/` 的路由、状态机、权限和上线 Gate 实现。
>
> **当前状态**：综合业务合同与飞书适配目标已定义；本地 Skill 可做零副作用评审。R0.5 本机 `lark-cli` → Vercel 仅能做 transport smoke，不能执行此 Skill 的 Bot 业务流程；完整三源流程仍待服务端实现、FDEV Gate 与 Owner 评审。除非服务端实现并通过 R2/R3 Gate，不能称为已在飞书上线，也不能创建原生 OA。
>
> **权威来源**：[三源优惠券 OA 填报 PRD v1](../../../docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-workflow-prd-v1.md)、[飞书综合 Skill 升级方案](../../../docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)；架构与上线 Gate 以 `docs/adr/` 和 `docs/oa-ticket-reimbursement-materials/current/operations/` 为准。
>
> **字段、边缘与运行边界**：[references/fields.md](references/fields.md) · [references/edge-cases.md](references/edge-cases.md) · [references/runtime-boundaries.md](references/runtime-boundaries.md)。若内容冲突，权威文档优先于本 Skill。

## 1. 目标与不可变边界

本 Skill 统一原“OA 优惠券填报”的本地底稿能力与“三源填报”的材料、映射和确认规则，目标业务链路为：

```text
原始配券表 + 原始白名单 + 原始黑名单（或明确无黑名单）
  → 版本化标准数据包
  → 标准配券表 / 标准名单 / 已填充标准配券表截图
  → 第一次确认：映射、补充、无黑名单/重叠决策
  → OA 预填快照
  → 第二次确认：确认最终预览
  → 创建或更新既有 OA 测试稿
  → 用户在既有草稿执行明确“发送”
  → 仅在服务端 native-submit Gate 开放时创建并回读飞书原生 OA
```

每次执行均须遵守：

1. **配券表是业务字段第一来源**；补充文本只能填补缺项，或在展示原值、覆盖原因和确认人后显式覆盖。
2. **白名单必传**；黑名单不上传不等于无黑名单，必须由业务员明确确认“本次无黑名单”。黑名单无效、空表或解析失败绝不能自动降级。
3. **不默认名单优先级**。白黑名单有交集时，必须由业务员选择白名单优先、黑名单优先或替换源文件。
4. **源文件只读且不能直接进入 OA 附件**。正式附件只能是同一 revision 的标准生成产物；必传图片从已验证、已填充的标准配券表完整渲染，不能从原始源表或自由上传图片推断业务内容。
5. **AI 只能给候选**，不能补造业务事实、决定映射/冲突/模板/审批路径，也不能替代确定性校验。
6. **本地 Skill 不调用** Base、Drive、飞书消息、审批、OA 或表单写入 API；不运行 Shell/脚本以外的外部副作用。
7. **原生 OA 创建就是提交**。只有当前 owner 在当前 revision 的最终确认，且服务端阶段、allowlist、模板、附件、幂等和审批定义 Gate 均通过时，受认证服务端才可创建并回读；不设置审批人、抄送人或审批路由。

本 Skill 不支持未登记券型、未登记模板、未知 ID 维度、未经确认的字段映射、群聊协作、批量提报或“直接把任意原表传入 OA”。

## 2. 两个执行平面

| 平面 | 入口 | 可做 | 明确不可做 |
| --- | --- | --- | --- |
| Claude Code 本地 | `/OA优惠券提报` | 收集本地文件路径、解析/审阅候选、生成本地底稿和待确认清单、复用零副作用离线验证 | 共享 Bot 草稿、写 Base/Drive、上传审批附件、调用 OA API、宣称飞书已提交 |
| R0.5-manual-smoke | 测试 Bot → Mac `lark-cli` / 本机 bridge → Vercel ingress | 验证已到达 Vercel 的 HMAC transport、receipt/outbox 与安全拒绝；核对脱敏证据 | 执行 `/OA优惠券提报`、运行 worker tick、创建 task/effect/card/file/OA、回复用户、宣称 durable ACK/retry/R1-dev |
| 飞书 Bot 目标运行时（R1-dev/R2） | 业务员在测试 Bot 单聊发送 `/OA优惠券提报` | 服务端创建/恢复系统任务、收集飞书材料、卡片确认、保存审计、生成 draft-only 产物并交接既有 OA 测试稿 | 由卡片或 Bot 自行授权、把源表直接作为 OA 附件、绕过服务端 Gate |
| 服务端 native-submit（仅 R3/R4） | 既有 OA 测试稿的明确“发送”动作 | 重验 owner/revision/hash/审批定义、提升冻结产物、创建并回读原生 OA | 使用本地 Skill 或客户端凭据创建 OA、盲目重试未知结果 |

当前已生效的 `OA优惠券审批` 手工导航与 `优惠券Excel试点` 受限流程不属于本 Skill 的替代范围；在新服务端路线完成评审和上线前，仍按各自当前文档执行。

## 3. 材料与事实来源

| 材料 | 必传 | 作用 | 本地/飞书共同规则 |
| --- | ---:| --- | --- |
| 原始配券表 `.xlsx` | 是 | OA 字段、券档、费用/GMV 等业务事实的第一来源 | 允许任意布局；识别 Sheet、表头、说明行、数据行和字段候选，无法唯一映射时追问 |
| 原始商品白名单 `.xlsx` | 是 | 本次纳入范围的第一来源 | 确认 Sheet、列和 SKU/SPU/商家 ID 维度后才能使用 |
| 原始商品黑名单 `.xlsx` | 否 | 本次排除范围的第一来源 | 未上传时必须确认“本次无黑名单”；上传但无效必须阻断 |
| 已填充标准配券表截图 | 是（系统生成） | 当前 OA 的必传图片附件 | 仅从同一 revision 已验证的标准配券表完整渲染；记录源产物 hash、渲染范围和图片 hash |
| 业务员补充文本 | 条件必需 | 补充配券表未覆盖的必填字段或说明显式覆盖 | 与配券表冲突时展示两值、来源和影响，覆盖必须留理由 |
| 飞书身份（仅 Bot） | 系统提供 | 最终申请人和部门候选 | 申请人以最终确认人的 `open_id` 为准，不以表格人名冒充 |

文件可以乱序到达。文件名只能作为角色候选提示，不能单独决定“配券表/白名单/黑名单”；应根据 Sheet、表头、数据类型、样例和已发布规则识别。当前本地预览可使用：

```bash
python3 .claude/skills/OA优惠券提报/scripts/parse_xlsx.py "文件.xlsx"
python3 .claude/skills/OA优惠券提报/scripts/parse_xlsx.py "文件.xlsx" --all
python3 .claude/skills/OA优惠券提报/scripts/parse_xlsx.py "文件.xlsx" --sheet "Sheet 名"
python3 .claude/skills/OA优惠券提报/scripts/parse_xlsx.py "文件.xlsx" --agg 'SKUID:unique_count'
```

该脚本只是标准库 `.xlsx` 预览和统计工具，不证明字段映射、模板适配或 OA 可提交性。

## 4. 综合交互流程

### 4.1 发起与接收

收到命令后，先说明并收集材料，不因自由文本不足而要求业务员重填整份 OA 表单：

```text
【OA 优惠券提报】请发送以下材料（可分多条、乱序发送）：
1. 原始配券表（必传，.xlsx）
2. 原始商品白名单（必传，.xlsx）
3. 原始商品黑名单（可选，.xlsx；不上传时需确认“本次无黑名单”）
4. 已填充标准配券表截图（系统在标准配券表验证后生成；不要求上传）

配券表缺失的 OA 必填字段、映射冲突或业务说明，我会只追问对应的最小项目。
```

本地执行时，材料必须以本地文件路径提供；飞书运行时，由服务端以当前任务 owner 的消息资源引用接收。用户取消时，本地不写文件；飞书运行时由服务端把当前 revision 标记为已取消，且不创建 OA。

### 4.2 解析、映射与第一次确认

系统/本地评审应展示：

- 配券表字段与标准 OA 字段的候选映射、源 Sheet/单元格/原值；
- 白名单和黑名单使用的 Sheet、列、ID 维度、数量、重复和异常样例；
- 配券表缺失的 OA 必填字段，以及补充内容与源表的冲突；
- 黑名单状态：`uploaded`、`absent_pending_confirmation`、`absent_confirmed` 或 `invalid`；
- 白黑名单交集的数量、样例和完整冲突清单（如存在）。

只有下列内容均由业务员完成**第一次确认**后，才可生成当前 revision 的标准数据包：

1. 配券表字段映射和任何显式覆盖；
2. 白名单 Sheet、列和 ID 维度；
3. 黑名单 Sheet、列和 ID 维度，或明确的“本次无黑名单”；
4. 缺失 OA 字段的补充值；
5. 白黑名单重叠的处理决定（白名单优先、黑名单优先，或替换源文件）。

任何源文件、映射、补充值、黑名单状态或重叠决定变化，都必须生成新 revision，使旧确认、标准产物和确认卡失效。

### 4.3 标准产物与最终预览

第一次确认后，同一 canonical revision 才可生成或准备：

- 标准配券信息表；
- 标准商品白名单；
- 已上传黑名单时的标准商品黑名单；
- 未上传黑名单时的“本次无黑名单”审计记录（**不**伪造空附件）；
- OA 预填快照，包括字段、来源、计算结果、模板版本、附件、警告与 blocker；
- 从同一 revision 已填充、已验证的标准配券表生成的图片附件，及其源产物 hash、渲染范围和图片 hash。

源文件、标准产物和 OA 预填快照都必须保留文件名/角色、字节数、SHA-256、来源/生成 revision 与模板或映射版本。飞书 native-submit 路线在提升为审批附件前必须重新下载冻结产物并重验 hash。

### 4.4 第二次确认与阶段边界

最终预览必须同时显示所有 OA 字段及来源、标准附件名称/行数/hash、黑名单状态、重叠决定、计算结果、警告、当前 revision 和未解决 blocker。

| 阶段 | 第二次确认含义 | 允许副作用 |
| --- | --- | --- |
| 本地 Claude Code | 确认本地评审/底稿内容 | 仅生成 Git 忽略的本地评审产物；不共享到飞书 |
| R2 draft-only | 确认冻结产物和 OA 预填快照，并创建/更新既有 OA 测试稿 | 保存系统草稿、Drive/Base 引用及审计；禁止 `POST /approval/v4/instances` |
| R3/R4 native-submit | 在既有 OA 测试稿执行明确“发送” | 服务端重验 Gate、即时提升已验证产物、创建并回读一笔原生 OA |

第二次确认只能由当前 owner 在当前 revision 操作；它只授权创建或更新既有 OA 测试稿，不等于原生 OA 已发送。后续既有草稿的明确“发送”动作必须再次校验 owner、revision、源/产物 hash、模板、审批定义 hash、allowlist、kill switch 和业务幂等 key；创建结果未知进入 `SubmissionUnknown` 对账，创建后回读不一致进入 `CreatedNeedsReview`，均不得显示盲目重提。

## 5. 本地输出与飞书运行时合同

### 5.1 Claude Code 本地输出

本地需要生成可审阅材料时，仅写入 Git 忽略的：

```text
docs/oa-ticket-reimbursement-materials/drafts/<YYYYMMDD-HHmm>-<活动名slug>/
```

建议包含：

| 文件 | 内容 |
| --- | --- |
| `oa-form-draft.md` | OA 字段、值、来源、附件清单、黑名单状态、重叠决定与待确认项 |
| `fields.json` | 机器可读的字段、来源、附件元数据、映射、确认和 revision 草稿 |
| `validation-report.md` | 阻断项、警告、信息提示、口径核对和需要业务确认的问题 |

这些文件不是飞书系统草稿、Drive 文件或 OA 附件；本地执行成功绝不意味着飞书 Bot、Base、Drive、审批权限或 native-submit 已验证。

### 5.2 飞书 Bot 目标运行时合同

飞书端的 `/OA优惠券提报` 必须由服务端任务而非本地文件承载。其运行边界按阶段不同：

```text
R0.5-manual-smoke（当前可选 transport 验证）
  Feishu 测试事件
    → Mac：lark-cli + 本机 bridge
    → 签名 Vercel /api/feishu/bridge
    → PostgreSQL receipt/outbox
    → 脱敏证据核对；不回复用户、不处理业务

R1-dev/R2/R3（后续服务端目标）
  Feishu 消息 / Card action
    → FDEV-002 后的 durable long-connection runner 或已实现的 HTTP callback
    → 已验签、去重、持久接收的 Nitro ingress
    → Coupon command dispatcher / 三源任务服务
    → R2：冻结产物和既有 OA 测试稿 handoff
    → R3/R4：既有明确“发送”动作通过 Gate 后的 Approval gateway
```

卡片回调只应表达“哪位用户对哪个 task/revision 做了哪个动作”；不能携带或覆盖最终字段。Bot、transport adapter、AI、卡片和本地 Skill 都不能决定最终授权或绕过服务端状态机。任何用户可见回复必须是持久 effect worker 的幂等结果，不得从 ingress 同步发送。

## 6. 必须阻断的情况

- 缺少配券表或白名单，或无法从已验证标准配券表完整生成当前 OA 必传图片；
- 黑名单既未上传也未明确确认无黑名单，或黑名单已上传但无效；
- 文件不可安全解析、不是 `.xlsx`、超出已发布大小/行数限制，或角色/Sheet/列/ID 维度存在歧义；
- 名单空值、公式、多 ID 单元格、前导零风险、未解决重复、白黑名单维度不一致或未解决重叠；
- 未登记券型、模板/模板 fingerprint 不匹配，或无法生成可重新验证的标准产物；
- 必填 OA 字段缺失，字段冲突/金额/ROI/日期无效，或业务口径未决定；
- 旧 revision、非 owner 操作、确认快照过期、审批定义变化或产物 hash 不一致；
- native-submit 条件缺少 stage、allowlist、kill switch、审批定义、完整材料、幂等 claim 或可审计的创建状态。

新场景未被字段字典或边缘规则覆盖时，停在“待业务确认”；不得猜测、静默降级、上传源文件或创建 OA。

## 7. 实施与联调提示

将本 Skill 接入实际飞书测试前，必须按[飞书综合 Skill 升级方案](../../../docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)、[运行阶段参考](references/runtime-boundaries.md)和 FDEV 台账推进：

1. 评审并冻结首期券型、字段映射、白/黑名单模板、审批定义和责任 Owner；
2. 复跑 `pnpm test:coupon-three-source:offline` 等零副作用验证；
3. 如只验证 Mac 长连接至 Vercel，按 ADR-0008 执行 R0.5：测试普通非命令文本、所有业务 Gate 和 Bot 回复关闭、只核对 receipt/outbox；它不验证此 Skill 的业务流程；
4. 依次完成 FDEV-001 baseline、FDEV-002 durable ingress、FDEV-003A/003B effect safety、FDEV-004A–004C 对账/观测/数据治理、FDEV-005 环境预检，并在每项实现冻结后交由新的 Test-Plan Agent 和独立 QA/Test 验收；
5. 仅在 FDEV-006 🥇 后进行 R1-dev command/task/card canary；仅在 FDEV-007 🥇 后实现完整 R2 三源材料、两次确认、标准产物/截图和既有 OA 测试稿 handoff；
6. 仅在 FDEV-008 🥇 后，才在隔离测试 OA 中验证既有明确“发送”路径的 R3 canary。

任何被定义为“上线前待实现”的配置、权限或服务端控制，都不能由本 Skill 的存在、本地测试通过、R0.5 transport smoke 或某一次 Bot 卡片成功替代。
