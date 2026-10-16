# 三源映射表单卡 ErrCode 11310「name 超长」诊断记录

- **日期**：2026-10-16 上午（北京时间）
- **环境**：Vercel Preview `aihuishou-feishu-workflow-915d08p3b`（部署身份 `8f752be`，分支 `p0-three-source-direct-http`）
- **现象**：用户飞书 E2E 停在「第 2 步 AI 识别中」超过 4 分钟无后续卡片；worker 日志连续多个 tick `processed jobs=0 effects=0`（认领了但 0 成功）后归于沉默。
- **影响范围**：`907c9a6` 部署后的**所有**三源映射表单卡投递（含 2026-10-15 16:37 与 17:54 两轮的 `mappingCardPersisted=false`——当时未被归因）。

## 事实链（诊断顺序）

1. **bridge 日志**（`.local/p0-preview-bridge.log`）：用户动作全部到达且 `forwarded status=200`——事件入口无故障。
2. **AI 诊断端点** `GET /api/internal/control-plane/ai-diagnostics`（Bearer tick token + protection bypass）：最新 run `status=succeeded`、`projected=true`、活动文案 `succeeded`，但 `draftProjection.mappingCardPersisted=false` → 识别与写入正常，投递段失败。
3. **Base 直读**（`lark-cli base +record-list`，三源试点表）：活跃草稿 `reczz28NtbiBLSvW`（`CTS-b5f7cd48`，revision 3，Status=Collecting）——`task.sources` 两源齐全、`pendingSources=[]`、两槽位识别 `primary=true`、**无 `mappingCardDelivery`**；`blacklistStatus=absent_pending_confirmation`。
4. **真发复现**（`pnpm audit:cards -- --draft <导出> --send --only REAL-DRAFT`）：
   `Failed to create card content, ext=ErrCode: 11310; ErrPath: ROOT -> body -> elements -> [4](tag: form); ErrMsg: name exceed the default maximum 100`
5. **本地构建扫描**（字符串属性逐项测长）：命中 112 字符的 name——
   `coupon_three_source_mapping_confirm:<recordId>:<revision>:<64 hex>`
6. **git 定位**：`git log -S` 证实 `590f677`（2026-10-10）引入的无哈希模板 ~55 字符一直正常；`907c9a6` 追加全量 `computeCouponThreeSourceMappingContextHash` 后**确定性**超过飞书 100 字符上限（最短 102）。

## 根因

飞书卡片组件 `name` 上限 100 字符（线上实测，文档未写明）。`907c9a6` 为防"同 revision 下材料/识别结果漂移"在确认按钮 name 尾部拼接 64 位上下文哈希，使 name 必然超限；发卡 effect 5 次重试全拒后进死信，草稿永久缺投递，用户侧表现为"AI 识别中"不动。

## 修复（对应实施基线 v1.12）

- `action-name.ts`：版本化动作 name 唯一编解码点；wire 侧哈希截为 24 hex（96 bit，仅同 revision 内比对），构建期断言 ≤100 fail-closed；解析器兼容无哈希历史卡、拒绝 64 hex 旧格式。
- `dispatcher.ts`：解析与哈希比对对称改造；语义幂等键与 Base `contextHash` 保持全量 64 hex。
- 防回归：cards-schema walker 与 `audit:cards` 干跑增加 name>100 / default_value>800 静态门禁；补 dispatcher 哈希路径测试（此前零覆盖）。

## 恢复

死信不自愈。用户重发 `/OA优惠券提报` → `startOrResume` 复用活跃草稿 → `sendDraftState` 重发映射卡（`mappingCardDelivery` 缺失故必然新建消息），revision 不变、识别结果零损失；无需重传文件或手工补发。

## 证据留存

- 导出草稿：`.local/stuck-draft-export.json`（Git 忽略，含 ownerOpenId 顶层字段，可供 `audit:cards --draft` 复用）
- 真发报错原文见上文第 4 步；Base 记录与 worker 日志时间窗（2026-10-16T01:11–01:16Z）以当日会话记录为准。

## 边界声明

本记录仅为诊断与验证证据，不构成任何上线批准；原生 OA 创建边界（draft-only、kill switch）未受本次修复影响。
