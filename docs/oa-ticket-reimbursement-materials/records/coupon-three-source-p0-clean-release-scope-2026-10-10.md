# 三源优惠券本机长连接 P0：干净发布包范围 v1

> **状态：** 待审阅的 POC 发布范围；不是部署、上线、R1/R2/R3 Gate、可靠事件接收或原生 OA 通过证明。
> **日期：** 2026-10-10
> **目标：** 为一个具名测试用户整理严选三源 Bot → OA 测试稿所需的最小发布集；真实发送不在本范围。
> **关联：** [P0 最快 Bot POC 交付计划](../proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md) · [本机长连接 POC 运行手册](../current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md) · [ADR-0010](../../adr/0010-timebox-local-long-connection-three-source-poc.md)

## 已完成的受控资源准备

- 已由 Bot 身份创建隔离的三源试点 Base，包含 `Pilot ID`、`Owner Open ID`、`Status`、`Revision`、`Schema Version`、`Task ID` 与 `State JSON` 字段。
- 已由 Bot 身份创建隔离的三源试点 Drive 文件夹。
- 当前 CLI 用户对上述隔离资源拥有完整访问权限；Bot 已成功读取空的 Base 表与 Drive 文件夹。
- 本记录不写入 Base/Drive token、用户 open ID、secret 或附件内容。

上述准备不代表 P0 bridge 已部署、runner 已运行、pilot 已启用或原生 OA 可以创建。

## 拟纳入发布的运行时代码

### 三源领域、adapter 与 OA 测试稿交接

```text
server/lib/coupon-oa/three-source/
server/lib/excel-template-engine/three-source.ts
server/assets/coupon-excel/商品明细白名单-多券档SKU-v1.xlsx
server/assets/coupon-excel/商品明细黑名单-多券档SKU-v1.xlsx
server/lib/feishu/coupon-oa/three-source/
server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts
server/lib/feishu/events.ts                         # 仅 P0 bridge / threeSourceOnly / file metadata hunk
server/lib/feishu/message-client.ts                 # 已有原始消息回读 helper，复用不复制
```

### 最小本机长连接 P0 transport

```text
scripts/long-connection-bridge.mjs
scripts/lib/long-connection-bridge-runtime.mjs
server/lib/feishu/bridge-auth.ts
server/api/feishu/poc-bridge.post.ts
server/lib/control-plane/runtime-config.ts           # 仅既有 stage parser
package.json                                          # P0 runner script hunk
.env.example                                          # 变量名/注释 hunk；无值
```

P0 route 必须只在 `local` stage 对 HMAC 验签、nonce replay、最大 body 和 `threeSourceOnly` 负责；不得静态或动态导入 durable ingress receiver、PostgreSQL、worker、scheduler、对象存储或 effect runtime。

对应单测必须包括：bridge runtime/envelope、HMAC、P0 ingress、three-source dispatcher 的 CLI 文件元数据回读、`threeSourceOnly` 路由隔离、领域/adapter/handoff/events 回归测试。

## 明确排除的现有工作区改动

以下不属于这次 P0 发布包：

- `server/lib/control-plane/` 中的 PostgreSQL receiver/repository、migration、对象存储、worker、lease、outbox、DLQ 和 scheduler；仅已追踪的 `runtime-config.ts` stage parser 可复用；
- `server/api/feishu/bridge.post.ts` 及其 durable ingress 路线；P0 只能使用独立的 `/api/feishu/poc-bridge`；
- 企业托管 bridge、容器、个人/企业运行治理、R0.5 smoke 以外的 P1 transport 工作；
- 旧 OA / Excel 试点的无关改动、管理员前端、Skill 删除/迁移、DeepSeek、其它未跟踪文件；
- `task-repository.ts`、`task-service.ts` 及任何 control-plane 三源适配。

## 受控配置边界

值只能写入 Vercel secret/configuration store 或安全 Mac runner 环境，不能提交到仓库、文档或聊天。变量名和取值边界以[运行手册](../current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md)为准。

Vercel 运行时至少要求：

```dotenv
FEISHU_RUNTIME_STAGE=local
FEISHU_LEGACY_POC_ENABLED=false
FEISHU_BRIDGE_KEY_ID=<独立测试 key ID>
FEISHU_BRIDGE_SHARED_SECRET=<独立测试 secret>

FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN=<隔离 Base token>
FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID=<隔离表 ID>
FEISHU_COUPON_THREE_SOURCE_PILOT_FOLDER_TOKEN=<隔离 Drive 文件夹 token>

FEISHU_COUPON_OA_MODE=native-submit
FEISHU_COUPON_OA_ALLOWED_OPEN_IDS=<唯一 POC 测试用户>
FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false
FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS=
```

Mac runner 的 `FEISHU_BRIDGE_P0_MODE=true` 必须与精确 HTTPS `/api/feishu/poc-bridge` target 配合；它不属于 Vercel 环境变量。测试窗口只为唯一用户临时开启 pilot，native-submit kill switch 全程为 `false`；最终确认只能创建 OA 测试稿。

## 当前 No-go 项

1. 当前工作区包含大量与 P0 无关的已修改、已删除和未跟踪文件；不得把整个工作区作为部署输入。
2. 本机 CLI 可能在转发/Vercel 处理前 ACK，故没有可靠 source ACK、retry、restart recovery 或 durable receipt/outbox 合同。
3. POC 不使用企业托管常驻 bridge；也绝不能被解释为 R1/R2 managed bridge 已就绪。
4. `calcImage`、字段补充/覆盖、非 SKU 名单、耐久 receipt/outbox、worker、原生 OA 幂等与 `SubmissionUnknown` 对账均未完成；native-submit 必须关闭。
5. 缺少单 consumer、单用户 allowlist、脱敏证据、停止/回滚窗口或任何 P0 HMAC 配置时，不得开启 pilot flag。

## 审阅结论所需动作

1. 审阅本范围，确认只提取上述 runtime 文件及精确 hunk，不携带无关工作区修改。
2. 在独立 release revision 验证 server lint、typecheck、构建和脱敏 E2E；Vercel build 必须能在没有 P1 durable files 的干净 checkout 完成。
3. 经用户明确授权的 commit/push 后，使用该 revision 部署；不得用当前脏树直接部署。
4. 只按[本机长连接 POC 运行手册](../current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md)执行：single consumer、HMAC、单用户材料/卡片/产物/OA 测试稿和“没有 `POST /approval/v4/instances`”的脱敏证据。不得从该结论跳转到真实 OA 创建。
