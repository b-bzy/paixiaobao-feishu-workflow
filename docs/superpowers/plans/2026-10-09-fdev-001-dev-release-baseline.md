# FDEV-001 可复现 Dev Release 基线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **修订状态（2026-10-09，v3）：** 两轮独立 Review 均发现初版设计不能证明隔离性。本版将 hermetic runner、ignored-input rejection、manifest schema 和 evidence-volume safety 变为实现前的具体合同。本文件仍是 FDEV-001 第 2 步“出方案”；未获用户/Release Owner 审阅前，不得写实现代码、创建 tag、配置外部环境、运行 Docker/数据库验证、部署或调用外部服务。

**Goal:** 为默认关闭的 Feishu R1-dev command-intake foundation 建立一个可复核、可重复、默认拒绝且不会产生飞书/OA副作用的 release baseline。交付物是受保护 Git ref 的来源身份、隔离验证工具/测试、测试方案和证据模板；不是 Dev Bot、bridge、scheduler、feature flag 或上线能力。

**Architecture:** baseline 分为三个不可替代的层：

```text
受保护 CI / Release Owner
  → fresh detached source clone（只含 tag 追踪内容）
  → Host hermetic orchestrator
       ├─ no-egress Node runner：offline install + lint/typecheck/test/build
       └─ PostgreSQL-only Node runner：仅可访问内部 PostgreSQL 17
  → 新建、Docker 管理的 evidence volume（不接受任意 host output path）
  → closed-schema、无秘密的 identity / result manifests
```

两个 runner 均从只读 source snapshot 复制到容器 scratch workspace 后工作；source snapshot、来源 repo 和 host runtime configuration 永远不挂载为可写输入。no-egress runner 使用 Docker `network_mode: none`；PostgreSQL-only runner 只加入 `internal: true` 的专用 Docker network，并且该 network 只连接 runner 与短生命周期 PostgreSQL 17 service。任何 image digest、network policy、mount、source scan、Git/ref 或 command 证明缺失，都生成 No-go，不能由 CLI flag、环境变量或文字声明放行。

**Tech Stack:** Node.js 22.22.2 ESM/JSDoc、`node:child_process`、`node:crypto`、`node:fs`、`node:path`、Vitest 4、pnpm 10.14.0、Docker Engine 28.5+ / Docker Compose、PostgreSQL 17、现有 migration runner 与 control-plane PostgreSQL suite。

**Spec:**
- `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md`
- `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-command-intake-release-plan-v1.md`
- `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-durable-control-plane-risk-remediation-backlog-v1.md`

## Global Constraints

