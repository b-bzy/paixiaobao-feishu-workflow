# 三源提报 Drive 下载 403 诊断与修复

> **状态**：已定位并修复（代码侧）；复测待 P0 Preview 重新部署后进行。
> **当前依据**：阶段与 go/no-go 以 [rollout](../../current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) 为准。

> **日期**：2026-10-13
> **范围**：Bot「拍小宝」三源提报 P0 试点，点击最终确认后 `自动填写 OA 草稿` 阶段，冻结 Drive 产物回读校验。
> **现象**：错误卡片「OA 优惠券三源提报未完成 / 原因：Feishu Drive file download failed: 403」。

## 1. 失败路径与初步误判

三源流程在确认后由 `uploadVerifiedCouponOaArtifacts`（`server/lib/feishu/coupon-oa/frozen-artifact-handoff.ts`）对每个冻结产物调用 `downloadFeishuDriveFile` 做字节数与 SHA-256 校验。原实现使用：

```text
GET /open-apis/drive/v1/medias/{file_token}/download   ← 错误端点
```

该端点是「下载素材」，仅服务**云文档素材**（docs 图片、多维表格附件等），且要求对素材单独授权；对 `parent_type=explorer` 上传的**云空间资源文件**一律返回 HTTP 403（空响应体，无 JSON 错误码）——与卡片现象一致。

初步排查曾怀疑应用缺少 Drive 下载权限（参照 [2026-09-30 Excel 试点记录](coupon-excel-pilot-drive-download-403-resolution-2026-09-30.md)）。经开放平台后台核实：**`drive:drive:readonly`（查看、评论和下载云空间中所有文件）已开通且已随 v1.0.4（2026-09-30 16:00）发布**，权限不是根因。09-30 记录中的「等待权限发布后复测」方向有误：权限发布后该应用同样会 403，因为端点用错了。

## 2. 探针对照实验

使用应用凭证对试点文件夹「优惠券三源提报-R3单用户试点-20261009」（应用为所有者）执行 上传探针文件 → 双端点下载对照 → 清理：

| 步骤 | 结果 |
| --- | --- |
| upload_all 上传（parent_type=explorer） | 200 / code 0 |
| metas/batch_query | 200 / code 0 |
| **medias/{token}/download（旧实现）** | **HTTP 403，空 body** |
| **files/{token}/download（正确端点）** | **HTTP 200，字节完全一致** |
| 删除探针文件 | 200 / code 0 |

探针脚本为一次性临时脚本（曾位于 `/tmp/feishu-drive-probe/probe.mjs`），未在试点文件夹遗留任何文件。

## 3. 修复

`server/lib/feishu/drive-client.ts` 的 `downloadFeishuDriveFile` 改为：

```text
GET /open-apis/drive/v1/files/{file_token}/download
```

并注释说明端点边界：冻结产物是 explorer 云空间文件，必须走 files 下载端点；medias 端点只服务云文档素材。`server/lib/feishu/drive-client.test.ts` 同步断言新端点（作为回归钉）。

验证：`drive-client` / `frozen-artifact-handoff` / `excel-pilot-oa-handoff` 共 21 个用例通过；`pnpm typecheck:server` 通过（`typecheck:admin` 的 `@types/react` 缺失为存量环境问题，与本修复无关）。

## 4. 复测步骤

1. 将 `p0-three-source-direct-http` 分支重新部署 P0 Preview。
2. 在失败卡片上「使用最新卡片重试」一次（无需重新生成或上传材料，冻结产物保留）。
3. 预期：下载与 SHA-256 校验通过 → 附件上传审批附件库 → 系统 OA 草稿自动填写完成 → 停止在人工预览/最终确认之前；不会自动提交原生正式 OA。

## 5. 教训

- 飞书 Drive 有两套下载端点：`files/{token}/download`（云空间文件）与 `medias/{token}/download`（云文档素材）。403 空 body 是端点/资源类型不匹配的典型症状，不能一律归因于应用 scope。
- 开放平台「相关 API/事件」列出的 API 覆盖范围以资源类型为前提；判断权限问题时先用最小探针在目标资源类型上做对照实验。
