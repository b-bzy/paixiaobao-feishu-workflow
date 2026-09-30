# 优惠券 OA 附件上传“无响应”本地诊断

> **日期**：2026-09-29  
> **范围**：机器人「优惠券 OA 智能填报」在草稿 `COA-f9926e8f` 创建后，业务员发送 `.xlsx` 待补材料未收到机器人回复。  
> **结论状态**：已定位当前阻断原因；未部署、未修改 Vercel，也未创建任何 OA 或审批附件。

## 1. 用户现象

业务员已通过机器人表单创建草稿，卡片显示待补材料：满减测算图片、配券信息表（`.xlsx`）和商品明细白名单（`.xlsx`）。随后在与机器人的单聊中发送了名为 `平台承担100%配券明细表9.30-10.10.xlsx` 的文件，但界面未收到成功、失败或待补清单更新的回复。

## 2. 本地排查范围与方法

本次仅进行本地和只读诊断：

1. 检查本机 `long-connection-bridge.mjs` 进程、监听状态和桥接日志；
2. 启动本地 Nitro 服务，真实请求本地首页和 `/api/feishu/process` 回调入口；
3. 使用 `lark-cli api GET ... --as bot` **只读**回查已收到的两条附件消息元数据；
4. 阅读附件事件、消息回读、资源下载、审批附件上传和错误处理代码；
5. 运行本地单测：`events.test.ts` 与 `approval-client.test.ts`。

未进行的操作：修改/部署 Vercel、重启当前生产桥接、向审批附件库上传文件、创建 OA、写入或删除 Base 测试数据。

## 3. 已验证事实

### 3.1 附件事件已经到达本机桥接

本机 bridge 进程仍在运行，并消费了两个 `im.message.receive_v1` 的 `file` 事件。日志中有对应的消息 ID（本文不完整记录 ID）和两次下游失败：

| 附件事件 | bridge 下游结果 | 说明 |
| --- | --- | --- |
| `…7bc` | HTTP 400：`Feishu message did not include its original body` | 在事件到达后立即回读原始消息体时失败 |
| `…69` | HTTP 400：`Feishu approval file upload failed: No permission` | 已成功取得附件相关信息，但上传审批附件库时被飞书拒绝 |

因此，“无响应”**不是**附件消息没有发送到机器人，也不是 bridge 未运行。

### 3.2 当前 bridge 实际转发的是 Vercel，而非本地服务

运行中的 bridge 日志明确显示目标为：

```text
https://aihuishou-feishu-workflow.vercel.app/api/feishu/process
```

这意味着截图中发生的附件处理使用的是当前 Vercel 部署版本。虽然本次没有部署或改动 Vercel，但也不能把这次线上交互结果当作本地修改后的代码验证结果。

本地桥接应在后续 Draft E2E 中显式使用：

```sh
FEISHU_PROCESS_URL=http://localhost:3000/api/feishu/process pnpm dev:events
```

### 3.3 首条附件的原始消息体现在可被 bot 身份读取

对两条消息执行 bot 身份的只读 `GET /open-apis/im/v1/messages/:message_id` 后，均取得了：

```json
{
  "msg_type": "file",
  "body": {
    "content": "{\"file_key\":\"…\",\"file_name\":\"平台承担100%配券明细表9.30-10.10.xlsx\"}"
  }
}
```

这证明：

- 消息未被删除；
- bot 身份当前可以读取这两条消息；
- 文件名和 `file_key` 在消息体中存在；
- 首条日志中的“未包含原始消息体”不是附件本身永久缺少数据。

