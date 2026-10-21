# 优惠券 P0 开放使用部署方案 v2(待审计草案)

> **状态**:待审计草案;取代 [v1](coupon-p0-multi-user-native-submit-deployment-plan-v1.md)。描述目标配置与执行步骤,**不构成执行授权**。`FEISHU_COUPON_OA_OPEN_ACCESS=true` 上线前须完成 §2 签核(含 D1 ADR)。
> **日期**:2026-10-19
> **适用拓扑**:飞书 App(长连接)→ bridge/worker(分支 `p0-three-source-direct-http`)→ Vercel Preview `POST /api/feishu/poc-bridge` → 优惠券 Bot(`OA优惠券填报` / `/OA优惠券提报`)→ OA 测试稿 / 受控原生提交。
> **权威边界**:[ADR-0010](../../../adr/0010-timebox-local-long-connection-three-source-poc.md) · [ADR-0013](../../../adr/0013-p0-bridge-coupon-oa-draft-action-passthrough.md) · [内网试点 rollout 计划](coupon-oa-internal-pilot-rollout-plan-v1.md) · [P0 runbook](coupon-three-source-local-long-connection-poc-runbook-v1.md)

## 0. 需求(Owner 2026-10-19 裁定)

1. **砍掉按用户的使用授权**:任何在飞书可用范围内的人都可以调用拍小宝进行 OA 优惠券填报,不再维护 `FEISHU_COUPON_OA_ALLOWED_OPEN_IDS` 按人名单。
2. **约 10 人量级**的并发使用。
3. 支持从飞书(私聊、群聊 @)发起提报。

**授权模型变更**:使用层授权从"服务端 open_id 名单"改为"飞书应用可用范围"——谁能看到机器人,谁就能用。真实原生提交(native submit)**不随之开放**,仍由 kill switch + 具名提交名单控制(§4)。

## 1. 代码变更(已完成,随本方案交付)

`server/lib/feishu/coupon-oa/config.ts` 新增 `FEISHU_COUPON_OA_OPEN_ACCESS`(严格 `true`/`false`,默认关闭,非法值抛错):

- `true` 时 `assertCouponOaUserAllowed` 直接放行——覆盖两条路线(`OA优惠券填报`、`/OA优惠券提报`)及全部卡片动作的使用授权;
- **不 bypass** `assertCouponOaNativeSubmitAllowed` 的任何一层:mode 闸、kill switch、`FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS` 提交名单照常生效(有专门测试锁定该分层);
- fail-closed 语义不变:默认 `false`、未配置、拼写错误均回到按名单拒绝。

验证:`config.test.ts` 19 例全过(含 4 例新增);coupon-oa + events 关联套件 294 例全过;biome 通过。仓库 `pnpm typecheck` 当前在 admin 前端有预先存在的 React 类型错误,与本次改动无关(干净工作区同样失败)。

## 2. 前置决策与签核(审计入口)

| # | 决策项 | 内容 | 决策人 | 签核 |
| --- | --- | --- | --- | ___ |
| D1 | **边界 ADR(必须)** | 记录:使用授权从服务端名单改为飞书可用范围;runbook"单用户"限制正式放宽为可用范围全员;native submit 仍走具名 canary。无此 ADR 不得开 `OPEN_ACCESS=true`。 | 架构 Owner | ___ |
| D2 | **可用范围边界** | 开放给哪个部门/群(≈10 人);离职/转岗人员随可用范围自动收回——这是新的授权生命周期,由飞书管理员流程承担。 | 业务 Owner | ___ |
| D3 | **审批定义** | 提交 canary 落隔离测试定义还是真实定义(现 `FEISHU_COUPON_OA_APPROVAL_CODE` 指向【拍拍】优惠券申请及修改)。真实定义须先知会审批人。 | OA 流程 Owner | ___ |
| D4 | **bridge 常开** | 10 人量级下 bridge 单点影响面扩大。最低要求:Mac 防休眠 + 进程崩溃自动拉起(launchd/pm2);建议迁常开机器。bridge/worker 退出不自愈是已知观察项(replay 记录)。 | 运行 Owner | ___ |
| D5 | **值守窗口** | 提交 canary 首笔的值守人与核对记录。 | 值守人 | ___ |
| D6 | **应用权限版本** | 实例创建/附件上传/定义读取权限已批、版本已发布、群 @(`im:message.group_at_msg`)已生效。 | 飞书应用管理员 | ___ |

## 3. 阶段 A:开放使用(≈10 人,提交仍关闭)

### 3.1 飞书开放平台

1. 可用范围设为目标部门/群(D2),发布版本——此后"加人=管理员在飞书后台点可用范围",服务端不再有任何按人配置。
2. 群聊入口:开通 `im:message.group_at_msg`,拉机器人进群。回复仍私发发起人(现行设计)。
3. 事件订阅不变:长连接 `im.message.receive_v1` + `card.action.trigger`。

