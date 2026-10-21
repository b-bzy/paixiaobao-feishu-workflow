# 2026-10-21 白名单 ID 类型识别不出来 + 「确认依据」字段冗余:问题定位与修复方案(bug-fix-3 / bug-fix-4)

> 环境:P0 Preview(OPEN_ACCESS 试点,分支 `p0-three-source-direct-http`),新商真实提报测试,与同日 [bug-fix-1/2 记录](2026-10-21-oa-readback-false-alarm-and-double-recognition-cards.md) 同一场。
> 状态:**已实施(2026-10-21,本仓库工作区)**:设计 v1 已按 bug-fix-4 修订(D2 删除 ≥2 字依据句)、ADR 编号顺延为 [ADR-0015](../../../adr/0015-merchant-id-whitelist-closed-set-dimension-recognition.md)、PRD 升 v1.7、rule version 升 three-source-offline-v2。prompt v7/二选一确认卡/生成维度化均已落地并过全量回归(含新增 e2e S17)。待 Preview 部署后真发验证。
> 截图:`~/Movies/CleanShot 2026-10-21 at 09.48.40@2x.png`(白名单识别困难卡)、`09.43.50@2x.png`(确认依据输入框)。

## 结论速览

| 编号 | 现象 | 定位结论 | 修复方向 |
| --- | --- | --- | --- |
| bug-fix-3 | 文件名明写「商家ID_10月新商优惠券-双十一前置.xlsx」的无表头单列名单,系统识别不出 ID 类型;兜底卡只有「确认原值实际是 SKU」一个下拉选项,没有商家 ID 可选 | DeepSeek **确实被调用了**(第 2 步「AI 识别中」就是对三个源逐一跑 DeepSeek),但 prompt v6 有两条硬禁令:禁止按文件名判标识维度、无表头单列数字**必须**返回 UNKNOWN(`ai-recognition.ts:1024-1026`);确定性识别层同样主动放弃文件名证据(`recognition.ts:225-227`)。所以"识别不出来"是**规则设计的结果**,不是没接 API,也不是模型能力不足——本地 POC 已证明放开证据后同批无表头样本判定显著改善 | 落地既有待评审设计 [商家 ID 白名单 v1](../proposals/three-source/coupon-three-source-merchant-id-whitelist-design-v1.md):prompt v7 放开证据、判定集封闭为 `SKU` \| `MERCHANT_ID`(无第三种)、确认卡改二选一、生成侧支持「限商家ID」 |
| bug-fix-4 | 「确认依据(至少 2 个字)」必填输入框,业务上属多余确认项 | 它是当前 confirm-as-SKU 路径的强制审计输入:卡片必填(`cards.ts:1150-1156`)、提交时校验 ≥2 字(`dispatcher.ts:431-436`)、并作为生成侧放行名单的条件之一(`lists.ts:326`)。设计 v1 的 D2 原样保留了它;本次用户反馈(需求方)构成对 D2 的产品修正 | 从确认卡删除该必填框及三层校验;确认记录保留 `detectedDimension + confirmedAs`——二选一本身就是人的显式决定,足以满足"AI 不决定字段事实"红线 |

---

## Bug-fix-3:文件名写着「商家ID」,系统却认不出,兜底只有"确认是 SKU"

### 3.1 现场复述

第 3 步「检查并补充活动信息」卡出现橙色块:**白名单识别困难:商家ID_10月新商优惠券-双十一前置.xlsx 是无表头或标识含义不明确的单列数据,系统只能判断它是名单,不能仅凭数字区分 SKU、SPU 或商家 ID。当前生成只支持 SKU,请确认这些原单元格实际是 SKU**。下方下拉「请确认白名单标识类型」只有一个选项「确认原值实际是 SKU」。

用户的三个诉求:①一开始就该按**文件名 + 表内内容**识别出类型;②识别应通过 DeepSeek 实现,怀疑没用或效果差;③兜底应是**商家ID / SKU 二选一**,而不是这种"二次确定是 SKU"的格式。

### 3.2 先回答"DeepSeek 到底用没用"——用了,但被 prompt 禁令锁死

完整链路:

```text
第 2 步点击「开始统一识别」
  → startAiRecognition (feishu/…/three-source/service.ts:548)
  → 对每个源文件跑 DeepSeek 主识别 (coupon-oa/three-source/ai-recognition.ts,
    prompt 版本 = coupon-three-source-p0-ai-primary-v6, ai-recognition.ts:25)
  → AI 结果存入 draft.recognitions[role].ai.result (service.ts:757-768 消费 skuRegionCandidates)
  → 第 3 步卡渲染 (cards.ts:582-594 unresolvedIdentifierDimension)
```

