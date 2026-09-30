# 优惠券双草稿互斥与懒过期测试用例 v1

> **状态**：自动化核心用例已实现；人工飞书 E2E 待部署后执行
> **日期**：2026-09-30
> **关联方案**：[优惠券双草稿冲突与懒过期治理方案 v1](coupon-workflow-mutual-exclusion-and-idle-timeout-solution-v1.md)

## 1. 测试边界

本期采用“下一次相关用户事件到达时懒过期”的策略，不包含 Cron、后台 Worker、8 分钟主动提醒或第 10 分钟主动推送测试。所有自动化用例通过 mock 飞书 API 和 Base store 运行，不能创建真实 OA 或真实审批附件。

基准时间：

```text
T0 = 2026-09-30T10:00:00.000Z
超时阈值 = T0 + 600 秒
```

测试中直接注入时间戳，不真实等待 10 分钟。

## 2. 已实现的自动化用例

| ID | 层级 | 场景 | 预期结果 |
| --- | --- | --- | --- |
| L-01 | 单元 | 记录有 `updatedAt` | 以最新持久化时间作为有效业务操作时间。 |
| L-02 | 单元 | 记录尚未修改 | 回退使用 `createdAt`。 |
| L-03 | 单元 | 空闲 9 分 59 秒 | 草稿仍可继续。 |
| L-04 | 单元 | 空闲恰好 10 分钟 | 可取消 OA 与 Excel 草稿被判定为过期。 |
| L-05 | 单元 | `Confirmed` OA 或 `GeneratedConfirmed` Excel | 不被懒过期机制取消。 |
| E-01 | 事件集成 | 活跃 Excel 时发送 `OA优惠券填报` | 不展示 OA 表单，返回 Excel 流程提示与结束按钮。 |
| E-02 | 事件集成 | 旧 OA 表单在 Excel 启动后保存 | 保存前二次校验阻止创建 OA 草稿。 |
| E-03 | 事件集成 | Excel 试点超过 10 分钟后上传文件 | 先将 Excel 草稿置为 `Canceled`；不下载文件、不上传审批附件。 |
| E-04 | 事件集成 | Excel 创建人点击结束 | 校验 revision 和所有者后置为 `Canceled`。 |
| E-05 | 事件集成 | OA 创建人点击结束 | 校验所有者后置为 `Canceled`。 |
| C-01 | 卡片单元 | OA 流程阻塞卡 | 包含 `coupon_oa_cancel` callback。 |
| C-02 | 卡片单元 | Excel 流程阻塞卡 | 包含 `coupon_excel_pilot_cancel` callback。 |
| C-03 | 卡片单元 | 历史双草稿冲突卡 | 同时提供结束 OA 和结束 Excel 两种 callback。 |

对应代码：

- `server/lib/feishu/coupon-oa/workflow-lifecycle.test.ts`
- `server/lib/feishu/events-excel-pilot.test.ts`
- `server/lib/feishu/events.test.ts`
- `server/lib/feishu/coupon-oa/cards.test.ts`

## 3. 必须保持的回归用例

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| R-01 | 同一用户仅有 OA 草稿时上传配券表 | 仅走 OA 附件处理，不走 Excel 白名单处理。 |
| R-02 | 同一用户仅有 Excel 试点时上传 `.xlsx` 白名单 | 仅走 Excel 白名单处理，不上传审批附件。 |
| R-03 | 同时存在历史 OA 与 Excel 草稿时上传文件 | 不下载、不上传、不生成，展示冲突恢复卡。 |
| R-04 | 已结束草稿的旧确认/结束卡片再次点击 | 不恢复状态，不处理文件，不重复写入。 |
| R-05 | 非创建人点击结束按钮 | 不能更新他人草稿，也不返回敏感草稿信息。 |
| R-06 | 已提交、需人工复核或已确认生成的记录 | 不允许由结束动作或懒过期机制修改。 |
| R-07 | `draft-demo` 模式 | 仍执行互斥与结束规则，但不调用审批附件或正式 OA API。 |

## 4. 人工飞书 E2E 验收

使用测试机器人、测试 Base 表和脱敏附件；禁止创建真实 OA。

1. 先发送 `优惠券Excel试点`，再发送 `OA优惠券填报`：应展示 Excel 流程卡，不能进入 OA 表单。
2. 在 Excel 试点中点击“结束当前 Excel 试点”，然后发送 `OA优惠券填报`：应能正常打开和保存 OA 草稿。
3. 创建 OA 草稿，等待超过 10 分钟，再发送与该流程相关的附件：应先显示结束卡，文件不可归入旧草稿。
4. 人工准备一个历史双草稿用户，上传文件：应只显示冲突恢复卡；分别验证两个结束按钮。
5. 尝试用另一测试用户点击回调：应被所有者校验阻止。

## 5. 运行命令

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/workflow-lifecycle.test.ts \
  server/lib/feishu/coupon-oa/cards.test.ts \
  server/lib/feishu/events.test.ts \
  server/lib/feishu/events-excel-pilot.test.ts \
  --exclude '.claude/worktrees/**'

pnpm lint
pnpm typecheck
pnpm test
```

当前会话中存在临时 Agent worktree；执行 Vitest 时排除 `.claude/worktrees/**`，避免临时 worktree 未生成 `.nitro/types` 导致与本次代码无关的测试加载失败。
