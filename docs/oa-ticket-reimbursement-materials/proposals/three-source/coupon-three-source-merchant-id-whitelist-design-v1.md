# 三源优惠券：商家 ID 名单封闭集判定与忠实产物 · 设计与审计 v1

- **状态**：已评审通过（需求方 2026-10-16 确认识别思路；2026-10-21 需求方反馈 bug-fix-3/4 后按下方修订记录修正 D2 并批准实施，ADR 见 [ADR-0015](../../../adr/0015-merchant-id-whitelist-closed-set-dimension-recognition.md)）
- **日期**：2026-10-16（v1）/ 2026-10-21（修订）
- **决策 Owner**：优惠券流程 Owner（需求方）、工程 Owner
- **关联**：[ADR-0011](../../../adr/0011-use-deepseek-only-for-p0-candidate-recognition.md) · [ADR-0012](../../../adr/0012-make-ai-primary-for-p0-three-source-recognition.md) · [ADR-0015](../../../adr/0015-merchant-id-whitelist-closed-set-dimension-recognition.md) · [MVP PRD v1.8](../../current/product/coupon-oa-mvp-prd-v1.8.md) · [本地长连接 POC runbook v1](../../current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md)
- **实施计划**：[2026-10-16-coupon-three-source-merchant-id-whitelist.md](../../../../docs/superpowers/plans/2026-10-16-coupon-three-source-merchant-id-whitelist.md)

## 修订记录

- **2026-10-21（需求方反馈驱动）**：
  1. **D2 修正（= bug-fix-4）**：删除「并填写 ≥2 字依据」要求及配套的 `*_dimensionReason` 必填输入框与三层校验——封闭枚举二选一本身即人的显式决定，`detectedDimension + confirmedAs + sourceSha256` 已构成完整审计链；真实使用中自由文本只产出「文件名写的」这类无信息量字符串。全文 D2、§3.2 表单键、实施计划 Task 3/4 中涉及 reason 的条款随之作废。
  2. **ADR 编号顺延**：审计项 A2 原写「新增 ADR-0014」，因编号已被 open access 方案占用（`0014-open-access-usage-authorization-via-feishu-availability-scope.md`），实际为 **ADR-0015**。
  3. **PRD 版本顺延**：v1.6 已被缺口提醒方案占用，本方案产品基线为 **PRD v1.7**。
  4. **部署批次**：与 2026-10-21 bug-fix-1/2/5 同批次部署，rule v2 升版只作废在途草稿一次。

## 1. 背景与问题

2026-10-16 试点出现真实案例：业务员上传文件名为「商家ID」的 `.xlsx`，内容为**无表头单列数字**。
当前行为：

1. 确定性识别层把该文件识别为 `dimension: UNKNOWN` 的名单候选
   （`server/lib/coupon-oa/three-source/recognition.ts` 的 `headerlessSingleColumnCandidate`）；
2. AI 提示词 v6 明确禁止按文件名判定，并强制无表头数字返回 `UNKNOWN`
   （`ai-recognition.ts` system prompt 第 1024–1026 行）；
3. 第二轮卡要求 owner「确认原值实际是 SKU」——若该列确为商家 ID，确认即虚假声明；
4. 生成侧只支持 SKU：`assertListIsUsable` 拒绝非 SKU 维度，冻结产物 A1 硬编码
   `sku`，配券表「限品类型」列固定「限SKU」。

结果：这类真实材料在 P0 无法走通，且确认文案诱导错误声明。

## 2. 产品决定（需求方 2026-10-16 已确认）

| # | 决定 | 内容 |
| --- | --- | --- |
| D1 | 封闭集意图判定 | 无表头单列数字名单由 DeepSeek 做意图判定，判定集封闭为 `SKU` / `MERCHANT_ID`，不存在超出该范围的输出；证据为数值位数与格式模式、Sheet 名、文件名标注、活动上下文，文件名仅作低权重线索。 |
| D2 | owner 确认门 | AI 判定只是**系统推测候选**；无表头来源的名单无论 AI 判定结果如何，一律由 owner 在第二轮卡从「商家 ID / SKU」中显式确认（2026-10-21 修订：不再要求填写 ≥2 字依据）。AI 不决定字段事实。 |
| D3 | 限品类型取值 | 名单确认为商家 ID 时，标准配券表「限品类型」列写「限商家ID」（来自 owner 确认记录，非 AI 直写）。官方枚举未确认的风险见 §5-R3。 |
| D4 | 忠实产物 | 商家 ID 名单生成维度化冻结产物：表头 `商家id`、文件名前缀「商家ID白名单/黑名单」、独立模板 id、hash + 回读校验；系统不改写任何单元格值；源文件仍绝不进入 OA 附件。 |

