# 优惠券 Excel 试点内置模板“不存在”线上诊断与修复

> **状态**：历史诊断与本地修复记录；结论仅适用于文中日期、环境和证据范围，不构成当前部署状态证明。
> **当前依据**：阶段与 go/no-go 以 [rollout](../../current/operations/coupon-oa-internal-pilot-rollout-plan-v1.md) 为准。

> **日期**：2026-09-30
> **范围**：Bot「优惠券Excel试点」在用户确认白名单映射后，进入 Excel 生成阶段失败。
> **结论状态**：已定位并完成本地修复与回归测试；待部署后进行桌面端验证。

## 1. 用户现象

桌面端已成功完成以下步骤：

```text
优惠券Excel试点
→ 字段确认
→ 上传 .xlsx 白名单
→ 选择“白名单 / A（SKUID，3 条）”
→ 确认映射并生成 Excel
```

Bot 随后显示：

```text
Excel 试点模板不存在：配券信息表-常规满减券.xlsx
```

这说明白名单接收、Sheet/列解析和映射卡片正常；失败发生在读取内置配券模板之前，因此与用户上传的白名单、Drive 文件夹权限、OA 草稿或正式审批无关。

## 2. 根因

`nitro.config.ts` 将模板目录注册为：

```ts
serverAssets: [{ baseName: "coupon-excel", dir: "server/assets/coupon-excel" }]
```

Nitro 构建产物实际注册的原始资源键为：

```text
server:coupon-excel:配券信息表-常规满减券.xlsx
server:coupon-excel:商品明细白名单-自动填报演练.xlsx
```

旧实现却从错误的存储命名空间读取：

```ts
useStorage("assets:coupon-excel").getItemRaw(assetName)
```

该键不会映射到 Nitro 的 `/assets` server storage，因此线上返回空值并误报模板缺失。

## 3. 修复方案

只修改 `server/lib/feishu/coupon-oa/excel-pilot-assets.ts` 的内置模板读取规则：

```ts
useStorage("assets:server").getItemRaw(
  `coupon-excel:${assetName}`,
)
```

这与 Nitro 实际构建键一致，继续使用原有打包资产，不引入外部文件读取、Drive 下载或运行时模板上传。

本修复不改变：

- 白名单源文件处理与安全校验；
- Drive 生成文件保存；
- Excel → 系统 OA 草稿提升；
- 人工测算图片上传；
- 最终原生 OA 的人工提交边界；
- 已暂停的“旧 OA 草稿与 Excel 试点并存”路由优化。

## 4. 回归保护

新增 `excel-pilot-assets.test.ts`，覆盖：

1. 配券模板从 `assets:server` / `coupon-excel:` 键读取；
2. 白名单模板从同一命名空间读取；
3. 资源确实不存在时，仍返回清晰的模板缺失错误。

## 5. 验证步骤

部署修复后，在同一个 Excel 试点草稿中重新点击或重新进入映射流程：

```text
选择白名单 SKU 列
→ 确认映射并生成 Excel
```

预期：

1. 不再出现“Excel 试点模板不存在”；
2. Bot 先显示“正在生成 Excel”，随后显示“Excel 已生成，待确认”；
3. Drive 文件夹中出现一份配券表和一份标准白名单；
4. 此阶段不创建原生 OA；仅在用户确认输出并走完后续人工步骤时才进入系统 OA 草稿链路。

若仍失败，应记录 Bot 错误卡全文和 bridge 对应日志，再区分为模板读取、ExcelJS 生成、Drive 上传或 Base 写入问题。
