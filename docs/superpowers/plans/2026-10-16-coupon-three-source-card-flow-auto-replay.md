# 三源卡片链路自动重放与卡点记录 · 执行方案 v1

> **状态：待用户确认。本文包含真实外部副作用（向你飞书会话真发卡片、Preview 控制面写入、DeepSeek 识别调用），未获确认前不执行任何步骤。**

**日期**：2026-10-16
**发起**：用户要求自动填卡+自动提交，全流程走一遍，重点观察卡点并记录 bug
**关联**：[本地用例检查器（已建）](../../.local/case-inspector/) · [整合实施计划（方案A/B）](2026-10-16-coupon-three-source-gap-reminder-and-merchant-id-integrated.md) · `p0-preview-deploy` / `p0-stuck-diagnosis` skill

---

## 1. 目标与非目标

**目标**：用真实测试用例（桌面 `测试用例/case1-9`）把 P0 三源全流程真实走通一遍——指令 → 文件上传 → 角色确认 → AI 识别 → 第二轮映射卡 → **脚本自动填表+提交** → 重叠/黑名单确认 → 冻结生成 → OA 草稿卡——逐阶段记录时间线，超阈值即判卡点，产出结构化 bug 清单。

**非目标**：
- 不提交原生 OA（全程 draft-only，最终止步于 OA 草稿卡）；
- 不修改产品代码（发现的 bug 只记录，归入方案 A/B 或新立项）；
- 不伪造文件消息（文件必须由你真实发送，`file_key` 无法合成）；
- 不做多人并发（单 case 串行）。

## 2. 机制：如何"自动填卡"（可行性已核实）

卡片上的确认按钮/表单，在服务端就是 `card.action.trigger` 事件。注入器把"真人点击"构造成同构事件，走**完全相同的链路**：

```
注入器脚本 ──HMAC签名──▶ POST Preview /api/feishu/bridge
  → 耐久收件箱（去重/回放校验）→ worker（租约/tick）→ dispatcher
  → 校验/revision/冻结/生成 → 真实飞书发卡到你的会话
```

- 信封形状与签名头直接复用 `scripts/lib/long-connection-bridge-runtime.mjs:287-308`（card.action.trigger 构造）与 `:326-349`（`createBridgeSignedHeaders`），凭据与运行中的 bridge 同源；
- operator = 你的 open_id（等同你本人点击，已获你授权）；
- 注入事件全部使用全新 `event_id`（uuid），**绝不重放**真实事件 id；
- 卡片动作全集（`cards.ts`，注入器需支持）：`role_confirm`、`no_blacklist_confirm`、`mapping_confirm`、`overlap_decide`、`final_confirm`、`calc_images_append/replace_all`、`supplement_recognition_start`、`cancel`。

与真人操作的唯一差异：动作事件由脚本构造。其余 100% 真实（含 AI 识别、Base 草稿、对象存储、发卡）。

## 3. 分层测试设计

| 层 | 内容 | 成本 | 回答的问题 |
| --- | --- | --- | --- |
| L0 | 环境与部署前置检查 | 0 | 链路在线吗？测哪个 SHA？draft-only 吗？ |
| L1 | `pnpm audit:cards -- --send` 全形态真发+自动撤回；`--draft` 用真实 Base 草稿渲染映射卡真发 | ~16 张卡（自动撤回） | 每种卡片 schema 飞书收不收（11310/200621 类） |
| L2 | **主体：逐 case 全流程自动重放** | 每 case 5–10 张真卡 + DeepSeek 调用 | 流程哪一步卡住、卡片到不到、状态机死不死 |
| L3 | 故障注入（第二轮，可选） | 每 round 2–3 张卡 | 失败路径：恢复卡、幂等、revision 竞态 |

## 4. 阶段任务

### Phase 0: 环境前置（无副作用）

- [ ] `pnpm p0:preview:status`：确认 bridge/worker 在线、Preview URL、部署 SHA；
- [ ] **SHA 决策**：当前部署 aapp4eol4（cbc25e6）vs 重部署含 `b466413`（枚举报错中文文案，流程中错误提示更好看）。若重部署：需先处置未提交文件（4 份文档 + 2 个脚本），走标准 stash/commit 流程，**单独授权**；
- [ ] 确认 draft-only / native kill switch 关闭（部署配置 + final_confirm 链路止步 OA 草稿卡）；
- [ ] 注入器凭据来源（已核实）：仓库根 `.env.local`（FEISHU_BRIDGE_KEY_ID / FEISHU_BRIDGE_SHARED_SECRET / VERCEL_AUTOMATION_BYPASS_SECRET）+ `.local/p0-preview-state.json`（Preview URL）；脚本**不得打印任何凭据值**；+ 你的 open_id；
- [ ] **时序约束**：若方案 B（整合计划阶段一）已先行合入部署，本计划 §7-1 / Phase 4 的"预期复现 11310"全部反转预期为"回归验证通过"——开工前按当时代码状态改写预期。

