# 优惠券 OA MVP 文档库

> **当前产品基线**：[优惠券 OA 智能提单 MVP PRD v1.2](product/coupon-oa-mvp-prd-v1.2.md)  
> 目录中的调研、截图、模板和案例用于支撑该 PRD；`archive/` 仅保留历史方案，不作为当前实现依据。

## 目录结构

```text
.
├── README.md
├── product/                         # 当前有效的产品文档
│   └── coupon-oa-mvp-prd-v1.2.md
├── research/                        # 未完全确认的需求、规则和原始依据
│   ├── coupon-oa-application-requirements-v0.md
│   ├── coupon-configuration-templates-and-fields-v0.md
│   └── screenshots/                 # 通用规则与字段截图 02–09
├── assets/
│   └── templates/                   # 10 份标准配券 Excel 模板
├── cases/
│   └── 202609240455/
│       ├── README.md                 # 案例分析
│       ├── attachments/              # 案例原始 Excel
│       └── screenshots/              # 案例截图 10–11
├── drafts/                           # P1 填报 skill 生成的 OA 填单底稿（按次归档）
├── test-fixtures/                    # 脱敏的审批演练样本；仅限演练定义使用
│   └── coupon-oa-route-verification/
└── archive/
    └── email-assistant/              # 已归档的邮件草稿助手方案
```

## 快速入口

### 当前产品文档

- [优惠券 OA 智能提单 MVP PRD v1.2](product/coupon-oa-mvp-prd-v1.2.md)：当前唯一的 MVP 产品需求基线；P0 为机器人返回既有飞书优惠券 OA 审批表入口。

### 调研依据

- [优惠券 OA 申请需求梳理](research/coupon-oa-application-requirements-v0.md)：原始 OA 字段、业务管控规则和待确认事项。
- [配券模板与配置字段说明](research/coupon-configuration-templates-and-fields-v0.md)：模板矩阵、字段字典、计算公式和商品名单规则。
- [原始截图](research/screenshots/)：上述调研文档引用的通用规则和字段截图。

调研文档中的“待确认”内容不是已发布产品规则；与当前 PRD 冲突时，以 PRD 明确纳入的 MVP 范围为准。

### 产品资产

- [标准配券模板](assets/templates/)：常规、PLUS、兑换码和大促神券共 10 份 Excel 模板。

模板文件是原始业务资产。模板选择、字段含义和公式解释以[配券模板与配置字段说明](research/coupon-configuration-templates-and-fields-v0.md)为索引。

### 真实案例

- [OA 编号 202609240455：寄卖苹果手机优惠券申请](cases/202609240455/README.md)：包含案例分析、两份原始附件和两张截图。

案例用于验证需求和发现口径差异，不得直接视为通用模板或已确认规则。

### P1 填报交互（Claude Code skill）

- Skill：`.claude/skills/OA优惠券填报/`（`/OA优惠券填报` 触发）。按 PRD v1.2 P1 采集结构化字段与三份材料，解析校验并核对口径后，在 `drafts/<时间>-<活动>/` 生成填单底稿、`fields.json` 和校验报告；提交 OA 仍由业务员在原生表单人工完成。
- 在 OA 获授权写入 API 确认前，底稿即 P1 交付物；`fields.json` 供未来服务端写入直接消费。

### 历史归档

- [邮件助手 MVP 设计方案](archive/email-assistant/coupon-oa-mvp-design-v1.md)
- [邮件助手分期实施方案](archive/email-assistant/coupon-oa-mvp-phased-delivery-plan-v1.md)

这两份文档描述的是“只生成邮箱草稿”的历史方向，与当前“创建真实飞书 OA”的 MVP 不同，仅供决策追溯。

## 文档状态约定

| 目录 | 状态 | 使用方式 |
| --- | --- | --- |
| `product/` | 当前有效 | 产品、设计和验收以此为准；同一阶段只保留一个当前 PRD |
| `research/` | 调研/待确认 | 用于追溯来源和补充业务确认，不直接作为开发承诺 |
| `assets/` | 原始可复用资产 | 保留文件原貌；变更时同步更新字段说明和版本信息 |
| `cases/` | 真实案例 | 案例说明、附件和截图必须放在同一 OA 编号目录内 |
| `archive/` | 历史归档 | 不作为当前实现依据；禁止从归档文档反向覆盖现行 PRD |

## 维护约定

1. 当前 MVP 范围、流程、字段或验收变化只更新 `product/` 中的 PRD，并同步版本号和变更说明。
2. 新增业务规则、字段截图或待确认结论放入 `research/`，同时标注来源和确认状态。
3. 新增已确认的标准 Excel 放入 `assets/templates/`，不要与单次活动附件混放。
4. 新增案例时使用 `cases/<OA编号>/`，并将说明、附件和截图分别放入该案例目录。
5. 被替代但仍需追溯的方案移入 `archive/<主题>/`，并在文档顶部说明归档原因和当前替代文档。
6. 案例中的人员、商品和经营数据仅用于已授权的需求分析与测试；外发或用于正式环境前须确认数据权限与脱敏要求。