- FDEV-001 只固化 release baseline；FDEV-002 至 FDEV-006 必须保持第 1 步，FDEV-007/008 不启动。
- FDEV-001 期间禁止部署、Dev App/Bot 配置、feature enablement、bridge/scheduler 启动、真实 Feishu/Approval/Base/Drive/object storage/AI 调用、native OA、live “拍小宝”或 legacy `/api/feishu/process` 改动。
- source candidate 必须由受保护 annotated tag 的 peeled commit 创建**全新 detached clone**；不能使用开发者主目录、现有 worktree 或其 clean status 作为候选。clone 过程禁用 global/system Git config，且只检出 tag 追踪内容。
- pre/post 都必须复核 annotated tag object SHA、peeled commit SHA 与 `HEAD` 相同且未变；所有 `git status --porcelain=v1 --untracked-files=all`、`git diff --check` 和 tracked-file diff 均必须干净。local tag 不是不可变性的证明：🥇 还需要平台受保护/append-only ref 的 Owner evidence。
- candidate source scan 在任何 child run 前后执行：拒绝任意 ignored/untracked source input；拒绝 tracked 或 ignored 的 dotenv、`.npmrc`、`.pnpmfile.*`、`.yarnrc*`、credential/key/certificate 与本地 runtime config filename。runner scratch 还必须拒绝测试期间新出现的敏感配置，即使它在 Git ignore 中。只读 source mount 与 disposable scratch 是最终防线。
- 不接受任意 `--output`、任意 `--hermetic-policy-id`、任意 PostgreSQL label 或本地环境 attestation。只有 orchestrator 固定的 policy IDs `fdev001-no-egress-v1`、`fdev001-postgres-only-v1` 和 target label `fdev001-postgres17-isolated-v1` 可进入 manifest。
- Docker runtime image 和 PostgreSQL image 都必须使用 protected platform policy 记录的 digest-pinned references，启动使用 `--pull never`。候选验证前须检查实际 image RepoDigest 等于 policy；image/policy revision/audit-run ID 有任一缺失即 No-go。未提供实际受保护 policy 时，代码可做 unit test，但不得进入正式验证。
- no-egress lane 只可运行在 `network_mode: none` 容器；PostgreSQL lane 只可运行在 `internal: true` private network，并经 Docker inspect 证明 endpoint membership 恰为 runner/PostgreSQL。受保护 CI 还必须保留独立可查询的 platform audit artifact，证明没有 default/host network、没有额外 attachment、没有 proxy/credential injection。CLI metadata 从不作为授权或网络隔离证明。
- PostgreSQL test URL 只由 PostgreSQL-only orchestrator 通过 container secret 注入。test-only migration CLI 只读取 `CONTROL_PLANE_TEST_DATABASE_URL`，production `DATABASE_URL` 不会进入任何 child；无 test URL 时不得创建数据库 client。
- baseline manifest/evidence 使用 closed schema、`additionalProperties: false`，只允许固定 command IDs/argv、enum result、UTC timestamps/durations、Git SHA、file SHA、platform policy ID、image digest、opaque UUID-shaped audit ID 和固定 PostgreSQL target enum。不得写 URL、host/database/user、secret、token、raw payload、open ID、file key、原始/hashed stdout/stderr、error text、absolute path、自由文本 label 或 log location。
- 所有 local/PG subprocess 都只能由 hermetic orchestrator 产生。`pnpm install` 必须是 `--frozen-lockfile --offline`，依赖 store 已在 image 中；cache miss 或任一 command 非零立即 No-go，绝不联网补依赖。
- `pnpm lint`、server/admin typecheck、tests、server/admin build、diff check、migration repeat 与 PostgreSQL suite 都必须退出 0。当前 admin failure 不能豁免；在独立获批准的修复完成，或 Requirement Owner 正式缩小成功标准并重新走方案评审前，FDEV-001 一直 No-go。
- 开发中的 unit/regression check 仅属于第 3 步开发反馈。独立 Test Agent 产生并经 Review Agent 审阅的正式测试方案才可推进第 4 步；实测才可写入第 5 步。
- 创建/推送 commit/tag、配置受保护 CI policy、provision image/runner、运行正式 Docker/DB 验证、部署和验收签字均只能由 Lead / Release Owner 在明确授权后执行。

## Review Focus

