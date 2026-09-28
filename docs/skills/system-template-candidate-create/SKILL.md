---
name: system-template-candidate-create
description: 根据已确定的系统模板候选名称、简介、各图片栏模型作用和完整提示词，使用项目模板测试 MCP 逐个创建后台测试模板，并将核实后的候选关联登记到 materials。用于明确要求创建候选模板的任务；不提交付费生图或发布模板。
---

# 创建系统模板候选并登记

给定一个 `TPLxxxx` 和明确要创建的候选清单，使用项目 MCP 为每个候选创建独立的后台系统模板，并报告每项创建与本地登记结果。用户要求创建即授权本流程；不要把本技能用于仅需讨论或起草提示词的请求。

## 读取与准备

1. 先读项目 `mcp-test/CORE.md`；通过 `mcp-test/materials/catalog.json` 找到目标模板的 `manifest.json` 和现有 `candidates.json`（若存在）。登记结构或删除后重建规则不熟悉时再读 `mcp-test/docs/candidate-registry-design.md`，本轮已核对且未变化的资料直接沿用。`TPL` 编号是本地类型编号，不是后台模板 ID。
2. 直接使用已批准的候选交接内容：创建名单、各候选版本／名称／简介／**完整基础提示词**／**每栏完整模型作用**，以及共用模型、分类、栏位 `key`／顺序／名称／必填与上传要求、补充描述设置和素材清单。不得在创建时重新拟写已批准字段，也不得以“同上”、摘要或别的候选文本代替完整字段。旧研发记录缺少字段时，先从当前会话与素材档案补齐并核对；仍有会改变表单的歧义时，先交付具体字段供负责人确认。
3. 未另行指定的新测试候选使用“测试”分类、`gpt-image-2.5` 模型、`allowsSupplementalDescription: true`，不传 `supplementalDescriptionRecommendation`，并传 `assets: []`（效果图、栏位示例图和预设图均为空）。已批准的不同设置优先；不得因默认值改动既有候选。创建前只在助手层调用**一次** `get_admin_context`，核对正式管理员及实时可用的分类和模型，解析本轮共用 ID；MCP 单项创建内部仍会自行校验。模型或分类不可用时停止受影响项，不沿用历史 ID 或暗换配置。
4. 在任何远程写入前做**一次整批预检**：名单与批准版本一致，各候选名称、简介、完整提示词和模型作用齐全；共用栏位 `key` 不重复，数量、顺序、必填和上传要求与素材来源一致；补充描述及素材设置不冲突。按 MCP 当前 Schema 组装每项完整 `template` 表单：`generationModelId`、`name`、`description`、`categoryId`、`inputs`（每栏 `key`、`order`、`label`、`required`、`uploadRequirement`、`modelRole`）、`allowsSupplementalDescription`、可选的 `supplementalDescriptionRecommendation`、`executionPrompt`。现有 `candidates.json` 中若已登记同一标识，先按准确 ID 回读；不要因名称相同或提示词有新版本就重复创建，也不要覆盖已有映射。需要修改已有候选时转用更新流程。若负责人明确要求重建已软删除的候选，先核对旧记录的 `backendDeletion`，将其完整移入 `archivedCandidates` 并递增 `registryRound`；新创建的关联只写入当前 `candidates`，历史 `decisions` 继续只追加。

## 逐个创建与核实

- 使用项目 MCP 的 `create_system_template_candidate`，按 A/B/C 顺序**逐项**调用，每项使用独立的 `executionId`；可以在一次编排调用中串行执行，不并行提交。该工具负责“创建草稿 → 登记可选素材 → 进入 `testing` → 最终回读”的闭环；目标是创建**测试状态**的模板，不以草稿创建成功作为完成。默认 `assets: []`；`competitor/` 是参考资料，`test-inputs/` 是试用输入，均不自动成为后台展示素材。只有用户明确指定正式展示素材及其栏位、顺序时，才按 MCP 规则传入 `assets`。
- 每次调用后检查 `ok`、`status`、`reportPersisted`、`templateId`、`versionId`、`revision` 和 `serverStatus`。MCP 在返回成功前已按准确 ID 回读并逐字段核对名称、简介、分类、模型、栏位顺序与作用、完整基础提示词、补充描述设置、展示素材及 `testing` 状态；**仅当工具返回 `ok=true`、`status=completed`、`reportPersisted=true` 时**认定该候选创建完成，无须重复调用 `get_system_template`。结果部分完成或不明时仍按原执行编号独立回读排查。
- 返回 `uncertain`、`partial`、报告未落盘或后台回读不一致时，保留原 `executionId`，通过 `get_template_trial_report` 和后台权威回读定位实际状态；**不得换新编号自动重建**。某项失败不冒充成功；后续候选是否继续创建，按失败是否影响整批输入或管理员环境判断，并在最终报告中逐项列明。

## 更新正式素材目录

本轮可确认项全部回读后，**一次**创建或增量更新该 `TPL` 目录的 `candidates.json`；失败或待核对项不登记为 `active`。沿用登记设计中的 `schemaVersion`、`templateTypeId`、`candidates` 和只追加的 `decisions`：每个新候选记录 `key`、`displayName`、`templateId`、`versionId`、`promptLabel`、`researchStatus: active`、`lastObservedBackend`（真实状态、revision、回读时间），并追加 `registered` 决策及本次创建的 `executionId`。保留既有候选与历史决策，检查 JSON 可解析且标识和后台 ID 无重复。不要把完整提示词、模型作用、管理员凭据或签名地址写入登记文件。

已有 `TPL` 时无需改 `catalog.json` 或素材 `manifest.json`；它们继续分别维护类型索引与素材定义。批次结束后只在 `docs/project-status.md` 写一条结果摘要；稳定的 `CORE.md`、目录 README 和登记设计不随每轮候选创建重复更新。创建或登记未确认时，不写入虚假的 `active` 关联；MCP 报告中的实际模板 ID 和待核对状态应留在本次完成情况中。

## 完成情况输出

使用表格逐项报告：候选标识、名称、提示词版本、创建状态、后台模板 ID／版本 ID、**回读确认的版本状态**、`executionId`、本地登记状态。汇总已完成、部分完成、失败或待核对数量；仅草稿已创建、进入测试失败或回读无法确认时列为部分完成／待核对，并写明实际停留状态。明确指出是否有“后台已进入 `testing` 但本地登记失败”的项，以及对应报告路径和后续处理。进入 `testing` 只表示可供管理员试用，不表示已生图、通过验收或发布。