关键不在"没调用",而在 prompt v6 的三条 system 规则(`ai-recognition.ts:1024-1026`,原文):

1. 「材料角色(whitelist/blacklist)与标识维度(SKU/SPU/MERCHANT_ID/UNKNOWN)是两个独立判断,**不得因文件名含'商家ID'就把**…数字直接判断为 MERCHANT_ID」;
2. 「文件名只可作为**低权重角色线索**…」(只允许影响 whitelist/blacklist 判断,不允许影响维度);
3. 「**无表头单列数字名单无法仅凭数值唯一判断** SKU、SPU 或 MERCHANT_ID,**dimension 必须返回 UNKNOWN**」。

确定性识别层殊途同归:`headerlessSingleColumnCandidate`(coupon-oa/three-source/recognition.ts:200-246)对无表头单列数字直接给 `dimension: "UNKNOWN"`,且 reasons 里明写「文件名包含"商家ID",**但原表无表头,不能据此确定** ID 类型」(recognition.ts:225-227)——识别到了文件名证据,然后**主动扔掉**。

两层任意一层命中,`unresolvedIdentifierDimension` 即返回非 SKU(cards.ts:582-594),渲染困难卡。

**模型能力不是瓶颈的实证**:2026-10-17 本地 DeepSeek 准确率 POC(`.local/deepseek-accuracy-poc/`,含 accuracy-report.md)——现 prompt 下无表头样本 0/4 全 UNKNOWN;根因分析即为「prompt 保守规则放弃文件名+位数证据」;放开证据后同批样本判定改善。POC 的结论与本次定位一致:**不是 DeepSeek 认不出,是识别合同不让它判**。

### 3.3 为什么兜底长成"二次确定是 SKU"——生成侧只支持 SKU,确认只是放行改写

当前确认链(以白名单为例,黑名单对称):

```text
cards.ts:1130-1157    unresolvedWhitelistDimension → 渲染 confirmAsSku 单选项 + dimensionReason 必填框
dispatcher.ts:417-448 mappingSelections:必须选 SKU + 理由≥2字,否则抛错;
                       记录 { detectedDimension, confirmedAs:"SKU", reason }
lists.ts:318-328      dimensionConfirmedAsSku():按 sourceSha256+维度+reason≥2 判定"可作为 SKU 放行"
lists.ts:449-455      非维度 SKU 且未确认 → issue「当前只支持 SKU 名单」
lists.ts:507          解析结果 dimension 硬编码 "SKU"
lists.ts:540-541/624  生成侧硬门:非 SKU 直接抛「当前 P0 只支持 SKU 名单」
calculation.ts:91     配券表 schema:productLimitType = z.literal("限SKU")
template-engine index.ts:137  「限品类型」列 Y 写 productLimitType(固定 限SKU)
```

即:**「确认原值实际是 SKU」不是识别兜底,而是让人为一次维度改写签名放行**。如果这列真是商家 ID,确认"是 SKU"就是虚假声明(文件名明明写着商家ID)——这正是 2026-10-16 真实案例暴露的问题。

### 3.4 修复 = 落地既有待评审设计 v1 + 按 bug-fix-4 修正 D2

仓库里已有一份**与用户三条诉求一一对应**的设计(2026-10-16 起草,状态:待评审,需求方当时已确认识别思路):

- 设计:[coupon-three-source-merchant-id-whitelist-design-v1.md](../proposals/three-source/coupon-three-source-merchant-id-whitelist-design-v1.md)
- 实施计划:[2026-10-16-coupon-three-source-merchant-id-whitelist.md](../../superpowers/plans/2026-10-16-coupon-three-source-merchant-id-whitelist.md) 及整合版 […gap-reminder-and-merchant-id-integrated.md](../../superpowers/plans/2026-10-16-coupon-three-source-gap-reminder-and-merchant-id-integrated.md)

| 设计 v1 决定 | 对应用户本次反馈 |
| --- | --- |
| D1 封闭集意图判定:DeepSeek 按**位数/格式模式、Sheet 名、文件名标注、活动上下文**判 `SKU`/`MERCHANT_ID`,判定集封闭、无第三种;prompt v6→v7 删除两条禁令 | ①「一开始就识别出来,类型只有 SKU 和商家ID 两种」+②「按文件名和内容识别,通过 DeepSeek」 |
| D2 owner 确认门:无表头来源一律出**「商家 ID / SKU」二选一**卡,AI 判定只是预选候选 | ③「兜底是二选一,不是二次确定」 |
| D3 限品类型:确认商家 ID 时配券表写「限商家ID」 | (用户未展开,设计已覆盖) |
| D4 忠实产物:表头 `商家id`、文件名前缀「商家ID白名单」、独立模板 id、hash+回读 | (同上) |
| D2 后半句「并填写 ≥2 字依据」 | **与 bug-fix-4 冲突,需修正删除**(见下节) |