1. **伪造或非隔离运行：** unit tests 必须证明 inner verifier 没有 policy secret/volume 时只能产生开发结果；host orchestrator 必须验证 digest、network mode、endpoint set、read-only source mount、empty evidence volume 和 protected audit identity，任一不符 No-go。
2. **ignored / runtime input 污染：** tests 必须覆盖 pre-existing ignored `.env`、tracked `.npmrc`、ignored pnpm config、scratch 新增 dotenv、global Git config 和 candidate clone 外部文件；任一拒绝且不 spawn runner。
3. **tag 或 candidate 漂移：** tests 必须覆盖 lightweight/mismatched/deleted/recreated/moved tag、tag object SHA 改变、peeled SHA 改变、pre/post source diff 和 source scan 变化。
4. **证据泄漏或写入绕过：** serializer tests 必须攻击 policy ID/label/audit ID/child error/output with URL、credentials、newline、absolute path；evidence-volume tests 必须攻击 existing file、parent substitution、symlink and mount race。
5. **默认开放或 R1-dev 越界：** offline config contracts 必须证明缺失/空白/非法 config 时 command intake、task/effect creation 和 native-submit 都不可达，fake Card/Approval gateway 调用为零，且不启动 bridge/scheduler/Bot client。

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `scripts/lib/control-plane-migration-runner.mjs` | 提取 migration 执行逻辑；只接收调用者的 database URL，不读取 process environment。 |
| `scripts/migrate-control-plane.mjs` | 保持 production-style CLI；只读取 `DATABASE_URL`。 |
| `scripts/migrate-control-plane-test.mjs` | test-only CLI；只读取 `CONTROL_PLANE_TEST_DATABASE_URL`。 |
| `scripts/migrate-control-plane.test.mjs` | 两个 migration entry point 的 env selection、无 fallback、无 client-before-validation 和 repeat contracts。 |
| `scripts/lib/feishu-dev-release-baseline.mjs` | Git/tag/file identity、source-input scan、closed manifest schema、safe value grammars 与 serializer。 |
| `scripts/lib/feishu-dev-release-baseline.test.mjs` | identity/source-scan/manifest adversarial unit contracts。 |
| `scripts/verify-feishu-dev-release-baseline.mjs` | **inner verifier**；仅由 container entrypoint 调用，执行固定 lane commands 并只向 mounted evidence volume 写 closed-schema result。 |
| `scripts/verify-feishu-dev-release-baseline.test.mjs` | inner verifier lane、command ordering、environment stripping、serializer、no arbitrary output contracts。 |
| `scripts/run-feishu-dev-release-baseline-hermetic.mjs` | **host orchestrator**；fresh clone、policy/digest/mount/network/volume verification、two-lane Compose execution、source post-check 与 safe audit result。 |
| `scripts/run-feishu-dev-release-baseline-hermetic.test.mjs` | fake Docker/Git runner contracts: clone, image/no-pull, network/mount/volume validation, negative policy cases and cleanup. |
| `infra/release-baseline/compose.yml` | two runner services and PostgreSQL 17 service; `no-egress` has `network_mode: none`, `postgres-only` uses the sole `internal: true` network. |
| `infra/release-baseline/Dockerfile` | digest-pinned Node 22.22.2 runner image with an offline pnpm store; no project source or secret baked in. |
| `infra/release-baseline/runner-policy.schema.json` | closed schema for platform-supplied policy: two pinned image digests, fixed policy IDs, fixed target enum, allowed Docker Engine/version constraints, opaque audit-run ID grammar. |
| `infra/release-baseline/runner-policy.example.json` | invalid-for-execution documentation fixture; it deliberately lacks real digests/audit identity and must fail verification. |
| `server/lib/feishu/coupon-oa/three-source/config.test.ts` | offline default-closed contract; no real Bot/client/network. |
| `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/feishu-dev-release-baseline-test-plan-v1.md` | Test Agent’s formal Step 4 test plan, based on this fixed runner profile. |
| `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/feishu-dev-release-baseline-verification-template-v1.md` | closed-field, default-No-go verification record template. |
| `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/feishu-dev-release-baseline-<UTC-date>-<tag-object-sha-prefix>.md` | real evidence created in Docker evidence volume and later archived only as a separate audit-only change. |
| `docs/.../coupon-oa-feishu-dev-requirements-tracker-v1.md` | FDEV-001’s only lifecycle/defect/acceptance status. |

## Task 1: Source isolation, migration interfaces and closed data contracts

**Files:**
- Create: `scripts/lib/control-plane-migration-runner.mjs`
- Create: `scripts/migrate-control-plane-test.mjs`
- Create: `scripts/migrate-control-plane.test.mjs`
- Create: `scripts/lib/feishu-dev-release-baseline.mjs`
- Create: `scripts/lib/feishu-dev-release-baseline.test.mjs`
- Modify: `scripts/migrate-control-plane.mjs`

