# 优惠券 Excel 试点 Base 附件归属错误诊断与修复方案

> **日期**：2026-09-30
> **范围**：Bot「优惠券Excel试点」在白名单映射确认后生成 Excel，并将生成文件关联到 Excel 试点 Base 草稿。
> **结论状态**：根因已由桌面端真实联调验证；修复待部署验证。

## 1. 用户现象

以下流程已成功完成：

```text
优惠券Excel试点
→ 字段确认
→ 上传文本格式 SKUID 白名单
→ 选择“白名单 / A（SKUID，3 条）”
→ 确认映射并生成 Excel
```

生成阶段的 Bot 错误卡为：

```text
Feishu Excel pilot draft request failed:
The attachment does not belong to this bitable.
```

这证明源文件上传、下载、SKU 列识别、映射确认和内置模板读取均已进入生成链路；失败发生在将生成文件写入 Excel 试点 Base 记录的附件字段时。

## 2. 根因

系统此前执行：

```text
生成 workbook bytes
→ 上传普通 Drive 文件夹
→ 获得 Drive file_token
→ 直接写入 Bitable 附件字段
```

普通 Drive 文件的 `file_token` 不属于目标 Bitable。飞书拒绝将它赋给 Base 附件字段，因此返回：

```text
The attachment does not belong to this bitable.
```

这不是源白名单格式、Drive 文件夹协作者权限或原生 OA 权限问题。

## 3. 采用的修复模型

每个生成文件保留两个明确用途不同的 token：

| token | 存储位置 | 用途 |
| --- | --- | --- |
| `fileToken` | 配置的普通 Drive 文件夹 | 冻结版本、hash 校验、后续 Excel → OA 草稿提升时重新下载 |
| `baseFileToken` | 当前 Excel 试点 Base 的 `bitable_file` 媒体 | 填充 Base 的 `Generated Coupon File` 或 `Generated Whitelist File` 附件字段 |

Base 附件上传使用飞书要求的两步协议：

```text
POST /drive/v1/medias/upload_all
parent_type=bitable_file
parent_node=<Base app token>

POST /base/v3/bases/{base_token}/tables/{table_id}/append_attachments
```

系统绝不再把普通 Drive token 写入 Base 附件字段。

## 4. 保留的边界

本修复仅解决生成文件在 Base 中的可见附件副本，不改变：

- Drive 中的冻结版本和 hash 校验；
- 源白名单不进入 OA 附件库；
- Excel → 系统 OA 草稿的后续提升；
- 寄卖/pop 的人工测算图片；
- 正式 OA 仅经业务员最终点击后创建；
- 已暂停的旧 OA 与 Excel 试点并存路由优化。

## 5. 故障恢复与验收

若旧版本已使某条试点卡在 `Generating`，将它恢复到 `AwaitingWhitelistUpload` 后重新发送源白名单；新代码会生成新的有效映射卡。

部署后验收顺序：

```text
上传源白名单
→ 确认映射
→ 生成完成
→ Base 两个附件字段各有一份有效文件
→ Drive 文件夹仍有两份冻结文件
→ Bot 显示“Excel 已生成，待确认”
```

在点击 `确认生成结果` 之前，不会上传原生 OA 附件或创建原生 OA。
