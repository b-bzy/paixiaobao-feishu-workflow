---
name: coupon-three-source-replay-test
description: 三源优惠券链路真发自动重放测试。当用户要求"跑一遍测试用例""重放测试""回归测试三源流程""测一下卡片链路会不会卡住"时使用。默认测试集=桌面「测试用例」case1-9；文件/口令以用户身份经 lark-cli 发送，卡片动作用签名注入器提交，逐 case 记录时间线与卡点并产出 BUGLIST。纯测试授权流程：外部副作用（真发卡片、DeepSeek 调用、Preview 部署）需用户确认后执行。
---

# 三源链路真发自动重放测试

把真实测试用例喂进真实飞书链路：用户身份发文件 → 服务端真实识别（确定性+可选 AI）→ 注入器代替人工点卡 → 校验/生成/交接全程观测 → 卡点取证。

## 前置（Phase 0：环境预检，无副作用）

1. `pnpm p0:preview:status` —— 确认部署 SHA、bridge/worker 在线；不在线则 `pnpm p0:preview:up`（工作区不干净时按惯例 stash push -u → up → stash pop）。
2. 凭据源（全部不打印值）：
   - bridge 签名：`.local/p0-preview.env`（KEY_ID/SHARED_SECRET/BYPASS）
   - 部署 URL：`.local/p0-preview-state.json`
   - 用户身份：`.local/flow-replay.json`（ownerOpenId，0600）+ lark-cli 用户授权（`lark-cli auth status`，需 `im:message.send_as_user`）
   - 试点 Base：`.local/diag-base-app-token`（「优惠券三源提报试点」表；`.local/preview-diag.env` 里是旧绑定 token，已失效勿用）
3. 确认 draft-only / native kill switch 关闭。
4. AI 路径前置：部署环境需 `FEISHU_COUPON_THREE_SOURCE_P0_AI_RECOGNITION_ENABLED=true` + `DEEPSEEK_API_KEY`（仅 `AI_PRIMARY_ENABLED=true` 而缺这两者时，点 AI 按钮会报配置错误）。

## 工具

- `scripts/coupon-three-source-flow-replayer.mts`（`node --import tsx --env-file=.env.local` 运行）：
  - `send-text --text "clear" --label <case>` —— 以注入信封发文本口令（或用 lark-cli 以用户身份发，保真度更高）
  - `inject --action <名> --pilot-record <rec> --revision <n> [--form-file x.json] [--value-extra '{"role":"..."}'] --label <case>` —— 签名注入卡片动作
  - `watch --label <case> --seconds 6` —— 快照试点 Base，找新 CTS 草稿
  - `render-form --record <rec>` —— 渲染当前映射卡，输出表单字段名/必填/选项
- `lark-cli im +messages-send --chat-id <试点聊天> --file <相对路径>` —— 以用户身份发文件（绝对路径被拒，先 cd）
- 试点聊天：与「拍小宝」的 p2p（用 `lark-cli im +messages-search --query "OA优惠券提报"` 定位 chat_id）
- 证据目录：`.local/flow-replay/<case>/`（timeline.jsonl、state-*.json、表单 JSON；git 忽略，真实数据不入库）

## 默认测试集（桌面「测试用例」case1-9）与期望基线

每个 case 的固定节奏：**清场（clear）→ 发 `/OA优惠券提报` → 发该 case 文件 → watch 找新 CTS → （可选）注入 AI 识别 → render-form 填表 → inject mapping_confirm → 验证 DraftOnlyConfirmed + 产物 + oaDraftRecordId**。

