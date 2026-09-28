# 模板类型与候选提示词关联登记设计

> 记录日期：2026-09-23  
> 状态：设计规则已迁入独立项目；本项目尚未登记任何候选，旧项目登记不继承

## 1. 为什么需要这份登记

当前 `materials/catalog.json` 只记录 `TPL0001` 等模板类型的名称和素材目录，模板目录中的 `manifest.json` 只定义友商参考、上传图组和测试用例。两者都没有记录 A/B/C 三个候选实际对应的后台系统模板和版本。

现有 MCP 的 `submit_template_trial` 必须收到 `candidateKey`、后台 `versionId` 和当前 `expectedRevision`；`get_system_template` 也需要准确的后台模板 ID 或版本 ID。仅凭模板中文名称搜索数据库可能找到旧版本、同名模板或已停用候选，因此不能作为自动付费测试的定位方式。

需要增加一份**本地候选登记**，回答“这个模板类型当前有哪些候选、各自对应哪个后台模板、是否仍参与测试”。实际模板版本状态和修订号仍以每次调用时的后台权威回读为准，登记不是数据库的替代品。

## 2. 文件职责

```text
mcp-test/materials/
├─ catalog.json                         # 模板类型总索引：编号、名称、目录
├─ overview.md                          # 以后由登记自动生成的总览表，不手工维护
└─ TPL0001-action-imitation/
   ├─ manifest.json                     # 素材、栏位和测试用例
   └─ candidates.json                   # A/B/C 后台关联、研发状态和决策记录
```

未来可由 `catalog.json` 的 `candidateRegistryPath` 指向各模板的 `candidates.json`，但不复制候选详情。每个模板类型的 `candidates.json` 是候选关联和人工取舍的唯一维护位置。新项目当前没有这些文件，也没有候选总览；首次登记必须取得准确后台 ID 并实时回读。

本阶段不增加 PostgreSQL 表。当前主要是项目负责人在本机通过 Codex 研发模板，本地登记足以提供编排上下文；后台数据库继续保存真实系统模板、版本、任务和积分。出现多人同时维护、后台直接管理研发状态或需要跨设备查询时，再考虑独立数据库切片。

## 3. 候选登记建议字段

下例只演示结构，UUID 和时间为占位，不能直接用于真实测试：

