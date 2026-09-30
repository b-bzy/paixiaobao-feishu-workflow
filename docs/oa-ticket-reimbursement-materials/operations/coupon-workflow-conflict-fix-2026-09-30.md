# FIX-2026-09-30：优惠券双草稿冲突与懒过期修复验证记录

> **状态**：代码修复完成，本地自动化验证通过；尚未部署、尚未进行飞书测试租户 E2E
> **日期**：2026-09-30
> **关联方案**：[优惠券双草稿冲突与懒过期治理方案 v1](../implementation/coupon-workflow-mutual-exclusion-and-idle-timeout-solution-v1.md) · [测试用例 v1](../implementation/coupon-workflow-mutual-exclusion-and-idle-timeout-test-cases-v1.md)

## 1. 修复目标

修复同一用户同时存在「优惠券 OA 草稿」与「优惠券 Excel 试点草稿」时，上传文件被拦截并提示“无法判断文件用途”的问题。

本次采用的超时机制为**10 分钟懒过期**：系统不依赖 Cron 或进程内定时器；用户下一次发送相关文本、文件或点击相关卡片时，系统先结束过期草稿，再拒绝处理这一次迟到输入。用户需重新发送对应指令开始新流程。

## 2. 已实现修复

| 项目 | 实现结果 |
| --- | --- |
| OA / Excel 流程互斥 | Excel 活跃时不再打开或保存 OA 草稿；OA 活跃时不创建 Excel 试点。 |
| 保存前二次校验 | 即使用户持有旧 OA 表单，Excel 启动后点击保存也不会创建第二条草稿。 |
| 历史冲突恢复 | 双活跃状态不处理附件，卡片提供结束 OA 或结束 Excel 的操作。 |
| 用户自助结束 | 新增 `coupon_oa_cancel` 与 `coupon_excel_pilot_cancel` 回调，校验创建人；Excel 同时校验 revision。 |
| 10 分钟懒过期 | 使用 `updatedAt`，无更新时回退 `createdAt`；过期流程先置为 `Canceled`。 |
| 迟到输入隔离 | 过期后的文件、旧卡片和旧表单不触发下载、审批附件上传、Excel 生成或 OA 提交。 |
| 非安全状态保护 | `Confirmed`、`Submitting`、`Submitted`、`CreatedNeedsReview`、`GeneratedConfirmed` 不被懒过期取消。 |

## 3. 自动化测试结果

### 3.1 定向回归测试

执行命令：

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/workflow-lifecycle.test.ts \
  server/lib/feishu/coupon-oa/cards.test.ts \
  server/lib/feishu/events.test.ts \
  server/lib/feishu/events-excel-pilot.test.ts \
  --exclude '.claude/worktrees/**'
```

结果：

```text
Test Files  4 passed (4)
Tests       45 passed (45)
```

覆盖结果：

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| L-01 ~ L-05 | 10 分钟边界、时间回退、终态不超时 | 通过 |
| E-01 | Excel 活跃时阻止打开 OA 表单 | 通过 |
| E-02 | Excel 活跃时阻止保存旧 OA 表单 | 通过 |
| E-03 | 过期 Excel 文件不下载、不上传 | 通过 |
| E-04 | Excel 创建人结束试点 | 通过 |
| E-05 | OA 创建人结束草稿 | 通过 |
| E-06 | 过期 OA 附件不下载、不上传 | 通过 |
| C-01 ~ C-03 | OA、Excel、冲突卡片均包含正确结束 callback | 通过 |

### 3.2 全量服务端回归

执行命令：

```bash
pnpm exec vitest run --exclude '.claude/worktrees/**'
```

结果：

```text
Test Files  24 passed (24)
Tests       116 passed (116)
```

### 3.3 类型检查与代码风格

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm typecheck:server` | 通过 | 服务端 TypeScript 无错误。 |
| 指定文件 `biome check` | 通过 | 本次修改的 TypeScript 文件无格式或 lint 错误。 |
| `pnpm lint` | 通过（5 条 warning） | warning 均位于既有的 `apps/miaoda-admin`：React 非空断言 1 条、CSS selector specificity 4 条；与本次服务端修复无关。 |
| `pnpm typecheck` | 未完全通过 | 服务端通过；管理端因本地 `apps/miaoda-admin` 缺少 React、Vite 和相关类型依赖而失败，未修改管理端代码或依赖。 |

## 4. 未执行项与原因

| 项目 | 状态 | 原因 |
| --- | --- | --- |
| 飞书测试租户 E2E | 未执行 | 当前不修改生产 bridge、Vercel 或真实 Base 数据。 |
| 真实审批附件上传 | 未执行 | 本次不创建审批附件或正式 OA。 |
| 生产部署 | 未执行 | 本次仅完成代码与本地自动化验证。 |
| 第 8 分钟主动提醒 | 未实现 | 已明确选择“下一事件时过期”，未引入 Cron、队列或后台 Worker。 |
| 第 10 分钟主动终止卡 | 未实现 | 无持久化调度基础设施；仅在下一相关用户事件到达时执行懒过期。 |

## 5. 上线前人工验收建议

在测试机器人与测试 Base 表中执行以下步骤，且不提交真实 OA：

1. 发送 `优惠券Excel试点`，再发送 `OA优惠券填报`：确认不会出现 OA 填报表单。
2. 在 Excel 试点卡中结束流程后，再发送 `OA优惠券填报`：确认可正常创建 OA 草稿。
3. 创建 OA 草稿后，等待超过 10 分钟，再发送附件：确认只收到流程结束提示，附件未被处理。
4. 准备历史双活跃草稿，发送文件：确认不处理文件，并可分别结束 OA 或 Excel。
5. 使用其他测试用户点击结束卡：确认无法结束不属于自己的草稿。

## 6. 已知边界

飞书 Base 当前没有跨表事务或唯一约束。入口检查和保存前二次检查能阻止正常单聊流程重现该问题，但两个完全并发的 Serverless 请求仍不能获得数据库级严格互斥保证。

若后续需要用户完全无操作时在第 8 分钟提醒、在第 10 分钟主动取消，需引入持久化活动时间字段及受保护的周期任务或延迟队列；不能依赖 Serverless 内存定时器。
