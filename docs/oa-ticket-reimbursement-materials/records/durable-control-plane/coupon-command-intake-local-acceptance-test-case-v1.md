# 三源优惠券提报：本地耐久命令验收测试用例 v1

> **目的**：在本地 PostgreSQL 中验证 `/OA优惠券提报` 的 command-only 路径：一条已完成 HMAC 验签与规范化的可信单聊 receipt 只创建/恢复一笔 `Collecting` 任务，并通过持久 effect 发送一张**伪造的**材料收集卡。
>
> **安全边界**：本用例不连接 Feishu、Base、Drive、对象存储、renderer 或 Approval；卡片 gateway 是测试 double，绝不产生真实消息或 OA。

## 前置条件

```bash
pnpm infra:up
DATABASE_URL='postgresql://aihuishou:local-development-only@localhost:5432/aihuishou_workflow' \
  pnpm db:migrate:control-plane
```

- PostgreSQL 必须为 `healthy`。
- 测试使用随机 disposable schema，测试结束自动删除；不会修改 `public` 中已迁移的业务表数据。
- 若 `pnpm infra:up` 因 MinIO 镜像拉取失败，PostgreSQL 仍已 healthy 时可继续本用例；该 case 不依赖对象存储。

## 核心验收用例

| 项目 | 内容 |
| --- | --- |
| 用例 ID | `TC-CP-COMMAND-001` |
| 名称 | 经认证单聊命令创建任务并发送受控 intake card |
| 自动化位置 | `server/lib/control-plane/postgres-command-intake.integration.test.ts`：`runs an accepted command through the real worker and a fake card gateway` |
| 输入 | `im.message.receive_v1`，`chat_type=p2p`，`chat_id`/actor/message/stable delivery ID 均有效，文本精确为 `/OA优惠券提报` |
| 前置 Gate | 测试注入 allowlisted/enabled gate；不读取真实环境中的 Feishu/OA 配置 |

### 执行步骤

1. 以 `PostgresIngressReceiver` 接受一条 canonical、payload-hash 匹配的 delivery。
2. 在同一 transaction 写入 nonce、`feishu_deliveries` receipt 和 `process_feishu_delivery` outbox job。
3. 以 `createDurableCouponControlPlaneWorker()` 运行一个 tick：
   - workflow worker 创建/恢复 owner 的 `Collecting` task；
   - 写入 audit、delivery outcome 和唯一 intake-card effect intent；
   - effect worker 获取该 effect lease。
4. 通过 fake `CouponIntakeCardGateway` 返回成功结果，记录一个 `fake-feishu-card:<semantic-key>` external reference。
5. 查询 disposable schema 中的 task/effect/outcome 状态。

### 通过条件

| 断言 | 期望 |
| --- | --- |
| Workflow job | `claimed=1`、`succeeded=1` |
| Effect job | `claimed=1`、`succeeded=1`、`outcomeUnknown=0` |
| 任务 | 仅一笔 owner task，状态为 `Collecting` |
| 卡片调用 | fake gateway 恰好调用一次，receiver 为该 owner，idempotency key 匹配 `coupon-intake-card:CTS-*` |
| Effect receipt | 状态为 `succeeded`，external reference 以 `fake-feishu-card:` 开头 |
| 网络边界 | 不允许调用真实 Feishu API；本用例没有 Feishu credential 或 `fetch` mock 的依赖 |

## 补充回归用例

| 用例 ID | 场景 | 预期 |
| --- | --- | --- |
| `TC-CP-COMMAND-002` | 同一 stable delivery 重送、nonce 改签 | 原 receipt 返回，最多一个 workflow job |
| `TC-CP-COMMAND-003` | 两条不同 receipt、同一 owner 并发处理 | 最多一笔 active task；effect intent 按 task/revision 去重 |
| `TC-CP-COMMAND-004` | 两个 worker 同时 claim | PostgreSQL `FOR UPDATE SKIP LOCKED` 使一个 job 只被一个 worker 领取 |
| `TC-CP-COMMAND-005` | worker lease 到期后被另一 worker 领取 | attempts 递增；旧 lease token 不得 complete 或 retry 写入 |
| `TC-CP-COMMAND-006` | 非单聊、非文本、模糊文本、hash 被篡改 | 仅持久化 `ignored` / `rejected` outcome；不创建 task/effect |
| `TC-CP-COMMAND-007` | 卡片返回不确定远端结果后以新数据库连接模拟 worker 重启 | effect 进入 `outcome_unknown`，重启 worker 领取零 effect，fake gateway 不得再次调用 |

## 执行命令

```bash
CONTROL_PLANE_TEST_DATABASE_URL='postgresql://aihuishou:local-development-only@localhost:5432/aihuishou_workflow' \
  pnpm test:control-plane:postgres
```

建议稳定性检查：

```bash
for run in {1..10}; do
  CONTROL_PLANE_TEST_DATABASE_URL='postgresql://aihuishou:local-development-only@localhost:5432/aihuishou_workflow' \
    pnpm test:control-plane:postgres || exit 1
done
```

## 本次实测结果（2026-10-09）

- `pnpm test:control-plane:postgres`：`1 file / 5 tests passed`。
- 覆盖 fake card 成功回执，以及 `outcome_unknown` 后用新 PostgreSQL connection 模拟 worker 重启时不重发。
- 连续执行 10 次：全部通过。
- migration runner 第二次执行均为 `already applied`。

## 不在本用例证明范围内

- bridge 使用官方 Lark SDK 时的 ACK 时序；
- 真实 Feishu card 的发送、重试及 readback；
- MinIO/S3 文件保存；
- Base/Drive projection、Excel renderer、Approval/native OA。

上述能力仍需保持关闭，直到各自的独立集成/故障演练 Gate 通过。
