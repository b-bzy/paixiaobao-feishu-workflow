# 优惠券 OA 企业托管 Bridge 资源发现与部署前交接指南 v1

> **状态**：R1 内网试点的资源发现、申请与部署前交接要求；不是 bridge 已部署证明。
> **适用入口**：飞书应用当前仅授权的长连接事件接收。
> **不授权**：飞书订阅模式变更、Vercel 设置变更、原生 OA、allowlist 扩容或复制本机凭据。
> **权威 Gate**：[ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)、[rollout](coupon-oa-internal-pilot-rollout-plan-v1.md)、[readiness checklist](coupon-oa-pilot-launch-readiness-checklist-v1.md)。

## 1. 目的与唯一试点拓扑

本指南让平台、工程、飞书应用和运行 Owner 能先找到或申请合格的企业宿主，再进行 R1 受控验证。它解决“有本机授权或 Vercel 项目关联，但没有企业运行资源”时的交接问题。

```text
Feishu WebSocket event
  → 企业托管 lark-cli consumer
  → durable bridge outbox
  → 专用 HMAC HTTPS
  → Vercel/Nitro /api/feishu/bridge
  → PostgreSQL transport receipt + workflow outbox
  → durable worker / coupon domain handler
```

| 环境 | 宿主与入口 | 允许事项 | 明确禁止 |
| --- | --- | --- | --- |
| R0 本地开发 | 个人电脑上的 `lark-cli` / `pnpm dev:events` → 本地 Nitro | 调试、mock、脱敏验证 | 作为试点服务、复制个人凭据、真实 native OA |
| R1 托管 bridge 测试 | 企业 VM/受控容器/已有企业 bridge → 已签名 `/api/feishu/bridge` | 指定测试账号的事件接收、持久接收和恢复验证 | 业务试点、native OA、无证据扩容 |
| R2 draft-only | 通过 R1 的企业 bridge + 受控服务端资源 | 严格 allowlist 的草稿、冻结产物、Base/Drive 交接 | `POST /approval/v4/instances` |

Vercel/Nitro 是 bridge 的**受签名 HTTP ingress 和业务处理面**，不是 `lark-cli` 长连接宿主。`/api/feishu/process` 与当前本地开发桥不是 R1 部署目标；不得通过“把开发脚本复制到企业主机”绕过本指南。

## 2. 资源发现状态阶梯

资源状态必须按顺序记录在日期化[资源发现记录](../../records/durable-control-plane/coupon-r1-managed-bridge-resource-discovery-2026-10-10.md)和 checklist 中：

```text
未定位 → 候选已识别 → 已提交申请 → 已分配 → 宿主已验证 → Bridge 已验证 → R1 已批准
```

| 状态 | 含义 | 不代表 |
| --- | --- | --- |
| 未定位 | 尚未知道哪个企业团队或运行资源可承载 bridge。 | 企业不存在可用资源。 |
| 候选已识别 | 找到共享 bridge、VM、容器或内部 worker 平台候选。 | 已获批准或满足运行要求。 |
| 已提交申请 | 有编号化 ticket/服务请求和明确请求人。 | 资源已经可用。 |
| 已分配 | 平台已分配候选主机或 namespace。 | bridge 已部署或 R1 已就绪。 |
| 宿主已验证 | 平台控制、服务身份、持久卷、出网和监控已留证。 | bridge/Nitro 合同、outbox 或恢复已验证。 |
| Bridge 已验证 | 精确 artifact 通过签名、去重、恢复和故障演练。 | rollout 已签核。 |
| R1 已批准 | checklist 为指定版本、资源、测试账号和窗口完成书面签核。 | R2 draft-only 或 R3 native-submit 已批准。 |

任何“已分配”或“宿主已验证”都不能替代 `Bridge 已验证`。资源或证据缺失时维持 R0 / No-go。

## 3. 企业资源发现与申请流程

### 3.1 先查是否可复用