### Phase 1: L1 卡片真发审计（授权项 1）

- [ ] `pnpm audit:cards -- --send`：全部卡片形态真发+撤回，预期 16/16 通过（cbc25e6 后基线）；
- [ ] 从 Base 导出当前任一草稿，`pnpm audit:cards -- --send --draft <导出> --only mapping`：真实草稿渲染的映射卡真发验证。

### Phase 2: 注入器构建（本地开发，无外部副作用）

- [ ] 新脚本 `scripts/coupon-three-source-flow-replayer.mts`（默认不入库，留 working tree）：
  - `watch`：轮询 Base State JSON（draft status/revision/validationIssues/failureReason）→ 追加 `timeline.jsonl`；
  - `submit --action <name> --form <json>`：构造签名信封注入 card.action.trigger；
  - `replay --case <n> --config <json>`：按状态机自动逐卡交互；
  - 卡点检测：§5 阈值表，超时即标记 + 自动抓取证据（`/api/internal/control-plane/ai-diagnostics`、Base 直读）；
- [ ] 从 `cards.ts` 提取映射卡表单字段的准确 `name`（`owner_*` 前缀等），与本地 inspector 已验证的补充值（业务模式=pop、活动背景=**本地自动测试**<标记前缀，见 §11-A1/A9>、起止日期、是否超扣=否、优惠券赠送=不允许、领取规则、活动积分比例=6、公开推广渠道）做成每 case 配置；**form_value 所有值一律转字符串**（真人表单提交含数字均为字符串，否则测的是生产不存在的路径）；
- [ ] **干跑验证**：注入一次故意非法表单（缺必填）→ 预期：请求被接受、dispatcher 拒绝、无 revision 变化、无卡片异常；
- [ ] **信封保真度对比**：从 bridge 日志取一次真人点击的 card.action.trigger 信封，与注入信封逐字段 diff，确认除 event_id 外同构。

### Phase 3: L2 逐 case 全流程重放（授权项 2）

顺序（每 case 串行，跑完一个汇报再下一个）：

- [ ] **canary: case3**（配券型号表+商品明细白名单，本地已全绿的最干净 case）
- [ ] case8（小名单 SKU 单档）
- [ ] case6（2872 行大名单，压生成耗时）
- [ ] case1（商家ID白名单 → 预期卡在维度确认门，验证卡点表现与文案）
- [ ] （视前四个结果决定）case9 多源场景与 case5

每 case 流程（含**前置清除**，见 §11-A3——重发口令会 `startOrResume` 复用活跃草稿，不清除会把下个 case 的文件挂到上个 case 的草稿上）：

1. **清除**：你发 `clear` 口令（级联取消三源草稿+OA 草稿）→ 脚本确认 Base 无活跃草稿；
2. 你发 `/OA优惠券提报` + 该 case 两个文件 → 脚本 watch 到**新 CTS id**（确认草稿新鲜，不是复用）；
3. 脚本逐卡自动交互至 OA 草稿卡或卡点；
4. 产出 `.local/flow-replay/<case>/timeline.jsonl` + 卡点记录。

case1/case2 追加**最小填变体**（见 §11-A2）：填全配置会绕开事故路径，需再跑一轮"不填公开推广渠道"的最小变体，才会走到 11310 恢复卡分支。

### Phase 4: L3 故障注入（授权项 3，可选第二轮）

- [ ] **11310 复现（触发条件已修正，见 §11-A2）**：提交时**留空公开推广渠道**且表内推广途径=公开自动推广（case1/2 表格天然满足）→ 冻结校验命中 `publicPromotionChannels` → 恢复卡两区重名 → 预期整卡拒收+静默+「生成中」死卡（方案 B 改动 1/3 靶区，当前代码未修）。注意：`优惠券赠送=是` 等其他非法枚举**不会**触发重名（`optionalOwnerSupplementKeys` 仅含 `publicPromotionChannels`），只走普通枚举拒绝路径——那是另一条值得记录但不叫 11310 的用例；
- [ ] **幂等测试拆两层（见 §11-A4）**：① 原样重发同一 HTTP 请求体（旧 nonce）→ 预期被 `BridgeNonceReplayCache` 挡下，**不产生任何副作用**；② 同 event_id + 全新 nonce/timestamp/签名重新构造 → 预期被耐久收件箱去重，无重复副作用；③ 不同 event_id 重复同一确认 → 预期 revision 竞态拒绝；
- [ ] 旧 revision 提交 → 验证竞态拒绝文案。

