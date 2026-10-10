# ADR-0009：已废止的三源优惠券直接 HTTP draft-only POC

- **状态**：已被 [ADR-0010](0010-timebox-local-long-connection-three-source-poc.md) 取代；保留为历史，不得按本文配置或执行当前 P0。
- **日期**：2026-10-10
- **决策 Owner**：优惠券流程 Owner、工程 Owner、飞书应用管理员
- **关联**：[ADR-0010](0010-timebox-local-long-connection-three-source-poc.md) · [ADR-0002](0002-use-http-callback-as-event-ingress.md) · [ADR-0006](0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) · [ADR-0007](0007-adopt-durable-control-plane-for-coupon-pilot.md) · [ADR-0008](0008-limit-local-lark-cli-to-vercel-integration-smoke.md)

> **历史说明：** 这是原先为 direct HTTP callback 编写的 P0 方案。需求方随后选择保留测试 App 的长连接模式；当前可执行手册为[本机长连接 POC 运行手册](../oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md)。

## 背景

已实现的三源适配器可在受限范围内收集 `.xlsx` 配券表、SKU 白名单和可选黑名单，要求确认无黑名单/名单重叠，并把冻结的标准 Excel 产物交接给既有 OA 测试稿。当前没有企业托管常驻 bridge 资源；本轮只需要验证一个具名测试用户的 Bot 卡片、材料、标准产物和 OA **测试稿**体验。

现有公网入口 `POST /api/feishu/process` 已直接调用 `handleFeishuPocEvent()`。它核验 Verification Token 后，同步处理消息、文件、卡片、Base、Drive 和草稿副作用。该能力可用于低风险、可随时关闭的真实环境 POC；它不具备事件收据、事务 outbox、异步 worker、重试、死信队列或恢复语义。

## 决策

允许在一个明确时间窗内使用以下**直接 HTTP、单用户、draft-only POC**拓扑：

```text
Feishu Dev App（开发者服务器回调；单一事件接入方式）
  → HTTPS
  → Vercel POST /api/feishu/process
  → 同步 legacy POC handler
  → 严选三源试点 adapter
  → 隔离 Base 任务记录 + Drive 标准产物
  → 既有 OA 测试稿
```

该标签为 `direct-http-draft-poc`，只用于文档、配置和测试沟通；它**不是**新的 `FEISHU_RUNTIME_STAGE`、release ring、FDEV 完成标志或 Gate 通过证明。运行时继续使用 `FEISHU_RUNTIME_STAGE=local` 的 legacy POC 边界。

### 允许范围

在配置完成且仅对一个严格 allowlist 用户开放时，允许验证：

- 精确命令 `/OA优惠券提报`；
- `.xlsx` 材料的乱序接收、角色/歧义列选择、无黑名单确认和名单交集决策；
- **常规满减券 + 严选 + SKU** 的确定性校验与标准 Excel 产物；
- 冻结产物重新下载并完成 hash 校验后，创建既有 OA **测试稿**及其预览卡。

### 必须保持的配置边界

配置只存在于 Vercel 的受控环境变量中，不写入仓库、文档、终端记录或聊天内容。运行前必须确认：

1. `FEISHU_VERIFICATION_TOKEN` 与飞书开发者服务器配置匹配；
2. 三源 pilot 使用专属 Base app、表和 Drive 文件夹，且 `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED` 只在测试窗口打开；
3. 所有优惠券状态操作都受单一测试用户 allowlist 限制；
4. 为复用既有 OA 测试稿交接而启用的 OA mode 不得替代 native 授权；
5. `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 始终为真。任何情况下都不得让本 POC 发出 `POST /approval/v4/instances`。

飞书开发者服务器事件**不启用加密**，直到服务端实现并验证解密；当前入口只核验匹配的 Verification Token，未实现加密 payload 处理或等价签名/replay 防护。

### 明确禁止

- 使用个人电脑、本机 `lark-cli` 或 `scripts/long-connection-bridge.mjs` 作为本 POC 的运行链路；
- 与长连接 consumer、旧 bridge 或另一 HTTP consumer 双活；
- 开启 native-submit kill switch、创建真实 OA、扩大 allowlist、接收群聊协作或批量操作；
- 宣称回调已经 durable-accept、超时可恢复、重复事件安全无副作用，或本 POC 已达到 R1/R2/R3；
- 将本地 Claude Code Skill 自动加载、自动执行或自动授权的假设带入 Vercel/Bot；
- 宣称已完整实现 Skill 合同。当前 POC 不含 `calcImage`、字段补充/覆盖、非 SKU 名单、完整最终 provenance 预览和耐久 submission 控制面。

## 与既有 ADR 的关系

- **ADR-0002**仍是长期目标：HTTP callback 必须先完成安全校验、幂等持久接收与异步投递。本 ADR 只复用其公网 HTTP 方向，不满足其 durable ingress 设计。
- **ADR-0006**仍约束企业托管长连接内网试点；本 ADR 不废止或放宽其中的 bridge、outbox 和运行要求。
- **ADR-0007**仍是 R1+ 的强制控制面。Base 不是事件收据、提交锁或原始字节的 canonical store，本 POC 不可进入 R2/R3。
- **ADR-0008**只允许本机 `lark-cli` 进行 R0.5 手工 smoke；本 ADR 改用开发者服务器回调，并不扩大 ADR-0008 的允许范围。

## 停止与回滚

出现下列任一情况立即停止该 POC：回调挑战/验证异常、重复或超时回调、Vercel 重启、Base/Drive/文件下载失败、卡片重复点击、意外 native OA 写入迹象、事件加密、敏感日志或任何无法明确解释的状态。

按以下顺序处理：

1. 保持 native-submit kill switch 为关闭；若已处于不确定状态，先在服务端再次关闭。
2. 关闭三源 pilot flag；必要时在飞书控制台移除事件订阅或停止开发者服务器回调。
3. 不重试可能已有副作用的卡片或 HTTP 请求；只保留脱敏的时间窗、部署版本、状态和 hash 证据。
4. 对已创建的 OA **测试稿**人工核对或取消；不得为“补偿”创建真实审批实例。
5. 在原因、影响和关闭时间明确后，才允许配置变更或下一次单独授权的测试窗口。

## 后果

### 正向

- 不需要企业托管常驻 bridge，即可验证真实 Feishu → Vercel → Base/Drive → OA 测试稿的最小体验。
- 不改变已存在的三源领域、OA 测试稿或 native-submit Guard；native 入口继续 fail closed。
- 为后续正式 HTTP callback 保留相同的公网路径名称，但不会把一次 POC 成功误写为持久化能力。

### 限制和后续

完成 POC 只能说明受限用户体验与资源权限可工作。若要达到完整 Skill 合同或启用真实 OA，必须先分别补齐截图渲染、字段补充/覆盖、扩展 ID 维度、全量最终预览，以及 ADR-0007 所要求的 receipt/outbox、耐久任务/对象存储、worker、effect receipt、submission attempt 和 `SubmissionUnknown` 对账能力。

## 相关运行材料

- [三源最快 Bot POC 交付计划](../oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md)
- [三源直接 HTTP draft-only POC 运行手册](../oa-ticket-reimbursement-materials/current/operations/coupon-three-source-direct-http-poc-runbook-v1.md)
- [优惠券 OA 内网试点 rollout](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)
- [企业托管 bridge 运行手册](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-managed-bridge-runbook-v1.md)
