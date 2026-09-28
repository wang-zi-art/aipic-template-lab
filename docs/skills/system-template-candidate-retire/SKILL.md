---
name: system-template-candidate-retire
description: 根据模板类型和候选提示词信息，使用项目 MCP 停用质量不佳的未发布系统模板候选，并同步本地 candidates.json 的研发状态与决策记录。仅在用户明确要求停用或淘汰候选时使用；不处理已发布模板。
---

# 停用系统模板候选

本项目 MCP 的 `delete_unpublished_system_template` 会**软删除整个从未发布的候选模板**，不是只关闭某一版提示词。历史版本、素材元数据、试用任务、积分和结果仍保留，但删除后该模板不能继续编辑、试用或发布。用户明确要求停用即授权此操作；仅反馈“效果不好”时先讨论取舍，不自动删除。

## 定位与核对

同一任务处理多个候选时，只读取本轮需要的登记和证据；可按各自准确 ID 并行完成只读后台回读，全部身份核对后仍逐项写入本地暂停状态并串行软删除。当前会话中已核对且未变化的资料不重复整理。

1. 先读 `mcp-test/CORE.md`，用用户提供的 `TPLxxxx` 从 `mcp-test/materials/catalog.json` 定位模板目录，读取 `candidates.json`（若存在）；登记规则不熟悉时再读 `mcp-test/docs/candidate-registry-design.md`。结合候选标识或提示词版本，找到唯一的 `templateId`、`versionId`。没有登记时，只能使用当前会话或用户提供的准确后台 ID，再用 `get_system_template` 核对；不能仅按相似名称或历史记录猜测目标。登记中已有匹配的 `backendDeletion` 时，不再发起新的删除。
2. 调用 MCP `get_system_template` 回读目标，核对稳定模板 ID、目标版本 ID、名称、提示词内容或版本线索与用户指定的候选一致，并取得**稳定模板当前 `revision`**。若用户只想停用同一稳定模板中的一版、或目标身份仍有歧义，说明该 MCP 会删除整个候选，不执行删除。
3. 记录用户实际提供的质量问题、相关 `T` 用例和测试 `executionId`；没有具体证据时写明“用户判定质量不佳，未提供样本证据”，不补造测试结论。后台是否曾发布、是否有活跃试用由服务端最终复核；预先发现不符合删除范围时不发起删除。

## 停用操作

先将已唯一核对的候选在 `mcp-test/materials/<模板目录>/candidates.json` 中设为 `researchStatus: paused`，追加一条有时间、原因和已有证据编号的本地停用决策，使默认测试名单立即排除它。若尚无登记，须已有准确后台 ID、候选 `key` 和提示词版本，并经权威回读一致后，按登记设计建立该候选的最小记录，再设为 `paused`；缺任一身份信息时先报告缺口。保留既有候选及只追加的历史记录；若本地文件写入失败，不继续远程删除，以免后台和登记失联。

随后使用新的 `executionId`，逐个调用 MCP `delete_unpublished_system_template`，传入准确的稳定 `templateId` 和刚回读的稳定模板 `expectedRevision`。不复用登记中可能过期的 revision。该工具只接受从未发布、当前无排队或处理中管理员试用、状态合法的候选；遇到发布历史、活跃任务、修订冲突或状态冲突时停止该项，不绕过服务端限制。

成功以 MCP 返回的 `ok=true`、`serverStatus=deleted`、`deletedAt` 和已落盘报告为依据；`replayed=true` 表示同一模板此前已被软删除，核对 ID 和删除时间后可记为“此前已停用”。普通模板详情在删除后可能返回不存在，不能把单独的 404 当作删除成功证据。若结果不明或报告未落盘，按原 `executionId` 查询 `get_template_trial_report` 并核对后台状态，不换新编号自动重发。

## 同步 materials 与汇报

- 确认后台已软删除后，将该候选的 `researchStatus` 改为 `retired`，在登记项增加 `backendDeletion`（`deletedAt`、`executionId`），并追加独立的 `backend_deleted` 决策。保留 `lastObservedBackend.versionStatus` 为删除前最后一次真实版本状态；**不要写成 `deleted`**，因为软删除发生在稳定模板上。
- 后台删除被拒绝或仍待核对时，保持本地 `paused`，记录已知的后台状态和阻碍；不写 `backendDeletion` 或声称后台已停用。仅在目标身份可确认时修改对应的 `candidates.json`；`manifest.json` 的素材、测试用例、`catalog.json` 和历史输出不随候选停用而删除。
- 逐项报告 `TPL` 与候选标识、后台模板／版本 ID、质量原因和证据、MCP 执行编号、后台结果及删除时间、本地研发状态与文件更新结果。明确区分“后台已删除”“仅本地暂停”“待核对”“无法删除”；若后台成功但本地最终写入失败，直说两处状态不一致并给出恢复所需的 ID 和报告路径。
