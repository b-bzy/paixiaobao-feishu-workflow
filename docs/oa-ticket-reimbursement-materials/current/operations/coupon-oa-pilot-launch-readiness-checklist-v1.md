# 优惠券 OA 内网试点上线 Readiness Checklist v1

> **使用方式**：每项必须填 Owner、环境、日期、证据引用、审阅人和复核到期日；空项或“口头确认”均视为未通过。
> **安全**：证据不得包含 secret、原始 payload、完整员工标识、附件内容或可用于重放的签名材料。
> **阶段权威**：[内网试点 rollout 计划](coupon-oa-internal-pilot-rollout-plan-v1.md)

## 0. 记录信息

| 项目 | 值 |
| --- | --- |
| 目标 Ring | R0 / R1 / R2 / R3 / R4 |
| 环境 | 测试 / 内网试点 |
| 变更版本 |  |
| 计划窗口 |  |
| 业务 Owner |  |
| OA 流程 Owner |  |
| 飞书应用管理员 |  |
| 平台/安全 Owner |  |
| Bridge 运行 Owner / 值守人 |  |
| 工程 / QA Owner |  |
| 结论 | Go / No-go / 待补证据 |

## 1. 文档、范围与数据

| 检查项 | Ring | Owner | 状态 | 证据/审阅/复核日期 |
| --- | --- | --- | --- | --- |
| ADR-0006 已接受，ADR-0002 仍被标注为长期 HTTP callback 目标 | R1+ |  | ☐ |  |
| 三路线语义在 README、PRD、rollout 与卡片/实现说明中一致 | R1+ |  | ☐ |  |
| 试点用户上限、allowlist、时间窗和数据分类获批准 | R1+ |  | ☐ |  |
| 真实业务数据、Drive/Base 访问与保留/删除责任获数据 Owner 批准 | R2+ |  | ☐ |  |
| 三源流程仍标为待模板/字段映射完成，未被误称为已上线 | R1+ |  | ☐ |  |
| 文档与运行证据均未暴露 secret、原始附件或敏感人员数据 | R1+ |  | ☐ |  |

## 2. Fail-closed 配置与服务端授权

| 检查项 | Ring | Owner | 状态 | 证据/审阅/复核日期 |
| --- | --- | --- | --- | --- |
| 未设置/非法/冲突的 launch stage 默认拒绝 native submit | R1+ |  | ☐ |  |
| global native-submit kill switch 已部署、默认关闭且已演练 | R1+ |  | ☐ |  |
| allowlist 是服务端资源；不依赖卡片隐藏或前端变量 | R1+ |  | ☐ |  |
| 非 allowlist 用户在发起、附件、callback、确认、提交均被拒绝 | R1+ |  | ☐ |  |
| 仅批准的 native approval code 可用于提交 | R3+ |  | ☐ |  |
| owner、当前 revision、附件、definition hash 与业务幂等 claim 均在服务端复验 | R3+ |  | ☐ |  |
| draft-only 审计/API 证据证明无 `POST /approval/v4/instances` | R2 |  | ☐ |  |

## 3. 企业托管 bridge 与 ingress

| 检查项 | Ring | Owner | 状态 | 证据/审阅/复核日期 |
| --- | --- | --- | --- | --- |
| 宿主为企业托管 VM/容器、非 root 服务账号和持久加密卷 | R1+ |  | ☐ |  |
| lark-cli 与凭据受管理、版本固定、轮换和回退已定义 | R1+ |  | ☐ |  |
| 两类 consumer 由 supervisor 独立监控与退避重启 | R1+ |  | ☐ |  |
| bridge 专用 HMAC、key ID、时钟窗口、nonce/replay 防护已验证 | R1+ |  | ☐ |  |
| Nitro 拒绝未签名、错误 key、错误签名、过期与重放请求 | R1+ |  | ☐ |  |
| 稳定 event/card callback ID 被保留并进入持久 transport 去重 | R1+ |  | ☐ |  |
| outbox 可承受 Nitro/Vercel 中断，重放不会重复副作用 | R1+ |  | ☐ |  |
| 单活动消费者已落实；未启用未经设计的多副本 | R1+ |  | ☐ |  |
| 监控/告警覆盖存活、活动、outbox、重连、认证、拒绝和延迟 | R1+ |  | ☐ |  |
| runbook 已由非实现者走读并完成 bridge/Vercel 故障演练 | R1+ |  | ☐ |  |

