# 三源优惠券直接 HTTP draft-only POC 运行手册 v1

> **状态**：待相关 Owner 审阅的单用户、限时测试部署手册；不是 R1/R2/R3、生产上线或原生 OA 授权。
> **日期**：2026-10-10
> **适用拓扑**：飞书开发者服务器回调 → Vercel `/api/feishu/process` → 严选三源 Bot → OA 测试稿。
> **权威边界**：[ADR-0009](../../../adr/0009-timebox-direct-http-callback-for-three-source-draft-poc.md)；P0 开发范围以[最快 Bot POC 交付计划](../../proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md)为准；与本手册冲突时以 ADR 和 rollout 为准。

## 0. 目的与非目标

本手册固定一个轻量测试部署方式：不运行企业托管常驻 bridge，直接由飞书向 Vercel 的 `POST /api/feishu/process` 发送事件。它只验证一个严格 allowlist 测试用户从精确命令 `/OA优惠券提报` 到**既有 OA 测试稿**的闭环。

```text
精确命令 + 三源 .xlsx
  → 材料/映射/无黑名单/交集卡片
  → 严选标准 Excel 产物
  → OA 测试稿和预览
```

本手册不允许：真实原生 OA 创建、R2/R3 Gate 声明、多人或群聊协作、批量操作、长连接 bridge、持久化/恢复能力声明，或把本地 Claude Code Skill 当成 Vercel 自动运行代码。

## 1. 已实现范围与 Skill 差异

### 1.1 本 POC 可以验证的能力

| 需求 | POC 行为 |
| --- | --- |
| 发起 | 仅接受精确规范化后的 `/OA优惠券提报`。 |
| 材料 | 接收 `.xlsx` 配券表、必传 SKU 白名单、可选 SKU 黑名单；允许乱序。单文件最大 10 MB。 |
| 角色/映射 | 文件角色不唯一时由 owner 选择；歧义字段、SKU 列、券档列和默认券档由卡片确认。 |
| 业务决定 | 未上传黑名单时必须确认“本次无黑名单”；白黑名单重叠时必须选择白名单优先、黑名单优先或更换源文件。 |
| 当前首期范围 | 仅常规满减券、`严选`、SKU 名单和已登记多券档模板。`寄卖`、`pop` 在生成前拒绝。 |
| 产物 | 生成同 revision 的标准配券表、标准白名单和（如上传）标准黑名单；保存 file metadata 与 SHA-256。 |
| OA 交接 | 从 Drive 重新下载冻结产物并校验 hash 后，创建既有 OA 测试稿及预览卡。源文件不会直接成为 OA 附件。 |

### 1.2 不能当作已实现的本地 Skill 合同

| 本地 Skill 合同 | 当前 POC 状态 |
| --- | --- |
| `calcImage`：从已验证标准配券表完整渲染的必传截图 | **未实现**。严选首期明确不生成/不接收该附件。 |
| 缺失 OA 字段的最小补充，以及有原因的显式字段覆盖 | **未实现**；当前只收集活动点位和候选列选择。 |
| SKU、SPU、商家 ID 的确认后处理 | **仅 SKU**；识别到 SPU/商家 ID 仍会在解析时阻断。 |
| 最终预览中完整展示字段来源、覆盖、计算、黑名单/重叠决定、行数和 blocker | **部分实现**；三源预览只展示核心摘要和附件 hash。 |
| 同一角色的多份源文件由 owner 二选一 | **部分实现**；当前选择角色会替换同角色来源并产生新 revision，没有独立二选一卡片。 |
| “优惠券提报”等自然语言别名 | **未实现**；测试必须输入精确命令。 |
| 事件 receipt/outbox、重试、DLQ、重放恢复与 R3 原生 OA | **未实现且不允许**。 |

因此，完成本手册不等于“本地 Skill 完整迁移到飞书”，只等于已验证该受限 Bot 子集。

## 2. 部署前边界

### 2.1 环境变量

所有值仅在 Vercel 的受控环境变量中维护。不要把值粘贴进仓库、文档、截图、命令历史或聊天记录。