实施时的三个注意点:

1. **ADR 编号顺延**:设计审计项 A2 写的「新增 ADR-0014」已被 open access 方案占用(`docs/adr/0014-open-access-usage-authorization-via-feishu-availability-scope.md`,commit 8d9bfb1),应为 ADR-0015;
2. **rule version 升版 fail closed**:`threeSourceRuleVersion` → v2 会使在途草稿的识别候选/确认快照/产物全部失效(设计 R4/A8),需同步 rollout 记录,试点用户重传即可;
3. **批次安排**:升版会让在途草稿作废,建议与 bug-fix-1/2 修复**同批次部署**,避免试点用户连续两次重传。

---

## Bug-fix-4:「确认依据(至少 2 个字)」是多余确认项

### 4.1 字段的三个挂载点

| 位置 | 代码 | 行为 |
| --- | --- | --- |
| 卡片渲染 | `cards.ts:1150-1156`(白)/`1187-1194`(黑) | `whitelist_dimensionReason` / `blacklist_dimensionReason` 必填 input |
| 提交校验 | `dispatcher.ts:431-436` | trim 后 <2 字抛「…请填写确认依据(至少 2 个字)」 |
| 生成放行 | `lists.ts:326` | `reason.trim().length >= 2` 是 `dimensionConfirmedAsSku` 的放行条件之一;确认记录 schema 见 `store.ts:83-91`(`reason: string` 必填) |

### 4.2 为什么当时会有这个字段,以及为什么现在可以删

设计 v1 沿袭的是 confirm-as-SKU 时代的审计逻辑:当时用户做的动作是"**把系统识别为未知/商家的名单改写声明为 SKU**",自由文本理由是这次改写唯一的人证。但在二选一形态下:

- 选择本身就是显式决定,`detectedDimension + confirmedAs + sourceSha256` 落确认快照已构成完整审计链(谁、在哪个源、从什么判定改到什么);
- 自由文本在真实使用中只会产出「文件名写的」「是sku」这类无信息量字符串(本次截图用户被要求填的正是它);
- 红线「AI 不得决定字段事实」不受影响——二选一是人在封闭枚举里拍板,比自由文本更严格。

**修复面**(随 bug-fix-3 一并做,不单独动 rule version):

1. `cards.ts`:删除两处 `*_dimensionReason` input;
2. `dispatcher.ts`:`mappingSelections` 删除理由长度校验,确认记录不再收集 reason;
3. `store.ts:83-91` / `lists.ts:295` 附近:`IdentifierDimensionConfirmation.reason` 从必填降为删除(或可选,取决于快照兼容策略;随 rule v2 升版一起 fail closed,无兼容包袱,建议直接删除);
4. `lists.ts:318-328`:`dimensionConfirmedAsSku`(将泛化为按 `confirmedAs` 匹配)删除 reason 条件;
5. 测试:dispatcher 单测「1 字理由抛错」用例移除,新增「无理由字段即可提交」;lists 放行测试同步。

---

## 实施顺序与验证

1. 设计 v1 出修订(删 D2 的 ≥2 字依据句),评审通过;ADR 按 0015 顺延;
2. 按既有实施计划执行:Task 1 文档基线(ADR-0015 + PRD v1.6 + runbook/rollout 同步)→ prompt v7(删两条禁令,加封闭集判定指令)→ 确认卡二选一(无理由框)→ 生成维度化(`限商家ID` + `商家id` 表头 + 新模板 id);
3. 验证:`pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:coupon-three-source:offline`;用「商家ID_…双十一前置.xlsx」同款文件真发重放,预期:第 3 步卡显示「系统判定:商家 ID(依据:文件名标注、数值位数)」+ 二选一默认预选商家 ID,选商家 ID 后产物表头 `商家id`、配券表「限商家ID」;无确认依据输入框;
4. 与 bug-fix-1/2 同批次部署(rule version 一次性升版,在途草稿只作废一次)。

## 边界与不动项

- AI 仍只产出候选与判定依据展示,owner 二选一是最终字段事实来源,不触碰审批/权限;
- 源白名单文件仍绝不进 OA 附件;商家 ID 名单走受控冻结产物 + hash + 回读;
- 不启用 SPU 名单生成;P1-1 路线、draft-only Gate、native kill switch、事件入口与控制面全部不动。
