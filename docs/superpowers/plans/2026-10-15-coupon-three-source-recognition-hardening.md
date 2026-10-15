# 优惠券三源识别链路加固实施计划

> 日期：2026-10-15  
> 设计：`docs/superpowers/specs/2026-10-15-coupon-three-source-recognition-hardening-design.md`  
> 执行方式：当前任务内顺序实施  
> 安全终点：受保护 Preview 的 draft-only 飞书 CLI 真测；不创建原生 OA

## 执行原则

- 每项先补失败测试，再做最小实现，再运行聚焦测试；
- 不修改已应用 migration，不改变事实源、事件入口或 OA 提交时机；
- AI 只产出候选，所有文件、坐标、SKU 和业务规则由服务端验证；
- 不新增固定券档名或 Sheet 名 allowlist；
- 真实文件、Base 导出和 AI 原文仅放 `/tmp` 或 Git 忽略目录；
- 外部真测前必须完成本地 Gate、干净提交、Preview SHA 回读和 kill switch 核对。

## Task 1：建立三源运行时错误合同

**文件：**

- 新建 `server/lib/coupon-oa/three-source/errors.ts`
- 新建 `server/lib/coupon-oa/three-source/errors.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`

**步骤：**

1. 为不支持格式、工作簿不可读/加密/为空、旧草稿不兼容、识别失败和未知异常
   编写用户投影测试；断言输出不包含原始 `error.message`、TypeError、ExcelJS 或堆栈。
2. 实现 `CouponThreeSourceError`、稳定错误码、`toCouponThreeSourceError` 和
   `toCouponThreeSourceUserFailure`。未知异常保留 `cause`，对用户只返回通用中文文案
   和脱敏 reference。
3. 替换 dispatcher 上传、callback 和顶层失败卡片中的任意 `error.message` 拼接；
   日志只保留错误码、阶段和脱敏业务标识。
4. 运行：

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/errors.test.ts \
  server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts
```

**完成标准：**所有用户失败卡均来自稳定错误投影，未知异常不会继续副作用。

## Task 2：修复附件分类和工作簿 Gate

**文件：**

- 新建 `server/lib/feishu/coupon-oa/three-source/file-classification.ts`
- 新建 `server/lib/feishu/coupon-oa/three-source/file-classification.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/dispatcher.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts`
- 修改 `server/lib/coupon-oa/three-source/ai-recognition.ts`
- 修改 `server/lib/coupon-oa/three-source/ai-recognition.test.ts`

**步骤：**

1. 添加 `.xlsx`、大小写扩展名、`.xls`、`.csv`、未知文件、PNG/JPEG、伪装图片、
   损坏/空工作簿测试。
2. 实现显式分类器：`excel_xlsx`、`image`、`unsupported_spreadsheet`、
   `unsupported_file`。未知文件不得默认进入图片处理。
3. 在实际 ExcelJS 读取边界捕获错误并转换为 Task 1 的业务错误；空 Sheet 单独分类。
4. 保持当前只支持 `.xlsx`，不实现 `.xls/.csv` 解析。
5. 运行：

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/file-classification.test.ts \
  server/lib/feishu/coupon-oa/three-source/dispatcher.test.ts \
  server/lib/coupon-oa/three-source/ai-recognition.test.ts
```

**完成标准：**每类附件只进入对应处理器，格式错误得到可行动中文提示。

## Task 3：将 AI proposal 改为分区容错

**文件：**

- 修改 `server/lib/coupon-oa/three-source/ai-recognition.ts`
- 修改 `server/lib/coupon-oa/three-source/ai-recognition.test.ts`
- 修改 `server/lib/coupon-oa/three-source/types.ts`
- 修改 `server/lib/control-plane/coupon-ai-recognition-effect.test.ts`

**步骤：**

1. 添加“一个非法分区不丢弃其他分区”的测试，分别覆盖 role、template、tier、field、
   SKU region 和活动文案；断言问题只落到对应分区。
2. 将整份 `couponThreeSourceAiProposalSchema.safeParse` 改为顶层对象检查与分区
   `safeParse`。为每个分区生成稳定 issue code/摘要。
3. 保持 source hash、证据坐标和原始值验证；schema 通过但证据无效的候选仍丢弃。
4. 确认 effect 持久化和投影可保存部分成功结果，并且不会把完整 AI 响应写入用户卡片。
5. 运行：

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/ai-recognition.test.ts \
  server/lib/control-plane/coupon-ai-recognition-effect.test.ts
