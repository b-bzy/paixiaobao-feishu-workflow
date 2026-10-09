# 优惠券 OA 模块化升级方案 v1

> **状态**：待技术、流程与业务 Owner 评审；仅形成方案，**不授权任何代码、配置、数据表、Bot 入口或原生 OA 行为变更**
> **版本**：v1.0
> **日期**：2026-10-09
> **方案对象**：当前飞书 Bot、优惠券 Excel 试点、系统 OA 草稿、原生 OA 提交及待评审三源填报能力
> **当前基线**：[优惠券 OA 当前功能结构与重构基线](../../current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md)
> **相关架构约束**：[架构基线](../../../architecture-decision.md)、[ADR-0004](../../../adr/0004-bot-confirmed-submit-for-coupon-oa.md)、[ADR-0005](../../../adr/0005-three-source-coupon-workflow.md)、[ADR-0006](../../../adr/0006-use-managed-long-connection-bridge-for-internal-coupon-pilot.md)
> **非替代关系**：本方案不替代当前 P1-1 Excel 试点产品基线、rollout Gate、已接受 ADR 或任何已发布的 Base schema；未获批并实际实施前，当前用户入口与运行方式保持不变。

---

## 1. 背景与结论

当前工程已将优惠券能力拆分为审批 schema、飞书 API、系统草稿、Excel 试点草稿、Excel 生成、文件交接、卡片和提交保护等多个文件。特别是原生 OA 的确认、定义 hash 校验、确定性幂等 UUID、创建后回读等保护逻辑已经形成明确模块，应在后续重构中保留。

但飞书事件总入口 `server/lib/feishu/events.ts` 同时承担消息/卡片解析、流程分发、附件处理、状态机协调、owner/revision 校验、卡片选择及普通报销 POC 兼容。新功能继续直接叠加到该入口，会扩大回归范围，并使 Excel 试点、旧 OA 草稿和待评审三源流程的边界逐渐模糊。

本方案建议采用**渐进式绞杀重构（Strangler Fig）**：先将事件运输层、命令分发、领域规则和外部依赖分离；在旧 Base 表和既有用户入口不变的前提下，逐步建立统一的逻辑任务模型。**不建议一次性重写、删除旧表或直接合并全部状态机。**

### 1.1 目标

1. 将飞书 transport、优惠券流程编排、领域规则、卡片展示和 Feishu/Base/Drive/AI 实现分层。
2. 使后续 Excel 试点优化、对话式一轮确认、三源填报等能力以独立 application service 接入，而不是继续扩大总路由。
3. 将 owner、revision、超时、取消、确认快照、幂等和提交守卫收敛为单一规则来源。
4. 在不改变当前 P1-1 业务范围的前提下，为后续统一 `CouponTask` 和生产级持久化/队列迁移建立接口边界。
5. 保持或增强原生 OA、附件和冻结文件的安全与审计能力。

### 1.2 非目标

本方案本身不包含以下工作：

- 不改变当前 `OA优惠券审批`、`OA优惠券填报`、`优惠券Excel试点` 的用户行为；
- 不注册或启用待评审的 `/OA优惠券提报` 三源入口；
- 不创建、迁移或删除 Base 表；
- 不提升当前 `draft-only` 阶段的原生 OA 权限；
- 不更改审批人、抄送人、审批路由或飞书审批定义；
- 不引入生产数据库、队列、对象存储或新的云平台；
- 不将 AI 用于决定审批、附件归属、名单优先级或提交结果。

---

## 2. 当前结构与主要问题

### 2.1 已有的有效模块边界

