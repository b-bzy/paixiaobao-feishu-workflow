# 优惠券 OA 企业托管 Bridge 运行手册 v1

> **状态**：内网试点运行要求；上线前必须由运行 Owner 演练。
> **不适用**：本地 `pnpm dev:events`、`scripts/long-connection-bridge.mjs`、开发 shell 或个人电脑。

## 0. 资源交接与环境边界

本手册只在企业运行资源已由平台/运行 Owner 验收后适用。资源发现、申请、部署前配置和 R1 host-only preflight 见[企业托管 bridge 资源发现与部署前交接指南](coupon-oa-managed-bridge-provisioning-guide-v1.md)；本次已知状态和后续企业资源查找应追加到[日期化资源发现记录](../../records/durable-control-plane/coupon-r1-managed-bridge-resource-discovery-2026-10-10.md)。

| 环境 | 入口与宿主 | 本手册是否允许启动 bridge | 阶段边界 |
| --- | --- | --- | --- |
| R0 本地开发 | 个人电脑上的 `lark-cli` / `pnpm dev:events` | 否 | 仅调试和脱敏验证；不是试点服务。 |
| R1 托管 bridge 测试 | 企业 VM / 受控容器 / 已批准共享 bridge → 签名 Nitro ingress | 是，但必须先通过资源交接、artifact、HMAC、receipt/outbox、监控和恢复验证 | 仅事件接收与恢复测试；不开放业务试点或 native OA。 |
| R2 draft-only | 已通过 R1 的企业 bridge 与受控服务端资源 | 是，且仍须按本手册值守 | 仅严格 allowlist 的草稿和受控产物；禁止原生 OA 创建。 |

Vercel/Nitro 只承载 bridge 的受签名 HTTP ingress 和业务处理面，不运行 `lark-cli` 长连接。主机已分配、Vercel 项目已关联、HTTP 可达或本地 app 已授权都不是 R1 准入证据；任一前置项缺失时保持 No-go，不能启动本手册所述运行链路。

## 1. 责任与边界

| 责任 | Owner | 要求 |
| --- | --- | --- |
| 宿主、网络、磁盘、supervisor | 平台/运行 Owner | 企业托管 Linux VM 或容器、非 root 服务账号、持久加密卷 |
| 飞书应用与 lark-cli 授权 | 应用管理员 | 企业受管身份、最小权限、轮换与离职回收 |
| bridge 版本与配置 | 工程 Owner | 固定版本、变更评审、可回退 artifact |
| route/allowlist/kill switch | 优惠券流程 Owner + 工程 Owner | 服务端控制、审计变更、默认关闭 native submit |
| 值守、告警、对账 | 值守人 | 按本手册处置、记录事件和证据 |

bridge 不得持有 OA 业务决策逻辑或绕过 Nitro 授权；不保存不必要的完整事件、附件内容或 secret。

## 2. 上线前宿主要求

- 使用独立非 root service account，最小文件权限；禁止以个人账号、交互 shell、`nohup` 或 LaunchAgent 作为长期服务机制。
- 采用 systemd 或受控容器编排，配置自动重启、退避、资源限制、健康检查和集中日志输出。
- outbox 使用企业批准的加密持久卷；记录容量、保留期、备份/清理责任。禁止 `/tmp`、容器临时层或纯内存保存未确认事件。
- 仅允许必要的飞书、Nitro/Vercel、监控/日志目的地出网；入站管理访问受企业网络控制。
- bridge shared secret、lark-cli 认证材料与其他密钥使用受控 secret store 注入；禁止写入仓库、镜像、命令行、日志和截图。
- 版本升级前在隔离环境验证，记录 `lark-cli` 版本、镜像/包 digest、配置版本与回滚版本。

## 3. 启动与健康确认

启动前确认：launch stage 为预期阶段；native-submit kill switch 状态；allowlist 版本；bridge key ID；Nitro 目标；审批定义/资源配置；outbox 无未说明积压。

