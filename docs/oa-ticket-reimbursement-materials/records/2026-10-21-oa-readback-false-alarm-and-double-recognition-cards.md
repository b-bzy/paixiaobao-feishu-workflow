# 2026-10-21 OA 提报"字段回读差异"误报 + 识别按钮双击重复发卡:问题识别与修复方案

> 环境:P0 Preview(OPEN_ACCESS 试点,分支 `p0-three-source-direct-http`),新商真实提报测试。
> 状态:**已实施(2026-10-21,本仓库工作区)**:bug-fix-1 A/B/C/D 与 bug-fix-2 均已落地并过全量回归;采用方案 A' 变体——重复 recognition_start 仍执行幂等重激活(保留卡滞恢复通道),仅在草稿状态未变化时跳过重复发卡。待 Preview 部署后真发验证。
> 截图:`~/Movies/CleanShot 2026-10-21 at 09.26.29@2x.png`(回读差异卡)、`09.30.49@2x.png`(双"AI 识别中"卡)。
> 同日后续 bug-fix-3/4(白名单 ID 类型识别 + 确认依据字段)见 [2026-10-21-whitelist-id-dimension-recognition-and-reason-field.md](2026-10-21-whitelist-id-dimension-recognition-and-reason-field.md)。

## 结论速览

| 编号 | 现象 | 定位结论 | 修复方向 |
| --- | --- | --- | --- |
| bug-fix-1 | OA 已成功创建,结果卡却显示红色「已创建但需立即复核/字段回读存在差异」,两个金额控件(预估GMV、预估费用)被标记不一致 | OA 提报本身成功;是**创建后自动核对(readback diff)的金额比对过于严格**把"提交值与飞书存储值仅在小数精度上不同"误判为不一致(10-15 曾修过附件同款误报,这次轮到 amount 控件) | 金额按"分"归一化后再比对 + 卡片信息架构改为"创建成功(绿)+ 核对提示(次级块)" + 文案通俗化 |
| bug-fix-2 | 双击"材料已上传完毕,开始统一识别"后出现两张一模一样的"第 2 步 AI 识别中"卡 | 是**双击**(两次点击=两个不同事件,各自完整走了一遍流程),不是内部响应重复——入口按 event_id 去重,同一事件的重发不会产生第二张卡;但**重复点击没有业务层幂等**,第二次点击被当成全新请求并再发一张状态卡 | dispatcher 对"已在识别中"的重复 `recognition_start` 直接收敛为 no-op,不再发第二张卡 |

---

## Bug-fix-1:OA 已提报成功,卡片却报"字段回读存在差异"

### 1.1 先回答:"字段回读"是什么(通俗版)

系统在你点击"确认提交正式 OA"之后,做了三件事:

1. 把你确认过的内容**提交**给飞书,创建正式审批(这一步成功了——你的 OA 里确实有这笔提报);
2. 提交成功后,系统**马上把刚创建的 OA 内容重新读回来一遍**;
3. 把"读回来的内容"和"当初提交的内容"**逐项比对**,确认飞书没有丢字段、改数值。

这个"读回来并比对"的动作就是代码里的 readback/diff,卡片上叫"字段回读"。它的目的是防"提交成功但内容悄悄变了"这种最危险的情况,属于安全兜底,不影响 OA 本身。

**你这次的情况属于第 3 步比对器报了假警**:OA 里实际存的金额和提交金额只差在小数精度(如 `22500.000000000004` vs `22500`),业务上完全一致,但比对器按"字符串必须逐位相等"判了不一致。

### 1.2 完整链路(代码定位)

```text
submitConfirmedCouponOaDraft (server/lib/feishu/coupon-oa/submit-service.ts:190)
  ├─ createCouponApprovalInstance   → OA 创建成功 ✓(你能在飞书 OA 里看到)
  ├─ getCouponApprovalInstance      → 把刚创建的实例 detail 读回
  ├─ parseApprovalFormValues        → 解析回读表单 (approval-schema.ts:449)
  ├─ diffSubmittedApprovalForm      → 逐控件比对 (approval-schema.ts:689)
  │    └─ amount 分支 (approval-schema.ts:770-784):
  │         decimal(提交值) !== decimal(回读值) 或币种不同 → 记一条 issue
  └─ 有 issue → 状态落 CreatedNeedsReview → 发红色「已创建但需立即复核」卡
       (cards.ts:477-509 buildCouponOaSubmissionResultCard:success ? 绿 : 红,二元)
```

### 1.3 根因分析

**已确认的代码事实:**