| 当前模块 | 已承担的职责 | 重构中的处理原则 |
| --- | --- | --- |
| `feishu/coupon-oa/approval-schema.ts` | 审批定义绑定、表单编码、回读比对 | 保留为核心安全规则，逐步移入 domain/application 边界 |
| `feishu/coupon-oa/approval-client.ts` | 审批定义、审批附件、实例 API | 收敛为 `ApprovalGateway` 的 Feishu adapter |
| `feishu/coupon-oa/draft-store.ts` | 系统 OA 草稿 Base 读写 | 保留为 legacy repository adapter |
| `feishu/coupon-oa/draft-service.ts` | 草稿字段校验、附件分类 | 拆分为领域校验与 application service |
| `feishu/coupon-oa/submit-service.ts` | 确认、提交、回读止损 | 保留安全语义，重构为 `SubmitNativeApproval` 应用服务 |
| `feishu/coupon-oa/excel-pilot-store.ts` | Excel 试点草稿及 revision | 保留为 legacy repository adapter |
| `feishu/coupon-oa/excel-pilot-service.ts` | 字段提取、白名单处理、Excel 生成 | 拆分为输入采集、产物生成和持久化编排 |
| `feishu/coupon-oa/excel-pilot-oa-handoff.ts` | 冻结产物校验、审批附件提升、创建 OA 草稿 | 保留为明确的 handoff 应用服务 |
| `feishu/coupon-oa/cards.ts`、`excel-pilot-cards.ts` | 飞书卡片展示 | 迁入 presentation，保留现有 payload 兼容性 |
| `excel-template-engine/` | Excel 模板、生成、校验、名单解析 | 保持独立，并消除对 Feishu Pilot 类型的反向依赖 |
| `coupon-oa/three-source/` | 三源离线识别、名单规则、确认快照 | 保持纯业务能力；未获批前不得接入线上 Bot |

### 2.2 需要治理的结构性问题

| 问题 | 当前表现 | 后果 | 本方案的处理方向 |
| --- | --- | --- | --- |
| 总路由过重 | `events.ts` 同时处理 transport、报销 POC、优惠券、附件、状态和卡片 | 新功能靠增加分支，改动回归面大 | 拆为 transport、command dispatcher 和 application service |
| 两套草稿状态机 | Excel 试点草稿交接到系统 OA 草稿 | 生命周期、取消、超时、互斥和 owner 校验易重复 | 先形成统一逻辑 `CouponTask` 视图，后续再决定物理存储收敛 |
| 基础设施直连 | service 内同时依赖 `process.env`、Base、Drive、Feishu API、AI | 存储或运行平台替换困难，测试需要大量 mock | 定义 repository/gateway ports，保留现有 Feishu/Base 为 adapter |
| 存储并发约束不足 | revision 是本地检查后再执行 Base PUT | 并发回调可能造成覆盖或副作用重复 | 在 repository contract 中明确 CAS/lease/event-receipt 要求 |
| 模板引擎反向依赖 | Excel 引擎使用 Feishu Excel 试点 schema 类型 | 通用引擎被上层试点语义束缚 | 提取通用优惠券领域类型，调整依赖方向 |
| 试点与 POC 混合 | 普通报销 POC 和优惠券流程共用总路由 | 业务边界和测试边界不清晰 | 先分 dispatcher，后逐步物理隔离 |

---

## 3. 不可退让的架构与安全约束

后续实施无论采用何种目录、语言或存储实现，均必须满足以下约束：

1. **源白名单、源黑名单和任意原始输入文件不得直接进入原生 OA 附件。**
2. 进入审批附件链路的生成文件必须能追溯至同一 revision，且在提升前重新下载并校验大小与 SHA-256。
3. 原生 OA 只能由最终 owner 在当前 revision 的明确确认后创建。
4. 提交前必须重新读取审批定义，并在 `definitionHash` 变化时 fail closed。
5. 原生 OA 创建必须使用稳定幂等键；创建结果不确定时不得盲目创建第二笔。
6. 创建后必须保存实例编号并回读核对；回读失败或差异必须进入人工复核状态，而非标记为成功或可安全重试。
7. 服务端不得篡改飞书审批人、抄送人或审批路由。
8. 任何迁移均不得让旧、新处理器对同一外部副作用执行双写、双上传或双提交。
9. AI 只能输出候选字段、歧义和说明，不能绕过确定性规则或决定业务事实。
10. 当前 rollout Gate、allowlist、kill switch 和 `draft-only` 边界优先于本方案中的任何目标结构。

---

## 4. 目标架构

### 4.1 分层结构