**Interfaces:** `.mjs` uses JSDoc typedefs, never executable TypeScript syntax.

```js
export async function runControlPlaneMigrations(input);
export function requireTestDatabaseUrl(env);
export async function inspectReleaseBaselineIdentity(input);
export async function recheckReleaseBaselineIdentity(input, initialIdentity);
export function assertCandidateSourceInputs(input);
export function parseRunnerPolicy(value);
export function buildSafeBaselineManifest(input);
```

`parseRunnerPolicy()` accepts only a closed JSON object whose policy IDs/target label are exact constants, image values match `name@sha256:<64 lowercase hex>`, audit ID matches `/^[a-f0-9]{8}-[a-f0-9-]{27}$/`, and no unknown fields exist. `buildSafeBaselineManifest()` accepts structured safe enums/IDs—not `process.env`, arbitrary strings, paths, URLs or child output.

- [ ] **Step 1: Write failing migration isolation tests**

  In `scripts/migrate-control-plane.test.mjs`, assert:

  ```js
  expect(() => requireTestDatabaseUrl({ DATABASE_URL: "postgres://prod" }))
    .toThrow("CONTROL_PLANE_TEST_DATABASE_URL is required");
  expect(requireTestDatabaseUrl({
    DATABASE_URL: "postgres://prod",
    CONTROL_PLANE_TEST_DATABASE_URL: "postgresql://test-db/control_plane_test",
  })).toBe("postgresql://test-db/control_plane_test");
  ```

  Also assert production CLI only selects `DATABASE_URL`; test CLI never reads/logs it; neither CLI creates a client before its required variable passes validation.

- [ ] **Step 2: Write failing identity/source/manifest tests**

  Use injected Git/fs runners to cover: dirty/untracked source; ignored `.env`; tracked `.npmrc`; ignored `.pnpmfile.cjs`; scratch-created dotenv; lightweight/mismatched/moved/deleted/recreated tag; tag-object/peeled SHA drift; global Git config presence; malformed policy/image/audit ID; URL/credential/newline/path child error fields; and unknown manifest properties.

  ```js
  expect(() => parseRunnerPolicy({ policyId: "https://user:secret@host" }))
    .toThrow("Invalid runner policy");
  expect(() => buildSafeBaselineManifest({ commandOutput: "postgres://user:pw@db" }))
    .toThrow("Unknown baseline manifest field");
  ```

  Every preflight failure must prove zero Docker spawn, zero database client, zero HTTP and zero evidence write.

- [ ] **Step 3: Run target tests and verify failure**

  ```bash
  pnpm exec vitest run \
    scripts/migrate-control-plane.test.mjs \
    scripts/lib/feishu-dev-release-baseline.test.mjs
  ```

  Expected: FAIL because the test-only migration entry and closed data contracts do not exist.

- [ ] **Step 4: Implement the two migration entry points and identity library**

  - Move existing migration behavior to `runControlPlaneMigrations({ databaseUrl, migrationsDirectory, pgModule, logger })`.
  - Preserve production `DATABASE_URL` CLI behavior; add test CLI that exclusively requires `CONTROL_PLANE_TEST_DATABASE_URL`.
  - Make identity require clean status, `git diff --check`, annotated tag object, tag object SHA, peeled SHA, HEAD equality, root `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`/`apps/miaoda-admin/package.json` SHA, migration runner SHA, continuous `0001`–`0004` migration SHA list, Git object format, Node/pnpm/Git version and OS/arch.
  - Source scan must reject source inputs in Global Constraints without serializing their names/values. It returns safe enum/boolean only.
  - Manifest serializer uses a literal allowlist of keys and fixed safe grammar; it never hashes or echoes raw stdout/stderr, error text, environment variables, URL or path.

