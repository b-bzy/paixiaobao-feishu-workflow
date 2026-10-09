# 优惠券 OA 智能提单 MVP PRD v1.3

> **状态**：当前通用产品边界；具体 Excel 范围以 [P1 Excel 试点 PRD v1.5](coupon-oa-p1-excel-pilot-prd-v1.5.md) 为准。
> **日期**：2026-10-08
> **替代关系**：替代 v1.2 对 P1/P2“永不服务端提交”的过期描述；v1.2 仅保留为历史 P0–P2 演进基线。
> **架构前提**：[ADR-0004](../../../adr/0004-bot-confirmed-submit-for-coupon-oa.md) · [内网试点 rollout](../operations/coupon-oa-internal-pilot-rollout-plan-v1.md)

## 1. 目标与不可变原则

目标是降低优惠券提单的重复录入成本，同时不替代现有 OA 的审批决定、审批路由或业务最终核对。

1. 未确认工作保存为系统业务草稿；飞书没有可 API 写入的客户端 OA 草稿。
2. 原生审批实例创建就是提交。系统绝不自动、静默或基于旧卡片创建 OA。
3. 只有当前草稿 owner 在当前 revision 的明确确认，且服务端阶段、allowlist、审批定义、材料、幂等和授权门禁均通过时，才可能由服务端创建实例并回读。
4. 服务端不设置节点审批人、抄送人或路由；AI 不得补造业务事实或越过确定性校验。
5. `OA优惠券审批` 的手工原生页面导航始终与程序化创建分开；人工提交不代表系统 native-submit 已开放。

## 2. 三路线合同

| 口令/路线 | 目的 | Draft-only | Native-submit 阶段 |
| --- | --- | --- | --- |
| `OA优惠券审批` | 返回既有原生 OA 发起入口 | 不写草稿/附件/实例 | 保持仅导航；用户手工提交是原生 OA 自己的行为 |
| `OA优惠券填报` | 收集结构化字段及材料，形成系统草稿 | 可校验、预览、修改系统草稿；禁止原生实例创建 | 仅 allowlist 用户在当前 revision 最终确认后可创建并回读 |
| `优惠券Excel试点` | 根据受限规则生成券表和白名单并交接草稿 | 冻结产物/哈希/引用，绝不自动创建 OA | 只由后续最终确认路径即时提升批准的产物；本流程不直接提交 |

## 3. 分阶段范围

| 阶段 | 允许能力 | 明确禁止 |
| --- | --- | --- |
| P0 导航 | 原生 OA 链接卡 | 代填、附件写入、草稿、实例创建、审批 |
| Draft-only 内网试点 | 系统草稿、受控文件解析/生成、hash、预览、人工补件 | `POST /approval/v4/instances`、自动/静默提交、扩大至未批准用户 |
| Native-submit canary | 对严格 allowlist 的一至两位用户，在值守窗口内创建/回读一次原生 OA | 批量、无监控、越过 revision/owner、未知结果盲目重试 |
| 严格 allowlist 试点 | 已通过 canary 的小范围同类能力 | 面向全员或生产 SLA/HA 承诺 |
| 生产 | 另行技术/合规/架构决策 | 将试点通过自动解释为生产批准 |

## 4. 服务端原生提交门禁

以下条件必须同时为真；卡片展示不能代替这些检查：

- launch stage 明确允许、global kill switch 打开、用户位于服务端 allowlist；
- 目标是批准的原生 `approval_code`，定义 hash 与确认时快照一致；
- 操作者是草稿 owner、action 属于当前 revision、确认仍有效；
- 必填字段、附件、产物 hash 与审批文件引用完整；
- 已原子占用持久 business idempotency key；
- 上一次提交不存在未对账的 `Submitting`、`SubmissionUnknown` 或 `CreatedNeedsReview` 状态。

任何条件不满足，服务端只返回安全的阻断/恢复提示，不调用创建实例 API。

## 5. 原生提交与异常状态

- `Submitted`：实例已创建且要求的 readback 比对通过。
- `CreatedNeedsReview`：已确认存在实例，但回读失败或字段存在差异；自动化停止，转 OA/运行 Owner 对账。
- `SubmissionUnknown`：创建请求结果无法证明；禁止创建第二笔，必须按 submission key/实例查询/审计证据对账。
- `Failed`：仅在确认没有创建原生实例时使用。

服务端保留确认人、时间、revision、schema、审批定义 hash、submission key、实例 code/link、readback 与差异证据。审批状态的后续同步与人工撤回/驳回由流程 Owner 明确负责。

## 6. 试点验收与非目标

试点验收以 rollout 的 R/Gate 为准，至少包括：fail-closed 配置、managed bridge 鉴权与去重、草稿/附件 E2E、Drive/Base/审批权限、重放/重启/故障测试、kill switch 和回滚演练。完成草稿阶段不自动授权原生 OA canary。

本版本不承诺生产数据库、队列、HA、跨区域恢复、全量审批生命周期、病毒/深度文件扫描、通用 AI 数据治理或全员开放。上述能力需另行实施和决策。
