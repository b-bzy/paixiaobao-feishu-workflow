# ADR-0011：DeepSeek 仅用于 P0 三源候选识别

- **状态**：已接受；待 P0 外部验证，不构成生产或原生 OA 授权
- **日期**：2026-10-10
- **决策 Owner**：优惠券流程 Owner、工程 Owner
- **关联**：[ADR-0005](0005-three-source-coupon-workflow.md) · [ADR-0007](0007-adopt-durable-control-plane-for-coupon-pilot.md) · [ADR-0010](0010-timebox-local-long-connection-three-source-poc.md)

## 背景

三源 P0 需要理解来源 Excel 中不稳定的列名、券型和候选数据行，但业务事实、模板、名单映射和生成许可不能交给 AI 决定。需求方已明确同意在本次受限 P0 中，将上传工作簿的完整非空单元格内容发送给 DeepSeek，并接受对应的外部处理风险。

## 决策

DeepSeek 只作为候选识别器：每个 `draft + revision + source role + source SHA-256 + model + prompt version` 最多发送一次完整工作簿请求，不分块，也不自动重试供应商请求。调用在 PostgreSQL durable effect worker 中异步执行，不得发生在飞书同步事件入口或 Mac long-connection bridge 中。

AI 输出必须通过严格 schema 与来源坐标校验，只保存模型、耗时、请求/响应 hash、经验证候选和失败分类；不保存完整 prompt、响应或工作簿副本。包含公式、外部链接或 prompt injection 的单元格一律是不可信数据，不能改变 schema、模板、权限、流程或副作用。

第二轮由当前 owner 对当前 revision 明确确认唯一常规满减券、缺失字段、名单 Sheet 和异常选择。未知券型、多券、无有效坐标、未确认活动点位或不支持券型都必须阻止生成。确认完成后，确定性模板引擎才可生成标准配券表以及单 Sheet 白名单和可选黑名单；生成阶段不得调用 DeepSeek。

## Gate 与失败处理

- `FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED=false` 默认关闭，并作为立即 kill switch。
- 仅允许官方 `https://api.deepseek.com`，请求必须有超时和 1 MiB 响应上限。
- 上下文过长、429、超时、网络错误、无效 JSON、超大响应或坐标校验失败均进入可审计的确定性/人工补充降级路径，不得伪造成功或自动再次外发。
- AI 成功但 Base/Card 投影失败时，只重试投影；不得重复调用 DeepSeek。
- 来源 hash、owner 或 revision 变化时丢弃旧候选。

## 范围外

本 ADR 不启用非 P0 用户、其它券型、自动审批、原生 OA 创建或提交，也不授权将来源文件直接作为 OA 附件。任何扩展范围都需要新的产品决定、ADR、运行 Gate 和独立验证。

## 后果与回滚

受控 P0 可以获得更稳健的候选识别，但增加了外部处理、成本、延迟和不确定性。发生隐私、重复请求、错误生成或供应商稳定性问题时，立即关闭 AI Gate；三源流程必须继续保留确定性识别和人工补充路径，并保持 native OA 开关关闭。
