# 2026-10-21 第 3 步确认"无限回弹":双列白名单(店铺id+sku)的多维度区域毒化生成 + 错误映射缺失(bug-fix-6)

> **状态:已实施并部署 Preview(`e2y910v4t`@`3132257`,2026-10-21 15:39 本地;身份回读 SHA 一致、openAccess=true、bridge/worker 在线);真发验证待用户重传双列白名单。**
> 环境:P0 Preview 部署(诊断时 `8imclli2n`@`0f36c73`;复核时 `palwjn3xf`@`f574132`),bridge/worker 本机常驻,时间均为 UTC(北京时间 = UTC+8)。
> 触发:用户报告"填写不了,一直回弹这个页面"(截图 `~/Movies/CleanShot 2026-10-21 at 10.04.06@2x.png`,即本地 10:04 = 02:04 UTC)。
> 与同日 [bug-fix-3(单列商家ID识别)](2026-10-21-whitelist-id-dimension-recognition-and-reason-field.md) 同族但**不同案例**:那次是单列无表头文件的识别期问题;本案例是**双列(店铺id+sku)有表头文件**的确认/生成期问题,`f574132` 的维度化改造未覆盖它(下文有复核证据)。

## 1. 问题现象与环境

第 3 步「检查并补充活动信息」卡填完提交后,出现红色条「上次确认未完成:**系统未完成本次处理,已保留当前材料,请稍后重试或联系处理。**」+「已恢复本卡片」,重试任意次数必弹回;卡片上没有任何指向白名单的可操作提示。

## 2. 证据

| 证据 | 内容 |
| --- | --- |
| Bridge 日志 | 02:02:27→52、02:03:30→55 两次 `coupon_three_source_mapping_confirm` 事件到达并 200 转发,排除网络/卡片通道 |
| Vercel 运行时日志 | 两次均 `Coupon three-source callback failed unexpectedly`(technicalMessage 脱敏),随后走恢复逻辑还原表单卡——"回弹"的机制 |
| Base 草稿 | 活跃草稿材料齐、AI 双源成功、投递正常;`failureReason` 即卡片红字 |
| 离线完整复现(决定性) | `scripts/coupon-three-source-confirm-failure-repro.mts`(未提交):bot 身份下载两份源文件(字节+sha256 与 State 一致),按 `confirmSourcesAndGenerate` 同序重放——配券表 7 档通过、sku 列解析 2872 条正常,最后一步抛线上同一错误 |
| f574132 复核(2026-10-21 13:50) | 对 `f574132` 同码重放:仍失败,错误变为「同一来源解析出不同标识维度,请重新确认标识类型」(`lists.ts:367`),且该消息不匹配 `knownErrors` 的「请**先**确认标识类型」→ 仍落兜底文案;提交层仍放行 |

## 3. 代码定位(以 `f574132` 后代码为准)

| 层 | 位置 | 现行为 |
| --- | --- | --- |
| 解析守卫 | `server/lib/coupon-oa/three-source/lists.ts:355-372`(`dimensionGate`) | 逐区域解析出不同维度即记 issue「同一来源解析出不同标识维度…」并跳过该区域;不提供"选哪一列"的通道 |
| 维度覆盖 | `lists.ts:308-327`(`resolveListDimension`) | 一次确认按 `detectedDimension===区域维度或 UNKNOWN` 对**所有**匹配区域做同向改写——双列下任一确认方向要么仍冲突、要么两列混采(污染) |
| 打包断言 | `server/lib/coupon-oa/three-source/workflow.ts:44-54`(`assertListIsUsable`) | 见任何 issue 即整体抛 `白名单存在未解决的数据问题：…` |
| 错误映射 | `server/lib/coupon-oa/three-source/errors.ts:71-74` | `存在未解决的数据问题/请重新确认标识类型` 均不在 `VALIDATION_REQUIRED` 正则内 → `UNEXPECTED_FAILURE` → 兜底文案「系统未完成本次处理…请稍后重试」 |
| 卡片判定 | `server/lib/feishu/coupon-oa/three-source/cards.ts:597-622`(`identifierDimensionChoice`) | `detected` 以确定性候选(`listCandidates`,本例只有 sku 列)优先;有表头 sku 列 → `requiresChoice=false` → 确认块不渲染 |
| 确认块 | `cards.ts:636-666`(`identifierDimensionConfirmBlock`) | 二选一下拉(商家 ID/SKU)已有,但文案只适配"单列无表头"场景 |
| 提交校验 | `server/lib/feishu/coupon-oa/three-source/dispatcher.ts:418-440` | 仅当 `choice.requiresChoice` 时强制提交选择;判定源与卡片同一函数,但该函数不含"多维度并存"条件 → 提交放行、生成必炸 |
| 规则版本 | `server/lib/coupon-oa/three-source/types.ts:10` | `three-source-offline-v2`;本修复改变名单解析结果集,需升版 |

