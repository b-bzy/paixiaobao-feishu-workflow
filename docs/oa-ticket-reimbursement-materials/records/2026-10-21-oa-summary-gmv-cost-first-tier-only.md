# 2026-10-21 多券档 OA 汇总值只取第一档：预估GMV/预估费用未跨档合计 (bug-fix-7)

> **状态：已实施并部署 Preview（`e2y910v4t`@`3132257`，2026-10-21 15:39 本地；身份回读 SHA 一致、bridge/worker 在线）；真发重放待用户以 6 档表核对合计值。**
> 环境：P0 Preview（`palwjn3xf`@`f574132`），bridge/worker 本机常驻；用户桌面截图 `~/Movies/CleanShot 2026-10-21 at 14.37.35@2x.png`（卡片）、`14.38.38@2x.png`、`14.38.59@2x.png`（源配券表）。
> 编号说明：用户口述为「bug-fix-6」，但同日编号 6 已被 [双列白名单回弹修复](2026-10-21-mapping-confirm-whitelist-merchant-column-bounce.md) 占用（其方案文档与本修复分属不同问题）。按 AGENTS.md「bug-fix-x 编号全局只增不改」，本问题编为 **bug-fix-7**。

## 1. 问题现象与环境

多券档配券表（6 个券档）走完三源流程后，OA 预填确认卡片与审批表单显示：

| 字段 | 卡片显示 | 源表第一档 | 源表全档合计（期望） |
| --- | --- | --- | --- |
| 预估GMV | 50,000 | W列第 1 行 = 50,000 | 523,000（50,000+240,000+96,000+45,000+46,000+46,000） |
| 预估费用 | 112,000 | V列第 1 行 = 112,000 | 324,800（112,000+89,600+56,000+33,600+22,400+11,200） |

显示值恰好等于第一档的值；用户指出正确口径是**全档合计**。

## 2. 证据

| 证据 | 内容 |
| --- | --- |
| 用户截图 ×3 | 卡片（14:37:35）显示 预估GMV=50,000、预估费用=112,000；源表（14:38:38、14:38:59）V列「预计费用」与 W列「预计引入GMV」各有 6 行非空值 |
| 数值对照 | 显示值 = 两列各自的第 1 行值；非合计 |
| 代码推导 | 消费链路唯一：卡片与审批表单（`approval-schema.ts:409-410`）均读 `OaPrefillSnapshot.values`；该快照由 `workflow.ts:695-722` 组装，见下节定位 |
| 待补 | 离线多档回归测试断言合计值（本文件第 5 节测试计划） |

## 3. 代码定位（以 `f574132` 后代码为准）

| 层 | 位置 | 现行为 |
| --- | --- | --- |
| 打包 | `server/lib/coupon-oa/three-source/workflow.ts:271-272`（`createCouponSetCanonicalPackage`） | `coupon = tiers[0]`；`computed = computeRegularFullReductionValues(coupon.input)` —— 包级费用/ROI 只按第一档计算 |
| 快照 | `server/lib/coupon-oa/three-source/workflow.ts:712-714`（`buildOaPrefillSnapshot`） | `estimatedGmvYuan: coupon.input.estimatedGmvYuan`（第一档 GMV）、`estimatedCostYuan/estimatedRoi: computed.*`（第一档口径） |
| 展示 | `server/lib/feishu/coupon-oa/approval-schema.ts:409-410`、`cards.ts:360-364` | 忠实渲染快照值，无独立 bug |

## 4. 根因分析（含已排除备选假设）

多行配券表按行解析为 `couponSet.tiers`（`recognition.ts:1236-1282`），每档独立提取字段并各自校验；生成配券表产物时也逐档计算（`workflow.ts:316-319`）。但 OA 预填快照的三个汇总字段从未做跨档合计——`CanonicalPackage.computed` 在多档路径直接绑定 `tiers[0]`，GMV 又直接读 `coupon.input.estimatedGmvYuan`（即第一档）。

已排除的备选假设：

- **不是 AI/识别取错行**：每档字段按行独立提取，`tiers[1..5].input.estimatedGmvYuan` 均存在且与源表各行一致（生成的逐档配券表产物可佐证）。
- **不是 Excel 产物错误**：产物生成走逐档 `computeRegularFullReductionValues(tier.input)`，每行费用正确。
- **不是卡片/审批表单渲染错误**：两者都只读快照值。

## 5. 修复方案（含取舍与测试计划）

