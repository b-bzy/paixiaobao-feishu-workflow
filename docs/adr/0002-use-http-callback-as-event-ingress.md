# 0002. 使用飞书 HTTP 回调作为统一事件入口

Date: 2026-09-27

## Status

Accepted

## Context

报销 POC 最初通过本地 `lark-cli` 长连接接收飞书事件，再由 Bridge 转发到
Vercel。该方式适合开发调试，但把个人电脑、登录会话、网络和本地进程引入了
运行链路。电脑休眠、退出登录或进程停止时，即使 Vercel 服务正常，员工也无法
发起新的报销流程。

用户已经决定将飞书开放平台的订阅方式切换为“将事件发送至开发者服务器”。
因此，后续架构选型以公网 HTTPS 回调为事件入口，不再围绕桌面端长连接展开。

本 ADR 取代 ADR-0001 中“POC 使用 CLI Bridge 作为事件入口”的部分；ADR-0001
关于分层混合架构、妙搭定位和生产演进的其他决策继续有效。

## Decision

飞书事件和卡片回调统一通过公网 HTTPS 发送到开发者服务器。POC 阶段由 Vercel
承载回调端点，正式阶段可以在保持 HTTP 合同不变的情况下迁移到国内云函数或
企业后端。

```text
管理员 → 妙搭控制面 → Vercel 管理 API → Skill / 模板 / 规则 / 发布
                                          ↓
员工 / 审批人 → 飞书 → Vercel HTTP 回调网关
                              ├─ challenge 与安全校验
                              ├─ 事件幂等
                              ├─ 快速确认接收
                              └─ 投递持久化异步任务
                                      ↓
                         业务后端 + 工作流 + Agent / Skill
                                      ↓
                         Base（POC）/ PostgreSQL（演进）
```

### 同步回调路径

回调请求只执行必须同步完成的工作：

1. 读取原始请求体并完成 URL challenge。
2. 校验 Verification Token、签名以及按需解密。
3. 提取 `event_id`、事件类型和操作者。
4. 以事件 ID 写入幂等记录并投递持久化任务。
5. 立即返回成功响应。

同步路径不得执行 AI 推理、附件 OCR、多 Agent 协同、外部邮件发送或完整审批
流程。项目内部以一秒为响应目标，并监控飞书后台出现的三秒超时。

### 异步处理路径

异步 Worker 负责：

- 读取管理员发布的 Skill 和模板版本。
- 创建或推进工作流实例。
- 调用 Agent、模型、OCR 和外部系统。
- 发送或更新飞书交互卡片。
- 写入业务结果、审计日志和通知记录。
- 按退避策略重试，失败后进入死信或人工补偿队列。

### 幂等与重试

- 事件表以飞书事件 ID 建立唯一约束。
- 卡片提交使用事件 ID、操作 ID 或业务幂等键去重。
- 创建报销实例时使用唯一业务编号，禁止重复事件生成多笔申请。
- 审批动作采用条件更新，只允许 `Pending` 转为 `Approved` 或 `Rejected`。
- 返回成功只表示事件已被可靠接收，不表示完整业务处理已经完成。
- 飞书重试或内部任务重试都必须得到同一个业务结果。

### 部署边界

POC 阶段由妙搭托管管理员页面，Vercel 承载回调端点、管理 API、业务服务和异步
任务入口。数据库、队列和对象存储使用独立的持久化资源，不能依赖 Serverless
实例本地磁盘或内存保存状态。

正式环境如果出现国内访问、数据驻留、成本、合规或稳定性要求，则把回调网关和
业务 Worker 迁往腾讯云 SCF、阿里云 FC 或企业容器平台。飞书订阅协议、领域服务
接口和数据库模型保持不变。

## Consequences

### Positive

- 管理员退出登录、电脑关机或 CLI 停止后，员工仍可调用 Skill。
- 飞书到后端的链路变成标准 HTTPS 接口，更容易监控、扩缩容和迁移。
- 回调网关与耗时任务解耦，降低三秒超时风险。
- 同一入口可以处理消息、卡片、审批状态和后续其他飞书事件。
- Vercel POC 可以快速复用，且以后迁往国内云不需要改变产品交互。

### Negative

- 必须建设安全校验、幂等、队列、重试、死信和事件审计。
- Vercel 上的异步执行需要持久化实现，不能只做进程内异步。
- 飞书后台切换订阅方式后，需要重新验证回调地址、事件权限和应用版本。
- 如果 Vercel 在中国大陆的网络质量不满足验收，仍需迁移国内入口。

## Validation

- 飞书可以成功保存开发者服务器回调地址。
- 回调端点能正确响应 URL challenge。
- P95 接收响应时间控制在一秒内，并持续监控三秒超时。
- 关闭本地 CLI 和电脑后，员工仍能发起报销。
- 同一事件重复发送不会创建重复实例或重复审批。
- 后端处理失败可以重试，并能查询最终状态和审计记录。
- 管理员发布新模板后，员工下一次调用使用新版本，历史实例保持原版本。

## Related Documents

- [ADR-0001：采用分阶段混合架构](0001-adopt-phased-hybrid-architecture.md)
- [ADR-0003：妙搭控制面与 Vercel 执行面](0003-separate-miaoda-control-plane-and-vercel-execution-plane.md)
- [总体架构基线](../architecture-decision.md)
- [后续技术选型决策](../future-technology-selection.md)
- [优惠券内网试点 rollout（仅作为 ADR-0002 的临时例外说明）](../oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)
- [ADR-0006：企业托管长连接内网试点](0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)