1. **飞书应用管理员**：确认应用的事件交付模式、已申请的消息/Card action 事件，以及是否已有可隔离接入的企业 Feishu/Lark 长连接 bridge 或 Bot event gateway。
2. **企业服务目录 / CMDB**：搜索“Feishu/Lark WebSocket consumer”“Bot gateway”“event bridge”“长连接”“managed container runtime”等候选；callback-only 网关不等同于能维持出站 WebSocket 的 bridge。
3. **平台 / SRE / 基础设施团队**：若已有共享 bridge，申请应用隔离和运行交接；若没有，申请一个企业托管的非生产 Linux VM 或受控容器 namespace。
4. **安全 / 网络团队**：确认受控出站能够访问飞书长连接端点、获批准的 Nitro ingress、secret store、企业时间服务和遥测目的地。此范围不申请公网入站 listener、新域名或飞书 direct HTTP callback。
5. **记录与交接**：把询问日期、团队角色、ticket、候选、限制和下一步追加到日期化记录；负面结果也是证据，不能据猜测跳过流程。

### 3.2 候选宿主硬性条件

候选仅在同时满足下列条件时，才可进入 host-only preflight：

- 企业管理的 Linux VM、受控容器或经批准的内部 worker 平台；不是个人电脑、LaunchAgent、开发 shell 或 Vercel Serverless；
- 独立的非 root 服务账号，有明确的补丁、离职回收和运行 Owner；
- 加密的持久卷，能保存未确认 delivery/outbox，并有容量、保留、备份和清理责任；不得使用 `/tmp`、容器临时层或纯内存；
- 企业 secret store 向运行时注入凭据；不得将 secret 写入仓库、镜像、命令行、ticket、截图或日志；
- 受控出网、时间同步和时钟偏移监测；
- systemd 或企业容器编排提供独立 consumer 的自动重启、退避、资源限制、健康检查和优雅停止；
- 集中脱敏日志、指标、告警和明确值守人；
- 可部署固定 artifact，保留上一个批准 artifact，并有已演练的停止/回退路径。

## 4. 可复制的平台资源申请

**标题：**

> `[资源发现/申请][R1 测试] 飞书企业托管长连接 Bridge 运行资源（不含飞书订阅或 Vercel 设置变更）`

**正文必须包含：**

- **目的与 Ring**：为 R1 测试接收飞书消息和 Card action 的企业托管长连接事件；不面向生产或全员。
- **优先级**：优先接入已有企业 bridge；否则分配一个企业管理的 Linux VM 或受控容器 namespace。
- **服务身份**：独立 non-root service account，不依赖个人登录或本机 `lark-cli` 会话。
- **单活规则**：一个活动 consumer 部署；任何副本扩展、leader election 或 HA 另行评审。
- **持久化**：加密持久卷用于未确认 outbox；另行引用经批准的 PostgreSQL、对象存储和 worker 资源。主机分配本身不满足这些依赖。
- **密钥**：应用凭据和 bridge 专用密钥从 secret store 注入；不可在申请正文给出真实值。
- **网络和时间**：仅出站访问飞书、Nitro ingress、secret、时间和遥测服务；指定时钟同步来源。
- **可观测性**：bridge/consumer 存活、最后 WebSocket 活动、最后 Nitro 持久接收、outbox 深度与最老年龄、重连、认证拒绝、重复率、dead-letter 和告警 Owner。
- **artifact 与回退**：固定 Git revision 与 artifact digest、上一个 artifact、受控停止和回退方式。
- **数据治理**：数据区域、访问控制、日志脱敏、保留期和清理 Owner。

**申请边界：**

> 本申请只定位或分配企业托管运行资源；不申请修改飞书事件订阅，不申请修改 Vercel 项目设置，不授权原生 OA，也不授权启用当前开发 bridge。工作负载只有在 HMAC、timestamp/nonce、持久 outbox/receipt、稳定 ID 去重、单活、supervisor、监控和恢复证据通过后才可接入 R1 测试事件。

## 5. 部署前配置与 artifact 交接

配置必须由各环境的 secret store 或受控部署系统注入。以下只定义变量类别和 Owner，**不记录真实值**。

