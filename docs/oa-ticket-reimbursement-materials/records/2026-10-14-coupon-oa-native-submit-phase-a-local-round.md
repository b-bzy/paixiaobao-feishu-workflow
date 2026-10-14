# 优惠券 OA native-submit 阶段 A 本地测试轮用例(2026-10-14)

> **范围与环境**:验证 native-submit 打通方案阶段 A 修复(P0 入口放行、双提交守卫、SubmissionUnknown 不抹 code、提交时附件重验重传、Confirmed 可取消、bridge bus 看门狗)在本机和本地栈上的行为。**本轮 kill switch 保持关闭**(`FEISHU_COUPON_OA_NATIVE_SUBMIT_ENABLED=false`),不创建任何原生 OA 实例。部署(上线)Vercel Preview 前须先完成 ADR-0013(见文末 Gate)。
>
> 代码基线:工作区未提交改动(基于 dcaf96e)。

## 一、自动化用例(vitest,已执行)

| 组 | 文件 | 覆盖点 |
| --- | --- | --- |
| 场景轮 | `server/lib/feishu/coupon-oa/p0-passthrough-scenario.test.ts` | ①确认→提交被 kill switch 拦(草稿保持 Confirmed)→重复确认重发提交卡→放弃→僵尸卡明确报错,五步状态/卡片断言;②Submitting 中双击提交→「正在提交」卡、不触发二次提交 |
| 入口路由 | `server/lib/feishu/events.test.ts`(three-source P0 ingress passthrough 组) | 三源草稿 confirm 放行到提交卡;confirm 失败回错误卡(非 500);重复 confirm 重发;非三源 schemaVersion 草稿回「当前入口仅支持三源提报交接」卡且零写入;Confirmed 可取消;无关 action 仍静默忽略 |
| 存储守卫 | `server/lib/feishu/coupon-oa/draft-store.test.ts` | 快照状态漂移拒绝写入(无 PUT);存储态已终态拒绝;写后状态落盘校验;`persistCouponOaSubmissionOutcome` 终态不让并发覆盖、非终态从新鲜快照写入 |
| 提交服务 | `server/lib/feishu/coupon-oa/submit-service.test.ts` | 守卫检测到并发领位即停止(不触 create);Unknown 前回读、并发方已有 code 转 CreatedNeedsReview 不抹 code;提交时重下 Drive+SHA-256 校验+重传换新 file code(表单含新 code);无 fileToken 旧路线跳过刷新;原有 6 项(冻结 hash、Gate 顺序、回读失败保全、Unknown)不回归 |
| 生命周期 | `server/lib/feishu/coupon-oa/workflow-lifecycle.test.ts` | Draft/Validated/Failed/Confirmed 可 owner 取消;Submitting/Submitted/SubmissionUnknown/CreatedNeedsReview 不可自助取消 |

执行命令与预期:

```bash
pnpm test                          # 全量:648+2 通过,0 失败
pnpm typecheck:server              # 通过
npx biome check server/lib/feishu/ # 改动文件无告警(存量 2 条不属于本次)
```

## 二、本地手动 E2E 清单(需在飞书内点击,kill switch 关闭)

前置:本地栈已拉起(本地 Nitro + 本地 bridge 指向 `http://localhost:3000/api/feishu/poc-bridge`),worker 停用不影响本轮(不触发 AI 新任务)。

| # | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| M1 | 三源主流程回归 | `/clear` → `/OA优惠券提报` → 上传配券表+白名单(+测算图) → 二轮确认(只点一次) | 与既有行为一致,最终出现第 5 步卡 |
| M2 | final confirm 交接 | 点「确认并创建 OA 测试稿」 | 出现「优惠券 OA 预填确认」卡(第 2 步),**不再无响应** |
| M3 | 进入提交页(核心新路径) | 预填卡点「确认进入提交页」 | 出现第 3 步卡「确认提交正式优惠券 OA」,含「确认提交正式 OA」与「放弃本次提交」两个按钮 |
| M4 | kill switch 关闭提交 | 第 3 步卡点「确认提交正式 OA」 | 失败卡含 `kill switch is closed`;Base 草稿状态仍为 Confirmed |
| M5 | 连点韧性 | 快速连点「确认提交正式 OA」两三次 | 每击都有卡响应(失败卡或「正在提交」),不出现无响应;Base 无重复写入痕迹 |
| M6 | 重复确认收敛 | 第 3 步卡出现后,回到预填卡再点「确认进入提交页」 | 重发第 3 步卡(不报错、不重复冻结) |
| M7 | 放弃出口 | 第 3 步卡点「放弃本次提交」 | 「优惠券 OA 草稿已结束」卡;Base 状态 Canceled |
| M8 | 僵尸卡明确报错 | 取消后再点旧的第 3 步卡「确认提交正式 OA」 | 明确错误卡(不能提交/状态不对),非无响应 |
| M9 | bus 看门狗(运维用例,由 agent 执行) | 杀掉 `_bus` 进程 | ≤60 秒内 bridge 退出,`pnpm p0:preview:status` 反映异常;重启后恢复 |

验证方法:每步对照本地 Nitro 日志(事件 id 与处理结果)、`.local/p0-preview-bridge.log`(带时间戳的 received/forwarded 行)、Base「优惠券提单草稿」表的状态/revision 列与 State JSON。

## 三、本轮明确不测

- 真实创建原生 OA(kill switch 关闭;开闸属阶段 C/G2,另行 canary)。
- 飞书 `uuid` 幂等性、file code 时效、contact scope(外部事实,阶段 C 验证)。
- `apps/miaoda-admin`(前端 typecheck 存量缺 `@types/react`,与本次无关)。

## 四、上线 Gate(全部通过后)

1. 新增 ADR-0013:时间盒 native-submit 路由 canary,显式放宽 ADR-0010 边界 2/5 的范围与停止条件(先于部署合入);
2. rollout 计划补「P0 Preview 路由放行 canary」节(引用 ADR-0013,kill switch 保持关闭);
3. Conventional Commit 提交本轮改动 → `pnpm p0:preview:down && pnpm p0:preview:up` 全新部署 → 用 M2–M8 在 Preview 上复测一轮。

## 执行记录

### 自动化轮(2026-10-14 10:40)

- `pnpm test`:**109 文件 / 650 用例通过**(含新增场景轮 2 例),0 失败;
- `pnpm test:coupon-three-source:offline`:10/10;`pnpm test:coupon-activity-copy`:8/8;
- `pnpm typecheck:server`:通过;
- biome:全部改动文件无告警。

### 本地栈(2026-10-14 11:00,手动轮环境)

- 基础设施:本地 PostgreSQL + MinIO(`pnpm infra:up`)已迁移;
- 本地 Nitro:`[::1]:3001`,env 组装自 `.env.local` + 本地诊断令牌 + 实测反查的试点 Drive 文件夹与审批定义(控件逐项比对通过),kill switch 关闭;
- 本地 bridge:→ `http://localhost:3001/api/feishu/poc-bridge`,revision 校验 dcaf96e 通过,共享 bus TCP 建立;
- tick 循环:有界(≤2 小时,4 秒间隔),供 M1 AI 识别;
- **M9 bus 看门狗实测通过**:kill `_bus` 后消费者 5 秒内退出(code=0),bridge child-exit 看门狗让进程组整体退出;新增的 bus 健康检查作为二层防御(bus 死而消费者未察觉的场景)。僵尸 TCP websocket 仍不可外部检测,值守需盯事件流。

### 手动轮(M1–M8)

- 待执行(需在飞书中点击;预填卡按钮在本轮首次可用)。

### 本地环境与第二轮卡 UX 修复(2026-10-14 12:2x–12:5x,根据首轮反馈)