```

**完成标准：**局部坏数据不会清空全部识别候选；失败分区可诊断且 fail closed。

## Task 4：纠正 AI-primary 合并和文件角色时序

**文件：**

- 修改 `server/lib/coupon-oa/three-source/recognition.ts`
- 修改 `server/lib/coupon-oa/three-source/recognition.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/service.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/service.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/ai-projection.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts`

**步骤：**

1. 添加有效 AI 优惠券结果不混入规则行、AI 分区无效才规则降级、AI/规则角色冲突
   进入 owner 确认的测试。
2. 修改 `resolveAiPrimaryRecognition`：按职责分区选择 AI 或规则，不再向有效 AI
   `couponCandidates` 无条件追加 deterministic candidates。
3. 调整上传/统一识别时序：合法 `.xlsx` 可先以未分配角色状态保存；统一识别不因
   规则角色歧义提前拒绝。AI 完成后根据证据决议角色，歧义进入统一卡片。
4. 保留白名单必传、黑名单状态、owner、revision、重复文件和同角色冲突 Gate。
5. 运行：

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/recognition.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts \
  server/lib/feishu/coupon-oa/three-source/ai-projection.test.ts
```

**完成标准：**AI-primary 与 ADR-0012 一致；规则降级不会抢占有效 AI 事实候选。

## Task 5：补齐部分 AI 名单区域和动态覆盖 Gate

**文件：**

- 修改 `server/lib/coupon-oa/three-source/lists.ts`
- 修改 `server/lib/coupon-oa/three-source/recognition.test.ts`
- 修改 `server/lib/coupon-oa/three-source/workflow.ts`
- 修改 `server/lib/coupon-oa/three-source/offline.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/service.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/service.test.ts`

**步骤：**

1. 添加 AI 只覆盖一个 Sheet、其余 Sheet 由规则发现；AI/规则同一区域去重；额外
   Sheet、不匹配名称、一个券档多 Sheet 和缺少明确映射的测试。
2. 删除 `aiSkuRegions.length > 0` 后提前返回的全有或全无分支，改为按 Sheet/区域
   合并，并继续枚举未覆盖 Sheet。
3. 修复 `selection?.sheets[worksheet.name]` 的半可选访问。
4. 在 canonical package 前增加动态覆盖检查：每个确认券档有明确来源映射；额外
   分组和多 Sheet 关系可经 owner 明确确认。不得比较固定券档名或要求 Sheet 同名。
5. 保持 SKU 原值、前导零、公式、重复、交集和 source hash 校验。
6. 运行：

```bash
pnpm exec vitest run \
  server/lib/coupon-oa/three-source/recognition.test.ts \
  server/lib/coupon-oa/three-source/offline.test.ts \
  server/lib/feishu/coupon-oa/three-source/service.test.ts
```

**完成标准：**AI 部分区域不会导致其他 Sheet 丢失，覆盖不足明确阻断而非静默生成。

## Task 6：集中规范化历史 Base 草稿

**文件：**

- 修改 `server/lib/feishu/coupon-oa/three-source/store.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/store.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/cards.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/cards.test.ts`
- 修改 `server/lib/feishu/coupon-oa/three-source/cards-schema.test.ts`

**步骤：**

1. 构造旧 State JSON fixture，逐项删除 recognitions、AI 候选数组、selections、
   mapping delivery、issues、artifacts 和图片数组；断言读取和卡片渲染不抛错。
2. 实现纯函数 `normalizeCouponThreeSourcePilotDraftState`，为所有可兼容缺省字段补
   默认值，并保持幂等。
3. `parseRecord` 只在 schema 可兼容时调用 normalizer；未知 schema 转成稳定业务
   错误，不猜测迁移。
4. 卡片生成器只消费规范化状态；仍保留必要防御性读取，避免单个损坏记录拖垮事件。
5. 运行：

```bash
pnpm exec vitest run \
  server/lib/feishu/coupon-oa/three-source/store.test.ts \
  server/lib/feishu/coupon-oa/three-source/cards.test.ts \
  server/lib/feishu/coupon-oa/three-source/cards-schema.test.ts
```

**完成标准：**历史可兼容草稿不会因缺少 `sheets` 或候选数组崩溃，未知版本 fail closed。

## Task 7：同步产品、实现与运行基线

**文件：**

