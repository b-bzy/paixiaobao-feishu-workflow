---
name: p0-stuck-diagnosis
description: 三源优惠券 P0 飞书 E2E"卡住/没反应/等不到卡片"的固定排障流程。当用户报告卡在某个步骤、AI 识别中不动、点了按钮没反应、卡片没收到、effect 失败、死信，或要求定位当前卡在哪个阶段时使用。按漏斗从外到内收敛：bridge 时间线 → worker tick 语义 → AI 诊断端点 → Base 直读 → 真发复现 → 本地构建定位 → git 定位引入提交。纯本地诊断协议，不执行任何服务端逻辑，不授予飞书/Base/OA 权限。
---

# P0 卡死排障漏斗

目标：用最少的步骤回答两个问题——**卡在哪个节点**、**为什么过不去**。每一层都有明确的"健康/异常"判据，异常才进下一层；不要跳层（真发和 Base 直读有外部副作用与成本，前两层通常已排除一半假设）。

权威事实源优先级与更多历史坑位：`docs/` 的 ADR/current 顺序，以及排障手册记忆（p0-e2e-debugging-playbook）。本 skill 只是把这些固定成动作序列。

## 第 0 层：时间线与进程（无副作用，必做）

1. `pnpm p0:preview:status` — 确认 bridge/worker 都 `true`、部署 SHA = HEAD。
   - bridge/worker 有一个为 `false` → 先 `pnpm p0:preview:down && pnpm p0:preview:up` 恢复，再重现问题。`down` 对"已登记但已退出的 PID"会报错但仍先杀掉活着的那个进程，报错可容忍，确认 `ps` 无残留即可 `up`。
2. bridge 日志 `.local/p0-preview-bridge.log`（按当前 UTC 时段过滤）：数用户动作。
   - `received <type>: id=…` 但没有对应 `forwarded … status=200` → 转发层问题（超时/重试看同日志）。
   - 全部 `forwarded status=200` 而用户没收到卡 → 问题在服务端投递，进第 1 层。
   - 注意日志时间是 **UTC**；北京时间 = UTC+8，先对齐再和用户核对"几点卡的"。
3. worker 日志 `.local/p0-preview-worker.log`：
   - `processed jobs=0 effects=0` **不是空闲**——只在 `claimed>0` 时打印，含义是"认领了但全部失败重试"（见 `scripts/lib/p0-control-plane-worker-loop.mjs` 的打印条件）。连续多行 = 有 effect 在反复失败；之后恢复沉默 = 重试烧完进死信。
   - `tick failed (no_response)` 连续出现 = 本机代理(127.0.0.1:7897)抖动或通道问题，先 `nc -z 127.0.0.1 7897`。

## 第 1 层：AI 诊断端点（判断"识别/投影/投递"断在哪段）

```bash
# 密钥在 .local/p0-preview.env,只在子 shell 注入请求头,不回显
( set -a; source .local/p0-preview.env; set +a; curl -sS --max-time 40 \
  -H "authorization: Bearer $CONTROL_PLANE_TICK_TOKEN" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  "https://<deployment-url>/api/internal/control-plane/ai-diagnostics" )
```

读最新 run，按字段定位断点：

| 现象 | 结论 |
| --- | --- |
| 无今天的 run | 事件根本没进来或任务没入队，回第 0 层对时间线 |
| `status != succeeded` | AI 调用失败，看 `fallbackCode`/`durationMs`（超时类） |
| `succeeded` 但 `projected=false` | 投影写入失败（历史案例：投影对着已取消草稿无限重试） |
| `succeeded + projected=true` 但 `draftProjection.mappingCardPersisted=false` | **识别没问题，投递段失败**——最常见卡点，进第 2 层 |
| 白名单 run 是盲区 | 此端点只覆盖 `source_slot=couponTable`；白名单要直读 Base |

Vercel 日志（`npx vercel logs --deployment <url>`）只有几分钟窗口且 **effect 的 send 失败原因只存 PG `last_error_message`、无日志出口**，所以"抢日志"通常拿不到东西，别在这里耗时间。

## 第 2 层：Base 直读（草稿状态权威）

State JSON 是三源草稿唯一权威（`Revision/Status` 列只是展示投影）；`lark-cli base +record-list` 的响应是矩阵格式：字段名在 `data.fields`，行是**数组**（`data.data`），record_id 在 `data.record_id_list` 平行数组。

判据（活跃草稿 = Status 非 Canceled/DraftOnlyConfirmed）：

- `task.sources` 两个 role 是否都有 fileKey/sha256、`pendingSources` 是否为空 → 判断"材料是否传齐"。
- `recognitions.<slot>.ai.primary` 是否存在 → 判断识别是否成功落盘。
- `mappingCardDelivery` 是否存在且 revision 与 `task.revision` 一致 → 判断投递段是否完成。
- `blacklistStatus=absent_pending_confirmation` 等待确认状态 → 判断下一步该发哪张卡。
- 写入类排查永远**独立 GET 回读验证**，不信 PUT 回显（Base 会静默丢弃超长值）。

## 第 3 层：真发复现（拿到飞书的权威报错）

飞书是卡片 schema 的唯一裁判，且报错带精确 ErrPath。用审计工具对真实草稿真发（发后自动撤回，目标=草稿 owner 本人，属 runbook 授权流程）：

```bash
# 1. 导出真实草稿(补顶层 ownerOpenId——它在 Base 独立列,不一定在 State JSON 里)
# 2. 干跑确认构建器不抛错
pnpm audit:cards -- --draft .local/<导出>.json
# 3. 真发 + 撤回,拿精确报错
pnpm audit:cards -- --draft .local/<导出>.json --send --only REAL-DRAFT
```

真发失败即得 ErrCode+ErrPath（本次事故：`11310 name exceed the default maximum 100`）；真发成功则问题不在卡片内容，转向 effect/幂等/租约方向。

## 第 4 层：本地构建定位 + git 定位引入提交

1. 用 `scripts/scan-card-limits.mjs`（本 skill 附带）在本地构建同一张卡，扫描全部字符串属性，列出超长项及 JSON 路径——把 ErrPath 对到具体模板。
2. `git log -S "<name 前缀>" -- <cards.ts>` 定位是哪次提交改了模板；对照该提交前后的部署时间与"上次成功发卡"的时间，确认因果。

## 常见红噪（不要被带偏）

- 旧日志文件是追加写：tail 看到的 `tick failed` 可能是上个会话的，先按时间戳分段。
- 截图/人肉描述不可靠：revision、字段是否为空以 API 回读为准。
- `processed jobs=0 effects=0` ≠ 空闲（第 0 层已述，最易误判）。
- 版本冲突卡（"提报版本已变化"）是守卫在正确工作，通常不是根因而是并发/重发的**结果**。

## 修复后必做

1. 死信不会自愈：修复部署后需重新触发投递（重传文件推进 revision，或按授权手工补发）。
2. 对修复涉及的新卡片形态重跑 `pnpm audit:cards -- --send`（干跑不校验飞书 schema）。
3. 回归测试补"生成的 name/属性长度 ≤ 飞书上限"断言，防止同类再犯。
