# 三源优惠券本地 E2E 实施进度（2026-10-13）

## 结论

本轮已建立 64 个 manifest、206 份合成 Excel 的生成能力、真实快速基准链路、AI
回放、结构化报告、S3/MinIO 不可变对象适配器和四个聚合命令。快速层现为 **64/64
符合预期**，Docker PostgreSQL + MinIO 耐久层也已通过。

本记录不表示飞书、Vercel、Drive、Base、Approval 或原生 OA 已验证。所有测试的
`nativeOaCreated` 均为 `false`。

## 已通过

- case contract：64 个 ID 完整且无重复；
- fixture 计划量：206 份合成工作簿；
- F01：识别、领域计算、标准模板生成和 Excel 回读通过；
- F02–F07：空文件、损坏 OOXML、加密容器、旧 XLS、伪装扩展名和超限文件均在 AI
  前阻断；
- 同 Sheet 重复 SKU：保留首次出现并静默去重；
- 跨 Sheet 相同 SKU：在每个 Sheet/券档中分别保留；
- 重复表头、中文日期、空白与 `N/A` SKU、自由命名多 Sheet 均通过回归；
- 合并单元格、隐藏数据、双表冲突、科学计数、来源角色颠倒和旧 revision 均返回稳定
  分类；
- AI replay、错误脱敏、报告分组、聚合命令 fail-closed；
- S3 immutable adapter 单元测试：首次写入、同 bytes 幂等、不同 bytes 冲突、metadata
  hash 校验；
- PostgreSQL + MinIO E2E：来源文件、revision、操作幂等、标准产物 immutable put、
  重放与 hash 回读通过；
- 受影响回归测试 145 项通过；仓库完整测试 596 项通过、8 项按环境条件跳过；服务端
  TypeScript 检查通过。

## 已修复的失败类别

- fixture 现在真实构造非法日期、数值边界、公式缓存、券档缺失/额外、来源角色颠倒、
  合并单元格、隐藏数据和多个标识列，不再静默回退成标准表；
- 离线 facade 增加显式动态多 Sheet 模式，旧单列模式保持兼容；
- 动态名单生成器允许同一 SKU 在不同 Sheet 中分别存在，同时仍拒绝同 Sheet 重复；
- 日期规范化、重复表头去重、空占位 SKU 和英文文件名角色信号已补齐；
- 第二轮问题、重叠决策、黑名单异常与 stale revision 具有稳定错误码。

每个 case 的 expected/actual 结果保存在：

`outputs/coupon-three-source-e2e/2026-10-13T05-27-56-539Z/fast-matrix-results.json`

以及：

`outputs/coupon-three-source-e2e/2026-10-13T05-27-56-539Z/per-case/<case-id>/result.json`

## Docker 镜像回退

Docker Desktop 的 DaoCloud Docker Hub 镜像代理曾对以下固定 MinIO 标签返回 403：

```text
docker.io/minio/minio:RELEASE.2025-04-22T22-12-26Z
docker.m.daocloud.io ... 403 Forbidden
```

`scripts/prepare-local-minio-image.mjs` 现在会先复用本地固定镜像；镜像缺失时，按 Docker
架构从 MinIO 官方 GitHub Release 下载同一版本二进制，校验固定 SHA-256 后使用
`infra/minio-local.Dockerfile` 构建。没有使用 `latest`，也没有降低校验标准。

## 已执行验证

```text
pnpm test:coupon-three-source:e2e-local:fast
结果：fast lane passed，64/64 case 符合预期

pnpm exec vitest run <受影响回归测试>
结果：15 files / 145 tests passed

pnpm test
结果：107 files passed，3 skipped；596 tests passed，8 skipped

pnpm typecheck:server
结果：passed

pnpm test:coupon-three-source:e2e-local
结果：fast passed，durable passed；64 个 case 均符合预期

pnpm infra:up / pnpm infra:down
结果：PostgreSQL、MinIO 均启动并通过健康检查，测试后容器已关闭

pnpm lint
结果：被仓库内 `.claude/worktrees/agent-abc7239e2a1bd614e/biome.json` 的嵌套 root
配置阻断；不是本轮修改文件的格式错误，已对本轮文件逐个执行 Biome
```