```text
Feishu HTTP / Bridge Ingress
  → Feishu Transport
      - 验证、解析、标准化 event / callback
  → Coupon Command Dispatcher
      - 将用户输入映射为明确命令
  → Coupon Application Services
      - 按用例编排领域规则和外部端口
  → Coupon Domain + Ports
      - 规则、状态、确认快照、接口契约
  ← Feishu / Base / Drive / DeepSeek Adapters
      - 外部 API、Base 数据表、对象与文件实现

Presentation
  - 基于 application outcome 生成飞书 Card 视图
```

### 4.2 依赖方向

目标依赖必须始终单向：

```text
Transport → Application → Domain + Ports
Adapters  → Ports
Presentation → View Models / Domain Read Model
```

明确禁止：

```text
Domain → Feishu API / Base / Drive / HTTP Event / process.env
Excel Template Engine → Feishu Excel Pilot Schema
Application → Nitro Request/Response 对象
```

### 4.3 推荐目录（目标态）

```text
server/lib/
  feishu/
    transport/
      envelope.ts
      callback-parser.ts
      message-dispatcher.ts
    adapters/
      feishu-message-gateway.ts
      feishu-drive-gateway.ts
      feishu-approval-gateway.ts
      bitable-coupon-repository.ts
    bridge-auth.ts

  coupon-oa/
    domain/
      coupon-task.ts
      lifecycle.ts
      artifacts.ts
      confirmation.ts
      submission-policy.ts
      types.ts
    application/
      start-coupon-task.ts
      collect-coupon-input.ts
      handle-source-file.ts
      generate-artifacts.ts
      handoff-to-oa-draft.ts
      confirm-coupon-task.ts
      submit-native-approval.ts
      cancel-coupon-task.ts
      resume-coupon-task.ts
    ports/
      coupon-task-repository.ts
      artifact-storage.ts
      approval-gateway.ts
      message-gateway.ts
      ai-extraction-gateway.ts
      clock.ts
      id-generator.ts
    presentation/
      cards/
      view-models.ts
    legacy/
      legacy-oa-draft-adapter.ts
      excel-pilot-adapter.ts

  excel-template-engine/
    domain-types.ts
    regular-full-reduction.ts
    whitelist.ts
    three-source.ts
    template-manifests.ts

  expense-poc/
    ...
```

该目录是目标参考，不要求一次性移动全部文件。实施阶段应优先保证职责和依赖方向正确，再逐步调整文件位置。

---

## 5. 核心模型与接口建议

### 5.1 统一逻辑任务模型

建议以 `CouponTask` 作为后续工作流的逻辑顶层实体：

```text
CouponTask
  ├─ taskId / ownerOpenId / revision / lifecycleStatus
  ├─ intakeMode
  │   ├─ ManualMaterialIntake
  │   ├─ ExcelPilotIntake
  │   └─ ThreeSourceIntake（待评审，未启用）
  ├─ canonicalBusinessInput
  ├─ sourceFiles
  ├─ generatedArtifacts
  ├─ requiredAttachments
  ├─ confirmationSnapshot
  ├─ approvalSubmission
  └─ auditTrail
```

字段含义：

| 字段 | 用途 |
| --- | --- |
| `taskId` | 跨草稿、文件和审批行为的稳定业务标识 |
| `ownerOpenId` | 唯一业务发起人与最终确认人边界 |
| `revision` | 防止过期卡片、旧确认与并发覆盖 |
| `intakeMode` | 区分手工材料、Excel 试点和后续三源输入，但共享最终确认与提交守卫 |
| `canonicalBusinessInput` | 已确认的业务字段事实，不直接等同于任一飞书卡片或 Excel 原始单元格 |
| `generatedArtifacts` | 已冻结的标准产物、模板版本、文件 hash、文件角色与存储引用 |
| `confirmationSnapshot` | 当前 revision 下用户确认过的字段、附件和业务决定 |
| `approvalSubmission` | 审批定义 hash、请求幂等键、实例编号、回读结果与异常状态 |

### 5.2 物理数据暂不合并

第一阶段只引入逻辑模型，不立即删除或合并：

- `CouponExcelPilotDraft`；
- `CouponOaDraft`；
- Excel 试点 Base 表；
- 系统 OA 草稿 Base 表。

建议先由 `legacy/` 中的 adapter 将两类草稿映射为 `CouponTask` 读取模型。待历史记录兼容、迁移策略、并发控制和审计保留策略明确后，再评估是否建设统一持久化表或迁移至正式数据库。