| 位置 | 配置类别 | 示例变量名 | Owner / 要求 |
| --- | --- | --- | --- |
| Bridge | 目标与传输身份 | `FEISHU_BRIDGE_TARGET_URL`、`FEISHU_BRIDGE_KEY_ID`、`FEISHU_BRIDGE_SHARED_SECRET`、`FEISHU_BRIDGE_INSTANCE_ID` | bridge 专用 secret；不得复用 App Secret 或 verification token；托管环境不得开启本地 HTTP 例外。 |
| Nitro ingress | stage 与桥鉴权 | `FEISHU_RUNTIME_STAGE`、`FEISHU_LEGACY_POC_ENABLED`、bridge key ID/secret | 工程与运行 Owner 共同复核；R1 必须使用明确 stage，legacy POC 不得与 durable 路线混用。 |
| 持久控制面 | 数据库与 worker | `DATABASE_URL`、`FEISHU_WORKER_ID`、`CONTROL_PLANE_TICK_TOKEN`、worker lease/limit 变量 | 平台 Owner 提供受控依赖；worker token 与 bridge 密钥分离。 |
| R2 以后 | 冻结产物对象存储 | `OBJECT_STORE_*` | R1 不因缺少 R2 资源而假称已进入 draft-only。 |
| 业务开关 | allowlist / native submit | 当前 server-side stage、allowlist、kill switch 与 approval 定义控制 | 仅对应 Gate 的服务端 Owner 改动；R1/R2 不授权 native submit。 |

**artifact 规则：**

1. 写入日期化记录的必须是已审阅 Git revision、已通过相关测试的构建 artifact 与 digest；dirty working tree 不是部署输入。
2. 任何工作区中的 bridge ingress、控制面或迁移候选代码，都必须先被纳入受评审版本并形成可复现 artifact，才可作为 R1 验证基础。
3. `lark-cli` 版本、包/镜像来源、bridge artifact 和回退 artifact 都要固定并留证。
4. bridge secret、App Secret、verification token、数据库凭据和 worker token 必须相互分离。

## 6. R1 部署与验证序列

只有 readiness checklist 已填写相应 Owner、环境、日期、证据和审阅人后，才允许执行下列步骤：

1. 确认候选资源通过第 3 节，并由平台 Owner 完成 host-only preflight；
2. 在隔离环境部署固定 artifact，验证数据库迁移、受控连接和最小健康信号；
3. 分别向 bridge 与 Nitro 注入相互独立的 secret reference；不从本机复制 `.env.local`；
4. 启动一个 bridge 实例，确保消息与 Card action consumer 由 supervisor 独立管理；
5. 验证有效 HMAC 正常接收，并验证未知 key、错误签名、digest 不匹配、过期 timestamp、重复 nonce 和未知 schema 被拒绝；
6. 验证稳定 delivery ID 的持久 receipt 与重复去重；模拟 HTTP 响应丢失，证明不会重复业务副作用；
7. 模拟 Nitro/Vercel、网络、consumer、bridge、worker 和毒事件故障，证明 outbox 保留、退避、恢复与告警；
8. 确认 dashboard、日志脱敏、告警和值守链路；
9. 将脱敏证据关联到日期化记录与 checklist；所有 R1 必填项经书面签核后才写入 `R1 已批准`。

R1 只验证事件接收与恢复，不开放业务试点或原生 OA。若需要进入 R2，必须另行通过 rollout G3；不得仅因 bridge 部署成功而变更业务阶段。

## 7. Host-only preflight 与立即 No-go

在尚未开始飞书消费前，允许验证服务账号、加密卷、secret 注入机制、时间同步、supervisor、日志/指标/告警、受控出网、artifact 发布与回退。完成这些只可标记为“宿主已验证”。

任一情况均为 No-go：

- 用本机、个人身份、`nohup`、LaunchAgent、`/tmp`、容器临时层或 Vercel Serverless 承载 bridge；
- 运行 `pnpm dev:events`、当前开发 bridge 或 restart helper 作为托管服务；
- 将 bridge 指向旧 `/api/feishu/process`，或把 HTTP 可达当成业务成功；
- 没有持久 outbox/receipt、稳定 ID 去重、单活约束、独立 consumer 监督、监控、告警或恢复演练；
- 使用未冻结的工作区、proposal、历史记录或设计文档作为部署 artifact；
- 复制本机授权材料、输出 secret，或在资源 onboarding 中启用 native submit / 扩大 allowlist。

## 8. 停止与交接

R1 停止时，先由 supervisor 停止新 intake，保留 outbox、receipt、dead-letter 和脱敏日志，记录 artifact、活跃 consumer、outbox 深度和最老年龄。只有确认 replay 兼容时才回退到上一批准 artifact；认证完整性可疑时优先停止、保留证据并轮换相关凭据。不得删除或盲目重放未对账记录。

运行期的启动、观测、故障和回滚动作见[bridge runbook](coupon-oa-managed-bridge-runbook-v1.md)；阶段暂停和业务副作用边界见[rollout](coupon-oa-internal-pilot-rollout-plan-v1.md)。