本地环境修正:`FEISHU_COUPON_OA_MODE` 误继承 `.env.local` 的 `draft-demo`(三源 Gate 拦截+OA 交接不可用),改为 `native-submit`;补 `FEISHU_COUPON_THREE_SOURCE_P0_AI_PRIMARY_ENABLED=true` 与 `FEISHU_COUPON_THREE_SOURCE_P0_ACTIVITY_COPY_ENABLED=true`(缺失导致 AI 识别成功但候选按非主处理,第二轮表单无预填);清理独占的陈旧 OA 草稿(Base 手动置 Canceled)。

第二轮卡 UX 修复(代码,自动化 652 例全过):

1. 超扣从"两个回调按钮+PATCH 刷新"改为**表单内下拉**(否/是,带默认值),超扣原因输入框常驻(标注"选'是'时必填",由服务端提交校验),消除"点击后整卡刷新清空已填内容"问题;删除废弃的 `coupon_three_source_over_deduction_select` 回调。
2. 「语音或文字补充说明」去掉必填标记(服务端对空文本仍有明确提示,不误触发识别)。
3. 「确认信息并生成标准附件」提交后**立即 PATCH 本卡为"标准附件生成中"(无按钮)**,消除重复点击窗口;`GeneratingArtifacts` 状态门保留为硬防线。
4. 提交改为**先中文预校验再推进版本**:缺业务模式/名称/背景/起止日期/超扣选择时直接回"请先完整填写:…"错误卡且 revision 不变(可原地重试);日期格式错误("9月30日")仍走 AI 修复流;开始/结束日期输入框常驻表单(带 AI 预填默认),修复 `activityStartAt undefined` 裸 zod 报错的根因。

### 确认身份降级为尽力而为(2026-10-14 14:3x)

实测确认环节被 `Feishu user profile did not include a stable applicant identity` 卡死;以 bot 调 `/contact/v3/users/{open_id}` 返回空壳档案(仅 open_id,无姓名/user_id/部门)——应用缺通讯录读取 scope。用户质疑设计过度成立:原生发起时平台自动带出通讯录信息,实例申请人由 create 请求的 open_id 指定,表单编码(approval-schema.ts)本就条件省略身份控件、回读 diff 只比对已提交控件、预览卡有兜底文案——仅 `resolveFinalConfirmerIdentity` 硬抛错。

修复:空壳档案/部门歧义 → openId-only 身份快照(审计所需稳定确认人= openId);userId/displayName/departmentOpenId 变为可选;open_id 不匹配仍拒绝。自动化用例含空壳确认、歧义降级、openId-only 提交不含身份控件、错人拒绝。

**canary 前验证项**:目标定义「部门」「申请人」控件 required=true(2026-10-14 实测)。开 Gate 后需验证飞书对省略的必填身份控件行为:自动填充(如原生)或干净拒绝;若拒绝,补 `contact:user.base:readonly` + `contact:user.department:readonly` 并发版,代码自动恢复全量快照。

### 链路最终收敛 + 桥接超时重发根因确认(2026-10-14 15:0x)

- **"重复点击"实为桥接超时重发**:bridge 日志证实 13:57-14:00 的三次点击转发延迟 14-18 秒(超过 10s 默认超时被重发),服务端各处理两次,第二次被状态/版本守卫拦截——用户单次点击无误。修复:转发超时提至 30s(本地与 p0-preview 部署脚本均已设 `FEISHU_BRIDGE_FORWARD_TIMEOUT_MS=30000`),并在 mapping_confirm 入口对已完成提报加重发收敛(重发→重送发送卡,不再报版本冲突)。
- **链路按用户授权收敛为全程一次确认**:第二轮确认后自动 生成→交接 OA 测试稿→直达唯一的「第 5 步:核对后确认发送」草稿卡(含放弃出口);链路=上传→解析→补充字段→草稿卡→确认即发送。handoff 失败自动回退第 5 步经典卡可重试。PRD/ADR-0013/rollout 已同步。
