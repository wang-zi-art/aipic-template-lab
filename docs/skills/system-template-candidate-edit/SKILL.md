---
name: system-template-candidate-edit
description: 根据模板类型、候选提示词和明确的修改要求，使用项目 MCP 更新未发布系统模板的完整基础提示词及指定图片栏模型作用，确认恢复 testing，并同步 materials 中的候选登记。适用于测试后修订候选，不负责更换模型、分类或发布模板。
---

# 编辑系统模板候选提示词

本技能只处理 MCP `update_system_template_prompt` 支持的字段：**完整基础提示词**及按 `key` 指定的**图片栏模型作用**。用户明确要求编辑即授权该候选的更新；仅反馈“效果不好”时先明确修改内容。修改名称、简介、图片栏结构、分类或模型超出此工具范围，不能借提示词更新流程悄悄改动。

## 定位与准备

1. 先读 `mcp-test/CORE.md`，用 `mcp-test/materials/catalog.json` 定位用户给定的 `TPLxxxx`，读取目标目录的 `candidates.json`（若存在）和 `manifest.json`；仅当登记规则需要核对时再读 `mcp-test/docs/candidate-registry-design.md`。依据候选 `key`、提示词版本和登记的后台 ID 确认唯一目标；没有登记时须从当前会话或用户提供的准确 `versionId` 开始回读，并取得候选 `key` 与当前提示词标签，不能仅凭相似名称选模板。
2. 用 MCP `get_system_template` 按准确 `versionId` 读取权威详情，核对模板／版本身份、当前 `draft` 或 `testing` 状态、完整提示词、栏位 `key` 与顺序及**版本的最新 revision**。登记已有 `backendDeletion`、后台已发布或软删除、目标不唯一、请求包含不受支持的字段时，停止该项并报告。旧报告和 `candidates.json` 中的 revision 只作线索。
3. 将用户指定的改动应用到当前完整文本，形成新的**完整** `executionPrompt`；只有需要改的栏位才列入 `inputModelRoles`，其余模型作用由 MCP 沿用后台值。核对各栏作用、基础提示词与当前验收标准不冲突。若修改意图不足以确定最终文本，先交付具体新文本供用户确认，不提交模糊改写。

## 编辑并恢复测试状态

先将已核对的候选在 `candidates.json` 中暂记为 `paused`，保留先前研发状态与原因，避免更新过程中被选入新测试；无登记时按权威回读的模板／版本 ID、候选 `key` 和当前标签建立最小记录。若本地写入失败，先停止，避免后台改动后无处登记。随后为该候选使用新的 `executionId`，调用 MCP `update_system_template_prompt`，传入准确的 `versionId`、刚回读的版本 `expectedRevision`、完整新 `executionPrompt` 和可选的已修改 `inputModelRoles`。工具负责“`testing` 退回 `draft` → 保存 → 进入 `testing` → 最终回读”；原本处于 `draft` 时从保存开始。不自行跨过工具步骤，也不重复提交同一不明结果。

仅当工具返回 `ok=true`、`reportPersisted=true`、`serverStatus=testing` 才认定编辑完成：MCP 的最终回读已核对同一版本的 revision、完整保存表单、提示词及栏位作用，无须再读取一次同一版本。若中途失败、结果不明或最终回读不符，保留原 `executionId`，查询 `get_template_trial_report` 和后台实际版本；不得换新编号自动重试。尤其要如实报告版本是否仍停在 `draft`。

## 更新 materials 与汇报

- 编辑完成后更新该模板的 `candidates.json`：保留原 `templateId`、`versionId` 和历史决策，将 `promptLabel` 从旧版递增到已确认的新版，刷新 `lastObservedBackend` 的 `versionStatus: testing`、真实 revision 和回读时间，追加 `prompt_updated` 决策，记录质量问题、修改字段、旧新版标签、相关试用及本次编辑 `executionId`。若先前为 `active` 且用户要继续测试，将 `researchStatus` 恢复为 `active`；其他暂停原因仍存在时保持 `paused`。不要把完整提示词或模型作用写入登记。
- 若后台编辑未确认成功，不提高 `promptLabel`，不声称已恢复测试；若回读显示 `draft` 或状态未知，将本地 `researchStatus` 标为 `paused` 并记录阻碍，防止被默认测试流程选中。后台成功但本地写入失败时明确报告状态不一致及恢复所需 ID。`manifest.json` 的 `sourceNote`、友商素材、测试用例及 `catalog.json` 不因提示词改动而变化。
- 逐项报告 `TPL`、候选标识、旧新版标签、实际修改字段、后台模板／版本 ID、执行编号、最终状态和 revision、本地登记结果及尚需处理的问题。进入 `testing` 只说明可再次试用，不代表新提示词已通过质量验收。
