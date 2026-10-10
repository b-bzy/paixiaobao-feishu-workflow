# FDEV-001 Dev Release Baseline 候选清单 v1

> **记录类型**：P1 durable release baseline 候选 manifest / evidence template
>
> **状态**：**P1 默认 No-go / 未验收**；不是 P0 最快 Bot POC 的阻断项
>
> **日期**：2026-10-09
>
> **权威生命周期**：[飞书开发版需求与进度台账](../../proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md)

## 1. 使用边界

本文件只为 FDEV-001 的未来 clean-checkout 验证提供固定字段。所有没有实际、可复核证据支持的字段均为 **Not yet recorded**。

它**不是 release baseline**（**not a release baseline**），也**不是 🥇 验收记录**（**not a 🥇 acceptance record**）。只有在以下条件同时满足后，Lead 才可用实际证据创建一份日期化记录：

1. 用户明确授权创建候选 clean commit/tag；
2. Release Owner 已确认其受保护、可追溯的 revision/tag；
3. 从该 clean checkout 重复得到完整、默认关闭的验证结果；
4. 新的 Test-Plan Agent、独立 QA/Test Agent、Requirement Owner、工程 QA 与 Runtime/Release Owner 都已完成其对应门禁。

在这些条件实现前，本模板不能被用作部署、Dev App 配置、bridge/scheduler 启动、真实 Feishu/OA 调用、feature enablement 或 FDEV-002 的前置证据。

## 2. 候选身份与工作区完整性

| 字段 | 实际记录 |
| --- | --- |
| Candidate revision | **Not yet recorded** |
| Candidate commit SHA | **Not yet recorded** |
| Candidate annotated tag | **Not yet recorded** |
| Tag object SHA / peeled commit SHA | **Not yet recorded** |
| Protected/append-only ref 证据 | **Not yet recorded** |
| Fresh detached clean checkout 身份 | **Not yet recorded** |
| `git status --porcelain=v1 --untracked-files=all` 结果 | **Not yet recorded** |
| `git diff --check` 结果 | **Not yet recorded** |
| tracked-file diff / source input scan 结果 | **Not yet recorded** |
| 验证日期、操作者与时区 | **Not yet recorded** |

## 3. 工具链、依赖与 migration 指纹

| 字段 | 实际记录 |
| --- | --- |
| Node.js 版本 | **Not yet recorded** |
| pnpm 版本 | **Not yet recorded** |
| Vitest / package manager lock 工具版本 | **Not yet recorded** |
| Docker Engine / Docker Compose 版本 | **Not yet recorded** |
| PostgreSQL 版本与 image digest | **Not yet recorded** |
| `pnpm-lock.yaml` SHA-256 | **Not yet recorded** |
| `package.json` / workspace manifests SHA-256 | **Not yet recorded** |
| `0001_durable_control_plane.sql` SHA-256 | **Not yet recorded** |
| `0002_durable_command_intake.sql` SHA-256 | **Not yet recorded** |
| `0003_add_delivery_chat_id.sql` SHA-256 | **Not yet recorded** |
| `0004_durable_effect_worker.sql` SHA-256 | **Not yet recorded** |
| 其他已纳入 candidate 的 migration 文件和 SHA-256 | **Not yet recorded** |

## 4. 可重复验证结果

所有命令必须从第 2 节记录的 fresh detached checkout 执行。结果只记录受控的命令、退出码、时长与范围；不得在本记录写 URL、host、database/user、secret、token、原始 payload、完整 open ID、file key、原始 stdout/stderr 或自由文本错误。

| 验证项 | 命令 / 固定入口 | 退出码 | 时长 | 结果与范围 |
| --- | --- | --- | --- | --- |
| 完整 Vitest 回归 | `pnpm test` | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| 服务端 TypeScript | `pnpm typecheck:server` | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| Nitro/server build | `pnpm build` | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| 控制面测试 | `pnpm test:control-plane` | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| disposable-schema PostgreSQL integration | `pnpm test:control-plane:postgres`，仅使用显式 test DB | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| migration repeat / hash protection | test-only migration entry / repeat contract | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| whitespace 检查 | `git diff --check` | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |
| FDEV-001 正式 hermetic lanes（如经批准实施） | approved fixed runner entry only | **Not yet recorded** | **Not yet recorded** | **Not yet recorded** |

## 5. 测试数据库与隔离清理

| 字段 | 实际记录 |
| --- | --- |
| 测试数据库来源（仅受控环境类别，不记录连接串） | **Not yet recorded** |
| disposable schema / database 隔离证据 | **Not yet recorded** |
| migration 后清理结果 | **Not yet recorded** |
| test schema/container/network/volume 清理结果 | **Not yet recorded** |
| 无 production `DATABASE_URL` 进入 test child 的证据 | **Not yet recorded** |
| 无桥接、scheduler、Bot client 或外部 provider 启动的证据 | **Not yet recorded** |

## 6. 默认关闭与零外部副作用

| 控制 | 结论 |
| --- | --- |
| Dev command feature | **Not yet recorded** |
| Dev card-send gate | **Not yet recorded** |
| `FEISHU_COUPON_THREE_SOURCE_R2_ENABLED` | **Not yet recorded** |
| native-submit / Approval create | **Not yet recorded** |
| Dev App/Bot、bridge 与 scheduler 未配置/未启动 | **Not yet recorded** |
| Feishu / Base / Drive / object storage / renderer / AI 调用数为零 | **Not yet recorded** |
| legacy “拍小宝”与 `/api/feishu/process` 未改变 | **Not yet recorded** |
| 无部署、无云资源、无 secret 修改 | **Not yet recorded** |

## 7. Test-Plan、QA、缺陷与验收

| 门禁 | 实际记录 |
| --- | --- |
| Step 4：新的 Test-Plan Agent、独立 worktree、case matrix / side-effect count / failure-rollback model | **Not yet recorded** |
| Step 5：独立 QA/Test Agent、revision / 环境 / 命令 / exit code / duration / result | **Not yet recorded** |
| 已登记 Bug、修复 revision 与回归结果 | **Not yet recorded** |
| 未覆盖外部 Gate 与剩余风险 | **Not yet recorded** |
| Requirement Owner 结论 | **Not yet recorded** |
| 工程 QA 结论 | **Not yet recorded** |
| Runtime/Release Owner 结论 | **Not yet recorded** |
| 无部署回滚/清理 drill | **Not yet recorded** |
| FDEV-001 🥇 结论 | **Not yet recorded — No-go** |
| FDEV-002 是否可进入第 2 步 | **Not yet recorded — No** |

## 8. 当前结论

**Not yet recorded：没有 clean commit/tag、没有可重复的候选验证、没有三方签字、没有 🥇。**

此文件不是 release baseline；它保留为 candidate-only 模板，直至用户明确授权 clean commit/tag 且相应的 FDEV-001 开发、Test-Plan、QA/Test 与验收生命周期实际完成。
