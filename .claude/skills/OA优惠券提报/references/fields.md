# 优惠券 OA 综合字段与状态字典

> **contractVersion**：`coupon-oa-unified-v1`。
> **定位**：统一 Claude Code 本地评审与拟议飞书 Bot 路线的业务合同；它不是当前线上 schema、飞书 OA 控件定义或 native-submit 授权。
> **权威性**：当前已生效的产品和上线能力以 `docs/adr/`、`docs/oa-ticket-reimbursement-materials/current/` 为准；三源字段和飞书适配以相应 proposal 获批后才可提升。
> **关联 Skill**：[OA优惠券提报](../SKILL.md)。

## 1. 支持状态与执行平面

| 标记 | 含义 |
| --- | --- |
| `local_review` | Claude Code 可用于本地审阅/底稿；不得产生飞书副作用 |
| `proposed_bot` | 飞书 Bot 目标合同；需要服务端实现、权限和 Gate，当前不能宣称上线 |
| `approved_runtime` | 只有被 `current/` 文档、服务端实现和 rollout Gate 同时证明后才可使用 |
| `needs_owner_confirmation` | 业务/流程/模板 Owner 必须确认，未确认时为 `blocker` 或最小化追问 |

当前首期三源离线切片仅证明“常规满减券 + SKU + 已登记多券档模板”的零副作用逻辑。字段模型可以表达的 SKU、SPU、商家 ID 不等于它们均已可在 Bot 路线使用。

## 2. 顶层任务与 revision

```json
{
  "taskId": "COT-uuid",
  "ownerOpenId": "ou_...",
  "executionPlane": "local_review | proposed_bot",
  "status": "Collecting | AwaitingSourceConfirmation | GeneratingArtifacts | AwaitingFinalConfirmation | Submitted | CreatedNeedsReview | SubmissionUnknown | Failed | Canceled",
  "revision": 1,
  "schemaVersion": "coupon-oa-unified-v1",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

- 一个 task 只能有一位 `ownerOpenId`；飞书运行时以最终确认人的不可变 `open_id` 为申请人身份事实。
- 源文件、映射、补充/覆盖、黑名单状态、重叠决定、模板或产物变化均使 `revision` 递增。
- 旧 revision 的确认、产物、卡片 action 和 submission intent 全部失效；服务端不能从卡片 payload 恢复旧值。

## 3. 源材料与黑名单状态

### 3.1 文件引用

```json
{
  "role": "couponTable | whitelist | blacklist | calcImage",
  "fileName": "string",
  "sha256": "hex",
  "bytes": 0,
  "sourceRef": "local path or server-side Feishu resource reference",
  "sheetName": "string | null",
  "column": "A | null",
  "header": "sku | null",
  "idDimension": "SKU | SPU | MERCHANT_ID | unresolved",
  "mappingVersion": "string",
  "receivedBy": "open_id | local operator",
  "receivedAt": "ISO-8601"
}
```

- 配券表和白名单为必传 `.xlsx`；黑名单是可选 `.xlsx`；`calcImage` 必须从同一 revision 已验证、已填充的标准配券表完整渲染并记录源产物与图片 hash，不解读图片中的业务事实。
- 同一角色多份文件必须由 owner 选择采用或显式替换；不得按收到时间或文件名静默覆盖。
- 源文件是只读 provenance 输入，**不**是审批附件。

### 3.2 黑名单状态

| 值 | 含义 | 是否可生成标准产物 |
| --- | --- | ---:|
| `uploaded` | 已上传并确认 Sheet、列、ID 维度 | 是 |
| `absent_pending_confirmation` | 未上传且尚未确认无黑名单 | 否 |
| `absent_confirmed` | owner 明确确认“本次无黑名单” | 是；不生成空黑名单附件 |
| `invalid` | 已上传但打不开、为空、含非法内容或映射不成立 | 否 |

`invalid` 永远不能自动变成 `absent_confirmed`。

## 4. 字段事实、优先级与显式覆盖

每个进入 canonical revision 的字段均记录来源，最小结构如下：

```json
{
  "key": "activityName",
  "value": "双11手机补贴",
  "source": {
    "kind": "couponTable | userInput | systemDerived | feishuIdentity | aiProposed",
    "fileName": "原始配券表.xlsx",
    "sheetName": "满减券",
    "cell": "K2",
    "rawValue": "双11手机补贴"
  },
  "override": {
    "applied": false,
    "previousValue": null,
    "reason": null,
    "operator": null
  }
}
```

优先级：

```text
最终确认人的飞书身份（申请人、部门）
  > 已确认的配券表字段
  > owner 对缺失字段的补充或有理由的显式覆盖
  > 已发布公式派生值
  > AI 的可审计候选（必须再确认，不能直接成为事实）