## 4. 根因分析

白名单 `平板常规店铺SKU优惠券 (2).xlsx` Sheet1 双列:`店铺id`(A 列,DeepSeek 判 `MERCHANT_ID`,去重后 124 个店铺)与 `sku`(B 列,判 `SKU`,2872 条)。生成链对 AI 区域逐一解析:A 列可按 MERCHANT_ID 通过,B 列触发维度冲突被记 issue;`assertListIsUsable` 见任何 issue 整体拒绝——**一个兄弟列毒化整份名单**。真实错误未映射 → 确定性数据拒绝被表述为"请稍后重试"的暂时性故障;用户在卡片上又看不到任何白名单提示 → 无限回弹。

结构性根因:**"标识维度未决"的判定在卡片渲染、提交校验、解析守卫三处使用不同事实源**(确定性候选 / 确定性优先 / AI 区域),且没有"多维度并存 → 让用户选路"的语义,只有"维度改写"语义(双列下必然出错或污染)。

已排除备选假设:bridge/网络(事件 200);AI 识别失败(两区域维度判定均正确);源文件下载/权限(离线复现字节级一致);revision 冲突(两次提交均通过守卫);`f574132` 已覆盖(同码复现仍失败,见 §2)。

## 5. 修复方案(bug-fix-6)

核心思路:**把"多维度并存"从异常升为一等交互——用户选一种标识维度,系统只采所选列;三层判定收敛到同一个领域层探测函数;所有未决错误如实透出。**

### 5.1 领域层:维度证据探测 + 选择式解析(lists.ts / 新共享助手)

1. 新增领域层导出 `detectIdentifierDimensionEvidence(recognition)`(放 `coupon-oa/three-source`,输入只依赖识别存储类型):返回 `{ dimensions: Set<"SKU"|"MERCHANT_ID">, multiDimension: boolean, columns: Array<{dimension, header, column, sheetName}> }`。证据源 = AI 区域候选 ∪ 确定性 `listCandidates`(identifier 类)。**卡片渲染、提交校验、解析守卫三处统一消费它,消除三套判定漂移。**
2. `parseMultiSheetTieredIdentifierList` 引入选择模式:
   - `multiDimension=true` 且**无**确认:不解析任何区域,记可直接行动的 issue:`同一来源同时检测到 sku 列与商家 ID 列，请先在最新卡片选择本单使用的标识类型`(措辞需命中 §5.3 映射);
   - `multiDimension=true` 且**有**确认(`confirmedAs=X`):**只解析原始判定维度 = X 的区域/候选,其余列排除**;对被排除列生成非阻塞注记(如 `已按【SKU】生成，忽略 店铺id 列（2351 行）`),由 service 并入 `draft.validationIssues` 以便在预览卡透出;**多列场景禁用"维度改写"**(选择≠改写,从结构上封死两列混采污染);
   - `multiDimension=false`:维持现行行为完全不变(单列无表头确认、单列改写、有表头直通——bug-fix-3/4 语义零回归);
   - 确定性 sheet 循环(非 AI 覆盖表)套用同一选择过滤,覆盖跨 sheet 混维度;
   - `dimensionGate` 冲突分支保留作防御,文案对齐 §5.3。
