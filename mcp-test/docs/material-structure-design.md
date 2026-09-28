# 系统模板测试素材目录设计

> 记录日期：2026-09-23  
> 状态：正式素材已迁入独立项目 `mcp-test/materials/`；图片栏映射须按未来候选的后台版本重新核对  
> 规则文档位置：`mcp-test/docs/`；由新项目普通 Git 管理

## 1. 目标与边界

为每一种系统模板建立固定编号和独立素材目录，保存最多一组友商参考，以及多组供 MCP 试用的有序上传图。每次测试还要准确记录对应的补充描述，确保不同候选使用同一输入条件进行比较，并能在以后找到当时使用的素材。

本设计只定义本地素材的组织与记录方式。它不改变后台模板、数据库、积分、MCP 工具接口或已有执行报告。友商参考图仅供观察和分析，不会因放入目录就自动成为生图输入。MCP 生成结果与人工评价另行记录，不混入原始素材目录。

模板类型与 A/B/C 后台候选的对应关系、停用原因及测试前回读规则见同目录的 `candidate-registry-design.md`；素材档案不承担这些研发状态。

## 2. 正式目录

```text
mcp-test/
├─ README.md                            # 工作目录入口与阅读顺序
├─ docs/
│  ├─ material-structure-design.md      # 本规则文档
│  └─ candidate-registry-design.md      # 候选关联登记设计
├─ materials/                           # 正式素材根目录；新 MCP inputRoot 已指向此处
│  ├─ catalog.json                     # 模板类型编号与目录索引
│  ├─ source-notes/test.md             # 原 test.md，内容保持不变
│  ├─ TPL0001-action-imitation/
│  │  ├─ manifest.json                 # 本模板类型的唯一素材档案
│  │  ├─ competitor/                    # 最多一组友商参考
│  │  │  ├─ input_01_subject_image.jpg
│  │  │  ├─ input_02_action_reference.jpg
│  │  │  └─ effect_01.png
│  │  └─ test-inputs/
│  │     ├─ S001/
│  │     │  ├─ input_01_subject_image.webp
│  │     │  └─ input_02_action_reference.jpg
│  │     └─ S002/
│  │        └─ ...
│  ├─ TPL0002-eyelid-medical-tape/
│  │  ├─ manifest.json
│  │  └─ competitor/...
│  └─ ... TPL0019-eyelid/
└─ archive/2026-09-23-initial-import/  # 一次性迁移脚本与历史清单
```

新项目的 `mcp-test/materials/` 是正式素材目录。新 MCP 的 `inputRoot` 和本机输出目录已配置；当前活动 MCP 仍在原项目。`D:\pic` 与原项目素材只作为历史和迁移回退来源，后续新增素材与用例只维护新项目目录。原 `test1` 至 `test18` 已规范成固定编号的模板目录，另有 `TPL0019`；`TPL0010` 和 `TPL0012` 仅有档案，没有空的 `competitor/`。

## 3. 编号与命名

| 编号 | 含义 | 规则 |
| --- | --- | --- |
| `TPL0001` | 一种模板类型 | 全局唯一、永久不复用；目录后缀仅便于阅读，中文名称记录在档案中。它不是后台的稳定模板 UUID，A/B/C 候选仍可对应多个后台模板。 |
| `S001` | 一组上传图 | 在所属模板类型内唯一；一组图片按后台图片栏顺序排列。同组图片可被多个测试用例复用。 |
| `T001` | 一项测试用例 | 在所属模板类型内唯一；定义“上传图组 + 一条确切的补充描述”。测试时把它作为现有 MCP 的 `sampleId`。 |

友商参考每个模板类型最多一组，因此不增加 `R001` 一类编号。图片文件名使用 `input_01_<简短用途>.<真实扩展名>`、`input_02_...` 和 `effect_01.<真实扩展名>`；用途尚未确认时可只保留序号。文件名帮助人工辨认；真正的栏位顺序由档案的有序数组和后台版本的 `slotKey` 共同确定。缺失第二栏图片时不能把原本的第三栏改名为第二栏。原 `test14` 的三张文件是带有“上传图／生成效果”标签的截图，正式文件以 `_capture` 命名，并在档案中标明 `representation=screenshot`，不称为无界面标记的原始图片。

## 4. 每个模板的 `manifest.json`

它是素材定义的唯一维护位置，建议包含以下数据：

| 区域 | 记录内容 |
| --- | --- |
| 模板身份 | 格式版本、`templateTypeId`、中文名称、档案修订号。 |
| 图片栏 `slots` | 每栏的 `order`、与后台一致的 `slotKey`、便于人阅读的名称。栏位的模型作用属于具体候选提示词，不在素材档案里复制。 |
| `competitorReference` | 最多一个对象；完整缺失时为 `null`。有图时分别列出实际取得的上传图、效果图、来源及缺失说明。只有上传图或只有效果图均允许记录，但不能声称已观察到完整配对。 |
| 上传图组 `imageSets` | `S` 编号、有序的栏位与相对路径、便于筛选的素材特征。正式测试用图必须满足当前后台版本的全部必填栏位。 |
| 测试用例 `testCases` | `T` 编号、引用的 `S` 编号、完整补充描述原文或 `null`、开发／留存用途及简短测试重点。 |

以下是结构示例，不代表已经创建或取得这些图片：

