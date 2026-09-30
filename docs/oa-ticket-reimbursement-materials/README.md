# 优惠券 OA 文档库

> **当前交付范围**：[优惠券 OA 智能填报 P1 PRD v1.5（内网试点版）](specifications/coupon-oa-p1-excel-pilot-prd-v1.5.md)定义正在实施的 P1-1：在 Bot 单聊中生成并由业务员确认两份 Excel。
> **待评审改造**：[对话式一轮确认改造 PRD v1.1](specifications/coupon-oa-conversational-single-confirm-prd-v1.md)将 P1-1 的多步骤确认收敛为“发起 → 补齐输入 → 统一确认并发起 OA”，并已记录最终发起、附件替换、超时和重提等边缘规则；获批前不改变当前基线。
> **总体边界**：[优惠券 OA 智能提单 MVP PRD v1.2](specifications/coupon-oa-mvp-prd-v1.2.md)定义 P0–P2 的渐进式目标、权限和人工确认原则。
> **数据边界**：真实案例仅保留在本地受控目录；仓库中可共享、可演练的材料仅限 `test-fixtures/` 下的脱敏样本。

## 目录结构

```text
.
├── README.md
├── specifications/                  # 当前产品需求与范围基线
│   ├── coupon-oa-mvp-prd-v1.2.md
│   └── coupon-oa-p1-excel-pilot-prd-v1.5.md
├── implementation/                  # 技术实现方案和受控配置结构
│   ├── coupon-oa-bot-autofill-plan-v1.3.md
│   ├── coupon-oa-draft-base-schema-v1.md
│   └── coupon-oa-draft-base-fields-v1.json
├── operations/
│   └── diagnostics/                 # 有时间边界的排障与验证记录
│       ├── coupon-oa-attachment-upload-no-response-diagnosis-2026-09-29.md
│       ├── coupon-excel-pilot-template-asset-resolution-2026-09-30.md
│       ├── coupon-excel-pilot-bitable-attachment-resolution-2026-09-30.md
│       └── coupon-excel-pilot-drive-download-403-resolution-2026-09-30.md
├── research/                        # 原始调研、待确认规则和截图依据
│   └── screenshots/                 # 通用规则与字段截图 02–09
├── assets/
│   └── templates/                   # 10 份标准配券 Excel 模板
├── test-fixtures/                   # 可共享的脱敏演练样本
│   └── coupon-oa-route-verification/
├── cases/                           # 本地受控的真实案例（被 Git 忽略）
│   └── <OA编号>/
├── drafts/                          # 本地生成的填单底稿（按次输出）
└── archive/
    └── email-assistant/             # 已归档的邮件草稿助手方案
```

`cases/` 中的真实 OA 说明、附件和截图受 `.gitignore` 保护，克隆仓库后可能不存在。它们只可在已获授权的本地环境中用于需求分析；不得提交、外发或用作公开测试数据。需要可复现的材料时，使用 `test-fixtures/` 中的脱敏样本。

`drafts/` 是 `/OA优惠券填报` 运行时生成的业务底稿位置，不是已发布的规则或标准模板。写入版本控制或外发前，必须单独完成数据权限与脱敏审查。

## 文档导航与权威性

| 文档 / 资产 | 状态 | 用途与使用规则 |
| --- | --- | --- |
| [P1 Excel 试点 PRD v1.5](specifications/coupon-oa-p1-excel-pilot-prd-v1.5.md) | **当前 P1-1 基线**（2026-09-30） | 规定内网试点的用户、单一常规满减券场景、输入、生成物、人工确认和明确非目标。P1-1 的产品与验收问题以此为准。 |
| [MVP PRD v1.2](specifications/coupon-oa-mvp-prd-v1.2.md) | 当前总体边界（2026-09-28） | 定义 P0–P2 的渐进式目标、权限边界和“不得代审批”的原则。P1-1 未覆盖的通用约束以此为准。 |
| [机器人端自动填报实施方案 v1.3](implementation/coupon-oa-bot-autofill-plan-v1.3.md) | 后续 OA 自动填写方案（2026-09-29） | 描述系统业务草稿、人工预览确认及创建实例后的回读止损链；依赖流程/应用管理员前置确认，不能替代 P1-1 的试点范围或独立授权上线。 |
| [系统草稿 Base 表结构 v1](implementation/coupon-oa-draft-base-schema-v1.md) / [`fields` JSON](implementation/coupon-oa-draft-base-fields-v1.json) | 受控实现配置 | 用于系统业务草稿表的字段定义和初始化。变更时须与相关服务端实现、脚本和实施方案同步。 |
| [附件上传“无响应”本地诊断](operations/diagnostics/coupon-oa-attachment-upload-no-response-diagnosis-2026-09-29.md) | 历史排障记录（2026-09-29） | 记录当时的环境、证据、结论和后续条件；不作为当前产品需求或运行状态的唯一依据。 |
| [Excel 试点内置模板读取修复](operations/diagnostics/coupon-excel-pilot-template-asset-resolution-2026-09-30.md) | 当前部署前诊断（2026-09-30） | 记录桌面端模板缺失的 Nitro asset namespace 根因、修复边界和回归验证步骤。 |
| [Excel 试点 Base 附件归属修复](operations/diagnostics/coupon-excel-pilot-bitable-attachment-resolution-2026-09-30.md) | 当前部署前诊断（2026-09-30） | 记录普通 Drive token 不能直接写入 Base 附件字段的根因、双 token 修复模型和验收步骤。 |
| [Excel 试点 Drive 下载 403 诊断](operations/diagnostics/coupon-excel-pilot-drive-download-403-resolution-2026-09-30.md) | 当前联调诊断（2026-09-30） | 记录确认生成结果后 Drive 冻结文件下载被 403 拒绝的权限前置、恢复步骤和不创建正式 OA 的边界。 |
| [调研依据](research/) | 调研 / 待确认 | 保存原始 OA 字段、模板规则、截图和未确认结论。不得仅凭调研内容实现或发布产品规则。 |
| [标准配券模板](assets/templates/) | 原始可复用资产 | 保留 Excel 原貌。模板选择、字段含义和公式说明以[模板与配置字段调研](research/coupon-configuration-templates-and-fields-v0.md)为索引；变更须确认版本和业务 Owner。 |
| [路径验证演练样本](test-fixtures/coupon-oa-route-verification/README.md) | 脱敏测试资产 | 仅可用于管理员准备的隔离演练审批定义，严禁连接真实建券、同步或生产环境。 |
| [邮件助手归档](archive/email-assistant/) | 历史归档 | 仅用于决策追溯，不能反向覆盖现行 PRD 或实施范围。 |

