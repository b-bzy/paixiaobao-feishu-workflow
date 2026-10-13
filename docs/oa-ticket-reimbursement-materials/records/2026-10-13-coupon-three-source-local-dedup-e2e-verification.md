# 三源优惠券多 Sheet 去重本地 E2E 验证记录

- **日期**：2026-10-13
- **环境**：本地，仅文件系统
- **外部调用**：0
- **原生 OA**：未创建
- **飞书/Vercel**：未部署、未调用

## 验证目标

验证三源流程的多 Sheet 白名单遵循以下规则：

1. 同一 Sheet 内重复 SKU 只保留第一次出现的位置；
2. 同一 SKU 出现在不同 Sheet 时分别保留；
3. AI 提供 SKU 区域与规则识别路径执行相同的去重规则；
4. 非法公式、多个 SKU 单元格和超出 Excel 可靠精度的数字仍然阻断；
5. 去重后可以继续生成标准配券表、标准白名单和配券表截图。

## Excel 测试输入

### 脱敏合成用例

目录：`docs/oa-ticket-reimbursement-materials/cases/local-e2e-synthetic-20261013/attachments/`

- `配券型号表9.30-10.10.xlsx`：四券档、双渠道、八条配券记录；
- `商品明细白名单9.30-10.10.xlsx`：四个 Sheet，覆盖表内重复、跨 Sheet
  重复、数值 SKU 和文本前导零 SKU。

合成白名单预期：

| Sheet | 源数据行 | 去重后行数 | 重点场景 |
| --- | ---: | ---: | --- |
| `100减1` | 3 | 2 | 表内重复 |
| `2000减20` | 3 | 2 | 表内重复 + 跨 Sheet 重复 |
| `3000减30` | 2 | 2 | 数值 SKU + 前导零文本 SKU |
| `3000减60` | 2 | 2 | 跨 Sheet 重复 |

### 已有脱敏 Excel fixture

目录：`docs/oa-ticket-reimbursement-materials/reference/fixtures/three-mode-screenshots/`

- `case01`：严选，无测算图；
- `case02`：寄卖，生成确定性测算图；
- `case03`：POP、五券档、多 Sheet；
- `case04`：非首行表头、任意布局、多 Sheet。

### 本地真实源表副本

真实源表只复制到 Git 忽略的 `cases/` 目录。测试期间校验源文件 hash、mtime 和
inode 未改变，不将源文件写入标准附件。

## 自动化回归

新增两条 `parseMultiSheetTieredIdentifierList()` 回归：

1. 规则识别路径：表内重复去重，跨 Sheet 相同 SKU 分别保留；
2. AI 区域路径：执行相同的 Sheet 级去重规则。

同时执行已有的非法 SKU、前导零、数值精度、自由 Sheet 名、业务模式、名单重叠、
无黑名单确认、模板 fingerprint、OA 编码和零网络副作用用例。

## 验证结果

### 脱敏合成 E2E

- 配券记录：8 条，4 个券档，2 个渠道；
- 标准白名单：4 个 Sheet，每个 Sheet 2 条；
- 表内重复已移除；跨 Sheet 重复已保留；
- 标准配券表、标准白名单和 PNG 截图生成成功；
- `networkCalls: 0`，`oaCreated: false`，源文件未变化。

### 本地真实源表 E2E

| Sheet | 标准产物行数 |
| --- | ---: |
| `100减1` | 992 |
| `2000减20` | 147 |
| `3000减30` | 106 |
| `3000减60` | 87 |
| 合计 | 1332 |

- 跨券档重复 SKU：265 个，均分别保留；
- 标准配券表、标准白名单和 PNG 截图生成成功；
- `networkCalls: 0`，`oaCreated: false`，源文件未变化；
- 第二轮仍保留业务模式、带年份日期和活动点位三个业务确认项，这些不是本次
  去重修复的失败。

## 命令结果

- `pnpm typecheck`：通过；
- 三源相关 Vitest：3 个测试文件、30 条测试全部通过；
- 本次修改文件的 Biome 检查：通过；
- 全仓库 `pnpm lint`：被既有 `.claude/worktrees/.../biome.json` 嵌套 root
  配置阻断，与本次修改无关。

本记录只证明本地 draft-only 练习链路和模板生成通过，不证明飞书端 E2E、Drive、
Base、Approval 权限或原生 OA 创建可用。