### 5.3 Ports（接口）

后续实现应优先定义以下稳定契约：

```text
CouponTaskRepository
  - get(taskId)
  - findActiveByOwner(ownerOpenId)
  - create(task)
  - update(task, expectedRevision)

ArtifactStorage
  - uploadFrozenArtifact(...)
  - downloadVerifiedArtifact(...)

ApprovalGateway
  - getDefinition(...)
  - uploadAttachment(...)
  - createInstance(...)
  - getInstance(...)

MessageGateway
  - fetchMessageResource(...)
  - sendCard(...)

AiExtractionGateway
  - extractCouponFields(...)

Clock / IdGenerator
  - now()
  - nextId()
```

### 5.4 并发 contract

`CouponTaskRepository.update(task, expectedRevision)` 必须具备可判定的冲突语义：

```text
成功：保存新 revision，并返回新任务
冲突：返回 RevisionConflict，不执行后续副作用
失败：可判定为未保存 / 保存未知 / 已保存，不能模糊处理
```

若 Base 无法提供真正的条件更新，实施前必须选择并记录下列至少一种保护方式：

1. 持久化 lease / 单任务锁；
2. 持久事件收据与单消费者；
3. 不可变事件记录 + 可恢复执行器；
4. 迁移到支持事务或条件更新的持久化存储。

仅依赖卡片携带的 revision 或内存中的对象比较，不足以构成并发保护。

---

## 6. 分阶段升级路线

## 阶段 0：建立可靠重构基线

### 目的

确保测试、类型检查和架构边界能可信地发现回归，再开始移动职责。

### 建议工作

1. 固定 Vitest 扫描范围，排除 `.claude/worktrees/` 等嵌套工作目录。
2. 修复妙搭管理端 React、React DOM、Vite 环境类型，使全量 `pnpm typecheck` 成为可靠门禁。
3. 为下列关键路径形成稳定测试：
   - Excel 试点状态转移；
   - Excel → 系统 OA 草稿交接；
   - 重复消息、重复回调和重试；
   - owner/revision 不一致；
   - 过期卡片；
   - 文件 hash 不一致；
   - 审批定义变化；
   - 原生 OA 创建后的回读异常；
   - native-submit kill switch 与 allowlist；
   - `CreatedNeedsReview` 不重复创建 OA。
4. 增加依赖方向检查：domain 不得 import Feishu；模板引擎不得 import pilot schema；transport 不得承载领域状态转移。

### 验收条件

- `pnpm test` 只执行当前工作树的测试；
- `pnpm typecheck` 全量通过；
- 核心安全规则有单元或合同测试；
- 后续重构可以用自动化回归证明不改变当前行为。

---

## 阶段 1：拆分飞书总路由

### 目的

将现有 `events.ts` 从“全业务实现”降级为 transport 与分发入口。

### 建议拆分

```text
FeishuEventDispatcher
  ├─ handleMessageEvent()
  │   ├─ dispatchCouponMessage()
  │   └─ dispatchExpenseMessage()
  └─ handleCardAction()
      ├─ dispatchCouponAction()
      └─ dispatchExpenseAction()
```

优惠券侧再按命令拆分：

```text
CouponCommandDispatcher
  ├─ StartManualOaEntry
  ├─ StartLegacyDraft
  ├─ StartExcelPilot
  ├─ SaveLegacyDraft
  ├─ UploadCouponMaterial
  ├─ ConfirmPilotInput
  ├─ ConfirmPilotOutput
  ├─ ConfirmOaDraft
  ├─ SubmitNativeOa
  └─ CancelWorkflow
```

### 约束

- 用户口令、卡片 action 名称、`value` / `form_value` payload 和外部响应保持兼容；
- 不得在此阶段改变状态机、Base 字段、附件时机或 OA 提交时机；
- 每迁移一个 command，增加“旧 payload → 新处理器 → 等价 outcome”的契约测试；
- 普通报销 POC 与优惠券流程至少在 dispatcher 层分离。

### 验收条件

