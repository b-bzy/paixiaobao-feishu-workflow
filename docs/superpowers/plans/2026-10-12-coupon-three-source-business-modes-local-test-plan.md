# 三业务模式与测算图片本地测试计划

> 状态：本地实现验证计划；不构成部署、飞书外部写入或原生 OA 授权。

## 目标

在进入耗时的飞书手工测试前，用脱敏 Excel、内存 fake 和 mock 完成三种业务模式、两种图片入口、分页渲染、冻结校验和 OA draft-only 映射验证。

## 测试数据

目录：`docs/oa-ticket-reimbursement-materials/reference/fixtures/three-mode-screenshots/`

| Case | 输入 | 重点 |
| --- | --- | --- |
| 01 | 严选单券档配券表 + 单 Sheet 白名单 | 无测算图片，渲染器不调用 |
| 02 | 寄卖单券档配券表 + 单 Sheet 白名单 | 缺用户图时生成 PNG |
| 03 | POP 五券档配券表 + 五 Sheet 白名单 | 多券档、横向分页、名单完整性 |
| 04 | 寄卖第 4 行表头配券表 + 多 Sheet 白名单 | 非首行布局、超扣原因、名单识别 |

所有文件仅含合成数据，不含真实 open ID、Base/Drive 标识或业务材料。

## 自动化层级

1. `calc-image.test.ts`：真实 PNG/JPEG 签名、损坏/伪装拒绝、显示值读取、横纵分页、确定性 PNG。
2. `task.test.ts`：消息/hash 去重、20 张上限、append/replace_all、revision 失效、顺序。
3. `local-fixtures.test.ts`：上述 8 个 Excel 的实际读取、三模式识别、多券档和多 Sheet 名单。
4. service/dispatcher/cards/events：图片消息与文件消息入口、首批默认追加、已有图片后的合并选择、重复回调、卡片中文提示。
5. workflow/handoff：模式矩阵、快照顺序 hash、Drive 回读、审批图片有序上传、draft-only Gate。

## 失败用例

- `.png` 文件名但内容不是 PNG/JPEG；
- 空文件、损坏图片、超过 10 MiB、超过 4000 万像素；
- 同 message ID、同内容 hash、重复 merge callback；
- replace_all 批次含无效项目；
- 自动渲染失败或 Drive 上传部分失败；
- 第二张冻结图回读 hash 变化；
- 严选意外带图、寄卖/POP 缺图、快照/上传顺序不一致；
- 已存在活动 OA 测试稿时再次交接。

## 本地命令

```bash
pnpm vitest run \
  server/lib/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/frozen-artifact-handoff.test.ts \
  server/lib/feishu/events.test.ts \
  server/lib/feishu/coupon-oa/approval-schema.test.ts
pnpm lint
pnpm typecheck
pnpm build
```

## 进入飞书手工测试的 Gate

- 上述测试和质量命令全部退出 0；
- 8 个 Excel 可被 ExcelJS 实际读取并完成对应断言；
- 自动 PNG 全部可解码，页码连续且 hash 稳定；
- 测试无真实网络调用，无 Base/Drive/Approval 写入；
- native-submit 仍关闭，且没有原生 OA 创建调用；
- 工作区 diff 不包含 secret、真实案例、临时预览图或调试输出。