### Phase 5: 汇总产出

- [ ] `.local/flow-replay/BUGLIST.md`：按 §6 格式记录全部卡点与 bug；
- [ ] 每条 bug 归属判定：方案 A 靶区 / 方案 B 靶区 / 新立项（如枚举方言映射、表头别名扩充）；
- [ ] 向你汇报：时间线摘要、卡点清单、修复优先级建议。

## 5. 观测与卡点判定阈值

| 阶段 | 预期上限 | 超时判定 |
| --- | --- | --- |
| 文件上传 → 角色/受理卡 | 30s | 卡点：intake |
| 角色确认 → AI 识别开始卡 | 10s | 卡点：分发 |
| AI 识别开始 → 映射卡 | 180s | 卡点：AI（查 ai-diagnostics + worker 日志） |
| mapping 确认 → 校验失败恢复卡 | 30s | **卡点高发区（11310 史）** |
| mapping 确认 → final/重叠卡 | 30s | 卡点：dispatcher |
| final 确认 → 生成完成 | 300s | 卡点：worker 生成（deadline 8f752be 观察项） |
| 生成完成 → OA 草稿卡 | 60s | 卡点：发卡 |

任一超阈值：记卡点 → 按 `p0-stuck-diagnosis` 流程就地取证（bridge 时间线 → worker tick → ai-diagnostics → Base failureReason），**不盲目重试**。

## 6. bug 记录格式

```markdown
### BUG-<case>-<n>: <一句话标题>
- 阶段: <如 mapping_confirm → 生成>
- 现象: <卡片停留「生成中」X 分钟无后续 / 卡片被拒收 / 状态不动>
- 证据: timeline.jsonl L<行>；Base failureReason=<值>；effect <id>=<状态>
- 初步归因: <file:line 猜测>
- 复现: <注入器命令>
- 建议归属: 方案A / 方案B改动<#> / 新立项
```

## 7. 已知嫌疑清单（预期会撞到的，提前挂账）

1. **公开自动推广+渠道空 → 冻结失败 → 恢复卡重名 11310 → 静默 → 「生成中」死卡**：方案 B 改动 1/3 靶区，代码未修；触发条件唯一（`optionalOwnerSupplementKeys` 仅含 `publicPromotionChannels`，cards.ts:335），L2 最小填变体与 L3 均应撞到——按设计这正是要采集的证据；
2. 公开自动推广+渠道空 → 冻结阶段才报错（方案 B 改动 2 靶区，本地 inspector 已在 case1/2 撞到）；
3. case9 老系统表格式方言（`每日领取上限`/`使用时间`表头、`活动期间每天可领1次`、`是`枚举）：映射卡预填与校验的具体表现待真发观察（新立项素材）；
4. AI 识别超时/慢（worker 硬 deadline 已修，验证修复效果）；
5. 表内已有非法值时表单补充值不生效（本地发现，真发观察 AI 表单修复路径是否兜住）。

## 8. 你的参与方式（每 case 约 3–6 分钟）

1. 我说"开始 caseN"后，你先发 `clear`（清掉上一 case 的活跃草稿），再正常发 `/OA优惠券提报` 和该 case 的两个文件；
2. **期间不要手动点任何卡片**——并发 revision 竞态会污染测试（历史事故类别）；
3. 收到的卡片全部由脚本自动交互，你只需看着（或不管），跑完我汇报时间线。

## 8a. 观测盲区补强

watch 除轮询 Base State JSON 外，同时 tail 本机 bridge/worker 进程日志（它们就在本地跑，`p0-stuck-diagnosis` 第一步就是 bridge 时间线）——intake 之前就死（bridge 断连、事件未进收件箱）时，Base 侧只会表现为"什么都没发生"，进程日志是唯一现场。

## 9. 授权点清单（执行前逐项确认）