```

配券表和补充值冲突时，必须展示原值、补充值、来源和影响；owner 选择覆盖时记录原因。任何 `aiProposed` 字段没有源定位、确认和当前 hash 时不得标为最终值。

## 5. OA 业务字段

| key | OA 业务字段 | 主要来源 | 当前状态/约束 |
| --- | --- | --- | --- |
| `department` | 部门 | 飞书最终确认人的主部门 | `proposed_bot`；无法唯一确定时由服务端提供允许候选，不能取表格人名 |
| `applicant` | 申请人 | 最终确认人的飞书身份 | `proposed_bot`；不得由配券表冒充 |
| `applicationType` | 申请类型 | 固定值 | 当前范围固定 `优惠券申请` |
| `businessMode` | 业务模式 | 配券表或 owner 第二轮确认 | 枚举与默认映射须 Owner 确认；当前不从显示姓名推断 |
| `activityName` | 活动名称 | 配券表 | 缺失时补充；生成候选不能冒充源表事实 |
| `activityBackground` | 活动背景 | 配券表或 owner 补充 | 同上；所有券档必须完整展示 |
| `activityPointPercent` | 活动点位(%) | 已批准配券字段映射 | 不得把满减门槛、券面额或优惠比例自动等同 |
| `platformBearingPercent` | 平台承担比例(%) | 配券表 | 缺失时追问；限定 `0–100` |
| `overDeduction` | 是否超扣点 | 系统默认“否” | `defaulted_pending_unified_confirmation`；默认值随最终统一确认审计，改为“是”时原因必填 |
| `overDeductionReason` | 超扣点原因 | 配券表或 owner 补充 | 条件必填 |
| `estimatedGmvYuan` | 预估 GMV（元） | 配券表预计引入 GMV | 正数；明确单渠道/全渠道口径 |
| `estimatedCostYuan` | 预估费用（元） | 已批准模板公式重算 | 与源值不一致必须展示并确认 |
| `estimatedRoi` | ROI | 公式/飞书公式 | 由 GMV÷费用派生；不能自由猜测 |
| `channels` | 配置渠道 | 配券表用券渠道 | 需要已发布的渠道文案映射 |
| `activityStartAt` | 活动开始日期 | 已批准映射或 owner 确认 | 不得把无年份的可领时间直接当活动日期 |
| `activityEndAt` | 活动结束日期 | 已批准映射或 owner 确认 | 不得早于开始日期 |
| `durationDays` | 时长（天） | 系统派生 | `end - start + 1`；冲突应显示而不是静默修改 |

以下建券后字段保持空白，不能由系统或 AI 编造：

```text
activityId
batchId
putKey
pcClaimLink
mobileClaimLink
```

## 6. 名单与重叠决定

每个有效名单项记录原始定位：

```json
{
  "id": "001234",
  "dimension": "SKU",
  "source": {
    "fileName": "白名单.xlsx",
    "sheetName": "Sheet1",
    "cell": "A12",
    "rawValue": "001234"
  }
}
```

首期一个有效单元格只能对应一个 ID。空值、公式、科学计数法/数值型造成的前导零风险、逗号/换行拼接多个 ID，以及未获已发布策略允许的重复均是 `blocker`。

白黑名单确认同一 ID 维度后，记录交集和业务决定：

```json
{
  "dimension": "SKU",
  "ids": ["001234", "009876"],
  "sha256": "hex",
  "decision": "whitelist_wins | blacklist_wins | source_replacement_required",
  "confirmedBy": "open_id",
  "confirmedAt": "ISO-8601"
}
```

| 决定 | 标准白名单 | 标准黑名单 |
| --- | --- | --- |
| `whitelist_wins` | 保留重叠 ID | 移除重叠 ID |
| `blacklist_wins` | 移除重叠 ID | 保留重叠 ID |
| `source_replacement_required` | 不生成 | 不生成 |

不得默认选择任一优先级。任何名单源 hash、Sheet、列、ID 维度或 ID 集合变化都会使决定失效。

## 7. 标准产物、附件与文件身份

| role | 产物 | 何时可生成/上传 |
| --- | --- | --- |
| `couponTable` | 标准配券信息表 | 来源确认后的当前 revision；native-submit 最终 Gate 后才可转审批附件 |
| `productWhitelist` | 标准商品白名单 | 同上 |
| `productBlacklist` | 标准商品黑名单 | 仅 `uploaded` 黑名单；`absent_confirmed` 时不生成伪造空文件 |
| `calcImage` | 已填充标准配券表截图 | 在标准配券表 round-trip 验证后完整渲染；记录源产物 SHA-256、模板版本、渲染范围、图片 SHA-256 和 revision |

每份产物至少记录：

```text
templateId、templateVersion、templateFingerprint、generatorRuleVersion、
fileName、bytes、rows、sha256、generatedRevision、frozenStorageRef、approvalFileCode
```

`sourceRef`、Drive `fileToken`、Base 附件 token 与审批 `approvalFileCode` 的用途不同，不能互相代替。只有当前 revision 中重新下载且 hash/字节数一致的标准产物才能在最终服务端 Gate 中获取 `approvalFileCode`。

## 8. 确认、审批与审计字段

| 记录 | 第一次来源确认 | 第二次最终确认 |
| --- | --- | --- |
| 必须绑定 | owner、revision、source hash、映射、补充/覆盖、无黑名单或 overlap 决定 | owner、revision、OA 预填快照、产物 hash、模板版本、审批定义 hash、警告 |
| 允许产物 | canonical package、标准产物、预览 | R2：系统草稿、冻结产物与既有 OA 测试稿 handoff；R3/R4：既有明确“发送”动作获得受控 OA 创建授权 |
| 失效条件 | 任一源文件、映射、决定或补充变化 | 以上任一变化、模板/定义 hash 变化、过期卡或 owner 改变 |

每个最终提交审计至少包含：

```text
taskId、ownerOpenId、revision、schemaVersion、sourceConfirmation、finalConfirmation、
source/artifact hashes、mapping/template/approval definition hashes、
submissionKey、status、approvalInstanceCode、approvalInstanceLink、readbackResult、diff
```

`Submitted` 仅表示实例已创建且要求的 readback 一致；`CreatedNeedsReview` 表示实例存在但读取失败或字段有差异；`SubmissionUnknown` 表示无法证明 create 结果，必须对账，禁止再次创建；`Failed` 仅在可以证明未创建实例时使用。

## 9. 严重级别与提交门禁

| 级别 | 含义 | 行为 |
| --- | --- | --- |
| `info` | 正常信息或未配置但不影响本期事实 | 展示并留痕，例如正式模板支持但本期未使用的券档 |
| `needs_confirmation` | 有候选/默认值但必须由 owner 显式确认 | 可展示草稿，不能进入最终快照 |
| `blocker` | 映射、材料、模板、计算、授权或审计不成立 | 不生成可提交产物，不创建 OA |

`artifactGenerationReady` 与 `submissionReady` 是独立门禁。允许在有 `needs_confirmation` 时展示待审核草稿，但不得把它标为可提交；任一 `blocker` 或 native-submit Gate 缺失必须 fail closed。

配券表中存在、但活动文案没有单独型号/券额策略的券档标记为 `unconfigured_coupon_tier`：它属于 `info`，必须展示、保存当前 candidate hash，但不进入 `missingFields`、不使文案候选降级，也不构成模板 mismatch。

## 10. 当前需 Owner 冻结的项目

1. 首期可用券型、字段/公式、舍入、业务模式与渠道字典；
2. 白/黑名单模板、Sheet/列、ID 维度、行数上限、重复策略和模板 Owner；
3. 活动点位、日期、业务模式、超扣点与配券表的正式映射；
4. 单渠道/全渠道 GMV、费用与 ROI 的业务口径；
5. 已填充标准配券表截图对应的 OA 图片控件、完整页渲染标准、保留期限和审计字段；
6. 飞书审批定义、控件绑定、目标 `approval_code`、申请人资格和撤回/驳回责任；
7. Bot allowlist、数据保留、Drive/Base 可见范围和运行 Owner；
8. 新路线的 launch stage、kill switch、幂等与 `SubmissionUnknown` 对账责任。