### 规则冲突时的处理顺序

1. 涉及当前 P1-1 Excel 试点的功能范围、字段、生成和验收时，以 **P1 PRD v1.5** 为准。
2. P1-1 未规定的通用权限、人工确认和分期边界，以 **MVP PRD v1.2** 为准。
3. 实施方案、Base schema、诊断和调研文档用于解释或落地，不单独新增产品承诺；与当前 PRD 不一致时，先更新 PRD 或另行形成经确认的决策。
4. 涉及真实审批实例、附件上传或自动填写时，还必须满足实施方案和 [ADR-0004](../adr/0004-bot-confirmed-submit-for-coupon-oa.md) 列出的流程管理员与应用权限前置条件。

## 常用入口

### P1-1 Excel 内网试点

- [P1 Excel 试点 PRD](specifications/coupon-oa-p1-excel-pilot-prd-v1.5.md)：当前试点唯一支持的“常规满减券 + 单列 SKUID 白名单”流程。
- [常规满减券模板](assets/templates/配券信息表-常规满减券.xlsx)：P1-1 唯一允许自动生成的配券模板版本。
- [路径验证脱敏样本](test-fixtures/coupon-oa-route-verification/README.md)：用于不触及真实业务数据的双路径演练。

### 业务规则与资产追溯

- [优惠券 OA 申请需求梳理](research/coupon-oa-application-requirements-v0.md)：原始 OA 字段、业务管控规则和待确认事项。
- [配券模板与配置字段说明](research/coupon-configuration-templates-and-fields-v0.md)：模板矩阵、字段字典、计算公式和商品名单规则。
- [原始截图](research/screenshots/)：调研文档引用的通用规则和字段截图。
- 本地真实案例（如存在）：`cases/<OA编号>/README.md`，仅用于授权范围内的需求分析与口径核对。

### 后续 OA 自动填写

- [机器人端自动填报实施方案](implementation/coupon-oa-bot-autofill-plan-v1.3.md)：系统草稿、预览确认、提交回读和止损设计。
- [ADR-0004](../adr/0004-bot-confirmed-submit-for-coupon-oa.md)：确认即提交模式及其不可绕过的约束。
- [附件处理诊断](operations/diagnostics/coupon-oa-attachment-upload-no-response-diagnosis-2026-09-29.md)：附件联调的历史问题、已验证条件和安全边界。

## 维护约定

1. 新的当前产品规则、范围或验收标准写入 `specifications/`；修改时同步更新版本、日期、变更说明和本 README 的文档登记。
2. 技术实施路径、Base/字段配置和可执行初始化资产放入 `implementation/`；代码或脚本引用路径变更时必须在同一变更中修复。
3. 仅对某次环境、时间或故障成立的调查记录放入 `operations/diagnostics/`，并在顶部明确日期、证据范围和当前适用性。
4. 未确认的来源、截图、规则和问题保留在 `research/`，不得被表述为已发布业务规则。
5. 经确认、可复用的标准 Excel 才能进入 `assets/templates/`；单次活动附件不得与模板混放。
6. 真实案例始终使用本地 `cases/<OA编号>/`，说明、附件和截图放在同一目录；提交或外发前必须取得单独的数据权限确认。
7. 可共享的流程验证只能使用 `test-fixtures/` 的脱敏材料；生成的 `drafts/` 必须按业务数据处理，不得默认视为可提交文档。
8. 被替代但仍需追溯的方案移入 `archive/<主题>/`，并在顶部标注归档原因和当前替代文档。
