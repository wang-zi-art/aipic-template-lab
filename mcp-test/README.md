# 模板测试素材目录

这里保存独立项目的正式素材、稳定规则和首次整理的历史资料。新增素材只维护在 `materials/`；原项目的旧目录仅是迁移回退来源。

| 位置 | 用途 |
| --- | --- |
| [`CORE.md`](CORE.md) | 素材编号、后台核对与执行边界 |
| [`materials/catalog.json`](materials/catalog.json) | 19 种模板类型的编号、名称和目录索引 |
| `materials/TPLxxxx-*/manifest.json` | 对应模板的友商参考、S 图片组、T 用例与来源说明 |
| [`docs/material-structure-design.md`](docs/material-structure-design.md) | 图片顺序、命名及变更规则 |
| [`docs/candidate-registry-design.md`](docs/candidate-registry-design.md) | 后续候选关联与停用登记规则；当前没有登记 |
| [`archive/2026-09-23-initial-import/`](archive/2026-09-23-initial-import/) | 一次性整理的历史脚本、清单及原始说明 |

当前共有 19 个模板类型、71 张图片。执行 `corepack pnpm materials:verify` 可只读检查索引、档案和图片内容。三份曾依赖旧项目试用或候选回读的档案已恢复 `slotMappingStatus=unverified`；保留的 `slotKey` 只是待核对定义。新项目没有继承旧候选、执行计划、报告或生成图片。九个 Skill 与中文索引已迁入 `docs/skills/`；本机新计划放在 `.local/codex-template-mcp/plans/`，报告和结果放在 `.local/codex-template-mcp/outputs/`。新活动 MCP 入口留待切片五切换。
