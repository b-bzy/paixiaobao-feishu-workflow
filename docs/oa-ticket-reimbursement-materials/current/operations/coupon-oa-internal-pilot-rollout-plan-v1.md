# 优惠券 OA 内网试点 rollout 计划 v1

> **状态**：上线治理基线；不是部署完成证明。
> **日期**：2026-10-08
> **适用架构**：[ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)

## 1. 目标

以受控、可回退的方式验证三条优惠券路径，而不把本地可运行结果等同于生产发布：

| 路线 | 固定边界 |
| --- | --- |
| `OA优惠券审批` | 仅导航到既有 OA；服务端不创建草稿或原生实例。 |
| `OA优惠券填报` | 系统草稿与确认流程；在允许 native-submit 前仅可操作草稿。 |
| `优惠券Excel试点` | 生成并冻结两份受控 Excel 后交接系统草稿；自身永不自动创建原生 OA。 |
| `/OA优惠券提报`（仅 `direct-http-draft-poc`） | 单用户严选三源材料 → 标准附件 → OA 测试稿；不是 R1/R2/R3 路线，不创建原生 OA。 |

## 2. 角色与原则

每一阶段开始前，在 readiness checklist 填写以下角色：业务 Owner、OA 流程 Owner、飞书应用管理员、平台/安全 Owner、bridge 运行 Owner、值守人和工程/QA Owner。缺少任一责任人即 no-go。

- 草稿阶段通过，不等于原生 OA 阶段通过；内网试点通过，不等于生产通过。
- 卡片隐藏不是授权边界。所有阶段、allowlist、owner、revision 和审批写入限制必须由服务端再次判定。
- 证据必须有环境、日期、审阅人和可重验引用；截图或历史单次成功不能单独作为 go 依据。

## 3. 阶段与 Gate

| Ring | 可开放范围 | 允许副作用 | 进入条件 | 扩大/退出条件 |
| --- | --- | --- | --- | --- |
| R0 离线/模拟 | 合成样本、mock | 无飞书真实写入 | 单测、合同测试、脱敏 fixture、文档 G0 | 任一语义不一致回到设计 |
| R1 托管 bridge 测试 | 指定测试账号、隔离资源 | 事件接收与草稿测试 | managed bridge、签名、outbox、去重、监控、G1/G2 | 失败、积压或认证异常暂停 |
| R2 内网 draft-only | 严格 allowlist 的业务员 | 草稿、冻结产物、Base/Drive 记录；**禁止创建原生 OA** | R1 通过，三路线 E2E、权限/文件验证、G3 | 任何意外原生实例、重复/泄露立即退回 |
| R3 原生 OA canary | 1–2 名具名用户、值守窗口 | 当前 revision 的显式确认后创建并回读一笔原生 OA | G4、`SubmissionUnknown` 对账、kill switch 与回滚演练 | 一例重复/越权/无法对账即停止 |
| R4 严格 allowlist | 预批准的小范围用户 | 同 R3 | canary 结果获业务/OA/安全/运行 Owner 书面确认 | 扩大名单需重复审核；不含生产批准 |
| R5 生产决策 | 不在本计划内 | 另行 ADR/技术选型后决定 | HTTP callback/持久化基础设施/合规等生产门禁 | — |

### 3.1 `direct-http-draft-poc` 文档标签

`direct-http-draft-poc` 是 [ADR-0009](../../../adr/0009-timebox-direct-http-callback-for-three-source-draft-poc.md)定义的单用户、限时直接 HTTP 测试标签：飞书开发者服务器回调直接进入 Vercel `/api/feishu/process`，仅验证严选三源材料、标准附件和 OA 测试稿。

它**不是** `FEISHU_RUNTIME_STAGE`、本表中的 release ring、R1/R2/R3 Gate 通过证明或 native-submit 授权。运行时仍处于 `local` legacy POC 边界：没有 durable receipt/outbox、异步 worker、可恢复重放或原生 OA 提交资格。完成该 POC 的唯一正向结论是“受限 Bot 子集能创建 OA 测试稿且没有创建原生实例”。