```json
{
  "schemaVersion": 1,
  "templateTypeId": "TPL0001",
  "name": "动作模仿",
  "revision": 1,
  "slots": [
    { "order": 1, "slotKey": "subject", "label": "主体人物" },
    { "order": 2, "slotKey": "action_reference", "label": "动作参考" }
  ],
  "competitorReference": null,
  "imageSets": [
    {
      "id": "S001",
      "inputs": [
        { "order": 1, "slotKey": "subject", "path": "test-inputs/S001/input_01_subject.jpg" },
        { "order": 2, "slotKey": "action_reference", "path": "test-inputs/S001/input_02_action.jpg" }
      ],
      "tags": ["手持道具", "动作迁移"]
    }
  ],
  "testCases": [
    {
      "id": "T001",
      "imageSetId": "S001",
      "pool": "development",
      "supplementalDescription": "让图一人物参考图二一样手持冰袋",
      "focus": "检查动作和道具是否来自第二张图"
    },
    {
      "id": "T002",
      "imageSetId": "S001",
      "pool": "development",
      "supplementalDescription": null,
      "focus": "检查无补充描述时的基础效果"
    }
  ]
}
```

示例中的 `subject`、`action_reference` 只是说明字段结构，不能照抄为真实栏位键。迁入后所有档案的 `slotMappingStatus` 均为 `unverified`；`TPL0001`、`TPL0004`、`TPL0019` 留有旧项目已用过的 `slotKey`，仅供新候选回读时核对。其余模板当前的 `slotKey` 为 `null`。档案保存上传顺序，不能直接当作已核准的 MCP 提交配置。

友商图片存在时，把 `competitorReference` 从 `null` 改成一个对象，分别保存 `inputs` 和 `effects` 数组。数组可以为空；只登记实际存在的文件，并用 `missingNote` 说明缺失或对应关系不确定的部分。友商图片不要求凑齐后台图片栏，也不要求与当前测试素材的数量一致。

`pool=development` 表示可用于探索和调词；`pool=holdout` 表示计划留作泛化检查。如果要检验对新图片的泛化能力，留存用例必须引用未参与调词的 `S` 图片组；如果只改变补充描述而复用已见图片，只能称为补充描述变化测试。若已查看留存用例的结果并据此修改提示词，后续不能继续把它的复测结果称为独立泛化验证。回归测试可以再次选用既有 `T` 编号，无须复制图片或创建新编号。

## 5. 补充描述与横向比较

同一上传图组可以对应多项测试用例，例如 `T001` 与 `T002` 都引用 `S001`，但使用不同补充描述。`null` 表示本次不提交补充描述；非空值必须保存测试时使用的完整原文，不依赖“沿用默认文案”一类隐式规则。现有 MCP 对补充描述有最多 500 字符的限制，而且只有当前测试版本允许时才可提交。

同一轮 A/B/C 横向比较应使用同一个 `T` 编号，保证三者的图片、图片顺序、补充描述和其他生成参数一致；候选模板版本可以不同。若某候选的图片栏结构不同，需先解决栏位映射，不能为了凑齐对照而悄悄交换图片。

## 6. 保存与变更规则

1. 正式目录中的 `catalog.json` 只登记模板类型编号、名称和目录，不复制每组素材明细；详细内容由各模板的 `manifest.json` 维护。
2. 相对路径以本模板类型目录为起点。所有测试图片必须位于受控 `mcp-test/materials/` 根目录内；不得使用 `..` 跳出所属模板目录。
3. 图片组或测试用例一旦参加真实测试，不在原编号下换图、换顺序或改补充描述；有变化时新建 `S` 或 `T` 编号。更正纯展示名称可以提高档案修订号并注明原因。
4. 执行前检查文件存在、真实格式、大小、图片栏数量和顺序、`slotKey`、补充描述长度，以及后台当前版本是否允许该描述。现有 MCP 仍负责自己的上传前校验；未来的执行 Skill 应先校验档案并把用例展开为 MCP 参数。
5. 每轮执行应记录档案修订号、所选 `T` 编号及对应的图片内容校验值。现有 MCP 报告已经记录实际输入图片的 SHA-256、路径和每项实际补充描述；跨轮的档案锁定与校验仍需后续实现，不能把本设计写成已具备的工具能力。
6. 模板素材档案只记录输入定义。任务、积分和导出状态由 MCP 执行报告记录，服务端状态仍以 PostgreSQL 为准；人工画面评价和候选取舍放在之后设计的评审记录中。
7. 当前档案额外保存 `originalRelativePath`、`sizeBytes`、真实 `contentType` 和 `sha256`。原 `test1\testexample1\uploadpic1.png` 实际是 WebP，正式文件因此使用 `.webp`；改名前的路径仍写在档案和 `archive/2026-09-23-initial-import/direct-layout-map.json` 中。
8. `D:\pic` 和原项目素材是历史或迁移回退来源；后续素材修改只发生在新项目正式目录。需要恢复时，先按 SHA-256 和档案修订号核对，不以旧备份覆盖更新后的素材。

## 7. 首次整理与本次迁移

原 `test1` 至 `test18` 规范为 `TPL0001` 至 `TPL0018` 的过程保存在 `archive/`；`TPL0019` 后续增量建立。`TPL0010` 和 `TPL0012` 没有友商参考图片，档案中的 `competitorReference=null`。`TPL0001` 的 `S001`、`S002` 分别来自原 `testexample1`、`testexample2`，其 `T001`、`T002` 保留从旧试用归纳的完整补充描述，但不再关联旧执行编号或报告。

本次迁入 19 份档案和 71 张图片，原图的路径、大小与 SHA-256 见新项目 `docs/materials-source-snapshot.json`。迁入后必须先回读新候选的真实图片栏，再由已迁入的 Skill 将 `T` 用例展开为 MCP 参数；MCP 本身不会自动读取 `manifest.json`。
