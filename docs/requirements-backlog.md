# 跨产品需求排期 Backlog

> **用途**：记录已确认、但尚未进入当前实施范围的跨产品需求。每项必须明确当前状态、前置条件、验收口径和权威来源；本清单本身不表示功能已上线或已获飞书访问权限。
>
> **维护规则**：已进入实施的事项应迁移到对应产品的 `current/`、`proposals/` 或实施计划，并在此处保留链接和状态；已完成事项保留完成日期与验证证据。

## 优先级与状态

- **P0**：当前最小可演示交付；范围冻结后一次实现、一次聚焦 review 和一次受控验证，不自动扩大为正式运行能力。
- **P1**：下一个明确交付批次；前置条件已基本满足。
- **P2**：已确认方向，等待配置、权限或产品设计冻结。
- **规划中**：已记录，尚未进入开发排期。
- **未开始**：需求已冻结，等待开发启动。
- **已完成**：实现、验证和所需上线 Gate 均已完成。

## 优惠券 OA 提报

| ID | 事项 | 状态 / 优先级 | 前置条件与范围 | 验收口径 | 权威来源 |
| --- | --- | --- | --- | --- | --- |
| OA-POC-001 | 严选三源最快 Bot POC → OA 测试稿 | 当前优先 / P0 | 单用户、`严选`、常规满减券、SKU、direct HTTP、标准附件和既有 OA 测试稿；复用现有 adapter，不创建原生 OA。 | 一次脱敏 E2E 成功生成标准附件和 OA 测试稿；native kill switch 始终关闭，审批中心无新增实例。 | [P0 交付计划](oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md) |
| OA-BL-001 | 业务员身份 → 默认业务模式候选 | 规划中 / P2 | 以后端已验证的飞书 `open_id` 为唯一主键维护默认业务模式；配置需包含启用状态、版本、维护人和更新时间。显示姓名只能展示，不能作为映射主键。 | 有效映射只生成带来源的候选；业务员仍可在第二轮/最终确认中确认或覆盖；缺失、失效或身份不唯一时回退人工确认；候选、覆盖原因和操作者进入 revision 审计。 | [三源后续迭代计划 §3.2](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-follow-up-iteration-plan-v1.md#32-业务模式当前人工确认后续身份映射候选) |
| OA-BL-002 | 飞书配券节奏表 API 日期候选 | 规划中 / P2 | 仅受认证服务端可读取业务方维护的配券节奏表；需先冻结表结构、业务时区、跨年规则、当前日期匹配规则、多行优先级、权限、Owner 与 feature flag。客户端、本地 Skill 和本地案例脚本不得直连。 | 按当前日期匹配唯一节奏行并生成含年份日期候选；记录行标识、读取时间、表版本/更新时间、匹配规则和审计 hash；无命中、多命中、权限/API 错误或数据不完整时回退人工确认，绝不猜测。 | [三源后续迭代计划 §3.3](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-three-source-follow-up-iteration-plan-v1.md#33-活动日期当前人工识别后续配券节奏表候选) |

## 耐久控制面风险整改

> 具体的 P1 耐久化需求拆分、FDEV 生命周期、测试 Agent 门禁与 R1-dev/R2 Gate 以[飞书 P1 耐久化与正式运行需求台账](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md)为准；风险定义以[耐久控制面风险整改开发清单](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md)为准。以下是 P1 跨产品排期索引，均受 FDEV-001 🥇 阻断；它们不阻断 `OA-POC-001`。

| ID | 事项 | 状态 / 优先级 | 前置条件与范围 | 验收口径 | 权威来源 |
| --- | --- | --- | --- | --- | --- |
| CP-BL-001 | durable bridge ACK / transport outbox | 未开始 / P1 | **FDEV-002 / CP-RISK-001**；以官方 SDK 替代开发 `lark-cli` bridge；不得在数据库持久化前 ACK。 | 断网、202 丢失、restart 下零消息丢失且 receipt/outbox 唯一。 | [FDEV-002](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-002 | 外部 effect timeout 与 lease fencing | 未开始 / P1 | **FDEV-003A / CP-RISK-002**；card effect 必须有 timeout、lease renewal 与未知结果语义。 | 慢请求、lease expiry 下不重复发卡，旧 lease 不能落库。 | [FDEV-003A](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-003 | effect task/owner/hash 完整性绑定 | 未开始 / P1 | **FDEV-003B / CP-RISK-003**；claim 时重验 task、revision、owner 与 request hash。 | 篡改 payload、owner、task 或 revision 时零 gateway 调用。 | [FDEV-003B](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-004 | unknown/DLQ 对账闭环 | 未开始 / P1 | **FDEV-004A / CP-RISK-004**；添加 read-only 查询、受审计人工决定与受限 replay。 | unknown/DLQ 在阈值内可见、可处置、可审计，未知副作用不自动重发。 | [FDEV-004A](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-005 | worker/bridge 健康、指标与运行手册 | 未开始 / P1 | **FDEV-004B / CP-RISK-005**；readyz、backlog、告警和 runbook。 | DB/backlog/DLQ/unknown/scheduler failure 可见、告警且 fail closed。 | [FDEV-004B](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-006 | 数据治理、保留、脱敏与 RBAC | 未开始 / P2 | **FDEV-004C / CP-RISK-006**；定义 payload/audit/effect retention、redaction、backup/RBAC。 | 不泄露 payload/标识；retention/restore/least privilege 均可验证。 | [FDEV-004C](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-007 | 受控对象存储 | 未开始 / P2 | **FDEV-007 / CP-RISK-007**；R2 前的 immutable object adapter、权限、加密与恢复。 | object hash、重复 key、权限和 outage 均 fail closed，可恢复验证。 | [FDEV-007](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |
| CP-BL-008 | PostgreSQL 故障注入矩阵 | 未开始 / P2 | **FDEV-007 / CP-RISK-008**；已有局部 foundation，仍需 rollback/CAS/effect recovery/retry-DLQ fault injection。 | 任一失败不留下半成 task/audit/effect/outcome，恢复后保持一次性语义。 | [FDEV-007](oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md#2-p1-canonical-fdev-顺序与当前队列) |

## 已知当前范围

- 当前三源本地流程对业务模式和带年份的活动日期仍采用人工确认；没有读取业务员映射或飞书配券节奏表。
- 本 Backlog 的事项不得被用于宣称已可提交原生 OA，也不得绕过现有 `draft-only`、审批定义、权限或 rollout Gate。