1. `estimatedCostYuan`(预估费用)是四数连乘的浮点计算(`calculation.ts:178-182`:总量×面额×使用率×平台承担比例),JavaScript 浮点乘法经常产生 `450000.00000000006` 这类尾差;
2. `estimatedGmvYuan`(预计成交额)来自表单文本直接 parse(`recognition.ts:958`),不做任何小数位归一化——用户从 Excel 复制或 AI 回填的计算值可以带任意位小数;
3. 提交时原样发送(`approval-schema.ts:409-410`),而飞书金额控件有自己的小数位精度(通常 2 位),**创建时按控件精度四舍五入存储**;
4. 回读比对用归一化后的字符串严格相等(`decimal()`,approval-schema.ts:531-547——它只处理前后零,不处理精度差),`22500.000000000004 ≠ 22500` → 误报。

**为什么以前没报、新商测试报了:** 是否触发完全取决于具体数字。canary 用的整数金额恰好干净;新商测算的费用连乘出尾差、成交额带多位小数,就触发了。这解释了间歇性。

**备选假设(次要,一并防御):** 回读的币种若以 `value.currency` 嵌套形态返回,`currencyValue()`(approval-schema.ts:555-562,只认控件顶层 `currency` 和 `value.ext.currency`)会取不到而误判不等。修复中顺带补齐取值路径,成本极低。

**判别验证(实施修复前 5 分钟可做,需授权):** 对这次新商的实例 `GET /approval/v4/instances/{instance_code}`,对比 form 里两个 amount 控件的 value 与草稿提交值——若只差小数位即证实主假设。也可直接在飞书 OA 界面肉眼比对金额。

**重要:这次的 OA 本身没有任何问题**,金额经飞书精度归一后是正确的业务值,无需撤回或重提。

### 1.4 修复方案

原则:不是"关掉报警",而是让**确认快照、提交值、飞书存储值三者本来就一致**,再把核对结果的信息架构改对。

**A. 金额按"分"归一化(根治,上游优先)**
- `calculation.ts`:`computeRegularFullReductionValues` 的 `estimatedCostYuan` 计算后四舍五入到 2 位小数(分),`estimatedRoi` 同步;
- `recognition.ts` `normalizedOwnerValue`:`estimatedGmvYuan` 输入归一化到 2 位小数;
- 归一化做在**值定稿处**(而不是提交时),保证用户在第 4 步卡片上确认、冻结快照、OA 实际内容三者完全一致——这是审计要求,不只是消警。

**B. 比对器容错(防御纵深)**
- `diffSubmittedApprovalForm` amount 分支:两侧各先按分归一化再比较; genuinely 不同的金额(分以下也不同的真实差异)依然照报;
- `currencyValue` 补 `value.currency` 嵌套取值路径。

**C. 结果卡信息架构重做(对应用户诉求 1)**
`buildCouponOaSubmissionResultCard`(cards.ts:477-509)从"全绿或全红"二元改为:
- **创建成功即绿色主状态**:标题「优惠券 OA 提报已完成」+ 绿色「已提报」徽标(只要实例创建成功就绿,红色只保留给"创建结果未知/失败");
- 核对结果降为次级块:核对全部一致 → 一行"已自动核对,提交内容与 OA 一致";存在差异 → 橙色「内容核对提示」块列出条目,附"打开正式 OA 核对"按钮与一句指引(如需修正联系管理员),不再用红色"需立即复核"吓人;
- `CreatedNeedsReview` 状态语义不变(真差异仍进人工复核状态),只改卡片呈现。

**D. 差异文案通俗化(对应用户诉求 2)**
- 卡片副标题「字段回读存在差异」→「提交内容自动核对:发现 N 项不一致」;
- 差异条目从 `widget17549659287210001: submitted amount differs from created approval` 改为控件业务名 + 双值,例如:「预估GMV:提交 1,904,761.90 / OA 实际 1,904,761.90(小数精度差异,已一致)」或真实差异时「预估费用:提交 26,137.90 / OA 实际 26,100.00,请核对」——需要把 `ApprovalFormVerification` 的条目从裸字符串升级为结构化 `{控件名, 提交值, 回读值, 差异类型}`(diff 函数已持有 schema 控件名与两侧值,信息齐全)。

**测试:**
- `approval-schema.test.ts`:amount 比对新用例(浮点尾差=一致、分以下真实差异=报、币种嵌套形态=一致);
- `calculation.test.ts`:连乘尾差归一化;
- `cards.test.ts` / `submit-service.test.ts`:新结果卡结构(创建成功+差异→绿主状态+提示块)、修归一化后健康提交落 `Submitted`;
- 回归:10-15 的附件 ext 文件名比对用例不破坏。

---

## Bug-fix-2:双击"识别生成"出现两张"第 2 步"卡

### 2.1 定位结论:是双击,不是内部响应问题

用户两个假设的判别:

- **"内部响应参数导致无论点不点都出两张卡"——可以排除。** 入口 `server/api/feishu/bridge.post.ts:144-161` 对每个投递按 `stableDeliveryId`(=飞书 `event_id`)做持久去重,同一事件的重复投递(bridge 超时重发、飞书 at-least-once 重推)直接返回 duplicate,不会二次处理;发卡也以同一 `event_id` 作幂等键(`events.ts:792` → `dispatcher.ts:1468-1473` → `sendCard(openId, card, idempotencyKey)`)。也就是说,传输层重复被现有幂等正确吸收了。
- **"双击导致"——成立,且是我们的缺口。** 飞书卡片每次物理点击都产生**新的** `event_id`,两次点击 = 两条互不相同的事件 = 各自完整处理一遍。用户自述"不小心点击了两次",与两张卡一致。

### 2.2 为什么双击能穿透四道已有防线

| 防线 | 现状 | 对本按钮是否生效 |
| --- | --- | --- |
| 入口 event_id 去重(bridge.post.ts) | 只拦"同一事件重发" | ✗ 两次点击是两个 event_id |
| 版本守卫(dispatcher.ts:1127) | `recognition_start` 被列为 **stateless action**(dispatcher.ts:1122-1126),跳过 revision 校验 | ✗ 刻意豁免 |
| `claimAction` 语义去重(dispatcher.ts:1148) | **只挂在 `mapping_confirm` 上** | ✗ 未覆盖 |
| 生成中状态门禁(dispatcher.ts:1094-1099) | 只拦 `GeneratingArtifacts` 状态;AI 识别中的状态是 `hasPendingAiRecognition`,无同款门禁 | ✗ 未覆盖 |

穿透后的重复路径:

```text
第 2 次点击 → dispatcher recognition_start(stateless,无守卫)
  → service.startAiRecognition(service.ts:548)
      → currentBatch 分支(service.ts:577-587):识别已为当前 revision 准备好
        → 仅重新 activatePendingRecognitions,草稿无变化,静默成功
  → dispatcher 无条件 sendDraftState(dispatcher.ts:1468)
      → hasPendingAiRecognition=true → 渲染"AI 识别中"卡 → 再发一张
```

附注:第 2 次点击会再次触发 `activateAiRecognition(runId)`(service.ts:1174-1182),PG 侧 run 状态守卫按设计应吸收(实现时确认一次);发两张卡是确定发生的用户可见后果,也是本次要修的点。

### 2.3 修复方案

**A. 最小修复(必做):重复 `recognition_start` 收敛为 no-op**
- dispatcher 在 switch 前(或 `recognition_start` case 内)加守卫:`action === "coupon_three_source_recognition_start"` 且 `hasPendingAiRecognition(draft)` → 直接返回 `{handled: true, message: "recognition already running"}`,**不发卡、不重激活**;
- 等价兜底:service 层 `currentBatch` 分支已返回原草稿(`next === draft`),dispatcher 对"状态未变化"的 recognition_start 跳过 `sendDraftState`;
- 效果:双击、旧卡迟到重击,只要识别已在跑,一律无事发生。第 1 步卡上已有说明 + 已发出的"AI 识别中"卡足以告知用户在跑。

**B. 加固(建议,防所有入口按钮的连点):**
- 参照 `mapping_confirm` 的"点击即折叠"(dispatcher.ts:1260-1273):记录第 1 步 intake 卡的 messageId(现有 `mappingCardDelivery` 同款模式),点击后 PATCH 为无按钮形态。改动面较大(需新增 intake 卡投递记录),可作为第二批;
- 可选:把 `claimAction` 语义键扩展到 `recognition_start`(`taskId+revision+actionName`),与 A 冗余,A 优先。

**测试:**
- dispatcher 测试:识别 pending 时第二次 `recognition_start` → `sendCard` 零调用、返回 handled;首次点击照常发卡;
- 回归:正常单次点击、`reopen`(只读重渲染依赖 stateless 语义)不受影响——守卫只拦"识别已在跑"的重复 start,不拦其他 stateless action;
- 上线后可用 replay 脚本注入两次同 action 不同 event_id 验证只出一张卡。

---

## 实施顺序与验证

1. **bug-fix-2 A**(最小、独立、零状态机变更)→ 双击回归验证;
2. **bug-fix-1 A+B**(数值归一化 + 比对容错)→ 单测 + 用新商同款数字本地直调 diff 验证;
3. **bug-fix-1 C+D**(卡片重排 + 文案)→ `audit:cards --send` 真发验证新卡形态(卡片属性白名单纪律);
4. 全量 `pnpm test` / `pnpm lint` / `pnpm typecheck`,部署 Preview 后由用户重跑一次新商提报,预期:绿色「提报已完成」+ 核对一致,或绿色 + 精度差异提示;双击识别只出一张卡。

## 边界与不动项

- 不改变 draft-only/OPEN_ACCESS Gate、审批路由、审批人、抄送人;
- 不改变 `SubmissionUnknown`/`CreatedNeedsReview` 状态机语义,只修误判输入与呈现;
- 回读核对本身保留——它是"创建后 readback"红线(ADR)的落地,修的是精度语义不是删除核对;
- 差异文案升级为结构化结果属领域层输出,不引入 AI 参与判定。