### 3.2 Vercel 环境变量(相对 P0 现状的增量)

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `FEISHU_COUPON_OA_OPEN_ACCESS` | `true` | 本方案核心开关;回滚=改回 `false` 重新部署,回到按名单。 |
| `FEISHU_COUPON_OA_ALLOWED_OPEN_IDS` | 保留现值或清空 | 开放模式下不再读取;留作回滚基线。 |
| `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED` | `true` | 三源提报入口常开(原先按窗口开关)。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED` | `false` | 阶段 A 保持关闭;所有人流程终点=OA 测试稿。 |

### 3.3 验证清单

- [ ] 可用范围内任意成员(含未进过任何名单的人)私聊 `/OA优惠券提报` → 收集卡;完整跑一单到测试稿。
- [ ] 群内 @机器人 → 发起人私聊收到卡片,群内无卡片。
- [ ] 可用范围**外**的账号搜不到机器人(可用范围是唯一边界,必须核实有效)。
- [ ] 数人同时各持有活动草稿 → 互不可见(`/clear`、草稿列表均按 open_id 隔离)。
- [ ] 身份端点回读 `couponOaNativeSubmitDisabled: true`。
- [ ] >10MB 文件、`.xls`/`.csv`、无表头名单等边缘输入给用户的提示卡正常(近期已修复分页与缺失材料文案)。

### 3.4 10 人量级的容量事实

- Base 活跃记录查询已分页(2026-10-18 修复,此前真实触发过全量拉取事故)——多人活跃草稿列表安全。
- AI 识别 worker 串行:10 人高峰排队,卡片停留"识别中"数分钟属预期;建议开通话术注明。
- 飞书 OpenAPI 租户限流共享;消息请求已设上界(近期提交)。
- bridge 单点:见 D4。

## 4. 阶段 B:真实提交 canary(不随开放使用自动放开)

机制不变,沿用现有窗口模式(`P0_ALLOW_NATIVE_SUBMIT_WINDOW=true` 随 deploy/up/status 传入)+ 具名提交名单:

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED` | `true` | 全局 kill switch。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS` | `ou_canary1`(1–2 人) | **提交授权仍具名**;`OPEN_ACCESS` 对此层无效(测试锁定)。 |

canary 值守逐笔核对(回读 instance code、申请人=发起人、附件=冻结产物 hash、路由未被改动;`SubmissionUnknown` 冻结对账、不盲建第二笔)与暂停条件同 [v1 §4](coupon-p0-multi-user-native-submit-deployment-plan-v1.md),不再重复。

### 4.1 提交层开放(Owner 2026-10-21 裁定,提前于一周观察期)

[ADR-0016](../../../adr/0016-open-native-submit-authorization-via-feishu-availability-scope.md) 已把提交授权边界改为飞书可用范围,新增变量:

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_OPEN_ACCESS` | `true` | 跳过提交具名名单;mode 闸/kill switch/使用授权不放松(测试锁定)。默认 `false`=回具名名单。 |

义务置换:放弃"canary 干净一周"前置,改为开放后**首批真实提交逐笔回读核对**并登记 §6;发现异常立即回滚(§5)。具名提交名单变量保留为回滚基线与未来收敛手段。

## 5. 回滚

| 场景 | 动作 |
| --- | --- |
| 使用层收缩 | `FEISHU_COUPON_OA_OPEN_ACCESS=false` 重新部署 → 回到按名单(保留的名单即回滚基线);或飞书后台缩小可用范围(即时生效,无需部署)。 |
| 提交急停 | kill switch `false` 重新部署;已创建实例不受影响。 |
| 提交层收回按人门禁 | `FEISHU_COUPON_OA_NATIVE_SUBMIT_OPEN_ACCESS=false` 重新部署 → 回到具名提交名单(ADR-0016 回滚路径)。 |
| 单人止损 | 提交层开放期=可用范围移除该人(飞书后台即时);回滚到具名名单后=提交名单删该 open_id;使用层单人止损=可用范围移除该人。 |
| 事件完整性存疑 | 停 bridge intake → 对账三态 → 恢复须重签 D1。 |

## 6. 变更与审计记录表

| 时间 | 操作人 | 变更(变量/开关/可用范围) | 部署 revision | 验证 | 复核 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-21 11:58 | b-bzy(Owner 授权,agent 执行) | 决策:提交层开放(ADR-0016),`FEISHU_COUPON_OA_NATIVE_SUBMIT_OPEN_ACCESS=true`;同日飞书可用范围已由 b-bzy 发版打开(实查=8 具名成员,非全员);提交具名名单同步扩至同一 8 人作为回滚基线 | palwjn3xf @ f574132 | 回读 `couponOaNativeSubmitOpenAccess:true`、`couponOaNativeSubmitDisabled:false`;bridge/worker 已挂新部署;首批提交逐笔核对待办 | 待架构 Owner 追认 |
| ___ | ___ | ___ | ___ | ___ | ___ |

## 7. 已知边界

- 可用范围成为唯一使用边界:范围配置过宽(如全公司)时服务端不再有第二道闸——D2 必须明确范围且变更走记录表。
- 群聊回复私发发起人;旧卡片堆积、聊天记录不可回收、下载副本出域等飞书固有边界同 v1。
- 本方案仍运行 P0 链路(`FEISHU_RUNTIME_STAGE=local`),bridge ACK 弱于托管 durable bridge;多人+真实提交是 ADR-0010 范围外受控例外,时间窗与退出条件写入 D1 ADR。

## 8. 相关文档

- [v1 方案(提交 canary 细节、边缘情况清单)](coupon-p0-multi-user-native-submit-deployment-plan-v1.md)
- [ADR-0010](../../../adr/0010-timebox-local-long-connection-three-source-poc.md) · [ADR-0013](../../../adr/0013-p0-bridge-coupon-oa-draft-action-passthrough.md)
- [rollout 计划](coupon-oa-internal-pilot-rollout-plan-v1.md) · [P0 runbook](coupon-three-source-local-long-connection-poc-runbook-v1.md)