3. `threeSourceRuleVersion` 升 `three-source-offline-v3`:解析结果集变了,`sourceConfirmationHash` 随规则版本区分,沿用 fail-closed 版本纪律。prompt v7 不动(识别已正确)。

### 5.2 卡片与提交(cards.ts / dispatcher.ts)

1. `identifierDimensionChoice` 内部改用 `detectIdentifierDimensionEvidence`;`multiDimension` 时 `requiresChoice=true`,`detected` 维持现行取值(确定性优先;持久化确认形状不变,`confirmedAs` 才是选择模式的生效字段)。
2. `identifierDimensionConfirmBlock` 增加多列文案分支:`**白名单标识类型确认：** <文件名> 同时检测到多种标识列（sku 与 店铺id/商家 ID）。当前标准产物按单一标识维度生成，请选择本单使用的标识类型；未选择的列不会进入名单。` 下拉组件与选项(商家 ID / SKU)复用现结构,表单名 `${role}_identifierDimension` 不变。
3. dispatcher 提交校验机制不变(已按 `requiresChoice` 拦截且错误已映射)——探测器更新后自动生效:双列草稿不选维度会在**提交时**被拦(「白名单标识类型请从商家 ID 或 SKU 中选择」),不再放行到生成期才炸。可选打磨:确认块在表单中的位置上移(紧随「商品白名单」行),提交拦截已兜底,位置不再致命。

### 5.3 错误映射(errors.ts)

`VALIDATION_REQUIRED` 正则增补:`存在未解决的数据问题|标识类型未确认|请重新确认标识类型`。未指定 `userMessage` 时原样透出真实原因,卡片从此不再把确定性数据拒绝说成"稍后重试"。

### 5.4 配套同步

- e2e 分类器 `server/lib/coupon-oa/three-source/e2e/error-classification.ts`(及其测试)同步新增文案;
- PRD v1.7 → v1.8:标识维度确认节补充"多列并存=选路(未选列不进名单)"语义与用户文案;
- 实施基线 changelog + 规则版本 v3 记录;不新开 ADR(选择语义是 ADR-0015 维度确认的细化,决策记录落本文档)。

### 5.5 取舍

- **选路而非成对支持**:双列的业务含义可能是"(店铺,SKU) 配对名单",标准模板层暂不支持配对;本修复提供"选一列"的安全通道并在卡片明示"未选列不进名单"。配对名单作为后续产品议题记录,不在本批强行支持(避免动模板引擎)。
- **多列场景禁止改写**:单列"把商家ID列按 SKU 用"的 override 保留(design v1 既有);多列下选择即选路,杜绝混采。规则不对称是有意的:单列没有歧义,多列有。
- **不改持久化确认形状**(`detectedDimension/confirmedAs`),不加 `MULTI` 枚举:避免动 ADR-0015 存储契约与历史草稿兼容。

## 6. 测试计划

| 层 | 用例 |
| --- | --- |
| `lists.test.ts` | 双列 fixture:①无确认 → 精确 issue + 0 entries;②确认 SKU → 仅 B 列 + 排除注记;③确认 MERCHANT_ID → 仅 A 列;④跨 sheet 混维度同样选择;⑤单列无表头/单列 MERCHANT_ID 改写/有表头直通回归不变;⑥规则版本 v3 生效(hash 前缀变化) |
| `cards.test.ts` | 多维度 → `requiresChoice=true` + 新文案块 + 二选一下拉;单列场景渲染回归 |
| `dispatcher.test.ts` | 多维度草稿未选择 → 提交被拦(已映射文案);选择后确认持久化并进入生成;重复点击/幂等键回归 |
| `errors.test.ts` | 新 pattern 命中 `VALIDATION_REQUIRED` 且消息透传 |
| e2e(offline) | 新增双列白名单用例(接 S17 编号后 S18),分类器同步;既有 65+ 例全绿 |
| 真实材料 | 部署前:复现脚本对真实双列文件加确认变体重放(预期:SKU 选择仅 2872 条 sku);部署后:重传原双列文件走通或收到明确拦截文案;`audit:cards` 干跑覆盖新文案块 |
| 命令 | `pnpm test:coupon-three-source:offline`、`pnpm lint`、`pnpm typecheck`;部署遵循窗口 flag 纪律(`P0_ALLOW_NATIVE_SUBMIT_WINDOW`) |

