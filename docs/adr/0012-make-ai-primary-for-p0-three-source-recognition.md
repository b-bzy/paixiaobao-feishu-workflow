# ADR-0012：P0 三源流程采用 AI 主识别和统一人工确认

- **状态**：已接受；仅限受控 P0 Preview，不构成生产或原生 OA 授权
- **日期**：2026-10-12
- **决策 Owner**：优惠券流程 Owner、工程 Owner
- **关联**：[ADR-0005](0005-three-source-coupon-workflow.md) · [ADR-0007](0007-adopt-durable-control-plane-for-coupon-pilot.md) · [ADR-0011](0011-use-deepseek-only-for-p0-candidate-recognition.md)

## 背景

现有 P0 虽已调用 DeepSeek，但确定性表头映射仍先决定主要候选，导致任意布局、
多 Sheet 和字段名称变化时出现大量技术映射项。活动名称还可能回退为“正常活动”
等占位文字，活动背景也未完整执行本地优惠券提报 Skill 的文案合同。

## 决策

DeepSeek 成为当前 allowlist P0 的首选工作簿识别器。模型返回文件角色、模板、
券档、字段、名单区域和文案候选，并引用真实来源坐标。服务端校验 source hash、
坐标、类型、模板 manifest、金额、日期和 SKU 规则。确定性识别只在 AI 关闭、
失败、响应无效或字段缺失时提供降级候选，不能覆盖已验证 AI 结果或 owner 输入。

候选必须区分来源明确值、AI 归纳、AI 推测、规则降级和 owner 输入。无年份日期
及公开促销主题可以作为“系统推测”预填，但必须在一张中文第二轮卡中由当前
owner 对当前 revision 确认。Sheet、列号、坐标和内部字段 key 只保留在审计中，
不向业务员展示。

活动名称和背景使用版本化运行时文案合同。DeepSeek 组织中文草稿，确定性代码
验证占位名称、全部券档覆盖、金额/日期一致性和禁止编造事实。owner 修改后的
文案不得被重复投影覆盖。

公开日历只作为软证据，通过独立、默认关闭的 HTTPS JSON gateway 查询。请求只
包含日期窗口、locale 和查询版本，不包含员工、SKU、券额或工作簿内容。该
gateway 不是通用搜索或浏览器入口；未配置、失败或冲突时回到明确的人工确认。

工作簿识别继续通过 PostgreSQL durable effect 执行，终态先持久化再投影。公共
日历软证据和活动文案请求合并到该次识别外发的受控上下文中，不新增可独立重放
的浏览或文案副作用；终态投影重试不得再次查询日历或调用 DeepSeek。同一
revision 的各来源聚合为一个批次，只发送或更新一张第二轮卡。第二轮确认前不得
生成 Excel；确认后仍由登记的确定性模板引擎生成并回读标准附件。

## Gate 与回滚

- recognition、AI-primary、shadow、activity-copy 和 public-calendar 分别使用默认
  关闭的开关；primary 与 shadow 不同时修改用户可见结果。
- AI、日历或文案失败不能清空 owner 输入，也不能绕过必填、revision 或模板 Gate。
- 重复事件、effect、卡片点击和 worker 重启不得重复外发、发卡或生成附件。
- 关闭 AI-primary 后，流程回到规则降级加同一张中文人工确认卡；历史 revision
  和确认快照不改写。
- 原生 OA、生产三源和非 allowlist 用户继续关闭。

## 后果

流程更能适应任意 Excel 布局，并显著减少技术映射操作；代价是新增模型不确定性、
延迟和公共日历配置。服务端证据校验、owner 确认和确定性生成继续承担最终安全
边界。