**领域层新增合计口径，快照层改用合计；单券路径行为不变。**

1. `server/lib/coupon-oa/calculation.ts` 新增 `computeCouponSetSummaryValues(inputs)`：Σ GMV、Σ 逐档费用（复用单档公式，保持逐档校验）、ROI = ΣGMV/Σ费用，cent 精度收敛。
2. `workflow.ts` `createCouponSetCanonicalPackage` 填充新字段 `CanonicalPackage.summary`（合计口径）；`buildOaPrefillSnapshot` 优先读 `summary`，缺省回落到单券 `computed/input` 口径（单券与旧兼容路径行为不变）。

取舍：

- 不改 `CanonicalPackage.computed` 的语义：`couponName/discountRatio` 是档位级概念，与合计费用混在同一对象里语义不清；新增显式 `summary` 字段并注释口径。
- 不重算历史冻结快照：已生成 OA 草稿/快照保持原值，修复只影响后续新生成流程。
- `sourceConfirmationHash` 不纳入 `summary`：它是已被 hash 覆盖的 tier inputs 的确定性派生值。
- 测算图与配券表产物维持逐档呈现（每档一列/一行各自的费用与 GMV），不做合计行。

测试计划：

- `calculation.test.ts`：合计函数单测（多档求和、ROI、空档位抛错）。
- `offline.test.ts`：新增多档配券表用例，断言 `oaPrefill.values.estimatedGmvYuan/estimatedCostYuan/estimatedRoi` 等于跨档合计；并跑 `pnpm test:coupon-three-source:offline` 全量回归。
- 卡片/审批表单无需新断言（值来源唯一）。

## 6. 边界与不动项

- P1-1 老路径（`excel-pilot-*`）与 `createSingleCouponCanonicalPackage` 兼容路径不动。
- 逐档配券表产物、测算图、白名单分档投影不动。
- 不涉及飞书权限、OA 创建 Gate、native submit 开关；不改变任何幂等键。

## 7. 验证记录（2026-10-21 本地）

实施内容：

- `server/lib/coupon-oa/calculation.ts`：新增 `CouponSetSummaryValues` 与 `computeCouponSetSummaryValues`。
- `server/lib/coupon-oa/three-source/types.ts`：`CanonicalPackage` 新增可选 `summary` 字段。
- `server/lib/coupon-oa/three-source/workflow.ts`：`createCouponSetCanonicalPackage` 填充 `summary`；`buildOaPrefillSnapshot` 的 预估GMV/预估费用/ROI 改读 `summary`（缺省回落单券口径）。
- 测试：`calculation.test.ts` 新增 3 例（合计、单档一致、空档位拒绝）；`offline.test.ts` 新增多档端到端断言（两档 50,000+240,000 GMV、各 25,200 费用 → 快照 290,000 / 50,400 / ROI 5.75）。

执行的命令与结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm vitest run server/lib/coupon-oa/calculation.test.ts server/lib/coupon-oa/three-source/offline.test.ts` | 19/19 通过 |
| `pnpm test:coupon-three-source:offline` | 14/14 通过 |
| `pnpm vitest run server/lib/coupon-oa server/lib/feishu/coupon-oa` | 523 通过 / 1 跳过（DeepSeek 契约集成，需真实密钥） |
| `pnpm typecheck:server` | 通过 |
| `pnpm biome check`（本次触及的 5 个文件） | 通过 |
| `pnpm lint` / `pnpm typecheck`（全仓） | 失败，但均为既有问题：`apps/miaoda-admin`（styles.css noDescendingSpecificity、`@types/react` 缺失）；本次与并行 bug-fix-6 改动均未触及 `apps/` |

环境与证据范围：本地 vitest（离线、无网络），未部署 Preview、未真实创建 OA。

未验证项及原因：

- **飞书真发重放**：Preview 已部署 `e2y910v4t`@`3132257`（down→up 全新部署；身份端点回读 SHA `3132257ba8…` 与本地一致，`couponOaNativeSubmitOpenAccess=true` 保持开放线基线，bridge/worker 在线且 worker 自校验 revision 通过）。真发属于用户侧操作：用本案例 6 档表重走三源流程，核对卡片 预估GMV=523,000、预估费用=各档计算值合计（业务表口径 324,800）、ROI=合计口径。
- **已存在的旧 OA 草稿**：历史快照不重算，属设计取舍（第 5 节），不回改。