启动后确认每项：

1. supervisor 显示 bridge healthy，两个 consumer 独立存活；
2. 最近 WebSocket 活动和最近 Nitro **持久接收**均在阈值内；
3. signed envelope 正常，签名拒绝/nonce 重放无异常增长；
4. outbox 深度和最老记录年龄在试点阈值内；
5. dashboard、告警、日志脱敏与值守通知可用；
6. 草稿阶段确认没有开启 native OA 写入。

正常启动不等于允许 R3/R4；只能在 rollout 对应 Gate 已书面通过后改变阶段。

## 4. 例行观测与告警处置

| 信号 | 首要动作 | 后续动作 |
| --- | --- | --- |
| 一个 consumer 停止 | 确认 supervisor 正在退避重启；不要手动开第二个 bridge | 超阈值则停止 intake、告警，按版本/授权排查 |
| outbox 增长或最老记录超阈值 | 检查 Nitro、网络、签名拒绝与磁盘 | 保留 outbox，修复后按稳定 event ID 重放；不得删除未对账记录 |
| Nitro 签名/重放拒绝 | 立即检查 key/时钟/nonce store；错误 key 不重试 | 大量异常时关闭 ingress/bridge 并按安全事件处理 |
| lark-cli 认证失败或重连循环 | 停止无限人工重试，检查受管凭据/应用可见性 | 轮换/重新授权后在测试事件上验证；记录影响窗口 |
| Drive/Base/OA 或 Vercel 故障 | 维持 outbox，停止产生不可安全恢复的副作用 | 服务恢复后先验证单个去重 replay，再逐步排空 |
| dead-letter/毒事件 | 隔离单项，记录 correlation ID 和脱敏原因 | 人工决定修复、弃置或安全重放；不得跳过幂等/授权 |

## 5. 原生 OA 事件处置

- `Submitted`：创建与必要 readback 均成功；记录 instance code/link 和确认 revision。
- `CreatedNeedsReview`：实例存在但 readback 失败/差异；暂停该草稿自动操作，通知 OA Owner 对账或撤回/驳回。
- `SubmissionUnknown`：无法证明 create 结果时的目标状态；禁止再次创建。按 submission key、实例查询和审计记录对账后再转换状态。
- 任一重复、越权、定义漂移或业务字段/附件 hash 异常：立即关闭 native-submit kill switch，执行 rollout 回滚流程。

## 6. 停止、升级与回滚

### 受控停止

1. 如涉及真实 OA，先关闭 native-submit kill switch。
2. 停止接收新事件；将内存中事件安全落入 outbox。
3. 等待已确认记录完成或把其明确标记为待恢复；记录 outbox 深度、最老时间和部署版本。
4. 停止 supervisor unit/容器；不要清空 outbox 或删除审计记录。

### 升级

1. 审核版本、变更、风险和回滚 artifact。
2. 在测试环境执行签名、重复、重连和故障恢复 smoke test。
3. 在窗口内切换，确认两个 consumer、outbox 和 Nitro receipt 正常。
4. 观察期内不扩大 allowlist 或变更 native-submit 状态。

### 回滚

按 [rollout 计划](coupon-oa-internal-pilot-rollout-plan-v1.md#4-立即暂停与回滚)执行：先关 native submit，再冻结用户/路线，保存证据，对账不确定实例；必要时回退应用版本/权限。手动 OA 导航是否保留由流程 Owner 决定。

## 7. 日志、数据与交接

日志允许使用 correlation ID、脱敏稳定 ID、event type、阶段、attempt、状态和错误类别；禁止 token、签名、完整 payload、原始附件、文件 key、完整 Open ID 与可识别业务内容。日志保留、访问与删除按数据 Owner 批准的策略执行。

每次故障/交接至少记录：时间窗、环境、bridge 版本、key ID（不含 key）、影响 consumer、outbox 状态、correlation ID、采取操作、OA/草稿影响、对账结论、复盘 owner。
