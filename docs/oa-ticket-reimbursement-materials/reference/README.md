# 参考资产

本目录保存原始调研、经登记的 Excel 模板和可共享的脱敏演练材料。它们是**证据、输入或测试资产**，而不是独立生效的产品规范。

| 类别 | 位置 | 使用边界 |
| --- | --- | --- |
| 调研依据 | [`research/`](research/) | 截图和初步规则仍须经业务/流程 Owner 确认后，才能进入当前 PRD。 |
| 受控模板 | [`templates/`](templates/) | 保留 Excel 原貌；上线使用前必须登记版本、结构 fingerprint、Owner 和字段映射。 |
| 脱敏 fixture | [`fixtures/route-verification/`](fixtures/route-verification/) | 仅用于隔离审批定义和测试账号，禁止连接真实建券、同步或生产环境。 |
| 试点重试反馈样本 | [`fixtures/excel-pilot-retry-evidence/`](fixtures/excel-pilot-retry-evidence/) | 仅用于 Bot 故障文案、重试边界和测试白名单样例的展示与回归；不得作为真实业务输入。 |

## 维护规则

- 单次活动文件、真实 OA 附件和可识别业务数据不得放入本目录；应留在 Git 忽略的 `../../cases/`。
- 模板变更不可只依赖文件名；必须同步修改其注册/映射、测试 fixture 和当前实施材料。
- 调研中“待确认”的结论不得直接作为服务端默认值、模板公式或 native-submit 条件。
- 演练 fixture 的所有字段、文件和附件哈希均需保持脱敏，并在测试报告中说明隔离环境。
