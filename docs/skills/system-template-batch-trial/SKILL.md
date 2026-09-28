---
name: system-template-batch-trial
description: 对同一系统模板类型的 A/B/C 候选按正式 T 用例批量提交管理员生图试用，自动收集结果，并生成可直接用文件管理器横向浏览的汇总文件夹。用于用户明确要求批量测试与结果对比时；不发布模板。
---

# 系统模板批量试用与文件夹对比

用户明确要求批量生图即授权本轮管理员试用。每轮只比较一个 `TPLxxxx` 的 A/B/C 子集，每个“候选 × T 用例”生成一张；不设置积分上限，不自动重生成失败或结果不明的任务。先读 `mcp-test/CORE.md`、目标 `manifest.json` 和 `candidates.json`，再按下述流程执行。

## 输入与一次性预检

用户至少指定 `TPL`、候选标识和 `T` 用例（或“全部开发用例”）。用 `catalog.json` 定位正式素材；从每个 `T` 取得所引用 `S` 的有序图片及其完整补充描述。仅凭友商图、名称或缺失的用例不能凑数。`candidates.json` 缺失时，先取得每个候选的准确后台版本 ID、候选标识和提示词标签，权威回读后才能编排。

逐个调用 `get_system_template` 核对候选身份、`researchStatus=active`、测试版本为 `testing`、最新 revision、图片栏 `key` 与顺序、补充描述能力和绑定模型。所有候选对同一 `T` 必须使用相同图片、描述和生成参数；用户提供的模型名称只用于核对，不能覆盖后台绑定。优先使用所有候选共同支持的后台默认比例、分辨率和质量；不一致或无法确定时请用户指定共同组合。`auto` 比例与分辨率必须成对，质量只在模型提供质量选项时提交。任一关键项不符，整批停止在付费提交前。

为本轮生成新 UUID v4 `executionId`，在 `.local/codex-template-mcp/plans/<executionId>.json` 保存下面格式的计划；`inputs.path` 为相对 MCP `inputRoot` 的规范路径，由 `catalog.directory` 加 `manifest.imageSets[].inputs[].path` 得到。`modelId` 须填写后台实际绑定 ID。新的批量 MCP 工具会在任何付费写入前一次检查所有图片的边界、大小与真实格式；单独排查素材时仍可运行 `pnpm --filter @aipic/mcp batch:comparison validate <计划路径>`，正常批次不重复运行该预检。

```json
{
  "schemaVersion": 1,
  "executionId": "本轮 UUID v4",
  "templateTypeId": "TPL0001",
  "manifestRevision": 1,
  "candidates": [{ "key": "A", "promptLabel": "A-v1", "templateId": "后台 UUID", "versionId": "后台 UUID", "revision": 2, "modelId": "模型 UUID" }],
  "generation": { "aspectRatio": "auto", "resolution": "auto", "quality": "auto" },
  "cases": [{ "id": "T001", "imageSetId": "S001", "supplementalDescription": "完整原文或 null", "inputs": [{ "order": 1, "slotKey": "subject_image", "path": "TPL0001-action-imitation/test-inputs/S001/input_01_subject_image.webp" }] }]
}
```

示例只表示字段结构，不代表真实用例或后台 ID。`quality` 在模型不支持时省略；无补充描述用 `null`，调用 MCP 时省略该字段。不得保存完整提示词、管理员令牌或签名地址。

## 提交与自动收集

将已保存的完整计划作为 `plan` 一次传给 MCP `submit_template_trial_batch`。工具先核对整批素材、正式管理员及所有候选的实时身份、revision、状态、栏位和模型参数，再按 `cases` 顺序、内部 A/B/C 顺序逐项调用现有单项提交服务；每个组合仍独立上传和登记。工具完成提交后在原执行目录生成 `batch-plan.json` 和初始 `comparison/`。提交结果不明确、鉴权或积分等全局问题发生时停止后续付费提交，并把余项记为未执行；局部明确失败记录为失败，不以新编号重试。已有执行编号只能查看报告和续收，不可再次调用批量提交。

所有拟提交组合处理完毕后，才调用 `collect_template_trial_results`；每轮最多处理 10 项，内部至多 3 项并发查询和下载，约每 20 秒继续收集。工具仅在结果状态变化或最终交付时重建 `comparison/`，无需每轮手动执行 `batch:comparison build`。直到全部终态，或从开始收集算起 30 分钟；到上限时交付部分汇总。后续按同一 `executionId` 继续收集；若汇总文件单独损坏，可对原计划手动运行 `batch:comparison build`，不重提已存在或结果不明的组合。收集工具返回的 `report.json` 是状态事实，汇总文件只是派生展示。

## 输出与报告

执行目录保留 MCP 的 `report.json`、`report.md` 和样本原图／结果；新增 `batch-plan.json` 与 `comparison/`。每个 `T` 文件夹用 `00-input_01`、`10-A-v1`、`20-B-v1` 等短文件名排列上传图与候选结果，保持真实扩展名；优先硬链接，不能链接时复制。`comparison/README.md` 列出逐用例状态，`summary.json` 保存相对文件路径、版本、任务、错误与处理状态。`comparison/index.html` 是石墨蓝紫逐例评审页，可直接从文件管理器打开，内嵌本次汇总快照，不调用后台；每次重建汇总时一同更新。页面是派生视图，真实状态仍以执行报告和后台回读为准。

完成后报告计划组合数、成功／失败／处理中／待核对／未执行数量、已知实际积分、执行编号、汇总目录及恢复方式。缺图和导出失败保留明确状态，不把它们写成已成功出图。