| 变量 | POC 要求 |
| --- | --- |
| `FEISHU_APP_ID`、`FEISHU_APP_SECRET` | 现有测试 App 的服务端凭据，供 Bot、Base、Drive 和 Approval API 调用。 |
| `FEISHU_VERIFICATION_TOKEN` | 与飞书开发者服务器配置完全一致；缺失或不一致时回调必须失败。 |
| `FEISHU_RUNTIME_STAGE` | 必须是 `local`；`direct-http-draft-poc` 不是一个 runtime stage。 |
| `FEISHU_LEGACY_POC_ENABLED` | 保持 `false`；local stage 已足以允许该 legacy POC 路径。 |
| `FEISHU_COUPON_OA_MODE` | 为复用既有 OA 测试稿交接设为 `native-submit`；它本身**不**授权创建 OA。 |
| `FEISHU_COUPON_OA_ALLOWED_OPEN_IDS` | 只包含本次唯一测试用户。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED` | 必须是 `false`。这是本 POC 最重要的 kill switch。 |
| `FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS` | 保持为空，或仅保留测试用户；无论哪种，native kill switch 都必须关闭。 |
| `FEISHU_COUPON_OA_APPROVAL_CODE`、`FEISHU_COUPON_DRAFT_TABLE_ID`、既有 OA Base 配置 | 使用已经验证的 OA 测试稿配置；不得改为非隔离审批定义。 |
| `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED` | 发布完成后先为 `false`；仅在明确测试窗口临时设为 `true`。 |
| `FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN`、`FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID`、`FEISHU_COUPON_THREE_SOURCE_PILOT_FOLDER_TOKEN` | 使用已创建的三源专属 Base/表和 Drive 文件夹；不得复用 legacy Excel 试点资源。 |

`FEISHU_COUPON_OA_MODE=native-submit` 的唯一原因是现有三源 handoff 拒绝 `draft-demo`。实际原生写入仍被 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 拦截；不可因为测试稿可创建而打开该开关。

### 2.2 飞书开发者后台

由应用管理员在测试 App 上完成，所有修改只面向测试可见范围：

1. 选择“将事件发送至开发者服务器”作为唯一事件接入方式，回调 URL 为：
   ```text
   https://<已部署域名>/api/feishu/process
   ```
2. 填写与 Vercel 环境变量相同的 Verification Token，完成 URL challenge；challenge 成功只证明地址与 token 可用，不证明事件 durable-accept。
3. 订阅 `im.message.receive_v1` 和 `card.action.trigger`，并按应用发布流程使测试 Bot 对唯一测试用户可见。
4. **关闭事件加密**。当前服务端未实现加密事件解密；启用后不得继续测试。
5. 不保留本机 `lark-cli`、旧 bridge 或第二个 HTTP consumer 为活动接入方；避免事件双投递或来源不明。
6. 不扩大权限或可见范围来解决配置问题。缺少消息、卡片、文件下载、Base 或 Drive 所需权限时先关闭 POC，交由应用管理员最小化评审。

## 3. 发布与启动顺序

1. 在独立、可审阅的发布版本上部署；不得把当前工作区无关改动作为 POC 副作用一同发布。
2. 仅写入第 2.1 节所列配置名称对应的受控值；发布后再次核对 native kill switch 为 `false`、pilot flag 为 `false`。
3. 访问部署健康端点或既有应用健康页面，确认 Vercel 可达。此结果不等同于飞书回调工作。
4. 按第 2.2 节保存开发者服务器回调并通过 challenge。
5. 在明确记录的短测试窗口内，只为唯一测试用户打开 `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=true`；其他用户继续被 allowlist 拒绝。

## 4. 单次 E2E 验证

测试材料必须使用已授权、脱敏的 `严选` 常规满减券 fixture；不要把真实敏感业务材料作为首次 POC 样本。

1. **入口**：测试用户在测试 Bot 单聊发送精确文本 `/OA优惠券提报`，收到材料收集卡。
2. **三源材料**：发送原始配券表与 SKU 白名单 `.xlsx`；可另行发送 SKU 黑名单。确认来源文件不会成为 OA 附件。
3. **黑名单**：若未发送黑名单，只能由 owner 点击“确认本次无黑名单”；上传但无效时必须停下修复，不能改按无黑名单处理。
4. **映射**：选择所有歧义字段/名单列，填写 OA 活动点位。若名单重叠，选择业务决定或返回替换源文件。
5. **产物**：确认生成标准 Excel。记录脱敏的 revision、附件角色和 hash 前缀；严选不应要求上传或生成截图。
6. **测试稿**：点击“确认并创建 OA 测试稿”，收到既有 OA 草稿预览卡。此处是本 POC 的成功终点。
7. **禁止最终提交**：不要点击既有 OA 草稿预览卡中的正式发送动作。核对 native kill switch 仍是 `false`，且审批中心没有本次新增原生实例、草稿记录没有 instance code/link。
8. **关闭窗口**：将三源 pilot flag 设回 `false`，保存不含 token、完整 open ID、原始 payload 或附件内容的测试结论。

成功标准是“标准附件 + OA 测试稿存在，且没有原生 OA 实例”。不是“用户点击了正式发送卡”，更不是“Vercel 返回了 HTTP 200”。

## 5. 停止条件、故障与回滚

以下任一情况都不是可直接重试的成功路径：challenge/Verification Token 失败、回调超时、重复事件或卡片点击、Vercel 重启、Base/Drive/下载失败、同一用户出现两个活动任务、回调加密、敏感日志、陌生用户副作用，或任何原生 OA 创建迹象。

立即执行：

1. 确认 `FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`；如有疑义先关闭所有优惠券 pilot flag。
2. 关闭 `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED`；必要时移除飞书事件订阅或开发者服务器回调。
3. 不重复点击、不盲目重新发送、不用第二个 consumer 补收事件。直接 HTTP 路径没有可证明的 receipt/outbox 恢复合同。
4. 只记录脱敏的时间窗、部署版本、事件类型、状态、revision、hash 前缀和已采取动作；不得保存 token、签名、完整 payload、文件 key、完整 open ID 或附件内容。
5. 人工检查并处理已生成的 OA 测试稿；禁止为了验证或补偿而创建真实 OA。

## 6. 证据与退出

每次测试窗口至少保留：环境名称、部署 revision、测试时间、测试 Owner、allowlist 已限制的证明、challenge 结果、材料/卡片各阶段结果、Base/Drive 标准产物的脱敏引用、OA 测试稿状态、native kill switch 状态，以及“未发生原生 OA 创建”的核对结论。

POC 完成后，应关闭三源 pilot flag；若不再继续测试，同时移除开发者服务器事件订阅。后续若要扩大能力，必须新建评审：截图/字段完善是业务实现工作；耐久 ingress、任务、outbox、effect receipt、native canary 和 `SubmissionUnknown` 对账必须按 [ADR-0007](../../../adr/0007-adopt-durable-control-plane-for-coupon-pilot.md) 另行完成。