```json
{
  "schemaVersion": 1,
  "templateTypeId": "TPL0001",
  "candidates": [
    {
      "key": "A",
      "displayName": "动作模仿候选 A",
      "templateId": "00000000-0000-4000-8000-000000000001",
      "versionId": "00000000-0000-4000-8000-000000000002",
      "promptLabel": "A-v1",
      "researchStatus": "active",
      "lastObservedBackend": {
        "versionStatus": "testing",
        "revision": 2,
        "checkedAt": "2026-09-23T00:00:00Z"
      }
    }
  ],
  "decisions": [
    {
      "at": "2026-09-23T00:00:00Z",
      "candidateKey": "A",
      "action": "registered",
      "reason": "建立模板类型与后台候选的对应关系",
      "evidenceExecutionIds": []
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `key` | 本模板类型内的 A/B/C 固定候选标识，与当前 MCP 工具允许的值一致；不能仅凭展示名称定位。 |
| `templateId`、`versionId` | 后台稳定模板与当前候选版本的准确 ID；初次建立和每次变更后都要权威回读。 |
| `promptLabel` | 人工研发版本名，例如 A-v1、A-v2；只用于区分提示词迭代，不代替后台 revision。 |
| `researchStatus` | 本地研发选择状态，例如 `active`、`paused`、`retired`；决定默认测试名单，不宣称后台已删除或停用。 |
| `lastObservedBackend` | 上次成功回读时的后台状态、修订号和时间，仅供发现变化；提交前仍必须重新查询。 |
| `backendDeletion` | 可选；仅在 MCP 确认稳定模板已软删除后记录 `deletedAt` 与 `executionId`。不把版本状态伪写为 `deleted`。 |
| `decisions` | 只追加的取舍记录，写明候选、动作、原因、时间和支持结论的执行编号。 |
| `registryRound` | 可选；同一模板类型删除后重建候选时递增，区分本地登记轮次，不替代后台版本号。 |
| `archivedCandidates` | 可选；保留以前轮次已确认软删除的完整关联及删除证据，当前测试名单只读取 `candidates`。 |

不在登记文件保存管理员会话、完整隐藏提示词、图片栏模型作用或供应商原始错误。完整提示词由后台版本管理；一次具体试用实际使用的版本、revision、参数和结果由 MCP 执行报告记录。

已软删除的稳定模板无法恢复。负责人明确要求原样重建时，先确认旧 `candidates` 均有 `backendDeletion`，再将旧记录完整移入 `archivedCandidates`，保留 `decisions`，并为新后台模板在当前 `candidates` 建立同一 A/B/C 标识的新关联。新旧轮次可使用相同提示词标签，但必须通过各自准确的后台 ID、登记轮次和执行编号区分；绝不能把旧 ID 当作新候选使用。

## 4. 质量不佳时如何记录“停用”

“不再参与研发测试”和“后台版本已停用／候选已软删除”是两个不同事实，必须分开记录。

负责人决定暂停或淘汰某候选时，先将对应 `researchStatus` 改为 `paused`，再向 `decisions` 追加一条记录，包含：观察到的问题、依据的样本和 `executionId`、决策时间，以及是否需要修改提示词后复测。此操作不会自动调用后台删除接口。明确要求后台停用且 MCP 确认软删除整个未发布候选后，才改为 `retired`，记录 `backendDeletion` 并追加独立的 `backend_deleted` 事件；`lastObservedBackend.versionStatus` 仍表示删除前最后一次真实版本状态。若后台删除失败或结果不明，保留 `paused` 并说明后台仍未确认停用。

当指令要求“测试 A/B/C 三个候选”，但登记中任何一个已暂停或淘汰，执行流程应先报告名单冲突，不悄悄改为只测剩余候选，也不把旧候选替换成同名模板。是否恢复候选由负责人明确决定并留下新事件。

保留候选并修改提示词时，MCP 只更新基础提示词与指定图片栏的模型作用；成功回读为 `testing` 后，才递增本地 `promptLabel`、刷新 `lastObservedBackend`，并追加 `prompt_updated` 决策，记录旧新版标签、修改字段、原因和执行编号，不保存提示词正文。若流程停在 `draft` 或结果不明，不提高标签，并将本地研发状态暂停，避免旧登记被当作可测版本。

## 5. “测试 TPL0001 的三个候选和三个素材”应如何执行

1. 从 `catalog.json` 找到 `TPL0001` 的目录和候选登记；从 `candidates.json` 得到 A/B/C 的后台模板 ID、版本 ID 与本地研发状态。
2. 对每个候选调用 `get_system_template` 权威回读，核对后台身份、版本、状态、当前 revision、模型能力及图片栏顺序。登记中的旧 revision 不能直接用于提交；回读失败或身份不符时停止付费提交并报告。
3. 从 `manifest.json` 读取负责人指定的三个 `T` 用例，展开其 `S` 图片组、严格顺序、`slotKey` 和各自的补充描述。A/B/C 对同一 `T` 必须使用相同输入条件。
4. 确认三个候选都可测、三个用例都存在、模型参数有效后，再创建新的 `executionId` 并逐项调用 MCP。执行报告保存实际提交和结果；登记可添加本轮 `executionId`，供后续质量决策引用。

当前正式素材目录中的 `TPL0001` 只有 `T001`、`T002` 两个用例。若现在要求“三个素材”，必须明确提示缺少第三个用例，不能把友商参考图临时冒充测试图，也不能把同一用例重复计算为三个素材。

## 6. 建立登记的前提与完成标准

先使用 MCP 管理员读取能力核对 A/B/C 的真实后台模板和版本，再写入新项目 `candidates.json`；旧项目状态和登记中的 UUID 只可作为待核对线索。旧项目曾为部分模板建立 A/B/C 登记，但本次迁移没有复制；新项目的首次候选关联将在后续流程中单独建立。

未来登记能力的最小验收是：给出 `TPL0001` 后能唯一得到已登记候选的真实后台 ID；停用 A 后默认测试名单同步变化且原因可查；后台修订变化或连接失败时不会使用陈旧登记提交付费任务；输入用例不足时明确指出缺口。本切片只迁移规则和素材，不执行这些候选操作。
