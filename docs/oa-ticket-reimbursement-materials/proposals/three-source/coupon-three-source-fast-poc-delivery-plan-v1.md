# 三源优惠券 P0：最快 Bot POC 交付计划 v1

> **状态**：需求方已选择；待优惠券流程、应用与工程 Owner 审阅后执行。
> **日期**：2026-10-10
> **定位**：单一、限时、draft-only 的 Bot POC 交付计划；不是 R1-dev/R2/R3、正式发布或原生 OA 授权。
> **运行手册**：[direct HTTP draft-only POC 运行手册](../../current/operations/coupon-three-source-direct-http-poc-runbook-v1.md)
> **长期路线**：[P1 耐久控制面 FDEV 台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)

## 1. 目标

尽快让**一个具名测试用户**在飞书测试 Bot 单聊完成：

```text
/OA优惠券提报
  → 上传严选配券表 + SKU 白名单 + 可选 SKU 黑名单
  → 确认材料角色、映射、无黑名单或重叠决定
  → 生成标准 Excel 附件
  → 点击“确认并创建 OA 测试稿”
  → 查看既有 OA 测试稿
```

成功终点是“标准附件和 OA 测试稿均已生成，且没有原生 OA 实例”。不点击既有草稿的正式发送按钮。

## 2. P0 的单一范围

| 项目 | P0 结论 |
| --- | --- |
| 业务模式与券型 | 仅 `严选`、常规满减券。 |
| 名单 | 仅文本格式的 SKU；白名单必传，黑名单可选但必须明确确认无黑名单。 |
| 用户与会话 | 一个严格 allowlist 用户、Bot 单聊、同一时刻一笔任务。 |
| 事件接入 | 飞书开发者服务器回调 → Vercel `POST /api/feishu/process`；不使用本机长连接或常驻 bridge。 |
| 产物 | 标准配券表、标准白名单、可选标准黑名单；源文件绝不进入 OA 附件。 |
| OA | 只创建既有 OA 测试稿；`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false` 全程不变。 |
| 验证 | 一次脱敏正常 E2E + 必要的失败停止验证；保留简短、脱敏的结论。 |

## 3. 明确复用，不重复开发

P0 先检查并复用下列已实现组件；除修复阻断 E2E 的缺陷外，不为 P0 新建平行服务、存储或提交链路。

| 已有组件 | P0 用法 |
| --- | --- |
| `server/api/feishu/process.post.ts` 与 `server/lib/feishu/events.ts` | 接收直接 HTTP 消息、文件和卡片回调。 |
| `server/lib/feishu/coupon-oa/three-source/dispatcher.ts` | 精确命令、材料、卡片 callback、owner/revision 和跨流程互斥。 |
| `server/lib/feishu/coupon-oa/three-source/service.ts`、`store.ts`、`cards.ts` | 三源识别、Base 状态、标准产物和用户卡片。 |
| `server/lib/coupon-oa/three-source/` | 确定性规则、canonical revision、名单交集和标准 Excel 生成。 |
| `server/lib/feishu/coupon-oa/three-source/handoff.ts` 与 `frozen-artifact-handoff.ts` | Drive 冻结产物重下载/hash 复验和既有 OA 测试稿交接。 |
| `server/lib/feishu/coupon-oa/config.ts`、既有 OA 草稿/预览/发送路径 | allowlist、native kill switch、OA 测试稿展示；P0 不修改或绕过 native Guard。 |
| 三源专属 Base、Drive 文件夹和模板资产 | 作为隔离的测试资源；不新建第二套资源模型。 |

## 4. P0 只保留四个交付动作

### P0-1：冻结一个可测版本

- 将严选 strict-only adapter、相关模板和已有 OA 测试稿 handoff 视为一个交付包，而不是拆成多个 FDEV。
- 只修复阻断 POC 的缺陷；不扩展功能范围。
- 运行相关单元测试、服务端 typecheck、构建和 `git diff --check`。
- 做一次聚焦 review：确认 source 文件不会作为 OA 附件、allowlist 生效、native kill switch 默认为关闭。

**完成标准：** 有一个干净、可说明内容的测试 revision；不要求 protected tag、hermetic Docker baseline、独立 Test-Plan Agent 或多轮专项 review。

### P0-2：配置最小测试环境