当前代码在事件到达后只做一次立即回读，没有重试：[`events.ts:110-176`](../../../../server/lib/feishu/events.ts#L110-L176) 与 [`approval-client.ts:115-129`](../../../../server/lib/feishu/coupon-oa/approval-client.ts#L115-L129)。因此，首条失败高度疑似是**消息体/API 的短暂可见性延迟**；另一个待确认可能是 Vercel 运行版本与本地工作区版本不一致。仅凭事后只读结果，不能断言二者中的哪一个是首条失败的唯一原因。

### 3.4 第二条附件的确定性阻断：审批附件上传没有应用权限

附件处理顺序是：

1. 回读原始消息取得 `file_key`；
2. 下载消息资源；
3. 调用 `POST /open-apis/approval/v4/files/upload` 获取审批 `file_code`；
4. 将附件元数据和 `file_code` 写入 Base 草稿；
5. 回复待补清单或预览卡。

第 3 步失败后，步骤 4、5 均不会执行。实际错误为：

```text
Feishu approval file upload failed: No permission
```

调用点位于 [`events.ts:149-166`](../../../../server/lib/feishu/events.ts#L149-L166)，实际上传接口及失败条件位于 [`approval-client.ts:153-184`](../../../../server/lib/feishu/coupon-oa/approval-client.ts#L153-L184)。

这是当前所有真实附件都无法成功处理的**确定性主阻断**。它与 PRD 已记录的约束一致：审批 v4 附件上传需要已开通且已发布的应用身份 `approval:approval` 权限；用户 token 不能替代该权限。

### 3.5 失败未回卡，导致用户侧表现为“完全无响应”

`handleCouponOaAttachment()` 中没有针对回读、下载、分类、上传、Base 更新失败的 `try/catch`，也没有发送错误卡。异常一路冒泡到 HTTP 回调层：

- 回调路由只记录 `console.error` 并返回 HTTP 400：[`process.post.ts:2-23`](../../../../server/api/feishu/process.post.ts#L2-L23)；
- bridge 将该 HTTP 400 写到本地日志：[`long-connection-bridge.mjs:53-63`](../../../../scripts/long-connection-bridge.mjs#L53-L63)；
- 飞书用户没有收到任何失败提示。

因此，**“无响应”是错误反馈缺失造成的产品问题，不是没有错误发生。**

### 3.6 已发送文件均被命名为“配券”文件，不能替代白名单

两条只读回查到的附件文件名均为：

```text
平台承担100%配券明细表9.30-10.10.xlsx
```

按现有规则，文件名含“配券”会分类为 `couponTable`；同一角色重复上传时，新附件覆盖旧附件，而不会填充 `productWhitelist`：[`draft-service.ts:65-126`](../../../../server/lib/feishu/coupon-oa/draft-service.ts#L65-L126)。

所以即使上传 API 权限修复后，这些同名文件也只会满足“配券信息表”，**仍不会满足“商品明细白名单”**。这不是本次无响应的原因，但会是下一步无法进入完整材料状态的原因。应另行发送文件名包含“白名单”的 `.xlsx`。

### 3.7 本地服务可启动，但当前未具备真实本地机器人联调配置

本地验证结果：

| 项目 | 结果 |
| --- | --- |
| `pnpm dev` | 成功启动于 `http://localhost:3000/` |
| `GET /` | HTTP 200，服务状态 `ok` |
| 本地回调 challenge | HTTP 200，challenge 原样返回 |
| 本地文本事件 | HTTP 400，`FEISHU_APP_ID and FEISHU_APP_SECRET must be configured` |

`.env.local` 当前未配置飞书应用凭证、Base App Token 和草稿表 ID；使用 `lark-cli` 长连接时，`FEISHU_VERIFICATION_TOKEN` 反而必须保持未设置，因为 bridge 不携带 HTTP webhook verification token。因此本次不能安全地把正在使用的 bridge 改指向本地后进行完整真人附件复现；那样只会在本地得到“未配置凭证”的假失败，无法验证真实链路。

本地测试在实现 local Draft Demo 后再次执行通过：

```text
Test Files  13 passed (13)
Tests       60 passed (60)
```

其中新增覆盖：本地模式的 Base-only 表单与保存回卡、保存校验失败回卡、附件不触发审批 API、遗留确认/提交 callback 不触发审批 API，以及同一业务员草稿更新而不重复创建。真实飞书 Base E2E 仍需要本机应用/Base 配置。

## 4. 根因判定

| 优先级 | 根因 | 置信度 | 对当前现象的影响 |
| --- | --- | --- | --- |
| P0 | 应用未获得或未发布 `approval:approval`，导致 `approval/v4/files/upload` 返回 `No permission` | 已证实 | 任何真实附件都无法完成上传、落库和后续回复 |
| P0 | 附件异常没有转化为机器人错误卡 | 已证实 | 用户只看到“无响应”，无法知道具体错误和下一步 |
| P1 | 原始消息体只做一次即时回读，无重试；首条消息在当时返回不完整，事后已可读取 | 高概率 | 首次附件可能随机失败，即使权限已修复仍不稳定 |
| P1 | 当前 bridge 指向 Vercel，不是 localhost | 已证实 | 本地代码无法参与实际飞书交互，阻碍本地调试闭环 |
| P2 | 重复发送“配券”文件，未发送“白名单”文件 | 已证实 | 权限问题修复后仍会卡在材料不齐，不会造成当前的静默失败 |

## 5. 建议的修复与验证顺序

### 5.1 已落地：本地固定字段 → Base Draft Demo（不创建 OA）

已实现独立的 `FEISHU_COUPON_OA_MODE=draft-demo` 模式，专门满足当前优先级的“固定字段自动填表并写入 Base”：

1. 机器人卡片改为“保存本地草稿”，明确说明仅验证固定字段自动写入 Base；
2. 表单在写入前校验活动名称、背景、真实日历日期、日期范围，以及寄卖/pop 的财务字段和超扣点原因；
3. 由应用 tenant token 将固定字段写入既有「优惠券提单草稿」Base 表；同一 `Owner Open ID` 重复保存会更新现有活跃草稿，而不是创建重复记录；
4. 附件消息、确认 callback 和正式提交 callback 会回“仅草稿”提示，且不会进入消息资源下载、审批附件上传、审批定义读取或实例创建；
5. 新增 `zsh scripts/check-coupon-oa-local-draft-demo.sh`，预检本地凭证、`draft-demo` 模式和 localhost bridge 启动命令，不输出任何密钥。

仍需由本机配置完应用凭证后，使用 `FEISHU_PROCESS_URL=http://localhost:3000/api/feishu/process pnpm dev:events` 完成真人 Base E2E；不会修改或部署 Vercel。

### 5.2 改善所有模式的错误可见性与稳定性

1. 为附件处理加统一错误边界：失败时记录包含 `message_id`、阶段（回读/下载/分类/上传/落库）的服务端日志，并向操作者发送不泄露 token/file key 的失败卡；
2. 对“回读原始消息体为空/类型不匹配”增加有限次数的指数退避重试；耗尽后回卡提示“附件消息仍在同步，请稍后重发”；
3. 在上传前先完成文件名/扩展名分类，避免无效文件也被上传至审批附件库；
4. 添加单测：消息体首读为空后重试成功、上传 `No permission` 时回错误卡、重复同角色附件覆盖、配券文件不能替代白名单。

### 5.3 未来真实 OA E2E 的前置条件

只有准备测试真实 OA 时，才申请 `approval:approval`，创建飞书应用版本并发布，必要时等待管理员审批；随后先用应用身份探针确认审批定义读取和附件上传返回成功的 `file_code`。这与本地草稿 Demo 是两条不能混用的测试模式。

## 6. 当前可执行结论

- 现有草稿和附件消息可保留，无需撤回 OA（本次没有创建 OA）；
- 在应用权限未发布前，继续向现有生产 bridge 发送附件仍会触发 `No permission`，不建议继续尝试；
- “固定字段自动填表单并写入 Base”的 local Draft Demo 已实现，下一步只需在本机填入应用/Base 配置、运行预检并让 bridge 临时指向 localhost 完成真人 E2E；
- 若目标改为真实 OA 附件联调，仍必须先解决 `approval:approval` 权限和应用发布，再进行一次脱敏样本的受控 E2E。