- [ ] **Step 5: Run developer regression checks**

  Re-run the Task 1 Vitest command. Expected: PASS; this is Step 3 development feedback, not Step 5 evidence.

- [ ] **Step 6: Lead source integration review**

  Integrate only after explicit commit authorization and isolation from unrelated durable-worktree changes. Do not create release tag, run migration or touch Docker/Feishu.

## Task 2: Concrete hermetic runner and inner verifier

**Files:**
- Create: `infra/release-baseline/compose.yml`
- Create: `infra/release-baseline/Dockerfile`
- Create: `infra/release-baseline/runner-policy.schema.json`
- Create: `infra/release-baseline/runner-policy.example.json`
- Create: `scripts/verify-feishu-dev-release-baseline.mjs`
- Create: `scripts/verify-feishu-dev-release-baseline.test.mjs`
- Create: `scripts/run-feishu-dev-release-baseline-hermetic.mjs`
- Create: `scripts/run-feishu-dev-release-baseline-hermetic.test.mjs`
- Modify: `package.json`
- Depends on: Task 1 safe interfaces

**Interfaces:**

```text
pnpm verify:feishu-dev-release-baseline -- --lane no-egress
pnpm verify:feishu-dev-release-baseline -- --lane postgres-only
pnpm run:feishu-dev-release-baseline:hermetic -- --release-tag <annotated-tag>
```

The inner verifier has no `--output`, policy-ID, image-digest, target-label or arbitrary command options. Its entrypoint receives only a validated policy file mounted at `/run/fdev001/policy.json`, a read-only source mount, a disposable scratch directory, and a new evidence volume. Direct invocation without these mount/policy invariants creates only a rejected/development result; it can never create acceptance-eligible evidence. The host orchestrator is the only command accepted by Task 4.

- [ ] **Step 1: Write failing Compose/policy/orchestrator tests**

  With fake Docker/Git runners, test that the host orchestrator:

  - creates a fresh `git clone --no-local --no-checkout`, checks out the peeled commit detached with global/system Git config disabled, and rejects any ignored/tracked sensitive candidate input before runner spawn;
  - validates a real protected policy file against schema, checks `docker image inspect` RepoDigest with `--pull never`, creates a new empty Docker evidence volume, and rejects user-supplied output paths;
  - launches `no-egress` only with `network_mode: none`, read-only source, read-only offline store and disposable scratch;
  - launches `postgres-only` only after the no-egress result passes and Docker inspect proves `Internal: true`, exact runner/PostgreSQL membership, no default/host network, read-only source and secret-only test URL;
  - rejects policy file missing/invalid, mutable tag image, additional network, writable source, missing Docker audit identity, evidence-volume reuse, symlink/mount substitution or missing protected-CI provenance.

  Assert no actual Docker/Git/DB command executes in unit tests.

- [ ] **Step 2: Write failing inner verifier tests**

  Test both fixed lanes:

  ```js
  expect(noEgressCommands).toEqual([
    ["pnpm", ["install", "--frozen-lockfile", "--offline"]],
    ["pnpm", ["lint"]],
    ["pnpm", ["typecheck:server"]],
    ["pnpm", ["typecheck:admin"]],
    ["pnpm", ["test"]],
    ["pnpm", ["build"]],
    ["pnpm", ["build:admin"]],
    ["git", ["diff", "--check"]],
  ]);
  expect(postgresOnlyCommands).toEqual([
    ["pnpm", ["migrate:control-plane:test"]],
    ["pnpm", ["migrate:control-plane:test"]],
    ["pnpm", ["test:control-plane:postgres"]],
  ]);
  ```

  Assert every spawned child has an allowlisted environment, never receives production DB/proxy/npm injection/Feishu/Approval/Base/Drive/S3/AI config, no raw output reaches evidence, first failure stops its lane, and no verifier result can add unknown manifest fields.

