# 项目自制 Skill 中文命令索引

在本项目中，可以直接用中文描述任务。助手先按下表定位 Skill，**打开对应 `SKILL.md` 阅读完整规则后执行**；本页只负责选路，不代替具体 Skill、`mcp-test/CORE.md` 或后台实时状态。这里的九个 Skill 保存在独立项目文档中，未安装到全局技能目录；本项目的 `AGENTS.md` 指向本索引。新项目目前没有候选登记或执行进度。

## 中文命令与 Skill

| 想完成的事 | 可直接发送的中文命令示例 | 对应 Skill | 交付与边界 |
| --- | --- | --- | --- |
| 提炼验收标准 | “为 TPL0001 制定验收标准。” | [system-template-acceptance](system-template-acceptance/SKILL.md) | 读取 `sourceNote` 和友商参考，交付带依据的 AC 初稿；按反馈修订，不创建模板。 |
| 设计候选提示词 | “按已确认的 AC-v2，为 TPL0001 设计 A/B/C 三套提示词。” | [system-template-prompt-candidates](system-template-prompt-candidates/SKILL.md) | 同时交付共用创建配置、各栏模型作用与完整基础提示词；不写入后台。 |
| 从验收标准走到后台创建 | “为 TPL0001 完整走一遍验收标准、候选提示词和后台创建流程。” | [system-template-create-workflow](system-template-create-workflow/SKILL.md) | 依次调用上面两项及创建 Skill；验收标准、候选内容分别经人工确认后才进入下一阶段。 |
| 直接创建已确定的候选 | “把已确认的 TPL0001 A-v1、B-v1 创建为后台测试模板。” | [system-template-candidate-create](system-template-candidate-create/SKILL.md) | 逐个创建、回读确认 `testing`，同步 `materials` 中的候选关联；不生图、不发布。 |
| 批量生图并横向查看 | “用 TPL0001 的 A/B/C 对 T001、T002 批量生图，整理横向对比文件夹。” | [system-template-batch-trial](system-template-batch-trial/SKILL.md) | 一次调用完成整批预检和内部串行提交，随后收集、续收并更新 `comparison/`；每轮只处理一个 `TPL` 类型。 |
| 修改某个候选提示词 | “把 TPL0001 的 B-v1 按以下要求修改，并恢复测试状态：……” | [system-template-candidate-edit](system-template-candidate-edit/SKILL.md) | 更新完整基础提示词或指定栏位作用，回读确认 `testing`，同步候选登记；不更换模型、分类或栏位结构。 |
| 停用质量不佳的候选 | “停用 TPL0001 的 B-v1，原因是 T002 结果中的人物身份不稳定。” | [system-template-candidate-retire](system-template-candidate-retire/SKILL.md) | 后台会软删除**整个未发布候选模板**，随后同步本地状态；不是只关闭某个提示词版本。 |
| 删除未发布候选 | “删除 TPL0001 的 B-v1 候选模板。” | [system-template-candidate-delete](system-template-candidate-delete/SKILL.md) | 与“停用”使用同一后台软删除操作；不会物理清除历史任务与结果。 |
| 根据测试结果持续优化至定稿 | “按 TPL0001 本轮生图结果分析问题，迭代主选和备选提示词。” | [system-template-prompts](system-template-prompts/SKILL.md) | 覆盖素材整理、结果评审、问题归类与最终提示词；不会仅凭此命令自动提交付费生图或发布。 |

## 选路与执行约定

1. **按目标选入口。**“写出来／设计”使用只产出文本的 Skill；“创建／编辑／停用／删除／批量生图”使用对应操作 Skill。若要求一条命令从参考素材走到后台创建，使用组合流程；若要对已有生图结果做质量分析与定稿，使用完整研发 Skill。
2. **先查已有上下文。**`TPLxxxx` 是素材类型编号，`A-vN` 是候选提示词标签，`Txxx` 是正式测试用例。助手应从当前会话、`mcp-test/materials/catalog.json`、对应 `manifest.json`、已有 `candidates.json` 和必要的后台回读获取信息；不能凭相似名称猜测后台 ID。缺少影响操作的关键身份或内容时，按对应 Skill 报明缺口。
3. **遵守各 Skill 的推进条件。**组合创建流程的两次人工审批不能跳过；已明确批准的版本不重复索要批准。用户明确要求执行创建、编辑、批量生图、停用或删除时，按对应 Skill 处理，不因本索引再增加一层审批。
4. **不要把“暂停测试”理解为后台停用。**当前“停用”和“删除”都指软删除整个未发布模板；如果只想暂时从测试名单移除，应明确说“仅在本地候选登记中暂停，不删除后台模板”，并按实际登记规则处理。
5. **按实际能力报告。**项目 Skill 只是工作指引，MCP 是否可调用、候选是否已登记、素材是否齐全及后台状态以当次核查为准。执行失败或结果不明时保留原执行编号，不把部分完成写成全部成功。

需要查看素材、候选与结果目录，读 [模块核心规范](../../mcp-test/CORE.md)；需要了解当前进度，读 [项目状态](../project-status.md)；需要核对后台规则，读 [接口使用基线](../template-testing-interface-baseline.md)。
