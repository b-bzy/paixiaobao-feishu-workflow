# ADR-0014:优惠券 Bot 使用授权改为飞书可用范围(open access)

- **状态**:Owner 已授权(2026-10-19,"砍掉权限授权,任何人都可调用拍小宝填报/提报,约 10 人量级");待业务/架构 Owner 追认。
- **日期**:2026-10-19
- **决策 Owner**:拍小宝 Owner(b-bzy);可用范围边界待业务 Owner 追认(部署计划 v2 D2)。
- **取代**:[ADR-0010](0010-timebox-local-long-connection-three-source-poc.md) 与 [P0 runbook](../oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md) 中"唯一 allowlist 用户""禁止多人/群聊"的使用范围限制;[ADR-0013](0013-p0-bridge-coupon-oa-draft-action-passthrough.md) 的单用户限定同此放宽。ADR-0010 的其余边界(单 consumer、限时窗口、停止条件)**继续有效**。
- **关联**:[ADR-0004](0004-bot-confirmed-submit-for-coupon-oa.md) · [ADR-0010](0010-timebox-local-long-connection-three-source-poc.md) · [ADR-0013](0013-p0-bridge-coupon-oa-draft-action-passthrough.md) · [部署计划 v2](../oa-ticket-reimbursement-materials/current/operations/coupon-p0-multi-user-open-access-deployment-plan-v2.md)

## 背景

P0 三源 Bot 原以服务端 `FEISHU_COUPON_OA_ALLOWED_OPEN_IDS` 按人名单作为使用授权(fail-closed,空名单=全员拒绝,无通配符)。业务试用扩大到约 10 人后,按人维护名单成为最高频、最易错的操作(单字符格式错误即全组瘫痪),而真实试点人群本就由飞书应用"可用范围"圈定。Owner 于 2026-10-19 裁定:使用授权不再按人维护,任何可用范围内的人都可直接使用。

## 决策

新增显式开关 `FEISHU_COUPON_OA_OPEN_ACCESS`(严格 `true`/`false`,默认 `false`,非法值启动期抛错):

1. `true` 时 `assertCouponOaUserAllowed` 直接放行——覆盖 `OA优惠券填报`、`/OA优惠券提报` 两条路线及全部卡片动作的**使用授权**。
2. **使用授权边界 = 飞书应用可用范围**:谁能看到 Bot,谁就能用。加人/回收人 = 飞书管理员调整可用范围(即时生效,无需部署);离职/转岗随可用范围自动收回。
3. **真实原生提交不随之开放**:`assertCouponOaNativeSubmitAllowed` 的三层 Gate(mode 闸、kill switch、`FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS` 具名名单)完整保留并有测试锁定分层;`OPEN_ACCESS` 对该层无效。
4. 默认 fail-closed:未配置、`false`、拼写错误均回到按名单拒绝;回滚 = 改回 `false` 重新部署,或缩小可用范围。

## 不可变边界

1. 可用范围成为**唯一**使用闸:范围配置过宽(如全公司)时服务端不再有第二道闸;可用范围的每次变更须登记部署计划 v2 §6 记录表。
2. 卡片隐藏与可见范围不构成对 native submit 的授权;提交 canary 仍走 rollout R3 路径(kill switch + 具名名单 + 值守逐笔核对)。
3. ADR-0010 的单 consumer、bridge 时限、停止条件与敏感日志边界不变;`FEISHU_RUNTIME_STAGE=local` 的 P0 链路定位不变,本 ADR 是其范围内的受控放宽,不是 R2/durable runtime 的替代。
4. 是否把真实提交同样开放给全部可用范围用户,是独立决策(canary 干净一周后由 Owner 另行裁定,届时修订本 ADR 或另立 ADR)。

## 后果

- 正向:加人零服务端操作;消除名单 typo 全组瘫痪风险;授权生命周期随飞书账号自动管理。
- 负向/风险:可用范围误配过宽时暴露面随之扩大(以记录表 + D2 追认缓解);服务端不再能按人禁用使用层(单点止损改用可用范围移除,即时生效)。
- 审计:使用层不再有服务端按人授权日志可查,以飞书可用范围变更记录 + Base 草稿 ownerOpenId 字段承担追溯。