- [ ] **Step 3: Write failing default-closed config contracts**

  Extend `server/lib/feishu/coupon-oa/three-source/config.test.ts` with isolated env reload/fakes: missing/blank/invalid feature config, empty allowlist and wrong stage reject exact p2p intake; rejection creates no task/effect; native-submit unavailable; fake Card/Approval gateway calls equal zero; no bridge/scheduler/worker/Bot client starts. Explicitly label effect-time fencing/card-send kill switch as FDEV-003, unimplemented and not implied by FDEV-001.

- [ ] **Step 4: Run target tests and verify failure**

  ```bash
  pnpm exec vitest run \
    scripts/verify-feishu-dev-release-baseline.test.mjs \
    scripts/run-feishu-dev-release-baseline-hermetic.test.mjs \
    server/lib/feishu/coupon-oa/three-source/config.test.ts
  ```

  Expected: FAIL because the runner/orchestrator/inner verifier/contracts do not exist.

- [ ] **Step 5: Implement constrained runner architecture**

  - Compose defines a `no-egress` service with `network_mode: none`; a `postgres-only` service and PostgreSQL 17 service are the only endpoints on a named `internal: true` network. No service joins the default network; source mount is read-only; evidence volume is new and Docker-managed; scratch is disposable; policy and test DB secret are read-only mounts.
  - Dockerfile is invoked only through a policy-bound digest-pinned image. It contains no project source, no secret and an offline pnpm store. Compose uses `--pull never`; missing image is No-go.
  - Host orchestrator accepts only release tag, creates/validates its fresh clone, checks policy/digest/network/mount/volume/policy-provenance/audit ID before each lane, and uses Docker inspect after each lane. It writes only safe structured evidence into the volume via exclusive no-follow creation relative to that volume root, then rechecks volume device/inode/mount identity.
  - Source is copied from read-only clone into lane-local scratch; post-lane tracked diff must be clean and sensitive generated runtime inputs fail. Scratch/output is destroyed; source clone post-check stays unchanged.
  - Inner verifier offers no generic child-command escape. It uses safe command IDs/argv above, bounded result enums, UTC/duration, no raw output/error. `migrate:control-plane:test` invokes only test CLI; production script remains unchanged.
  - Add `migrate:control-plane:test`, `verify:feishu-dev-release-baseline`, and `run:feishu-dev-release-baseline:hermetic` scripts. Do not change dev bridge, existing build/test behavior, lockfile, runtime feature config or production routes.

- [ ] **Step 6: Run developer regression checks**

  Run Task 2 Vitest command with fake Docker/Git/fs only. Expected: PASS and zero real Docker/DB/network/Feishu actions. This is still lifecycle Step 3.

- [ ] **Step 7: Independent source Review Agent**

  A fresh reviewer receives only frozen code/spec snapshot, confirms every Review Focus case and no FDEV-002/003 scope creep. Lead records their facts; defects return to Tasks 1/2 before a Test Agent starts Step 4 planning.

## Task 3: Formal test plan, evidence template and tracker transition

**Files:**
- Create: `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/feishu-dev-release-baseline-test-plan-v1.md`
- Create: `docs/oa-ticket-reimbursement-materials/records/durable-control-plane/feishu-dev-release-baseline-verification-template-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-requirements-tracker-v1.md`
- Modify: `docs/oa-ticket-reimbursement-materials/proposals/three-source/coupon-oa-feishu-dev-command-intake-release-plan-v1.md`
- Depends on: integrated Task 1/2 source and independent source review

**Interfaces:** Test Agent receives only the frozen source snapshot, command/schema interfaces and runner profile. It produces a test plan, No-go template and docs-contract assertion; it does not start runner or edit runtime environment.

- [ ] **Step 1: Test Agent writes failing docs-contract test**

  Assert test plan/template enumerate: fresh clone/source scans; tag-object+peeled+HEAD pre/post; protected-ref evidence; runner policy/image digests; two Docker network profiles; Docker inspect/audit artifact; new evidence volume/no user output; test DB secret only; closed manifest/no raw fields; all local/admin/PG command exit 0; default-closed cases; negative cases; zero prohibited service calls; Bugs, rollback and three signatures.

