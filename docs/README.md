# 项目文档导航

本目录汇总拍小宝飞书工作流的业务规划、架构决策、产品方案和运行记录。文档的用途和状态不同：业务规划用于确定后续方向，`proposals/` 为待评审方案，`current/` 和已接受 ADR 记录当前有效基线，`records/` 保存验证与运行证据。

> 除非相应文档明确写明已实施并附有验证证据，本文档库中的方案和优先级均不代表功能已上线、已获飞书权限或可自动创建、提交原生 OA。

## 业务规划与需求排期

- [拍小宝需求优先级清单（初稿）](拍小宝需求优先级清单.md)：基于业务访谈梳理的 AI 改造优先级，包括优惠券 OA 智能提单、跨品类数据看板等方向，以及人工决策边界。
- [跨产品需求排期 Backlog](requirements-backlog.md)：已确认但尚未纳入当前交付范围的跨产品事项、前置条件和验收口径。

业务优先级用于指导访谈、方案设计和试点立项；具体开发范围与交付状态仍以各产品的当前基线、实施计划和验证记录为准。

## 架构与技术决策

- [当前 POC 与优惠券内网试点架构基线](architecture-decision.md)：当前采用的架构、试点边界、非目标与迁移触发条件。
- [后续技术选型决策](future-technology-selection.md)：生产化评估中尚待决定的云、数据库、队列、对象存储和 AI/Agent 技术项。
- [架构决策记录（ADR）](adr/)：会改变架构边界的已接受决定；新决定应新增 ADR，而非改写历史记录。

## 优惠券 OA 文档库

- [优惠券 OA 文档库](oa-ticket-reimbursement-materials/README.md)：优惠券 OA 的产品、实现、运行、提议和参考资料入口。
- [当前生效基线](oa-ticket-reimbursement-materials/current/README.md)：当前有效的产品、实现和运行约束。
- [待评审方案](oa-ticket-reimbursement-materials/proposals/README.md)：尚未进入当前实现范围的产品和技术提议。
- [本地 Skill 与产品文档关系](oa-ticket-reimbursement-materials/claude-code-skill-contract.md)：本地辅助协议与受认证服务端 Bot 路线之间的边界。
