# 优惠券 OA 机器人端自动填报实施方案 v1.4

> **状态**：目标实现与上线前置条件；不是已完成能力声明。
> **日期**：2026-10-08
> **替代关系**：取代 v1.3 中“首期仅上传测算图片、券表/白名单由用户手工补传”的过期附件描述。
> **关联**：[ADR-0004](../../../adr/0004-bot-confirmed-submit-for-coupon-oa.md) · [ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) · [MVP PRD v1.5](../product/coupon-oa-mvp-prd-v1.5.md)

## 1. 目标

保留系统业务草稿、预览确认、审批定义 hash 守卫、确定性 submission UUID 与创建后 readback 的既有安全方向，并把 Excel 试点的产物边界与未来原生提交边界写清：**源输入永不直接成为 OA 附件；draft-only 只冻结产物；native-submit 只在最终门禁后即时提升经 hash 验证的产物。**

## 2. 附件与存储对象的精确区分

| 对象 | 角色 | 允许进入 OA | 保存/使用规则 |
| --- | --- | --- | --- |
| 源白名单 | 生成输入 | 否 | 只用于解析、映射与 provenance；不得上传审批附件库 |
| 源配券表/源黑名单 | 三源流程输入 | 否 | 只读审计输入，须经标准化才可使用 |
| 标准生成配券表 | `couponTable` | 是，且仅最终允许时 | 记录模板版本、revision、bytes、SHA-256 与冻结 Drive 引用 |
| 标准生成白名单 | `productWhitelist` | 是，且仅最终允许时 | 同上 |
| 标准生成黑名单 | `productBlacklist` | 仅已上传/确认时 | 无黑名单时记录状态，绝不伪造空附件 |
| 满减测算图片 | `calcImage` | 是，取决于业务模式 | 只登记/上传，不从图片推断业务事实 |
| Drive file token | 冻结文件定位 | 否 | 用于重新下载和 hash 核验 |
| Base attachment token | Base 展示/草稿关联 | 否 | 不能替代 Drive token 或 approval file code |
| approval file code | 原生 OA 控件引用 | 是 | 只在 native-submit 最终门禁通过后生成 |

## 3. 分阶段提交路径

### Draft-only

1. 从已确认 revision 生成或收集需要的标准产物。
2. 记录 Drive token、Base 附件 token（如需要）、文件名、bytes、SHA-256、模板版本和生成 revision。
3. 允许创建/更新**系统 OA 草稿**，但不调用 approval file upload 或 create instance；严禁 `POST /approval/v4/instances`。
4. 文件和字段变化均递增 revision，并使旧确认/产物失效。

### Native-submit（仅通过 rollout R3/R4 后）

1. 服务端复验 owner、revision、allowlist、kill switch、审批定义 hash、业务幂等 claim、字段与附件完整性。
2. 从 Drive 重新下载冻结产物，比对字节数与 SHA-256；任何不符立即阻断。
3. 仅将已验证的标准产物/业务测算图片上传审批附件接口，取得 approval file code；源文件绝不提升。
4. 创建实例后先持久保存 instance code/link，再 readback 比较；差异进入 `CreatedNeedsReview`。
5. 请求结果不明时进入 `SubmissionUnknown` 并对账，不重试 create。

## 4. 必须实施的上线前改造

| 领域 | 要求 |
| --- | --- |
| 配置 | 以显式 launch stage、native-submit enablement、server-side allowlist、kill switch 和批准 approval code 替代 unset 默认为 production 的行为；冲突/缺失值 fail closed。 |
| ingress | bridge 专用签名、timestamp/nonce 重放拒绝、稳定 event/card ID、持久 transport 去重和可恢复收据。 |
| 提交恢复 | 原子 business idempotency key、`Submitting` lease、`SubmissionUnknown` 对账、`CreatedNeedsReview` 告警与人工处理。 |
| 文件 | 通用大小限制、MIME/magic-byte 校验、恶意文件处置、Drive/Base/OA 权限与生命周期策略。 |
| 可靠性 | timeout、429/backoff、重试策略、失败分类、相关 ID、操作告警与运行手册。 |
| 数据治理 | DeepSeek 处理的字段分类、允许范围、保留/脱敏、供应商批准和降级策略。 |
| 生命周期 | 原生 OA 审批状态 webhook/轮询策略、撤回/驳回与人工对账责任。 |

## 5. 验证

- 单元/合同测试覆盖 identity、definition drift、revision、附件 hash、fail-closed stage、allowlist、重复 callback 和未知创建结果。
- 在隔离 Base、Drive、审批定义和测试账号完成 draft-only E2E；证明没有原生 OA API 创建请求。
- 在 canary 前完成 manual/API 路径比对、审批附件上传、重复/重放、Vercel/bridge 中断、Drive 403、readback mismatch 与 kill-switch 回滚演练。
- 通过 canary 仅证明受限人群可用；任何扩大范围仍须按 rollout gate 获批。