- [ ] **Step 2: Run docs-contract test and verify failure**

  ```bash
  pnpm exec vitest run scripts/verify-feishu-dev-release-baseline.test.mjs
  ```

  Expected: FAIL because formal plan/template do not exist.

- [ ] **Step 3: Test Agent writes formal plan/template**

  The plan must name exact policy IDs, Docker Compose services, Docker inspect claims, protected CI audit artifact lookup, immutable image digests, no-network/PG-only lane expected command results, test DB cleanup and all negative controls. It must state that no actual policy/digest/audit proof is No-go. Template is default **No-go / 未验收**, has closed safe fields only, and cannot contain URLs, credentials, paths, free text labels, raw output/log hash/log location or a prefilled Go.

- [ ] **Step 4: Independent Review Agent reviews the test plan**

  Verify the lifecycle boundary: Task 1/2 test runs are only developer regression; Test Agent plan/review is recorded in tracker with reviewer/date before real Step 5 results. Verify no test case starts Feishu/bridge/scheduler/Dev Bot.

- [ ] **Step 5: Lead updates docs status**

  Only after both source and test-plan review pass, update FDEV-001 from Step 3 to **Step 4: 出测试方案** and preserve all successors at Step 1. Docs contract must pass with no external side effect.

## Task 4: Formal hermetic clean-checkout testing

**Files:**
- Create only in a new Docker evidence volume: safe JSON/Markdown evidence named by UTC date + tag object SHA prefix
- Modify after actual result only: tracker and audit archive as a separate, explicitly authorized audit-only change—not the candidate tag
- Depends on: Task 3 approved test plan, protected CI policy/digest/audit setup and Release Owner authorization

- [ ] **Step 1: Preflight policy and candidate**

  Lead invokes only:

  ```bash
  pnpm run:feishu-dev-release-baseline:hermetic -- --release-tag <tag>
  ```

  Host orchestrator must create the clone, perform source/tag/ref scans, validate policy/image/audit requirements and create an empty evidence volume. It may not pull images, accept local attestation, use arbitrary DB URL/output path or start a runner before every precondition passes.

- [ ] **Step 2: Execute the two fixed lanes**

  - no-egress lane runs offline install, lint, both typechecks, full test, both builds and diff check; platform audit proves zero network endpoint.
  - PostgreSQL-only lane runs test migration twice and disposable-schema suite; platform audit proves only the PostgreSQL service endpoint exists and no external/default/host network is attached.

  Every check must exit 0. Cache miss, unknown generated sensitive input, admin failure, skipped required integration, nonzero check, external endpoint, changed source/ref, untrusted policy or evidence-volume anomaly is No-go.

- [ ] **Step 3: Execute negative controls**

  In fake/unit or disposable non-provider fixtures prove rejection of: dirty/moved/recreated tag, ignored dotenv/npm config, invalid policy/image/audit ID, local/non-protected provenance, writable source, extra/default network, missing/production-only DB URL, invalid secret mount, reused/substituted evidence volume, malformed manifest data and invalid config. Egress controls are proven from platform audit without attempting a Feishu/provider call.

- [ ] **Step 4: Post-check and Step 5 evidence**

  Host rechecks source/ref, image/mount/network/volume identity, test DB cleanup, zero prohibited service calls and no bridge/scheduler/Bot process. Only then may Lead write actual command-safe results into tracker Step 5. Test Agent reports facts, never 🥇 or unlocks FDEV-002.

## Task 5: Bug repair, non-deployment rollback and acceptance

**Files:**
- Modify only code/tests/docs identified by formal testing defects
- Modify tracker/evidence archive only after actual evidence, separate from candidate tag

