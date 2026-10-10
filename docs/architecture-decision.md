# 爱回收飞书工作流 POC 与优惠券内网试点架构基线 v1.1

> **状态**：当前 POC 与受限优惠券内网试点的架构基线；不是正式生产技术栈承诺。
> **更新日期**：2026-10-08
> **保留历史**：本版本延续 v1.0 的报销 POC 边界，并新增已批准的优惠券试点例外。
> **生产目标**：HTTP callback、持久事件账本/队列、异步执行器和企业批准的数据/运行平台。

## 1. 决策摘要

1. **飞书**是员工/业务员、审批人与 Bot 交互的主要入口；**妙搭**保留管理员控制面，页面权限不能代替后端鉴权。
2. **Vercel/Nitro**继续作为当前业务处理 API；其开发/POC 环境不构成生产可用性、合规或数据驻留保证。
3. **飞书 Base 与 Drive**可作为按流程隔离的 POC 草稿和冻结产物存储；它们不是长期多事实源生产设计，也未证明提供原生 OA 创建所需的原子唯一约束。
4. [ADR-0002](adr/0002-use-http-callback-as-event-ingress.md) 的 HTTPS callback + 持久接收 + 异步执行仍是长期正式目标。
5. [ADR-0006](adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md) 允许一个企业托管的 `lark-cli` bridge 作为**时间受限内网试点例外**。个人电脑、个人凭据、开发 shell 与本地 CLI 常驻仍不允许成为上线链路。
6. [ADR-0010](adr/0010-timebox-local-long-connection-three-source-poc.md) 仅为一个可随时停止的 P0 用户体验窗口允许本机长连接；它不是 ADR-0006 的替代，不具备可靠 ACK/retry/recovery，也绝不构成上线链路。
7. 权限、版本、状态变迁、幂等、最终审批写入与回读由确定性服务端代码控制；AI 不得决定审批结果、篡改路由或补造业务事实。

## 2. 当前优惠券路线与阶段

| 路线 | 目的 | 草稿阶段 | 小范围原生 OA 阶段 |
| --- | --- | --- | --- |
| `OA优惠券审批` | 导航至已有原生 OA | 仅返回入口；不创建草稿、附件或实例 | 同上；用户在原生页面手工提交不属于自动化写入 |
| `OA优惠券填报` | 收集结构化字段和材料，保存系统草稿 | 仅草稿/校验/预览，禁止创建原生实例 | 仅当前 revision、明确确认、服务端 allowlist 与全部门禁通过时创建并回读 |
| `优惠券Excel试点` | 生成受控券表与白名单，交接系统草稿 | 冻结 Drive 产物、hash 与引用；自身绝不创建原生 OA | 仅后续受控最终确认路径可即时提升已验证产物；Excel 流程不静默提交 |

三源优惠券流程由 ADR-0005 和相应 PRD 记录为**待完善模板/映射/服务端实现的提议流程**，不得因本内网试点而被表述为可生产提交。

## 3. 已选试点形态、前提与未决项

| 分类 | 内容 |
| --- | --- |
| 已选试点形态 | 企业托管常驻 bridge → 签名 HTTPS → Vercel/Nitro → Base/Drive 草稿/产物；先 draft-only，后由严格 allowlist 进入原生 OA canary。 |
| 上线前必须落实 | bridge 专用认证与重放拒绝、持久 transport 去重/outbox、单消费者、业务幂等、fail-closed stage/allowlist/kill switch、运行监控/告警、资源权限 E2E、回滚和对账演练。 |
| 仍未决定 | 生产关系数据库、持久队列/worker、对象存储、日志/监控平台、生产云/HA、长期 HTTP callback 切换与数据治理方案。 |

“低并发”不免除认证、去重、审计、授权与原生 OA 幂等要求；通过 draft-only 也不授权 native-submit。

## 4. 架构与信任边界

### 4.1 内网试点拓扑

```text
管理员
  → 妙搭管理控制面
  → Nitro 管理 API（服务端复核身份/角色）

业务员 / 审批人
  → 飞书 Bot、消息、Card 2.0
  → Feishu WebSocket event
  → 企业托管 bridge
      - lark-cli consumer
      - durable outbox / retry / health
      - signed, timestamped, nonce-protected envelope
  → Vercel / Nitro ingress
      - bridge authentication / replay rejection
      - persistent transport deduplication
      - server-side stage, owner, revision and allowlist gates
  → 优惠券领域服务
  → Base / Drive（隔离的 POC 草稿与冻结产物）
  → 仅 native-submit gate 全部通过时：飞书 OA API
```

