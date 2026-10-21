# ADR-0015：商家 ID 名单封闭集判定与忠实产物

- **状态**：已接受；待 P0 外部验证，不构成生产或原生 OA 授权
- **日期**：2026-10-21
- **决策 Owner**：优惠券流程 Owner（需求方）、工程 Owner
- **关联**：[ADR-0011](0011-use-deepseek-only-for-p0-candidate-recognition.md) · [ADR-0012](0012-make-ai-primary-for-p0-three-source-recognition.md) · [设计 v1（含 2026-10-21 修订）](../oa-ticket-reimbursement-materials/proposals/three-source/coupon-three-source-merchant-id-whitelist-design-v1.md)
- **取代**：无（对 ADR-0011/0012 识别合同的受控扩展，非撤销）

## 背景

2026-10-16 与 2026-10-21 试点连续出现同一真实场景：业务员上传文件名明写「商家ID」的无表头单列数字名单。现行实现把它识别为 `dimension: UNKNOWN`，第二轮卡只提供「确认原值实际是 SKU」单选项——若该列确为商家 ID，确认即虚假声明；这是 v6 识别合同（禁止按文件名判定维度、无表头必须返回 UNKNOWN）与生成侧仅支持 SKU 共同造成的设计结果，不是模型能力缺口（2026-10-17 本地 POC 已证明放开证据后判定显著改善）。

## 决策

1. **封闭集意图判定（prompt v6→v7）**：DeepSeek 对无表头单列数字名单做意图判定，判定集封闭为 `SKU` \| `MERCHANT_ID`；证据为数值位数与格式模式、Sheet 名、文件名标注、活动上下文，文件名为低权重线索、不得单独决定。AI 判定只是候选，不改写任何单元格值；名单值仍由服务端逐格重读校验。
2. **owner 二选一确认门**：无表头来源或识别维度非 SKU 的名单，无论 AI 判定结果如何，一律由 owner 在第二轮卡从「商家 ID / SKU」中显式确认（2026-10-21 需求方修正：不再要求填写 ≥2 字确认依据——封闭枚举选择本身就是人的显式决定，`detectedDimension + confirmedAs + sourceSha256` 构成完整审计链）。AI 不决定字段事实。
3. **限品类型与忠实产物**：名单确认为商家 ID 时，标准配券表「限品类型」列写「限商家ID」（来自 owner 确认记录）；冻结产物维度化：表头 `商家id`、文件名前缀「商家ID白名单/黑名单」、独立模板 id，hash + 回读校验；系统不改写任何单元格值，源文件仍绝不进入 OA 附件。
4. **rule version 升版 fail closed**：`threeSourceRuleVersion` 升为 `three-source-offline-v2`，在途草稿的识别候选、确认快照与产物全部失效，需重新上传确认。

## Gate 与失败处理

- AI 越集返回 `SPU`/`UNKNOWN` 或坐标伪造被拒时，按既有降级语义走确定性层 UNKNOWN + 人工二选一，不阻断、不伪造。
- 白黑名单确认维度不一致维持硬阻断；单券 legacy 路径对商家 ID 显式报「暂不支持」，不扩散改动。
- 「限商家ID」尚非审批侧官方确认枚举（设计 R3）：被审批 Owner 拒绝时回滚为常量「限SKU」（名单产物仍为商家 ID，材料语义降级为参考件），属产品决定。

## 范围外

不启用 SPU 名单生成；不改动 P1-1 独立 schema、draft-only、native OA kill switch、附件 Gate、事件入口与耐久控制面；不授权源文件进入 OA 附件。

## 后果与回滚

无表头商家 ID 材料从「无法走通 + 诱导虚假声明」变为「AI 带依据预判 + owner 二选一 + 忠实产物」。风险为 AI 误判（由 owner 确认门拦截）与 rule v2 升版使在途草稿作废（试点用户重传一次即可，rollout 已记录）。回滚点：识别合同回退 v6（一处 prompt 版本常量 + 禁令文案）、维度化产物与「限商家ID」各自独立可回退。