## 7. 边界与不动项

- 不动 OA 草稿/handoff/审批链路、不动 f574132 的维度化产物(限商家ID)与 prompt v7;
- 不改 `IdentifierDimensionConfirmation` 存储形状;不迁移历史草稿(v2 冻结快照按原规则可追溯);
- 单列 override 语义保留;"配对名单"支持不做,记录为后续产品议题;
- 部署与真发验证遵守既有授权流程;`.local/` 产物不入库。

## 8. 实施记录(2026-10-21,bug-fix-6)

按 §5 方案实施,涉及 `types.ts`(规则版本 v3)、`lists.ts`(探测器 + 选择式解析)、`recognition.ts`(店铺id/店铺编号 别名)、`errors.ts`、`cards.ts`、`dispatcher.ts`、`service.ts`、e2e(`case-catalog/case-contract/fast-runner/workbook-fixture-builder/error-classification`)。实施中发现并与方案的偏离(按流程回写):

1. **确定性层新增 `店铺id/店铺编号` 商家 ID 别名**(方案未列,属探测证据增强):真实文件的店铺列此前只有 AI 能识别,是三套判定漂移的成因之一;补别名后离线 e2e 无需 AI 也能覆盖双列场景。
2. **排除注记的透出落点调整**:预览卡/试点 send 卡均不渲染 `validationIssues`,注记实际落草稿 State JSON(`validationIssues`)+ 确认块文案("未选择的列不会进入名单");send 卡透出"已忽略哪一列"列为后续打磨项。
3. **阻断文案措辞避让**:原文案「请先在**最新卡片**选择…」会先命中 e2e 分类器与错误映射的 STALE_REVISION 正则(「最新卡片」),改为「请先选择本单使用的标识类型」。
4. **e2e 拆为 S18(未选维度→`IDENTIFIER_DIMENSION_SELECTION_REQUIRED` needs_clarification)+ S19(选 SKU 生成通过)两个用例**,矩阵 65→67,`case-contract` 的 ID 白名单正则同步扩展。

## 9. 验证报告(本地)

| 项 | 命令/方法 | 结果 |
| --- | --- | --- |
| 全量单测 | `pnpm test` | 841 passed / 9 skipped(含新增:lists 维度选择 7 例、errors 映射 2 断言、cards 多列确认块 1 例、dispatcher 双列拦截+放行 1 例) |
| e2e fast 矩阵 | `pnpm test:coupon-three-source:e2e-local:fast` | passed(67 case,0 failures;S18 needs_clarification、S19 passed) |
| 离线套件 | `pnpm test:coupon-three-source:offline` | 13 passed |
| lint | `pnpm exec biome check` 改动文件 | 干净(`pnpm lint` 全仓仅在 `apps/miaoda-admin` 报存量问题,与本修复无关) |
| typecheck | `pnpm typecheck:server` | 通过(`typecheck:admin` 存量 @types/react 缺失,与本修复无关) |
| 真实材料重放 | `scripts/coupon-three-source-confirm-failure-repro.mts`(事故草稿 State + bot 下载的原文件) | 无确认→阻断且文案可执行;确认 SKU→2872 条 sku + 忽略店铺id 注记;确认 MERCHANT_ID→124 个店铺 + 忽略 sku 注记 |

**已部署**:Preview `e2y910v4t`@`3132257`(2026-10-21 15:39,down→up 全新部署;身份端点回读 SHA 一致、`couponOaNativeSubmitOpenAccess=true`、bridge/worker 在线)。**未验证项**:飞书真发(rule v3 使在途草稿 fail closed,双列白名单需重传后按新流程走)。