- 在 Vercel 测试环境配置现有 App、OA 草稿、三源 Base/Drive 和单用户 allowlist 所需变量；不在代码、文档或聊天保存 secret。
- 保持 `FEISHU_RUNTIME_STAGE=local`、三源 pilot 默认关闭、native-submit kill switch 为 `false`。
- 在飞书测试 App 中选择开发者服务器回调，配置 `/api/feishu/process`、Verification Token、消息和卡片事件；关闭事件加密。
- 停止/切换旧长连接 consumer，确保同一 App 只有一种活动事件接入方式。

**完成标准：** Vercel 健康检查和飞书 URL challenge 通过；pilot flag 仍为关闭。

### P0-3：执行一次受控 Bot E2E

- 在短测试窗口只为唯一测试用户开启 pilot flag。
- 用已授权、脱敏的严选 fixture 完成命令、材料、映射、无黑名单或重叠决定、产物生成和 OA 测试稿创建。
- 核对生成附件、revision/hash 摘要和 OA 测试稿；确认审批中心无新增原生实例，且草稿无 instance code/link。
- 测试结束立即关闭 pilot flag；记录脱敏结论和任何 blocker。

**完成标准：** 得到“通过”或一个可复现 blocker。超时、重复 callback、意外用户副作用、Base/Drive 错误或任何 native OA 迹象均立即停止，不盲目重试。

### P0-4：只做阻断修复与一次复测

- 若 P0-3 失败，只修复直接阻断这条已冻结路径的问题。
- 回归相关单测、构建和一次相同范围的 E2E。
- 若问题属于缺少截图、补充/覆盖、非 SKU、耐久恢复或 native OA，不在 P0 中硬塞实现；登记到 P1。

**完成标准：** POC 结论明确：可演示、存在 blocker、或需要进入 P1；不以增加新的并行项目来掩盖失败。

## 5. P0 不做什么

以下项目全部延后，不得成为 P0 启动或完成的前置条件：

- FDEV-001 至 FDEV-008、企业托管 bridge、PostgreSQL receipt/outbox、worker、DLQ、对象存储和正式 R1-dev/R2 Gate；
- `calcImage`/服务端截图渲染、字段补充与带原因覆盖、SPU/商家 ID、多文件二选一、自然语言命令别名和完整 provenance 最终页；
- 多用户、群聊、批量、协作、正式可观察性/HA/数据保留体系；
- 原生 OA 创建、readback canary、`SubmissionUnknown` 对账和真实发送。

这些不是删除，而是有意放入 P1；P0 不宣称自己替代它们。

## 6. P1：在 POC 被业务验证后再启动

| P1 方向 | 何时需要 | 主要内容 |
| --- | --- | --- |
| P1-A：完整 Skill 合同 | POC 用户确认需要更多业务覆盖 | 截图渲染、字段补充/覆盖、非 SKU、完整预览、材料替换交互和扩展模板。 |
| P1-B：耐久与正式运行 | 要让 Bot 长期运行、扩大用户或处理故障恢复 | FDEV-001～FDEV-007、durable HTTP/bridge、receipt/outbox、worker、对象存储、DLQ、运行监控。 |
| P1-C：原生 OA canary | 明确需要“点击发送即创建真实 OA” | 独立审批定义、submission attempt、`SubmissionUnknown` 对账、readback、kill switch 和值守/回滚；对应 FDEV-008。 |

P1 工作可以在 POC 结束后按价值选取；不必承诺一次性实现全部 FDEV。

## 7. 简化后的质量与授权边界

P0 不取消安全边界，只将验证密度与副作用范围匹配到一个可逆测试：

```text
一个清晰范围
→ 一次实现/阻断修复
→ 一次聚焦 review
→ 一次脱敏 E2E
→ 一个可记录结论
```

任何 secret、飞书后台、Vercel 环境变量、pilot flag、事件接入方式和部署仍由有权限人员在明确测试窗口操作。P0 不能使用卡片隐藏替代服务端 allowlist，也不能将 OA 测试稿成功表述为真实 OA 已发送。

## 8. 文档关系

- 本文是 P0 的唯一开发/交付计划。
- [direct HTTP draft-only POC 运行手册](../../current/operations/coupon-three-source-direct-http-poc-runbook-v1.md)是 P0 的环境配置与 E2E 操作手册。
- [综合 Skill 飞书适配升级方案](coupon-oa-feishu-unified-skill-upgrade-plan-v1.md)保留完整 Skill 合同与长期架构作为 P1 目标。
- [飞书开发版需求与进度台账](coupon-oa-feishu-dev-requirements-tracker-v1.md)和 FDEV 清单只管理 P1 耐久化/正式运行工作，不再作为 P0 的串行前置条件。
