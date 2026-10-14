# ADR-0013：P0 长连接入口限时放行优惠券 OA 草稿操作（draft-only 路由 canary）

- **状态**：试点用户已授权（2026-10-14）；待优惠券流程与工程 Owner 追认。仅覆盖 P0 测试窗口内的路由放行，不构成 R3 native-submit 批准。
- **日期**：2026-10-14
- **决策 Owner**：优惠券流程 Owner、工程 Owner、试点用户（兼任本次 canary 操作者；当前授权事实仅来自试点用户）
- **取代**：[ADR-0010](0010-timebox-local-long-connection-three-source-poc.md) 中与本次路由放行冲突的部分——边界 5 的"必须忽略非三源文本、文件和 card action"与边界 2 的"也不点击既有测试稿的最终发送动作"。边界 2 的其余硬约束（`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 必须全程保持、绝不调用 `POST /approval/v4/instances`）**完整保留**。ADR-0010 的其余边界（单 consumer、Mac runner 时限等）继续有效。
- **关联**：[ADR-0004](0004-bot-confirmed-submit-for-coupon-oa.md) · [ADR-0009](0009-timebox-direct-http-callback-for-three-source-draft-poc.md) · [ADR-0010](0010-timebox-local-long-connection-three-source-poc.md)

## 背景

三源 P0 的终点是交接既有 OA **测试稿**并发出「优惠券 OA 预填确认」卡（`buildCouponOaPreviewCard`，第 2 步）。该卡自 P0 上线起就携带「确认进入提交页」按钮（action=`coupon_oa_confirm`），但 `threeSourceOnly` 入口在 dispatcher 未命中后静默丢弃该 action（HTTP 200、无卡片），形成死按钮：用户点击无任何反馈。此外该入口同时丢弃 `coupon_oa_submit` 与 `coupon_oa_cancel`，导致 Confirmed 草稿没有用户侧退出路径，并阻塞同一 allowlist 用户的所有优惠券流程。

ADR-0004 已接受的「系统业务草稿 + 确认即提交」机械结构（确认冻结定义 hash 与身份快照、kill switch 三重 Gate、确定性 UUID、先持久化实例 code 再回读 diff、CreatedNeedsReview/SubmissionUnknown 止损）在优惠券 OA 草稿路线中**已实现并有测试覆盖**；三源交接产生的草稿（`schemaVersion=coupon-three-source-pilot-v1`）完整复用该路线。缺的只是入口路由。

2026-10-14 的安全评审（阶段 A 前置）确认了放行的前提修复：OA 草稿 store 写前存储回读守卫、SubmissionUnknown 不抹已持久化实例 code、提交前用冻结 Drive 产物重验 SHA-256 并重传换取新 file code、confirm 分支全路径卡片反馈、Confirmed 可 owner 取消。

## 决策

在 ADR-0010 定义的同一测试窗口与同一唯一 allowlist 用户内，`threeSourceOnly` 入口**额外放行恰好三个卡片 action**：

```text
coupon_oa_confirm / coupon_oa_submit / coupon_oa_cancel
  （携带 draftRecordId，且草稿 schemaVersion === "coupon-three-source-pilot-v1"）
```

之后全部落入既有优惠券 OA 草稿处理链及其全部 Gate：OA allowlist → 草稿 owner → 过期 TTL（10 分钟）→ 状态机 →（提交时）`assertCouponOaNativeSubmitAllowed` 三重 Gate。

### 允许范围

- 仅限三源交接产生的草稿（schemaVersion 守卫在读取草稿后、owner 检查前最先执行；非三源草稿回明确提示卡，不产生写入）。
- 试点链路（2026-10-14 收敛）：第二轮确认后自动生成并交接 OA 测试稿，直达唯一的「第 5 步：核对后确认发送」草稿卡（含「放弃本次提交」出口）——链路为 上传→解析→补充字段→草稿卡→确认即发送，全程一次人工确认；已完成提报的旧卡或桥接重发的重复投递会重新送达该卡（幂等收敛）。bridge 转发超时自 10s 提至 30s，消除同步重活触发的超时重发。
- `coupon_oa_confirm`：身份快照 + 审批定义结构 hash 冻结并进入提交卡。试点链已不依赖该 action（保留放行以兼容已发出的历史卡片与旧路线行为）。
- `coupon_oa_submit`：走 ADR-0004 全部提交机械结构。**本 ADR 不开启 native-submit**：`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 保持关闭，提交在 kill switch 处 fail-closed 并回明确失败卡，草稿保持 Confirmed 可重试。真实创建原生 OA 仍需 rollout R3 canary Gate（G4 证据 + 值守 + 单笔），是独立决策。
- `coupon_oa_cancel`：owner 取消 Draft/Validated/Failed/Confirmed 草稿。