| 层级 | 责任 | 明确不负责 |
| --- | --- | --- |
| 飞书交互层 | 消息、表单、卡片、原生审批与人工路由 | 核心状态、业务授权、自动审批 |
| 妙搭控制面 | 管理员体验、配置、运营查看 | 最终后端授权、工作流状态推进 |
| 企业 bridge | 安全接收/转发、稳定 ID、outbox、运行健康 | 业务规则、OA 提交决策、审批路由 |
| Nitro 执行面 | ingress 校验、权限、状态机、文件/审批 API 编排 | 依赖进程内存/临时磁盘保存关键状态 |
| Base/Drive POC 存储 | 草稿、附件元数据、受控产物引用 | 原子事务锁、生产主库、长期合规存档 |
| 原生 OA | 提交、审批节点和结果 | 被 Bot 代替或被服务端覆盖审批人/抄送人 |

### 4.2 同步/异步边界

当前 Excel 试点可以在受限、低并发任务中同步执行解析/生成，但这只是产品范围，不是可靠接收机制。bridge 与 ingress 必须先持久记录可恢复的事件收据；耗时、重试或不确定的工作需要通过持久状态/lease 恢复，不能用 `waitUntil`、函数内存或 HTTP 200 代替队列语义。

长期 HTTP callback 路径必须在快速验证、事件 ID 去重和持久接收后返回，耗时解析、AI、文件和外部系统调用由持久执行器处理。

## 5. 原生 OA 保护

原生 OA 创建需要当前确认快照、审批定义 hash、提交幂等键和创建后 readback。状态含义为：

- `Submitted`：实例创建与必要 readback 成功；
- `CreatedNeedsReview`：实例存在但 readback 失败或差异，停止自动写入；
- `SubmissionUnknown`（上线前拟实现）：无法证明 create 结果，禁止盲目创建第二笔，必须对账；
- `Failed`：仅在确定未创建原生实例时使用。

应用不得覆盖审批人、抄送人或路由。手动 OA 导航可以作为业务批准的 fallback，但不能绕过自动化阶段门禁。

## 6. POC 与试点非目标

当前不承诺生产 SLA/HA、全员开放、正式财务/客户数据长期存储、生产队列/数据库/对象存储、完整恶意文件扫描、DeepSeek 数据治理、审批状态全生命周期同步或生产管理端身份方案。Drive 下载 403、附件权限、本地测试或历史诊断均不是正式上线证据。

## 7. 迁移/停止触发条件

应停止或缩小试点并处理回滚：重复/越权 OA、未签名请求被接收、无法去重/对账、outbox 积压或认证循环、敏感日志泄露、定义漂移/readback 差异、源文件进入 OA 附件，或运行 Owner 无法判断事件及审批是否已处理。

应启动正式架构迁移：需要扩大到未批准员工、真实受监管数据、稳定中国大陆可用性、可靠异步/死信、企业合规/数据驻留/采购要求，或 Base 无法满足事务与查询需要。正式迁移必须遵从[后续技术选型决策](future-technology-selection.md)与新的 ADR，而不是把此桥接试点直接量产。

## 8. 相关文档

- [ADR-0001：分阶段混合架构](adr/0001-adopt-phased-hybrid-architecture.md)
- [ADR-0002：HTTP 回调事件入口](adr/0002-use-http-callback-as-event-ingress.md)
- [ADR-0003：妙搭控制面与 Vercel 执行面](adr/0003-separate-miaoda-control-plane-and-vercel-execution-plane.md)
- [ADR-0004：系统草稿与确认即提交](adr/0004-bot-confirmed-submit-for-coupon-oa.md)
- [ADR-0006：企业托管长连接内网试点](adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)
- [ADR-0010：本机长连接三源 P0](adr/0010-timebox-local-long-connection-three-source-poc.md)
- [后续技术选型决策](future-technology-selection.md)
- [优惠券内网试点 rollout](oa-ticket-reimbursement-materials/current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md)
- [Bridge 设计](oa-ticket-reimbursement-materials/current/implementation/coupon-oa-managed-bridge-design-v1.md)