直接 HTTP POC 的配置、测试、停止和证据要求见[运行手册](coupon-three-source-direct-http-poc-runbook-v1.md)。出现超时、重复、重启、Base/Drive 故障、事件加密或任何原生实例迹象时，立即关闭三源 pilot flag/事件订阅；不得按 R1/R2 的 bridge/outbox 流程假定可恢复。

### G0 — 文档与责任

- ADR-0006、架构基线、产品 PRD、rollout 和 runbook 使用同一条 route matrix。
- 试点规模、数据分类、业务可见范围和 Owner 已批准。
- ADR-0005 被保留；本计划不把三源提议流程表述为已上线。

### G1 — Fail-closed 配置与授权

- 未设置或冲突的 launch stage 必须禁止 native submit；不能因 `FEISHU_COUPON_OA_MODE` 缺失而默认为 production。
- 全局 native-submit kill switch、服务端 allowlist、批准 approval code、当前 owner/revision、完整附件与审批定义 hash 均需同时满足。
- 对未授权用户的发起、附件、卡片 action、确认与提交均 fail closed。
- draft-only 环境的 API/审计证据证明不发生 `POST /approval/v4/instances`。

### G2 — Managed bridge

- bridge 在企业托管、非 root、受监督环境运行；不依赖电脑、`nohup`、个人登录或 `/tmp` 日志。
- 两个 consumer 可独立恢复；签名、时间窗、nonce、持久 outbox、稳定标识和 transport 去重均已验收。
- 仪表和告警能显示 bridge/consumer、活动、outbox、重连、认证、失败与延迟；runbook 已由非作者走读。

### G3 — Draft-only E2E

- 对每个启用路线至少完成三次正常 E2E，以及跨路线冲突、旧卡、重试、bridge/Nitro 重启、Drive/Base/AI/下载故障等注入测试。
- 重复事件、重放与超时不会重复生成草稿、产物、附件或卡片状态变迁。
- 源白名单从不成为 OA 附件，冻结产物 hash/revision 可核对。
- 所有失败给用户安全可理解的结果，不泄露 secret/内部 payload。

### G4 — Native-submit 能力证据

- 应用版本已发布并获批准；Bot 可见性仅限试点人群。
- 对目标定义完成：read definition、create/get instance、approval attachment upload、用户发起资格、`is_external=false`、definition hash、撤回/驳回责任的当前证据。
- 原子业务幂等 key、`Submitting`/`SubmissionUnknown`/`CreatedNeedsReview` 对账与告警已经实施和测试。
- 隔离审批定义上的 manual/API 路径对比报告已完整填写。

### G5 — Canary 与扩容

- 具名 canary 在值守窗口内完成，业务/OA Owner 核验字段、附件、申请人、节点和路由。
- 重复点击、并发 callback、readback 失败与 definition drift 均已预演；回滚先于扩大名单演练。
- 每次扩大 allowlist 都有时间、人数、Owner 和观察期记录。

## 4. 立即暂停与回滚

**立即暂停条件：**重复 OA、非 allowlist 用户副作用、无效/未签名请求被接收、approval code/definition hash 不一致、业务含义 readback 差异、`SubmissionUnknown` 无法及时对账、outbox 异常积压、认证循环、敏感日志泄露，或源文件被提升为 OA 附件。

**回滚顺序：**

1. 关闭服务端 native-submit kill switch；保留证据与日志。
2. 如事件完整性仍可信，可保留 draft-only；否则关闭相关路线并由 supervisor 停止 bridge intake。
3. 冻结 allowlist 与应用可见范围，保存收据、outbox、草稿、hash 与审批引用。
4. 对账 `Submitting`、`SubmissionUnknown`、`CreatedNeedsReview`；禁止删除或盲目重建已存在 OA。
5. 经业务 Owner 许可，可引导用户使用 `OA优惠券审批` 手工路线；它与自动化 native submit 回滚独立。
6. 完成事件复盘、修复和失败 Gate 重验后才可重新开放。

## 5. 当前未完成项

当前仓库的本地桥、Vercel ingress、Base 状态并发、文件安全、DeepSeek 数据治理、审批生命周期同步、生产管理端身份与完整可观测性均不是本计划的“已完成”前提。它们必须在对应 Gate 提交证据后才可被视为具备能力。