- `events.ts` 不再包含优惠券的具体状态机规则；
- 一个 Card action 只映射一个命令处理器；
- 运输错误、业务错误和卡片展示错误可区分；
- 现有飞书交互兼容测试通过。

---

## 阶段 2：提取 Coupon Domain 与 Application Service

### 目的

使核心业务规则脱离 HTTP、Feishu API、Base、Drive、AI 配置和卡片结构。

### 建议的领域能力

```text
canStartTask(...)
canAcceptAttachment(...)
canConfirm(...)
canSubmit(...)
transition(...)
invalidateConfirmation(...)
isTaskIdle(...)
isCancelable(...)
```

应优先从现有路由、生命周期 helper、草稿服务和 store 周边迁出：

- owner 校验；
- revision 校验；
- 空闲超时与取消；
- 活跃流程互斥；
- 合法状态转移；
- 文件角色完整性；
- 确认快照失效；
- 是否可进入原生 OA 提交。

### 建议的应用服务

| 应用服务 | 编排职责 | 不应承担 |
| --- | --- | --- |
| `StartCouponTask` | 创建或恢复任务 | 直接读取 HTTP event |
| `CollectCouponInput` | 接收文本/字段候选并更新任务 | 发送飞书卡片 |
| `HandleSourceFile` | 下载、校验、归类输入文件 | 决定审批路由 |
| `GenerateArtifacts` | 调用模板引擎生成并冻结产物 | 直接依赖 Base schema |
| `HandoffToOaDraft` | 校验冻结产物并形成 OA 草稿 | 创建原生 OA |
| `ConfirmCouponTask` | 绑定确认快照与审批定义 | 直接写 HTTP response |
| `SubmitNativeApproval` | 受控创建、持久化、回读 | 决定业务字段事实 |
| `CancelCouponTask` | 处理可取消状态和审计记录 | 删除历史文件或 OA 实例 |

### 验收条件

- owner、revision、超时和状态转换只有一个规则来源；
- 领域函数不读取 `process.env`，不调用 `fetch()`，不发送卡片；
- application service 只依赖 domain 和 ports；
- 新流程可以复用任务生命周期而不复制状态机判断。

---

## 阶段 3：引入 Ports 与 Feishu/Base Adapters

### 目的

将业务步骤与基础设施实现分离，为 Base、Drive、审批 API 和 AI 服务替换创造边界。

### 迁移映射

| 当前实现 | 建议迁移后的定位 |
| --- | --- |
| `approval-client.ts` | `FeishuApprovalGateway` |
| `drive-client.ts` | `FeishuDriveGateway` |
| `message-client.ts` | `FeishuMessageGateway` |
| `deepseek-client.ts` | `DeepSeekExtractionGateway` |
| `draft-store.ts` | `LegacyCouponOaDraftRepository` |
| `excel-pilot-store.ts` | `LegacyCouponExcelPilotRepository` |
| `excel-pilot-service.ts` | 多个 application service + ports 调用 |
| `excel-pilot-oa-handoff.ts` | `HandoffToOaDraft` application service |
| `submit-service.ts` | `SubmitNativeApproval` application service |

### 迁移规则

1. 先定义 port 和测试替身，再将现有 Feishu/Base 实现包裹为 adapter；
2. 不在同一个变更中同时替换 repository 与修改业务规则；
3. 外部副作用必须记录计划、执行、返回值与失败状态；
4. 对于创建审批实例、上传审批附件等不可逆操作，adapter 必须返回足以对账的稳定标识；
5. 对每个 port 建立异常分类：确定未执行、已执行、执行未知、可重试、人工复核。

### 验收条件

- application service 不直接调用 Feishu REST API；
- Base/Drive/审批 API 可以被 in-memory 或 fake adapter 替换；
- 外部服务故障不会被误判为安全可重试；
- 旧 Base 表继续可读写，迁移期间不破坏历史审计。

---

## 阶段 4：收敛 Excel 模板引擎与通用业务类型

### 目的

使 `excel-template-engine` 成为可被 Excel 试点、三源流程和未来后台批处理共用的纯本地模块。

### 建议工作

