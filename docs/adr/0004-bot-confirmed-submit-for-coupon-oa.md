# ADR-0004：优惠券 OA 采用系统业务草稿与机器人确认即提交模式

- 状态：已接受（业务 Owner 2026-09-29 口头批准，正式实施前需按方案 W0 清单完成管理员确认）
- 日期：2026-09-29
- 变更：创建/回读实例使用应用 tenant access token，并以申请人 `open_id` 标记实例发起人；用户 OAuth 不再是自动填单前置依赖
- 变更：以单一提交 schema 取代独立映射表；字段业务语义、飞书控件绑定、编码/解码规则同源维护
- 关联：[优惠券 OA 智能提单 MVP PRD v1.3](../oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.3.md) · [机器人端自动填报实施方案 v1.4](../oa-ticket-reimbursement-materials/current/implementation/coupon-oa-bot-autofill-plan-v1.4.md) · [内网试点 rollout](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)

## 背景

PRD v1.2 将 P1（自动填写 OA）的前置条件定为"流程管理员确认 OA API 的获授权访问方式"，并禁止自动提交。2026-09-28/29 的穷尽核查确认了以下平台事实：

1. 飞书审批不存在"创建草稿"开放 API；客户端草稿是纯 UI 功能，无 API 入口。
2. 发起链接不支持 URL 参数预填表单。
3. 「创建审批实例」和「获取单个实例」支持应用 tenant access token，并以 `open_id` 指定申请人；撤回仍只能由提交人用户身份或在飞书客户端执行。
4. 撤回仅限「审批中」实例，撤回后不可编辑重提；撤回规则可由管理员配置。

因此，"机器人把字段写入表单且不提交"在当前飞书开放能力下不存在官方实现路径；要实现自动填写，创建实例即提交是唯一通道。

## 决策

采用**系统业务草稿 + 确认即提交**模式：

- 未完成、未确认的字段与附件元数据保存在本系统的 Base「优惠券提单」生命周期表中，而不是飞书审批客户端草稿箱；每步保存为可恢复的草稿修订，业务员可以跨会话继续填写。
- 仅当业务员在预览卡明确确认后，才由服务端使用 tenant access token、以该业务员 `open_id` 创建真实审批实例；确认前对飞书审批保持零写入。
- 草稿到实例是**单向**转换；提交后不再修改草稿字段，只记录实例状态与审计结果。

并以三道人工/机器核对关约束：

1. 机器预检（校验报告，人只看异常项）；
2. 人工预览门——按 OA 字段顺序全量预览，**业务员明确确认前不产生任何 OA 单据**，确认动作落审计；
3. 提交后撤回窗——创建后秒级回读实例表单与确认预览逐字段比对，不一致立即告警并引导撤回；配错可由提交人撤回（客户端/API）或第一审批人驳回。

服务端以应用 tenant access token 发起实例，并在请求中传入业务员的 `open_id`；实例归属飞书定义中的该申请人，不代审批、不代附件补传。

## 理由

- 系统业务草稿补足飞书 API 无法创建客户端草稿的缺口：业务员可中断、续填、修改、复核。`/OA优惠券提报` Claude Code Skill 的本地结构化产物不是运行时系统草稿，也不会自动共享状态；如未来需要导入，必须以显式的服务端 schema、owner、revision、hash 与审计合同完成关联。
- 单一提交 schema 将业务字段语义、飞书控件绑定及编码/解码规则合并维护，避免独立映射表与业务 schema 漂移；审批定义结构哈希变更时 fail-closed，创建后回读比对提供最终校验。
- 该模式是唯一满足"自动填写"诉求的官方路径；"出错必被拦"（回读比对 + 自动止损）替代"控件绑定或编码永不犯错"的不可承诺目标。
- OA 流程中优惠券配置位于部门人工审批之后，撤回/驳回窗口横跨人工节点，实际风险窗口较宽。
- 备选方案（人工+底稿、表单默认值+历史单再发起）已并行提供，作为低风险组合长期保留。

## 约束

- 确认前零副作用：任何 OA 写入必须发生在预览确认之后。
- 不代审批：审批判断仍由现有审批流承担。
- 审计完整：每单记录确认人/时间/提交 schema 版本/审批定义结构哈希/实例 code/回读结果。
- App Secret 与 tenant access token 只保存在服务端环境变量；最小审批、附件和 Base scope；不向浏览器、卡片或日志输出 token。

## 试点阶段澄清（2026-10-08）

本 ADR 规定的是**允许服务端原生提交时**的确认、身份、定义 hash 与回读边界，不等于所有优惠券路径现在都可创建实例：

- `优惠券Excel试点` 的 output confirmation 仅交接系统 OA 草稿；它本身不创建原生 OA。
- 内网首发为 draft-only；只有 [rollout](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) 的 native-submit Gate 通过后，服务端才可对当前 revision、明确确认且 allowlist 内的用户创建实例。
- `CreatedNeedsReview` 与拟实施的 `SubmissionUnknown` 必须可人工对账；不能因 create/readback 异常盲目再次提交。
- 本 ADR 不覆盖三源流程尚未完成的模板、字段映射与服务端实现前置条件。


- 修订 PRD v1.2 中"P1 不自动提交"的边界；PRD 升版至 v1.3 时引用本 ADR。
- 新增前置依赖：流程管理员提供目标定义 approval_code、开放可见范围、确认撤回规则；应用管理员审批审批定义读取、实例创建/读取、附件上传和 Base 读写 scope。
- 若目标定义被核实为三方审批（is_external=true），本 ADR 不适用，需重新决策。
