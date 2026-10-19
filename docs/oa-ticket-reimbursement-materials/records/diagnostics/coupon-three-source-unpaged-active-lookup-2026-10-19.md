# 三源活跃草稿查询未翻页「文件静默丢弃」诊断记录

- **日期**：2026-10-19 09:35（北京时间）
- **环境**：Vercel Preview `aihuishou-feishu-workflow-bkawfq3c3`（部署身份 `c2acfde`，分支 `p0-three-source-direct-http`）
- **现象**：用户 `/clear` → `/OA优惠券提报` → 同时上传配券表与商家 ID 白名单 → 点「材料已上传完毕，开始统一识别」，收到「OA 优惠券三源提报未完成 / 系统未完成本次处理，已保留当前材料」兜底错误卡；两个文件在卡片上始终显示「待上传」。
- **影响范围**：三源试点表记录数超过 100 条之后的**所有**三源提报（2026-10-18 凌晨首次露头，当晚被当作"文件静默丢弃"回归，`c2acfde` 只加了诊断日志未修根因）。同类未翻页查询还存在于 OA 草稿互斥检查、Excel 试点草稿、报销模板/实例三处。

## 事实链（诊断顺序）

1. **bridge 日志**（`.local/p0-preview-bridge.log`，UTC 01:35）：两条文件消息与一次卡片动作全部 `forwarded status=200`——事件入口无故障。
2. **worker 日志**：事发窗口零输出（无 `processed jobs=N`），说明没有任何 effect 被认领——不是异步投递失败，而是同步入口就没把文件写进草稿。
3. **AI 诊断端点** `GET /api/internal/control-plane/ai-diagnostics`：**没有当日 run**，最新一条是 10-17 的——文件从未进入识别。
4. **聊天记录**（`lark-cli im +chat-messages-list --as user`，p2p 会话，position 1408–1414）：`/clear` 回「当前已是清空状态 / 没有检测到未完成的三源提报」；`/OA优惠券提报` 回第 1 步卡；两文件后紧接兜底错误卡。
5. **Base 直读**（`lark-cli base +record-list --limit 100 --offset 100`）：表共 **110 条**；第 101–110 条含**两笔 Collecting 活跃草稿**——`reczz28ObXpUs40k`（`CTS-54d3734e`，10-18 04:10 创建）与 `reczz28P5cWuTFIq`（`CTS-d11e5302`，10-19 09:35:23 由本次口令创建，**创建后零更新**，`task.sources` 为空）。`/clear` 声称"没有未完成提报"与此矛盾。
6. **代码定位**：`listActiveCouponThreeSourcePilotDrafts`（`server/lib/feishu/coupon-oa/three-source/store.ts`）只请求 `?page_size=100`，不跟随 `page_token`；对该 owner 恒返回 `[]`。
7. **错误文案成因**：按钮路径 `startAiRecognition` 在 `task.sources` 为空时抛「请先上传配券表和商品白名单，再开始统一识别」（`service.ts`），该文案不匹配 `errors.ts` 任一已知正则 → 落入 `UNEXPECTED_FAILURE` 兜底文案。

## 根因

飞书 Base 列表接口单页上限 100 条，`has_more`/`page_token` 需调用方跟随。四处 store 的列表读取都只读第一页，表过百条后第 101 条起的记录对业务逻辑**完全不可见**。对三源试点表的后果链：

- `/clear`：遍历不到活跃草稿 → 误报"已清空"，僵尸草稿永久残留；
- `/OA优惠券提报`：`startOrResume` 查不到活跃草稿 → 新建第二笔，破坏"单活跃草稿"不变量；
- 文件消息：`dispatchResource` 走 `no_active_draft` 分支静默丢弃（仅 `console.warn`，Vercel 日志几分钟即被 tick 冲掉）；
- 「开始统一识别」：空源抛可执行文案，却因缺少错误映射显示成无信息量兜底卡。

## 修复

- 新增 `server/lib/feishu/bitable-pagination.ts`：`listAllBitableRecords` 跟随 `page_token` 直至 `has_more=false`；`has_more` 为真却缺 token、token 不前进、超过 100 页三种情况一律抛错（fail loud，不再静默截断）；`bitableRecordsPath` 统一构造列表路径。
- 四处接入：三源试点 store、OA 草稿 store（`listActiveCouponOaDrafts`，原为内联 fetch）、`base-store.listRecords`、Excel 试点 store。各自的 `request`、超时、错误前缀、过滤与排序保持不变。
- `errors.ts`：`VALIDATION_REQUIRED` 正则追加「请先上传配券表和商品白名单」「请先确认无法唯一识别的材料角色」，原文透传给用户。
- 回归测试：翻页助手 7 例；四个 store 各一例"活跃记录只在第 2 页仍能找到"（事故场景）；错误映射 2 例。

## 恢复

修复部署后用户重发 `/clear`：翻页后能看见两笔僵尸 Collecting 草稿并正常取消（预期回「已清空 2 笔三源提报」），无需手工 upsert。随后重新 `/OA优惠券提报` 并上传材料即可。

## 边界声明

本记录仅为诊断与验证证据，不构成任何上线批准；原生 OA 创建边界（draft-only、kill switch）未受本次修复影响。遗留取舍：`listActive*` 现为全量翻页（当前 2 次请求），记录持续增长后应考虑服务端 filter 或旧记录归档，不在本次范围。