- 修改 `docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.4.md`
- 修改 `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md`
- 修改 `docs/oa-ticket-reimbursement-materials/current/implementation/coupon-three-source-live-audit-runbook.md`
- 修改 `docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md`

**步骤：**

1. 写明支持格式仍为 `.xlsx`、未知附件不进入图片路径、AI 分区降级顺序和用户安全
   错误行为。
2. 写明动态名单覆盖检查不使用固定券档名白名单，AI 只提议区域，SKU 从原文件复制。
3. 在 runbook 增加旧状态、部分 AI 响应、错误格式和内部错误不泄露的回归判读。
4. 检查 Markdown 链接和当前/提议/历史状态表述，不把本次实现表述为生产上线。
5. 运行：

```bash
pnpm exec prettier --check \
  docs/oa-ticket-reimbursement-materials/current/product/coupon-oa-mvp-prd-v1.4.md \
  docs/oa-ticket-reimbursement-materials/current/implementation/coupon-oa-current-architecture-and-refactoring-baseline-v1.md \
  docs/oa-ticket-reimbursement-materials/current/implementation/coupon-three-source-live-audit-runbook.md \
  docs/oa-ticket-reimbursement-materials/current/operations/coupon-three-source-local-long-connection-poc-runbook-v1.md
```

若仓库未配置 Prettier，则改用现有 Markdown 检查或人工链接检查，不新增格式工具。

**完成标准：**产品、实现和真测文档与运行时代码一致，边界未扩大。

## Task 8：完整本地回归、提交与 Preview 部署 Gate

**文件：**所有本次改动文件。

**步骤：**

1. 执行：

```bash
pnpm test:coupon-three-source:offline
pnpm exec vitest run \
  server/lib/coupon-oa/three-source \
  server/lib/feishu/coupon-oa/three-source \
  server/lib/control-plane/coupon-ai-recognition-effect.test.ts \
  server/lib/control-plane/coupon-ai-text-effect.test.ts
pnpm test:coupon-three-source:e2e-local:fast
pnpm test:coupon-three-source:e2e-local:deepseek
pnpm audit:cards
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

2. 对用户原始工作簿只在本地忽略目录或 `/tmp` 运行：

```bash
pnpm audit:workbook -- /path/to/脱敏配券表.xlsx --json /tmp/coupon-audit.json
pnpm audit:workbook -- /path/to/脱敏白名单.xlsx --json /tmp/list-audit.json
```

3. 审查 diff 和暂存范围，排除 `.env*`、真实材料、输出报告和临时导出。
4. 创建 Conventional Commit；确认工作区干净。
5. 执行 `pnpm p0:preview:check`，通过后执行 `pnpm p0:preview:up`；回读 Preview SHA、
   bridge 和 worker 状态。

**完成标准：**所有本地 Gate 通过，部署 revision 与本地完整 SHA 一致，只有一个
bridge/worker，native kill switch 关闭。

## Task 9：飞书 CLI 真环境验收与收尾

**文件：**

- 新建或更新一份脱敏记录：
  `docs/oa-ticket-reimbursement-materials/records/2026-10-15-coupon-three-source-recognition-hardening-live-round.md`

**步骤：**

1. 先用 `lark-cli base +record-list --as bot` 只读核对活动草稿和测试窗口，确认没有
   第二 consumer。
2. 在唯一测试用户 Bot 单聊发起 `/OA优惠券提报`，上传脱敏配券表与白名单并点击
   统一识别。
3. 回读 AI run、Base State JSON 和卡片：证明 DeepSeek 被实际调用，所有券档和
   名单 Sheet 均被保留，且没有 `sheets`/内部异常泄露。
4. 对 mapping 等关键卡片运行真实发送审计；确认每张 PASS 后已撤回。
5. 生成标准附件，核对角色、revision、hash 和 Drive readback；只进入 OA 测试稿
   预览，不点击正式发送。
6. 核对 Base 没有原生 approval instance code/link，Approval 中没有新增原生实例。
7. 关闭 pilot，执行 `pnpm p0:preview:down`，记录停止时间和脱敏结论。
8. 若任何 forward failure、双 consumer、撤回失败、hash/readback 不一致或原生 OA
   迹象出现，立即停止并按 runbook 回滚，不重放事件。

**完成标准：**真实飞书链路验证了本次修复，记录明确区分代码完成、Preview 部署、
飞书 E2E 和仍未授权的生产/原生 OA 能力。