- [ ] **Step 1: Register and repair each Bug serially**

  Lead gives every defect a stable FDEV-001 Bug ID with reproduction, impact, source file/commit, regression command and residual risk. Development Agent receives only written Bug, frozen code snapshot and test interface, adds a failing test, minimally repairs, then runs developer regression checks. Lead integrates serially.

- [ ] **Step 2: Test Agent retests formal matrix**

  Record prior failure, fixed ref, safe command ID/exit result, post-source/ref integrity and remaining scope. Any unresolved result is No-go.

- [ ] **Step 3: Non-deployment rollback drill**

  Confirm all command/card/native flags remain false; destroy only disposable clone/scratch/container/network/volume/test schema; verify Dev App, scheduler, bridge, legacy route and external provider state were never changed. Record that this is no-deployment cleanup, not an invented runtime rollback.

- [ ] **Step 4: Three-owner acceptance**

  Requirement Owner, Engineering QA and Runtime/Release Owner record Go/No-go, date, protected ref evidence, policy/digest/audit proof, clean source/ref result, all exit 0, secret/manifest scan, default-closed proof and cleanup conclusion. Any missing proof or nonzero required command is No-go. An acceptance-scope change requires a new user/Owner review of this plan.

- [ ] **Step 5: Mark 🥇 and unlock only FDEV-002**

  Only after three-party Go may Lead mark Step 7 `🥇 验收完成`, Step 8 as “FDEV-002 may enter Step 2,” and leave FDEV-003–008 unchanged. Evidence/docs commit needs explicit authorization and is never folded into the protected candidate tag.

## No-shared-context Multi-Agent Boundary

| Role | Written inputs only | Output | Prohibited actions |
| --- | --- | --- | --- |
| Plan Agent | Requirements/release docs and code snapshot | Independent plan/omissions report | Code edits, release decision, external action |
| Review Agent | Canonical plan or frozen code snapshot | Independent evidence-backed findings | Modify code/docs, tag, environment or services |
| Development Agent | Lead-frozen task, interfaces, failing test and code snapshot | Isolated-worktree code/tests change | Read Agent chats, tag/configure runner, change secrets/runtime or contact Feishu |
| Test Agent | Frozen code snapshot, formal plan and allowed runner facts | Test plan, evidence, Bug reproductions | Mark 🥇, deploy, edit runtime config or call external providers |
| Lead / Release Owner | Versioned artifacts/reports, never delegated conversation context | Serial integration, tracker, runner/tag/acceptance decision | Skip gates/lifecycle or delegate protected actions |

No Agent shares conversation context. Only finalized file paths, interfaces, code snapshots, command result records and structured Bug/evidence artifacts cross role boundaries. Integration order is plan/review → development → independent code review → Test Agent plan/review → formal testing → Bug loop → three-owner acceptance.

## Self-Review

- **Review coverage:** this revision fixes the two prior No-go designs by making all child execution run only inside concrete no-egress/PG-only Docker lanes and by rejecting ignored/tracked runtime inputs from an immutable fresh clone. It also closes policy/label free-text leakage and arbitrary-output TOCTOU with fixed closed schemas and a Docker-managed evidence volume.
- **Scope:** it adds only baseline/migration/test isolation artifacts. It does not make bridge/effect/scheduler/Dev App/material/OA behavior executable; those remain FDEV-002+.
- **Lifecycle:** Tasks 1–2 are development; Task 3 is the independently reviewed test plan; Task 4 is formal testing; Task 5 is repair/acceptance. No successor advances before 🥇.
- **No-go truthfulness:** platform policy/image/audit provisioning and current admin failures are deliberate acceptance gates. If unavailable, FDEV-001 is No-go—not a reason to weaken evidence or claim development release readiness.

## Execution Handoff

The v3 plan is saved to `docs/superpowers/plans/2026-10-09-fdev-001-dev-release-baseline.md`. It requires a fresh independent plan review and user/Release Owner approval before any code implementation begins.