## 3. 方案设计

### 3.1 识别层（AI 合同 v6 → v7）

- `couponThreeSourceAiPromptVersion` 升为 `coupon-three-source-p0-ai-primary-v7`；
- system prompt 移除「无表头必须返回 UNKNOWN / 不得因文件名判定」两条禁令，改为封闭集判定指令：
  无表头单列数字必须判定为 `SKU` 或 `MERCHANT_ID`，`reason` 必须引用可核验证据
  （位数/格式模式、Sheet 名、文件名标注、活动上下文），文件名不得单独决定；
- 输出 schema 不变（`dimension` 枚举本就含 `MERCHANT_ID`，坐标伪造拒收校验不变）；
- 服务端不新增封闭集强制剔除：AI 越集返回 `SPU`/`UNKNOWN` 时按既有降级语义处理
  （见 3.3），owner 确认门是最终防线。

### 3.2 确认层（卡片与选择）

- 触发条件从「确定性维度 ≠ SKU」扩展为：**无表头来源（确定性候选 `header === ""`）
  或任一识别维度 ≠ SKU**——即使 AI 判 `SKU` 也必须人工确认（审计改进 A4）；
- 卡片文案改为「系统判定 + 双选项」（2026-10-21 修订：无确认依据输入框）：
  「系统判定该名单为【商家 ID】（依据：文件名标注、数值位数…）。请确认实际类型：
  ○ 商家 ID ○ SKU」；
- 表单键：`whitelist_identifierDimension` / `blacklist_identifierDimension`
  （取值 `SKU` | `MERCHANT_ID`）；
  旧键 `*_confirmAsSku` 移除（rule version 升版后旧草稿 fail closed，见 3.5）。

### 3.3 降级链

1. AI 判定 + owner 确认 → 按 confirmedAs 维度走生成；
2. AI 判 `SKU` → 卡片仍要求确认（预选展示 SKU 判定依据）；
3. AI 分区失败 / 越集返回 / 坐标伪造被拒 → 确定性层 `UNKNOWN`，卡片仍出双选项人工选择；
4. 生成侧单券 legacy 路径（`parseSingleCouponIdentifierList`、
   `createSingleCouponCanonicalPackage` 等 P0 pilot 未使用路径）对商家 ID 显式报
   「暂不支持」，不扩散改动。

### 3.4 生成层

- `parseMultiSheetTieredIdentifierList`：确认语义从
  `dimensionConfirmedAsSku` 泛化为按 `confirmedAs` 匹配；解析结果 `dimension`
  记录确认后维度；单元格级校验（数字、无公式前缀、无分隔符、去重、空标记）全部不变；
- `assertListIsUsable` / `groupIdentifiersByTier` 接受 `SKU | MERCHANT_ID`；
  白黑名单维度不一致维持硬阻断（`computeOverlap` 既有校验）；
- `generateDynamicSkuListWorkbook` 增加 `dimension` 参数：表头
  `{ SKU: "sku", MERCHANT_ID: "商家id" }`，文件名前缀
  `{ whitelist: "商品明细白名单" | "商家ID白名单", blacklist: 同理 }`，
  模板 id 新增 `coupon-dynamic-merchant-whitelist-v1` / `-blacklist-v1`
  （SKU 模板 id 不变）；
- `regularFullReductionInputSchema.productLimitType` 从
  `z.literal("限SKU")` 放宽为 `z.enum(["限SKU", "限商家ID"])`（默认 `限SKU`）；
  三源确认/生成路径按白名单 `confirmedAs` 传入；P1-1 独立 schema
  （`excel-pilot-schema.ts`）不动；
- `threeSourceRuleVersion` 升为 `three-source-offline-v2`：在途草稿的识别候选、
  确认快照与产物全部失效，要求重新上传确认（fail closed）。

### 3.5 幂等、审计与安全不变项

- AI 判定不改写任何值；名单值仍由服务端逐格重读校验；
- `confirmationSnapshot` / OA 预填快照照常记录 `dimension` 与确认来源；
- 副作用、effect、租约、receipt、draft-only、native kill switch、附件 Gate 全部不变。

