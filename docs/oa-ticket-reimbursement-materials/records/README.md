# 诊断与验证记录

本目录保存有明确**日期、环境和证据范围**的诊断、修复与测试记录。它们支持复现、审计和排障，但不构成当前功能已上线、资源权限已开通或 rollout Gate 已通过的证明。

| 主题 | 位置 | 说明 |
| --- | --- | --- |
| R2 foundation 验证 | [`durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md`](durable-control-plane/coupon-r2-foundation-verification-2026-10-09.md) | 记录 lease 修复、当前自动化证据、admin 构建阻断与 No-go 边界。 |
| R1 bridge 资源发现 | [`durable-control-plane/coupon-r1-managed-bridge-resource-discovery-2026-10-10.md`](durable-control-plane/coupon-r1-managed-bridge-resource-discovery-2026-10-10.md) | 记录本机/仓库范围内的资源核查、企业资源交接待办与 R1 No-go；不构成分配或部署证明。 |
| 环境/资源诊断 | [`diagnostics/`](diagnostics/) | 附件上传、模板资产、Base 附件和 Drive 下载等一次性调查记录。 |
| 工作流生命周期记录 | [`workflow-lifecycle/`](workflow-lifecycle/) | 双草稿互斥、懒过期的实现方案、测试用例和修复验证。 |

## 使用规则

1. 阅读记录时必须同时查看其日期、环境、前置权限与未执行项；
2. 任何“通过”只覆盖文中列出的命令、样本和环境，不能外推到生产或 native-submit；
3. 新排障文档须写清问题、证据、结论、未验证项、当前适用性和后续责任人；
4. 当前阶段、运行要求和 go/no-go 始终以 [`../current/operations/`](../current/operations/) 为准。