### 不可变边界（继承并补充 ADR-0010）

1. ADR-0010 边界 1/3/4 继续适用；其立即停止条件按下节限定后适用。
2. **kill switch 全程关闭**：本 ADR 的放行使提交路径可达但不使其可执行；任何 `POST /approval/v4/instances` 调用在本窗口内仍是违规事件（立即停止条件）。
3. 除上述三个 action 外，`threeSourceOnly` 继续忽略一切非三源文本、文件与卡片 action（含 legacy OA 填报、Excel pilot、报销）。
4. 并发与幂等防线以已落地实现为准：OA 草稿 store 写前回读守卫（Base 无 CAS，残余窗口为单次 Base 往返）、提交时冻结产物重验重传、`persistCouponOaSubmissionOutcome` 终态不被并发覆盖。已声明的取舍：审批附件 file code 在 handoff 与提交时各生成一次（后者为准）；僵尸 TCP websocket 无法从 bridge 外部检测，值守需盯事件流。

### 停止条件

任一情况立即关闭本路由放行（回滚部署或关闭 pilot flag）：一例**重复创建或重复副作用**迹象（同一草稿产生两份实例/两份附件/重复不可收敛的状态变迁）、越权访问、状态与实例对账失败、kill switch 被打开、schemaVersion 守卫被绕过，或 ADR-0010 列出的任一立即停止条件（以其原文为准）。

**对 ADR-0010「重复事件或卡片点击」停止条件的显式限定**：本 ADR 放行的三个 action 的重复点击属受支持行为——只要重复点击被既有幂等机制干净收敛（重复 confirm 重发当前步骤卡、提交中重击回「正在提交」卡、终态重击回结果卡），即记录观测继续值守，不触发停止；一旦重复点击产生任何未收敛的重复副作用，按上一段的重复创建处理，立即停止。

## 理由

- 三源交接卡自身携带的下一步按钮被自身入口丢弃，是实现缺陷而非设计意图；修复路由让已实现、已测试的 ADR-0004 机械结构在 P0 端到端可达，同时用 schemaVersion 守卫保持"各路线各自入口"。
- 放行 confirm/cancel 是 draft-only 行为（零 OA 写入）；放行 submit 在 kill switch 关闭下等价于一次可观测的 fail-closed 演练，为 R3 canary 提供入口级证据。
- 不放行则 Confirmed 草稿卡死且阻塞全部优惠券流程，只能人工改 Base——比受控放行更不可审计。

## 后果与退出

- 正向结果：P0 窗口内可完整演练「预填确认 → 提交页 → kill-switch 拦截 → 放弃/取消」链路，并为 R3 canary 提供路由与守卫证据；不证明 native-submit 本身。
- 本 ADR 随 ADR-0010 的 P0 窗口结束而失效；后续路线（managed bridge / R2+ durable ingress）必须自带等效路由与守卫设计，不得默认继承本例外。
- PRD 升版至 v1.4、rollout 计划补 canary 节、实施基线补记放行规则与本 ADR 已声明的取舍。

## 相关运行材料

- [阶段 A 本地测试轮记录](../oa-ticket-reimbursement-materials/records/2026-10-14-coupon-oa-native-submit-phase-a-local-round.md)
- [内网试点 rollout 计划](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)
