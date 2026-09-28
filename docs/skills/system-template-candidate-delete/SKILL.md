---
name: system-template-candidate-delete
description: 按模板类型和候选提示词信息，使用项目 MCP 软删除质量不佳的未发布系统模板候选，同步 materials 中的候选登记并报告结果。仅在用户明确要求删除候选时使用。
---

# 删除系统模板候选

本项目目前只有 `delete_unpublished_system_template`：它软删除**整个从未发布的候选模板**，不能只删除其中某一版提示词，也不会物理清除历史版本、试用任务或结果。用户明确要求删除目标候选即授权执行；仅讨论图片效果时不触发删除。

本技能与 [system-template-candidate-retire](../system-template-candidate-retire/SKILL.md) 使用同一个 MCP 操作。读取并执行该 Skill 的完整流程，不另维护一套定位、异常处理或 `candidates.json` 写入规则。特别核对以下交付条件：

多个目标只读核对可按停用 Skill 并行完成；删除及每项本地状态更新保持串行，不再重复读取已确认且未变化的登记资料。

1. 用 `TPLxxxx` 和候选标识、提示词版本或准确后台 ID 唯一定位目标，回读后台取得稳定模板当前 revision；身份不明时不删除。
2. 先将已核对候选在 `mcp-test/materials/<模板目录>/candidates.json` 标记为 `paused` 并记录质量原因，再调用 MCP 软删除。已发布、仍有活跃试用或目标范围不匹配时，按原流程停止并如实报告。
3. 只有 MCP 确认 `serverStatus=deleted`、返回 `deletedAt` 且报告已落盘，才将本地状态改为 `retired` 并记录 `backendDeletion`。结果不明时保持 `paused`，用原执行编号核对，不自动重发。
4. 报告后台删除结果、删除时间、模板及版本 ID、执行编号、本地登记结果和未完成原因。`manifest.json` 中的素材与测试用例、`catalog.json` 和历史输出保留。