1. 将 `CouponPilotInput`、`CouponPilotChannel`、`CouponPilotComputedValues` 等通用概念迁移或映射到 `coupon-oa/domain/`；
2. 使模板引擎只依赖通用优惠券输入、计算值、模板 manifest 和字节流；
3. 保持模板引擎只负责：
   - 模板读取；
   - 单元格写入；
   - 文件生成；
   - 生成后校验；
   - 候选列识别；
   - SHA-256 与模板版本输出；
4. 禁止模板引擎负责：
   - 飞书消息下载；
   - Drive 上传；
   - Base 附件写入；
   - 卡片交互；
   - 原生 OA 提交。

### 验收条件

- Excel 引擎不 import `feishu/coupon-oa/*`；
- 三源离线逻辑可复用同一模板能力；
- 模板引擎可以在无 Feishu 凭据、无 Nitro 环境下完成测试。

---

## 阶段 5：在批准后接入三源流程

> **前置条件**：三源 PRD、正式白/黑名单模板、字段映射、OA 截图生成规则、上线 Gate 和服务端实现范围均已评审通过。未满足前，本阶段不得启动。

### 接入原则

三源流程不得新增“第三套顶层草稿 + 第三套事件总路由分支”。推荐接入为：

```text
CouponTask
  ├─ ManualMaterialIntake
  ├─ ExcelPilotIntake
  └─ ThreeSourceIntake
```

### 三源模块的职责边界

保留 `coupon-oa/three-source/` 当前纯业务能力，用于：

1. 识别配券表、白名单、黑名单来源与候选；
2. 构建第一次业务确认；
3. 处理黑名单缺省确认和名单重叠决策；
4. 生成标准数据包与标准附件；
5. 构建 OA 预填快照；
6. 将最终提交交给统一的 `SubmitNativeApproval` 守卫。

### 必须保持的门禁

- 第一次业务确认与最终 OA 确认不可合并；
- 未上传黑名单必须显式确认，不得静默视为无黑名单；
- 白黑名单重叠必须显式选择处置策略；
- 任一源材料、映射、产物或模板版本变化后，旧确认必须失效；
- 三源流程不得绕过现有原生 OA 提交、definition hash、allowlist、kill switch 和回读逻辑。

---

## 阶段 6：试点扩容后的运行时演进

此阶段不属于当前 P1-1 或本次模块拆分的必做项，仅在试点规模、耗时或并发达到触发条件时评估。

### 可能的后续能力

- 持久事件收据与 transport 去重；
- outbox、任务队列、lease 和恢复器；
- 文件解析/生成/上传异步化；
- 审批创建未知结果的对账器；
- 更适合并发和查询的正式数据库；
- Base 作为运营视图或审计镜像；
- 指标、告警、死信与人工复核工作台。

### 启动条件

出现任一情况时，应停止仅靠同步 Base 流程扩展，并评估本阶段：

- 多业务员并发导致 revision 冲突或重复回调难以治理；
- 文件处理超过同步入口可承受时限；
- 无法可靠判断外部副作用是否已执行；
- 活跃草稿查询、分页和审计已超过 Base 适用范围；
- 试点扩大到真实受监管数据或更高可用性要求。

---

## 7. 兼容、灰度与回滚

### 7.1 用户与数据兼容

阶段 1–4 必须维持：

- 现有用户口令不变；
- 现有 Card action 名称不变；
- 现有 `value` 和 `form_value` 格式不变；
- 当前 Base 记录可继续读取、恢复和审计；
- 已开始的 Excel 试点或 OA 草稿能由对应 legacy adapter 完成、取消或超时结束；
- 不引入新的用户确认步骤，也不减少现有安全确认步骤。

### 7.2 切换策略

按**命令/用例粒度**切换，禁止对同一动作让旧、新实现并行执行：

```text
旧 Dispatcher
  ├─ Start / Resume              → 可先切新路径
  ├─ Input / Attachment handling → 验证后切新路径
  ├─ Excel generation            → 验证后切新路径
  ├─ Handoff                     → 验证后切新路径
  └─ Native OA submit            → 最后切换
```

原生 OA 提交是最高风险能力，应仅在以下条件持续满足时切换：

- native-submit Gate 已开放；
- kill switch 与 allowlist 生效；
- definition hash、稳定幂等键和 readback 均在新链路实现；
- 有可用的实例对账和人工复核处理；
- 旧提交链路可作为逻辑与测试参照，但不可与新链路对同一任务双提交。

