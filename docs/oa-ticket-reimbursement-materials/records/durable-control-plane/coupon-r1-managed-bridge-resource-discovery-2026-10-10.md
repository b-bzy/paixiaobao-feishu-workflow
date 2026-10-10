# R1 企业托管 Bridge 资源发现记录 — 2026-10-10

> **记录类型**：资源发现与部署交接证据
> **观察环境**：开发工作站与本仓库本地工作区
> **当前结论**：**未定位 / R1 No-go**
> **适用范围**：本记录仅说明 2026-10-10 在上述范围内完成的核查；不构成企业全局资源盘点、运行批准、实现完成证明或上线授权。

## 1. 目的与权威边界

飞书应用当前仅申请了长连接事件接收能力。因此内网试点若进入 R1，唯一允许的入口方向是：

```text
Feishu WebSocket
  → 企业托管 lark-cli bridge
  → 已签名 HTTPS
  → Vercel/Nitro ingress
  → 持久收据 / outbox / worker
```

本记录用于交接“企业托管 bridge 宿主是否已经找到或需要申请”的事实。阶段、go/no-go 和回滚规则仍以[内网试点 rollout 计划](../../current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)、[readiness checklist](../../current/operations/coupon-oa-pilot-launch-readiness-checklist-v1.md)和[ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)为准。

它不改变长期 HTTP callback 目标，也不申请变更飞书事件订阅、Vercel 项目设置、原生 OA、allowlist 或任意 secret。

## 2. 已核查范围与限制

| 类别 | 本次核查 | 不能据此推导 |
| --- | --- | --- |
| 本机飞书能力 | 本机存在 `lark-cli`，且可见本地应用授权加密材料；未读取或输出其中内容。 | 企业服务账号、企业受管凭据或 bridge 已可运行。 |
| 本地进程 | 核查时未发现运行中的 `lark-cli` / `long-connection-bridge` 进程。 | 企业 VM、容器平台或其他团队没有已运行的 bridge。 |
| 仓库与 Vercel | 本地工作区有 Vercel 项目关联元数据；本机没有 Vercel CLI。 | 当前用户拥有 Vercel 部署、域名、环境变量或项目成员权限；线上 ingress 已发布。 |
| 本地开发脚本 | 可见 `pnpm dev:events` 和本地 bridge 脚本。 | 它们满足 R1 的受监督运行、持久 outbox、独立 consumer、恢复或监控要求。 |
| 企业基础设施 | 未登录企业云控制台、CMDB、服务目录、secret store、日志/监控或容器平台。 | 企业没有可复用的 bridge 或运行资源。 |

本记录不包含 App Secret、bridge shared secret、Vercel token、数据库 URI、完整 Open ID、原始事件、附件、签名或 nonce。

## 3. 当前可确认事实

1. 本机可继续用于 R0 开发和脱敏联调；个人电脑、本地 shell、`nohup`、`/tmp` 日志及 Vercel Serverless 均不得作为 R1/R2 的 bridge 宿主。
2. 本地 Vercel 项目关联只是一项开发环境元数据，不能替代运行 Owner 对项目权限、服务端变量、目标域名、部署 artifact 和线上健康状态的确认。
3. 企业托管 bridge 必须使用非 root 服务账号、企业 secret store、加密持久卷、受监督的进程/容器、受限出网、集中日志、告警和值守；要求见[bridge runbook](../../current/operations/coupon-oa-managed-bridge-runbook-v1.md)。
4. 只有主机被分配不足以进入 R1。还必须有与精确版本对应的 bridge/Nitro 验证、HMAC、稳定 ID、持久 receipt/outbox、单活动 consumer、故障恢复和运行证据。
5. 未提交工作区、目标设计、proposal、历史诊断或单次本地成功均不构成可部署 artifact 的证明。

## 4. 资源状态与待办