- [ ] **A1** L1 真发审计：~16 张卡到你 会话，全部自动撤回；
- [ ] **A2** L2 全流程重放：每 case 5–10 张真卡、POC Base/对象存储产生草稿与产物、DeepSeek 识别调用（费用）；
- [ ] **A3** L3 故障注入：每 round 额外 2–3 张卡，预期产生死卡样本（本身就是测试目标）；
- [ ] **A4** 是否重部署 `b466413`（测最新代码；需先处置未提交文件）；
- [ ] **A5** 注入器脚本去向（默认留本地不提交；验证有效后可作为测试工具入库）。

## 10. 停止条件

出现任一立即停：未知外部结果（创建结果不确定）、任何原生 OA 提交迹象（draft-only 下应不存在）、Preview 身份不匹配、bridge/worker 早退、你喊停。停止后保留现场取证，不清理不重试。

---

## 11. 审计修订 v1.1（2026-10-16，逐项对照代码核实）

| # | 对照项 | 结论 | 发现与动作 |
| --- | --- | --- | --- |
| A1 | AGENTS 红线"AI/脚本不得决定字段事实" | ⚠️ 可接受需标记 | 注入器以你 open_id 代填代提交=脚本代 owner 声明字段事实；POC draft-only + 你本人授权下可接受，但活动背景强制加「本地自动测试」前缀（Phase 2 已改），保证测试草稿可辨识、不混入真实审计轨迹 |
| A2 | L3 的 11310 触发条件 | 🆕 **实锤错误已修** | `optionalOwnerSupplementKeys` 仅含 `publicPromotionChannels`（cards.ts:335），重名只能由"公开自动推广+渠道空"触发；原方案写的"优惠券赠送=是"只走普通枚举拒绝、**不会** 11310。且 L2 填全配置恰好绕开事故路径——case1/2 增加"最小填变体"（Phase 3/4 已改） |
| A3 | 连续 case 的草稿隔离 | 🆕 **实锤遗漏已补** | `dispatchText → startOrResume(openId)` 会**复用活跃草稿**，OA 草稿活跃时还有 `activeWorkflowConflict` 拦截；不做每 case 前置 `clear`（config.ts:7，级联取消三源+OA 草稿）则 case 互相污染。Phase 3 流程已重写为 清除→新 CTS id 确认→开跑 |
| A4 | 幂等测试设计 | ⚠️ 已拆分 | 原样重发 HTTP 请求体会先被 `BridgeNonceReplayCache`（bridge-auth.ts:105）挡下，测的是 bridge 防重放而非控制面去重；L3 拆为三层（Phase 4 已改）：旧 nonce 原样重发 / 同 event_id 新签名 / 不同 event_id 重复确认 |
| A5 | 注入器凭据来源 | ✅ 已落实 | `.env.local`（BRIDGE KEY_ID/SHARED_SECRET、VERCEL bypass）+ `.local/p0-preview-state.json`；Phase 0 已写明，脚本禁打印凭据 |
| A6 | 注入信封保真度 | ⚠️ 已加防线 | 注入器模拟 bridge 输出而非飞书原始事件，理论上同构但有两个细节风险：form_value 必须全字符串（真人表单数字也是字符串）；Phase 2 新增"真实点击信封 diff"干跑项 |
| A7 | 观测盲区 | ⚠️ 已补强 | 只盯 Base 会漏掉 intake 前死亡（bridge 断、事件未入箱）；§8a 新增 tail 本机 bridge/worker 日志 |
| A8 | 与方案 B 时序耦合 | ⚠️ 已注记 | L3"预期复现 11310"仅在方案 B 合入前成立；Phase 0 新增时序约束：先测后修，或按当时代码反转预期 |
| A9 | 测试草稿与数据边界 | ⚠️ 已纳管 | 每 case 留 POC Base/对象存储草稿；BUGLIST.md 若移入 docs 必须脱敏（真实材料只留 .local/cases/drafts）；「本地自动测试」前缀兼作排查锚点 |
| A10 | 阈值表合理性 | ✅ | 生成 300s 对 2872 行（本地生成 <0.5s，大头在上传）充裕；超时是标记非硬失败，语义正确 |
| A11 | 与 skill/红线对齐 | ✅ | 停止条件与 p0-preview-deploy 一致；取证优先与 p0-stuck-diagnosis 一致；draft-only、不碰 native、不伪造文件事件、事件 id 全新不重放 |

**审计判定：方案可执行**，前提是 A2/A3 两处实锤修正（已并入正文）与 A4/A6 防线（已并入 Phase 2/4）；A1/A9 的「本地自动测试」前缀为强制项。