## 4. 飞书资源、权限与运行证据

| 检查项 | Ring | Owner | 状态 | 证据/审阅/复核日期 |
| --- | --- | --- | --- | --- |
| 应用版本发布且管理员审批；Bot 可见范围限制为试点用户 | R1+ |  | ☐ |  |
| 消息事件与 Card action 可由 managed bridge 接收 | R1+ |  | ☐ |  |
| Base：普通 OA 草稿表与 Excel pilot 专用表均为独立、正确权限资源 | R2+ |  | ☐ |  |
| Drive：生成文件夹上传、读取/下载与协作者权限已验证 | R2+ |  | ☐ |  |
| 消息资源下载、Base 读写、Drive 上传/下载、附件上传均有当前环境证据 | R2+ |  | ☐ |  |
| 审批定义 read、目标 approval code、definition hash、用户发起资格、`is_external=false` 已验证 | R3+ |  | ☐ |  |
| create/get instance 及附件上传在隔离审批定义完成 E2E | R3+ |  | ☐ |  |
| 撤回/驳回、人工对账和审批状态同步责任人已确认 | R3+ |  | ☐ |  |

## 5. 流程、幂等与 E2E

| 检查项 | Ring | Owner | 状态 | 证据/审阅/复核日期 |
| --- | --- | --- | --- | --- |
| 每条启用路线有至少三次正常 E2E，结果可回溯 | R2+ |  | ☐ |  |
| 重复事件、旧卡、重复点击、HTTP 回应丢失、bridge/Nitro 重启均不重复副作用 | R2+ |  | ☐ |  |
| Excel 试点只提升冻结产物；源白名单从不成为 OA 附件 | R2+ |  | ☐ |  |
| 产物 hash、revision、template version 和 Drive/Base 引用可核对 | R2+ |  | ☐ |  |
| Base/Drive/AI/文件下载故障返回安全用户提示并可恢复 | R2+ |  | ☐ |  |
| 业务 idempotency key 在 create 前持久占用；并发动作只产生一个实例 | R3+ |  | ☐ |  |
| `Submitting`、`SubmissionUnknown`、`CreatedNeedsReview` 可见、可告警、可对账 | R3+ |  | ☐ |  |
| definition hash drift、readback mismatch、未知 create 均 fail closed | R3+ |  | ☐ |  |
| manual/API route comparison 在隔离定义完成，报告无未解释差异 | R3+ |  | ☐ |  |

## 6. Canary、回滚与签核

| 检查项 | Ring | Owner | 状态 | 证据/审阅/复核日期 |
| --- | --- | --- | --- | --- |
| R3 仅包含 1–2 名具名 canary 和有值守的窗口 | R3 |  | ☐ |  |
| kill switch、关闭 bridge、冻结 allowlist、outbox 保留与对账已演练 | R3+ |  | ☐ |  |
| 重复 OA、越权、签名异常、readback 差异、未知提交、积压、敏感日志均为立即暂停条件 | R3+ |  | ☐ |  |
| 业务/OA Owner 已检查 canary 的字段、附件、申请人、节点和路由 | R3 |  | ☐ |  |
| R4 扩容名单、观察期、复核日期与关闭条件已获批准 | R4 |  | ☐ |  |
| 本阶段结论由业务、应用、工程、运行/安全 Owner 共同签核 | All |  | ☐ |  |

> 任一必填项未通过即 No-go。通过 R2 不授权 R3；通过 R4 不构成生产批准。
