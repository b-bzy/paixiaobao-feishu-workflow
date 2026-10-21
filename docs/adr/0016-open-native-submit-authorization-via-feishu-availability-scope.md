# ADR-0016:真实原生提交授权改为飞书可用范围(submit open access)

- **状态**:Owner 已授权(2026-10-21,"上线后不设提交门禁");提前于 [部署计划 v2](../oa-ticket-reimbursement-materials/current/operations/coupon-p0-multi-user-open-access-deployment-plan-v2.md) §4 预设的"canary 干净一周后再定"观察期,风险由 Owner 接受;待架构 Owner 追认。
- **日期**:2026-10-21
- **决策 Owner**:拍小宝 Owner(b-bzy)。
- **取代**:[ADR-0014](0014-open-access-usage-authorization-via-feishu-availability-scope.md) 不可变边界第 4 条预留的独立决策(现裁定:开放);[部署计划 v2](../oa-ticket-reimbursement-materials/current/operations/coupon-p0-multi-user-open-access-deployment-plan-v2.md) §4"提交授权仍具名"的默认约束。ADR-0014 其余边界继续有效。
- **关联**:[ADR-0004](0004-bot-confirmed-submit-for-coupon-oa.md) · [ADR-0010](0010-timebox-local-long-connection-three-source-poc.md) · [ADR-0013](0013-p0-bridge-coupon-oa-draft-action-passthrough.md) · [ADR-0014](0014-open-access-usage-authorization-via-feishu-availability-scope.md)

## 背景

提交 canary 自 2026-10-19 起运行(`FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS`=Owner 单人)。2026-10-21 飞书可用范围打开后,试用同事进入并完整走通三源流程(Base 草稿达到 `DraftOnlyConfirmed`),在「发送」一步被提交具名名单拒绝(收到 "Coupon OA native submit is not allowed for this user" 失败卡)。按人维护提交名单与使用层按人名单有相同的 typo 全组瘫痪、加人要改 env 重部署的问题。Owner 于 2026-10-21 裁定:上线后提交层不设按人门禁,授权边界与使用层一致,即飞书应用可用范围。

## 决策

新增显式开关 `FEISHU_COUPON_OA_NATIVE_SUBMIT_OPEN_ACCESS`(严格 `true`/`false`,默认 `false`,非法值启动期抛错):

1. `true` 时 `assertCouponOaNativeSubmitAllowed` 跳过 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS` 具名名单——**提交授权边界 = 飞书应用可用范围**:谁能使用,谁就能提交。
2. 分层不放松:mode 闸(`native-submit`)、kill switch(`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED`)、使用授权(`assertCouponOaUserAllowed`)始终先于名单检查;`FEISHU_COUPON_OA_OPEN_ACCESS` 与本开关互不替代,均有测试锁定。
3. 申请人=草稿 owner(操作者本人)不变;附件仍走确认后冻结产物重验 hash 重传,不引用用户下载副本。
4. 默认 fail-closed:未配置、`false`、拼写错误均回到具名名单拒绝。
5. 部署回读:`/api/deployment-identity` readiness 新增 `couponOaNativeSubmitOpenAccess` 字段,上线后必须回读确认为预期值。

## 不可变边界

1. kill switch 仍是唯一一键止损:异常时先 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 重部署,再排查;回滚 = 本开关改回 `false` 重部署。
2. 提前开放以义务置换:放弃"canary 干净一周"的前置等待,换成**开放后首批真实提交逐笔回读核对**(instance code、申请人、附件冻结产物、路由未改动),记录入部署计划 v2 §6;发现异常立即回滚。
3. `SubmissionUnknown` 对账纪律不变:结果不确定即冻结对账,不得盲目创建第二笔。
4. 可用范围成为唯一按人边界(D2):范围每次变更须登记部署计划 v2 §6 记录表;范围误配过宽时,任何范围内用户都可直接产生真实审批,靠审批人环节与 kill switch 兜底。
5. ADR-0010 的单 consumer、bridge 时限与停止条件不变;bridge 常开(D4)在本决策下从建议升级为硬前提——bridge 不在线时同事的发送点击无法到达服务端。

## 后果

- 正向:加人/回收人零服务端操作;消除提交名单维护成本与 typo 风险;授权生命周期随飞书账号自动管理。
- 负向/风险:真实【拍拍】审批定义中可能出现任何范围内用户的真实待审,审批人需知情(D3);误操作直接产生真实审批单(靠审批人拒绝 + kill step 止损);服务端不再能按人禁用提交层(单点止损=kill switch 或可用范围移除)。
- 审计:提交层不再有服务端按人授权日志;以 Base 草稿 ownerOpenId + 审批 instance 申请人字段 + v2 §6 记录表承担追溯。
