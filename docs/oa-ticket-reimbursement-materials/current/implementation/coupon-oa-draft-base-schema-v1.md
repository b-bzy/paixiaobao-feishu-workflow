# 优惠券 OA 系统草稿 Base 表结构 v1

> **状态**：当前受控实现配置；仅描述系统业务草稿，不代表飞书存在可 API 写入的客户端 OA 草稿。
> **适用范围**：[MVP PRD v1.6](../product/coupon-oa-mvp-prd-v1.6.md) 所定义的系统草稿路径；原生 OA 创建仍受 [rollout Gate](../operations/coupon-oa-internal-pilot-rollout-plan-v1.md) 约束。
> **关联配置**：[`coupon-oa-draft-base-fields-v1.json`](coupon-oa-draft-base-fields-v1.json)。

> 表名建议：`优惠券提单草稿`
> 用途：保存未提交、待确认、已提交或失败的系统业务草稿；不是正式飞书 OA 的替代品。
> 配置完成后，将表 ID 写入服务端环境变量 `FEISHU_COUPON_DRAFT_TABLE_ID`。

| 字段名 | Base 字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| Draft ID | 单行文本 | 是 | 唯一草稿 ID，如 `COA-...`；建议设为主字段或建立唯一性管控。 |
| Owner Open ID | 单行文本 | 是 | 机器人消息发送者的 `open_id`，用于隔离其草稿。 |
| Status | 单选 | 是 | `Draft`、`Validated`、`Confirmed`、`Submitting`、`Submitted`、`CreatedNeedsReview`、`SubmissionUnknown`、`Failed`、`Canceled`。`CreatedNeedsReview` 表示实例已创建但回读失败/差异，必须停止自动写入并人工核对；`SubmissionUnknown` 表示 create 调用结果无法证明，必须先对账，禁止自动重试创建。 |
| Schema Version | 单行文本 | 是 | 当前为 `coupon-oa-submit-schema-v1`。 |
| Definition Hash | 单行文本 | 否 | 业务员确认时锁定的正式审批定义结构哈希。 |
| Fields JSON | 多行文本 | 是 | 系统草稿的业务字段快照；不要人工改写。 |
| Attachments JSON | 多行文本 | 是 | 审批附件 file code、文件名、大小、SHA-256 与用途。 |
| Validation Issues JSON | 多行文本 | 是 | 机器校验与回读比对的差异清单。 |
| Confirmed At | 日期 | 否 | 业务员点击确认预览的时间。 |
| Approval Instance Code | 单行文本 | 否 | 正式 OA 创建后的 `instance_code`。 |
| Approval Instance Link | 超链接或单行文本 | 否 | 正式 OA 打开链接。 |
| Failure Reason | 多行文本 | 否 | 创建或回读失败原因；禁止写入密钥或 token。 |

## 原生 OA canary 前必须新增的状态/审计字段

以下不是当前 `v1` 表已经实现的字段，不能仅靠文档把它们视为可用；在 native-submit Gate 前应随代码、迁移与回归测试一并上线：

| 字段 | 用途 |
| --- | --- |
| `Submission Key` | 创建 API 前原子占用的持久业务幂等键。 |
| `Submission Attempted At` | 最近一次提交尝试时间与关联 attempt。 |
| `Confirmation Revision` | 明确确认所绑定的草稿 revision。 |
| `Reconciliation Status / At` | `SubmissionUnknown`、`CreatedNeedsReview` 的对账状态、时间和处理人。 |

## 权限与使用约束

1. 只把飞书**自建应用**加入该 Base，角色设为可编辑；不要把 App Secret、tenant token 或用户 token 写入表格。
2. 业务员只通过机器人操作草稿；默认不直接开放 Base 编辑入口，避免绕过确认快照与定义哈希守卫。
3. `Submitted`、`CreatedNeedsReview`、`SubmissionUnknown`、`Canceled` 状态的记录不可修改；需要重提时复制为新的 `Draft`。
4. `Failed` 仅用于可证明尚未创建原生 OA 的失败。`SubmissionUnknown` 用于 create 结果无法证明的情况；系统不得自动重试创建，必须先由 OA/运行 Owner 对账并记录结果。
5. 生产接入前确认附件哈希、文件名和业务字段是否属于内部敏感数据，并按企业数据分级配置 Base 访问范围。