| Case | 文件 | 预期 | 已知卡点/填表要点 |
| --- | --- | --- | --- |
| case3 | 配券型号表10.16-10.20 + 商品明细白名单10.16-10.20 | ✅ 一轮过 | 需白名单维度确认（SKU+SPU 双列，选 SKU+理由）；补：背景/日期/超扣/点位 |
| case4 | 配券型号表10.14-10.18 + 平台承担100%配券明细表 | ✅ 一轮过 | 新格式最干净 |
| case1 | 新商9月优惠券 + 商家ID_新商9月 | ✅（需填渠道+allowGift） | 老格式方言：allowGift=是；不填渠道=11310 死局复现变体（预期失败样本） |
| case2 | 10月新商双十一前置 + 商家ID_前缀 | ✅ | 同 case1 方言；预填 owner_allowGift 可一轮过 |
| case5 | 9.1-9.2乐器 + 乐器-白名单乐器商家id | ✅ | claimRule=每天可领一次 → 预填活动期间每天可领一次 |
| case6 | 平板优惠券申请3.30-3.31 + 平板常规店铺SKU(2) | ✅（AI 路径） | 2872 行大名单；AI 后会多暴露 owner_useWindow |
| case7 | 平板3.24-3.26 + 同上白名单 | ✅（AI 路径） | claimRule 方言恢复环 |
| case8 | M系列Mini主机 + M系列Mini主机SKU | ✅ | 470 行小名单 |
| case9 | 8 文件多源（2 配券表+5 白名单+SPU） | ⛔ 预期结构性卡死 | 多文件角色队列死滞（已知 BUG-9-1）；跑完记录状态即收队 |

标准填表基值（在 render-form 输出的字段上套用）：`业务模式=pop`、`活动名称=本地自动测试-<case>-<标识>`、`活动背景=本地自动测试：…不创建真实 OA`、`是否超扣=否`、`活动积分比例=6`、`公开推广渠道=单品页购物车`（老格式表）、`claimRule=活动期间每天可领一次`（老格式表）、`blacklistDecision=absent_confirmed`。

## 已知问题速查（详见 BUGLIST）

- **11310**：publicPromotionChannels 同时进待修正区+可选补充区 → 同名组件整卡拒收 → 失败被吞。触发条件唯一：公开自动推广+渠道空。
- **多文件角色队列**：确认 1 个后 pendingSources 不推进；旧角色卡全变死卡。case9 跑到此处即为目标结果。
- **枚举方言**：恢复卡修正入口是自由文本框（预填 owner_* 可绕开一轮往返）。
- **商家ID名单**：现有门禁只有「确认是 SKU」单选项（方案 A 落地前的已知限制）。

## 收尾

1. 汇总 `.local/flow-replay/` 证据 → 更新/产出 BUGLIST.md（真实数据留在 .local，移入 docs 前必须脱敏）。
2. 结束后发 `clear` 清场（级联取消三源+OA 草稿）。
3. 汇报：每 case 结果表、卡点清单、修复归属（方案A/B/新立项）。

## 纪律

- 真发卡片、DeepSeek 调用、重部署属外部副作用，执行前须用户确认；每 case 结束主动汇报再进下一个。
- 文件只能以用户身份发（跨应用伪造 file_key 不可行）；event_id/message_id 一律全新，绝不重放。
- 注入即代用户声明字段事实：活动名/背景一律带「本地自动测试」前缀，保证草稿可辨识。
- 用户测试期间不要手点卡片（revision 竞态会污染结果）。

## 一键回归（2026-10-17 新增，优先使用）

`node --import tsx --env-file=.env.local scripts/coupon-three-source-replay-all.mts`
——串行跑 9 case 全流程：clear → 提报 → 以用户身份发文件 → 角色队列逐份确认（case9 内置角色计划）→ 注入 AI 识别并等待各槽位终态 → 渲染映射卡智能填表（枚举选合法值、数字填合法数）→ 确认（带 revision 竞态重试，经恢复卡最多 4 轮）→ 终态校验。`REPLAY_ONLY=case6,case9` 只跑指定 case。输出 `.local/flow-replay-r2/<case>/final-state.json` + `summary.json`。

**期望基线（修复版 5a0e318 实测）**：9/9 `DraftOnlyConfirmed`；case9 到 rev14、三槽 AI、白黑双名单；每案测算图恰 1 张。

**已知坑**：
- 跑前确认 bridge/worker 活着（`pnpm p0:preview:status`）；长连接判死或 worker 8 连败会静默退出，表现为"口令有效但文件断流"→ down/up 重启。
- 多次注入可能被 AI 横幅等后台更新的 revision 守卫弹回（预期），脚本已重试；真人不会遇到。
- 单案 ~2 分钟，case9 ~7 分钟（8 文件 + 6 次角色确认 + 3 槽 AI）。
- 瞬时"系统未完成本次处理"（无校验问题、revision 不动）=环境抖动，重跑该 case 即可。