## 4. 审计结论（对照权威来源）

| # | 对照项 | 结论 | 动作 |
| --- | --- | --- | --- |
| A1 | AGENTS.md 红线「AI 不得决定字段事实/权限」 | ✅ 符合：AI 仅提候选，owner 确认，服务端逐格校验 | 无 |
| A2 | ADR-0011「范围外扩展需新产品决定 + ADR」 | ⚠️ AI 合同扩展（禁判维度→封闭集判定）+ 产物维度扩展触发该条款 | 新增 ADR-0014（计划 Task 1） |
| A3 | PRD v1.6 §识别「无表头单列数字不能仅凭文件名或数值确定标识维度」 | ⚠️ 与 D1/D2 冲突，产品行为变更必须先改 PRD | PRD 升 v1.6，v1.5 移入 `history/product/`（Task 1） |
| A4 | PRD「owner 确认原值实际按 SKU 使用」原则 | 🆕 原方案漏洞：AI 判 `SKU` 时确认卡消失，等于 AI 静默决定事实 | 已纳入设计：无表头来源一律强制双选项确认（D2） |
| A5 | runbook v1 L161「不得因文件名含商家ID 改写标识」 | ⚠️ 行为变更需同步 | runbook 对应段落更新（Task 1） |
| A6 | AGENTS.md 边界 3「源白名单绝不直接进 OA 附件」 | ✅ 符合：商家 ID 仍走受控冻结产物 + hash + 回读 | 无 |
| A7 | P1-1 与三源路线隔离（边界 6） | ✅ 符合：`calculation.ts` 仅三源引用（含其测试）；P1-1 独立 schema 不动 | 计划含 grep 验证步骤 |
| A8 | rollout 计划同步义务 | ⚠️ rule version 升版使在途草稿失效，需记录 | rollout 补记（Task 1） |
| A9 | 提示注入面：文件名是不可信输入 | ✅ 残余风险可控：AI 无值改写权，误判被 owner 确认门拦截，卡片展示判定依据供人工复核 | 卡片文案含依据展示（D2） |
| A10 | 幂等/重复点击/worker 重启 | ✅ 无新增副作用面；确认记录仍按 `sourceSha256 + dimension` 匹配 | 计划测试覆盖 |
| A11 | 测试义务（AGENTS：外部 AI 调用 mock 成功/失败/重复/未知） | ⚠️ 需新增矩阵 | 计划 Task 3–5 测试清单 |

**审计判定：方案可执行**，前提是 Task 1（ADR + PRD v1.6 + runbook/rollout 同步）先行合入；
A4 为审计新增的必要修正，已并入设计。

## 5. 风险与回滚

| # | 风险 | 缓解 / 回滚 |
| --- | --- | --- |
| R1 | AI 误判维度 | owner 双选项确认门 + 卡片展示判定依据；确认错可推翻重选 |
| R2 | AI 对无表头返回越集值（SPU/UNKNOWN） | 按降级链走人工选择，不阻断不伪造 |
| R3 | 「限商家ID」非官方确认枚举，审批侧可能不认 | draft-only 人工审批兜底；回滚 = 一处常量改回「限SKU」（名单产物仍为商家 ID，材料语义降级为参考件），属产品决定 |
| R4 | rule version 升版中断在途草稿 | 预期行为（fail closed）；rollout 记录，试点用户重传即可 |
| R5 | 生成模板 id 新增登记遗漏 | 产物模板 id 在生成处内联定义并回读校验，测试断言新 id |

## 6. 范围外

不启用 SPU 名单生成；不改动 P1-1 路线、draft-only、native kill switch、附件 Gate、
事件入口与控制面；不授权源文件进入 OA 附件；单券 legacy 生成路径本期不支持商家 ID。

## 7. 提升与验证

1. 评审通过本设计后，按实施计划执行（Task 1 文档基线先行）；
2. 全部验证命令：`pnpm lint`、`pnpm typecheck`、`pnpm test`、
   `pnpm test:coupon-three-source:offline`、`pnpm build`；
3. 试点验证：重放「商家ID」无表头文件 E2E（见 runbook §4 更新段）；
4. 提升时在 `current/product/`、`current/operations/`、ADR 写入生效规则，
   本文件页首注明去向。
