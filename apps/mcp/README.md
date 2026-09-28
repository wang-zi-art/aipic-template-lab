# 系统模板测试 MCP

该应用通过本地 `stdio` 把九个受控工具提供给 Codex。它只调用现有 HTTP API：候选素材为可选项，有素材时先由本机校验，再使用单次临时 COS 票据直传；每次试用输入仍必须校验并独立上传。候选创建、试用提交、提示词更新、候选软删除和结果收集分别输出安全的 JSON 与 Markdown 报告。

## 配置

1. 复制 `apps/mcp/config.example.json` 到 `.local/codex-template-mcp/config.json`。
2. 填写目标 API 根地址、正式管理员会话，以及允许读取和写入的两个绝对目录。该文件已由仓库忽略，不要提交。
3. 运行 `pnpm --filter @aipic/mcp build`。
4. 切片五切换活动入口时，复制 `.codex/config.toml.example` 为 `.codex/config.toml` 并核对新项目绝对路径。活动配置已由仓库忽略；切片三只保留示例。
5. 切片五启用后重启 Codex，在 MCP 工具列表确认以下九项：
   - `get_admin_context`
   - `get_system_template`
   - `create_system_template_candidate`
   - `submit_template_trial`
   - `submit_template_trial_batch`
   - `collect_template_trial_results`
   - `update_system_template_prompt`
   - `delete_unpublished_system_template`
   - `get_template_trial_report`

私密配置会在每次工具调用时重新读取，因此只更新管理员会话不需要重启 MCP。协议进程的 stdout 只承载 MCP 消息，诊断信息只会以脱敏固定文案写入 stderr。

## 推荐调用顺序

先调用 `get_admin_context` 核对身份、分类和模型，再用 `get_system_template` 读取参考模板。确认完整表单后，每个候选分别调用一次 `create_system_template_candidate`；没有效果图、栏位示例图或预设图时传入空 `assets`，有素材时再提供全部本地路径。若返回 `uncertain` 或 `reportPersisted=false`，不要重复创建；先按 executionId 查看报告并到后台核对服务端状态。

批量试用时，为整组操作准备一个新的 UUID v4 `executionId`，把完整批次计划一次传给 `submit_template_trial_batch`；工具先整批预检，再按“样本优先、候选 A/B/C 次序”内部串行调用单项提交服务。同一 `sampleId` 在三个候选中必须使用完全相同的栏位、路径和图片内容；MCP 只复制一份本地原图，但会为每个组合重新申请上传凭据。全部组合调用完成后再调用 `collect_template_trial_results`；首次收集会关闭提交阶段，每次最多查询十项、同时处理至多三项且不等待轮询。

每次提交前先读取测试版本的实时 `model`。比例与分辨率必须使用 `model.sizes` 中的同一组合；`auto` 是模型的真实参数，只能按 `aspectRatio=auto`、`resolution=auto` 成对提交，不能表示“使用默认分辨率”。需要默认值时显式提交 `defaultRatio`、`defaultResolution` 和 `defaultQuality`；模型有 `qualities` 时质量必填，模型没有质量选项时不得提交 `quality`。模板上的旧比例兼容字段不作为模型试用能力来源。

任务提交结果不明确时，报告会保留原 `clientRequestId` 并停止新的付费提交，不得换新标识重发。结果下载失败可以再次调用收集工具取得新签名，不会重新生图。本应用不提供自动重试、测试确认或发布能力。

批量横向比较使用项目 Skill `docs/skills/system-template-batch-trial/SKILL.md` 编排批量提交和结果收集。新工具在付费写入前自动完成素材验证，已有执行编号不可再次批量提交；提交后自动生成 `batch-plan.json` 及 `comparison/`，收集有进展或到终态时自动更新。打开 `comparison/index.html` 可在石墨蓝紫评审台逐例查看真实 A/B/C 结果、状态和输入图，并同步缩放、平移；页面可直接从文件管理器打开，不依赖本地服务。`comparison/README.md` 便于人工浏览，`summary.json` 保留可复用的相对路径与状态；需要单独排查或修复汇总时仍可运行 `batch:comparison validate|build`，原报告和原图保持不变。

保留候选需要改提示词时，调用 `update_system_template_prompt` 并提交版本 `revision`、新的基础提示词和需要改变的栏位模型作用。工具会读取完整权威表单；`testing` 版本先退回 `draft`，只合并指定字段，再保存并重新进入 `testing`。任一步失败都会停在实际状态，不自动补偿或重发。淘汰候选使用 `delete_unpublished_system_template`，每次只提交一个稳定模板及其 `revision`；服务端只允许删除从未发布、无活跃试用且状态合法的系统候选，重复请求返回首次删除时间。

试用输入支持真实 JPEG、PNG、静态 WebP、HEIC、HEIF 和静态 SVG，单张不超过 20 MiB；成功结果只按真实内容导出 JPEG 或 PNG。报告不会保存管理员会话、COS 临时凭据、对象 Key、签名地址、完整提示词或图片栏模型作用。

## 本地检查

```text
pnpm --filter @aipic/mcp typecheck
pnpm --filter @aipic/mcp test
pnpm --filter @aipic/mcp build
```