### 7.3 回滚原则

1. 新路径异常时，仅将**后续新任务**切回旧 dispatcher；
2. 已进入外部副作用阶段的任务不得通过“重新开始”来回滚；
3. 已有 `instance_code` 或提交结果未知的任务必须对账，不得自动再次创建 OA；
4. 回滚不得删除历史 Base 记录、冻结文件或已创建审批实例；
5. 每次切换和回滚均应保留任务 ID、revision、处理器版本和操作日志。

---

## 8. 测试与验收策略

### 8.1 分层测试

| 测试层 | 重点 | 示例 |
| --- | --- | --- |
| Domain unit test | 纯规则和状态转移 | owner/revision、超时、确认失效、附件完整性 |
| Application unit test | 业务编排与 ports 调用顺序 | 生成、handoff、确认、提交异常分类 |
| Adapter contract test | Feishu/Base/Drive 请求与响应映射 | token、分页、文件上传、审批实例、Base 字段 |
| Transport contract test | 飞书原始 payload 到 command/outcome | 消息、文件、表单、按钮回调、错误响应 |
| Compatibility test | 旧卡片与旧草稿可继续处理 | 旧 action、旧 Base record、处理中任务 |
| Isolated E2E rehearsal | 脱敏/隔离环境中的可恢复链路 | 生成 → 冻结 → handoff，原生 OA 前停止或使用隔离定义 |

### 8.2 重构完成的最低验收线

1. 正常 P1-1 用户仍可完成字段采集、白名单映射、两份 Excel 生成和确认；
2. 源文件始终不进入 OA 审批附件；
3. 两份审批附件可追溯至同一冻结 revision 并通过 hash 校验；
4. 旧卡片、重复回调、跨设备并发和超时重试不产生重复附件或重复 OA；
5. 审批定义变化后，旧确认无法创建原生 OA；
6. 原生 OA 创建后必定保存实例编号并回读；回读异常不标记成功；
7. 每笔任务可定位 owner、revision、确认时间、文件 hash、审批定义 hash、处理器版本和实例结果；
8. `pnpm test`、`pnpm typecheck`、lint 和新增的隔离演练均稳定通过。

---

## 9. 建议的评审决策顺序

在开始任何代码实施前，建议依次确认：

1. **技术 Owner**：认可渐进式重构，不做大爆炸替换；
2. **流程 Owner**：确认重构期间当前 P1-1 交互、确认次数和 OA Gate 不变；
3. **架构 Owner**：确认 `CouponTask` 是逻辑统一模型，不代表立刻合并 Base 表；
4. **安全/运行 Owner**：确认提交守卫、文件冻结、definition hash、readback 和对账要求不可降级；
5. **产品 Owner**：明确三源流程、一轮确认等提议仍需各自审批，不能因模块化改造自动上线；
6. **实施 Owner**：先完成阶段 0 的验证基线，才进入事件拆分。

若任一决策要求改变事件入口、事实源、原生 OA 提交时机、文件归属或正式部署平台，应按照现有文档治理规则新增或更新 ADR、rollout 与当前实现基线。

---

## 10. 预期产物（获批后）

本方案获得批准并进入实施时，预计会形成下列产物；本清单不是当前授权的执行任务：

- 事件 transport 与 command dispatcher 的模块拆分；
- `CouponTask`、生命周期、确认快照和提交策略的领域模型；
- repository、Drive、Approval、Message、AI 等 port contract；
- Feishu/Base/Drive adapter 实现与合同测试；
- legacy OA 草稿和 Excel 试点的映射 adapter；
- Excel 模板引擎脱离 Feishu Pilot schema 的类型调整；
- 当前功能结构与重构基线、测试规范、rollout/ADR 的必要同步；
- 三源流程获批后对统一任务模型的独立接入方案。

---

## 11. 变更记录

| 日期 | 版本 | 变更 | 适用状态 |
| --- | --- | --- | --- |
| 2026-10-09 | v1.0 | 首次形成优惠券 OA 模块化升级、兼容迁移、验收和回滚方案 | 待评审；未执行 |
