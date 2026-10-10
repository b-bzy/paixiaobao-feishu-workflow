# 三源优惠券直接 HTTP draft-only POC：干净发布包范围 v1

> **状态：** 待审阅的 POC 发布范围；不是部署、上线、R2/R3 Gate 或原生 OA 通过证明。
> **日期：** 2026-10-10（取代 2026-10-09 的 R3 canary 范围表述）
> **目标：** 仅为一个具名测试用户整理严选三源 Bot → OA 测试稿所需的最小发布集；真实发送不在本范围。
> **关联：** [P0 最快 Bot POC 交付计划](../proposals/three-source/coupon-three-source-fast-poc-delivery-plan-v1.md) · [direct HTTP draft-only POC 运行手册](../current/operations/coupon-three-source-direct-http-poc-runbook-v1.md) · [ADR-0009](../../adr/0009-timebox-direct-http-callback-for-three-source-draft-poc.md)

## 已完成的受控资源准备

- 已由 Bot 身份创建隔离的三源试点 Base，包含 `Pilot ID`、`Owner Open ID`、`Status`、`Revision`、`Schema Version`、`Task ID` 与 `State JSON` 字段。
- 已由 Bot 身份创建隔离的三源试点 Drive 文件夹。
- 当前 CLI 用户对上述隔离资源拥有完整访问权限；Bot 已成功读取空的 Base 表与 Drive 文件夹。
- 本记录不写入 Base/Drive token、用户 open ID、secret 或附件内容。

上述资源准备不代表 Bot 路由已启用、环境变量已设置、Bridge 已运行或原生 OA 可以创建。

## 拟纳入发布的运行时代码

### 三源领域与标准产物

```text
server/lib/coupon-oa/three-source/types.ts
server/lib/coupon-oa/three-source/recognition.ts
server/lib/coupon-oa/three-source/lists.ts
server/lib/coupon-oa/three-source/workflow.ts
server/lib/coupon-oa/three-source/task.ts
server/lib/coupon-oa/three-source/offline.ts
server/lib/excel-template-engine/three-source.ts
server/lib/excel-template-engine/index.ts                 # 仅导出三源引擎的 hunk
server/lib/excel-template-engine/template-manifests.ts    # 多券档白/黑名单 manifest 的 hunk
server/assets/coupon-excel/商品明细白名单-多券档SKU-v1.xlsx
server/assets/coupon-excel/商品明细黑名单-多券档SKU-v1.xlsx
```

### 飞书三源适配与 OA 草稿交接

```text
server/lib/feishu/coupon-oa/three-source/assets.ts
server/lib/feishu/coupon-oa/three-source/cards.ts
server/lib/feishu/coupon-oa/three-source/config.ts
server/lib/feishu/coupon-oa/three-source/dispatcher.ts
server/lib/feishu/coupon-oa/three-source/handoff.ts
server/lib/feishu/coupon-oa/three-source/pilot-config.ts
server/lib/feishu/coupon-oa/three-source/service.ts
server/lib/feishu/coupon-oa/three-source/store.ts
server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts
server/lib/feishu/coupon-oa/excel-pilot-assets.ts          # 通用模板加载器的 hunk
server/lib/feishu/coupon-oa/excel-pilot-oa-handoff.ts      # 共享冻结附件 hash 校验的 hunk
server/lib/feishu/events.ts                                # 仅三源 command/file/card callback hunk
```

### 配置、试点资源与测试

```text
.env.example                                                # 仅三源专用变量 hunk
scripts/create-coupon-three-source-pilot-base.sh
scripts/create-coupon-three-source-pilot-drive-folder.sh
scripts/create-coupon-three-source-pilot-table.sh
.../coupon-three-source-pilot-base-fields-v1.json
```

对应单测应一并纳入：三源领域、adapter、存储、卡片、dispatcher、frozen-artifact handoff 与受影响 Excel handoff / events 回归测试。

## 明确排除的现有工作区改动

以下不属于这次严选三源 R3 canary 发布包：

- `server/lib/control-plane/`、PostgreSQL migration、对象存储、worker、durable ingress 和相关脚本；
- 对 bridge、package 依赖、`package.json` / lockfile 的其他控制面改动；
- 已存在的旧 OA / Excel 试点功能变更，除上文列出的最小共享 helper hunk；
- 不相关文档、Skill 删除/迁移、管理员前端与其他未跟踪文件；
- `task-repository.ts`、`task-service.ts` 及其 control-plane 适配，它们不在当前三源 Bot runtime import graph 中。

## 部署前必须写入受控环境的变量

值只能保存到部署环境的 secret/configuration store，不能提交到仓库、文档或聊天记录。本 POC 使用直接开发者服务器回调；变量名及取值边界以[运行手册](../current/operations/coupon-three-source-direct-http-poc-runbook-v1.md)为准：

```dotenv
FEISHU_RUNTIME_STAGE=local
FEISHU_LEGACY_POC_ENABLED=false
FEISHU_VERIFICATION_TOKEN=<仅部署环境保存；与飞书后台匹配>

FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=false
FEISHU_COUPON_THREE_SOURCE_PILOT_BASE_APP_TOKEN=<隔离 Base token>
FEISHU_COUPON_THREE_SOURCE_PILOT_TABLE_ID=<隔离表 ID>
FEISHU_COUPON_THREE_SOURCE_PILOT_FOLDER_TOKEN=<隔离 Drive 文件夹 token>

FEISHU_COUPON_OA_MODE=native-submit
FEISHU_COUPON_OA_ALLOWED_OPEN_IDS=<唯一 POC 测试用户>
FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false
FEISHU_COUPON_OA_NATIVE_SUBMIT_ALLOWED_OPEN_IDS=
```

发布后先维持 `FEISHU_COUPON_THREE_SOURCE_PILOT_ENABLED=false`。测试窗口中只为唯一用户临时开启它，且 native-submit kill switch 全程为 `false`。三源最终确认只能创建 OA 测试稿；不得点击或尝试绕过既有 OA 草稿的正式发送动作。

## 当前 No-go 项

1. 当前 main 工作区包含大量与三源 POC 发布无关的已修改、已删除和未跟踪文件；不得把整个工作区直接当作发布输入。
2. Vercel 项目已关联，但三源直接 HTTP POC 所需的受控环境变量、部署 revision 和开发者服务器回调尚未完成验证。
3. 本 POC **刻意不使用**企业托管常驻 bridge；这不构成 POC 阻塞，但也绝不能被解释为 R1/R2 managed bridge 已就绪。
4. `calcImage`、字段补充/覆盖、非 SKU 名单、耐久 receipt/outbox、worker、原生 OA 幂等与 `SubmissionUnknown` 对账均未完成；native-submit 必须保持关闭。
5. POC 仍需记录测试 Owner、单用户 allowlist、脱敏证据和回滚窗口；缺少其中任一项时不得开启 pilot flag。

## 审阅结论所需动作

1. 审阅本范围，确认只提取列出的 runtime 文件与精确 tracked-file hunk，且不携带无关工作区修改。
2. 在独立 release branch 中构造可复现 POC 发布包，运行服务端 lint、typecheck、全量测试与脱敏 E2E。
3. 由用户明确授权 release commit / push 后，才创建提交并交由既定部署机制发布。
4. 仅按 [direct HTTP draft-only POC 运行手册](../current/operations/coupon-three-source-direct-http-poc-runbook-v1.md)执行：challenge、单用户材料/卡片/产物/OA 测试稿验证，以及“没有 `POST /approval/v4/instances`”的脱敏证据。不得从该结论跳转到真实 OA 创建。