| 项目 | 当前状态 | 需要的证据 / 下一步 | Owner |
| --- | --- | --- | --- |
| 企业共享 Feishu/Lark bridge | 未定位 | 飞书应用管理员确认是否已有可隔离接入的企业托管长连接服务。 | 飞书应用管理员 |
| 企业运行宿主 | 未定位 | 平台/运行 Owner 检索既有 Linux VM、受控容器或内部 worker 平台。 | 平台/运行 Owner |
| 资源申请 | 未提交 | 无合格共享服务时，按[provisioning guide](../../current/operations/coupon-oa-managed-bridge-provisioning-guide-v1.md)提交 R1 资源申请。 | 工程 Owner + 平台 Owner |
| Vercel/Nitro ingress 权限 | 未验证 | 确认项目成员、目标域名、运行时、服务端变量和回退责任；不得在本记录填入 secret。 | Vercel/平台 Owner |
| Bridge 运行 Owner / 值守 | 未指定 | 指定 non-root 服务身份、值守人、告警接收方和升级路径。 | 平台/运行 Owner |
| R1 准入 | No-go | 完成 readiness checklist 中所有 R1 必填项并书面签核。 | 全部 Owner |

## 5. 候选资源与交接表

当开始企业范围内的查找或申请时，由责任方追加以下信息。引用使用 ticket、资产或文档编号；不得粘贴凭据、私有 URL、签名、完整员工标识或其他敏感值。

| 字段 | 值 |
| --- | --- |
| 生命周期状态 | 未定位 / 候选已识别 / 已提交申请 / 已分配 / 宿主已验证 / Bridge 已验证 / R1 已批准 |
| 发现渠道 |  |
| 联系团队 / 角色 |  |
| 联系与回复日期 |  |
| 企业共享 bridge 是否可用 | 是 / 否 / 待确认 |
| 候选资源类型 | 共享 bridge / Linux VM / 受控容器 / 内部 worker 平台 |
| 申请 / ticket 引用 |  |
| 宿主 / namespace / 资产引用 |  |
| 平台 Owner / 运行 Owner / 值守人 |  |
| 安全与网络审阅人 |  |
| 服务身份与 secret 注入方式 | 仅写机制与引用，不写值 |
| 加密持久卷、保留期与清理责任 |  |
| 出网、时间同步、日志、指标和告警证据 |  |
| Git revision / artifact digest / 回退 artifact |  |
| 下一动作、Owner、截止日期 |  |

**状态释义：**“已分配”只说明有候选资源；“宿主已验证”只说明平台控制满足要求；只有“Bridge 已验证”且 checklist 签核后，才可写入“R1 已批准”。不得跳级。

## 6. 企业资源发现请求边界

可向平台/运行团队发送如下请求标题：

> `[资源发现/申请][R1 测试] 飞书企业托管长连接 Bridge 运行资源（不含飞书订阅或 Vercel 设置变更）`

请求内容、候选资源评估标准和 host-only preflight 见[企业托管 bridge 资源发现与部署前交接指南](../../current/operations/coupon-oa-managed-bridge-provisioning-guide-v1.md)。

本次请求只定位或分配企业托管运行资源；**不**授权启动当前开发 bridge、复制本机授权材料、变更飞书订阅、变更 Vercel、启用 native submit 或开放真实业务试点。

## 7. 活动日志（追加式）

后续按日期追加：发现询问、候选评估、ticket 提交、分配、host preflight、artifact 交接、bridge 验证、readiness 结论或关闭/替代。若资源申请被拒绝、放弃或被其他资源替代，保留本记录并新建新的日期化记录；不要重写本次观察事实。

| 日期 | 活动 | 证据引用 | 结论 / 下一步 | Owner |
| --- | --- | --- | --- | --- |
| 2026-10-10 | 完成本机与仓库范围核查 | 本记录第 2–4 节 | 未定位；R1 No-go；转交企业平台/运行资源发现 | 工程 Owner |
