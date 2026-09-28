# 模板提示词测试项目

本项目承载系统模板提示词研发使用的本地 MCP、九个项目 Skill 和正式素材。切片一至四验证通过后，切片五已将活动 MCP 入口切换到本项目；MCP 继续通过原项目的管理员 HTTP API 工作，不直接读取原项目数据库、队列或源码。迁移改动保持未提交供负责人审核。

## 本地开发

需要 Node.js 24 和 pnpm 11.9，安装 Git LFS 才能在今后的 Git 检出中取得真实素材图片。首次运行 `corepack pnpm install`，随后使用 `corepack pnpm build` 构建契约和 MCP，使用 `corepack pnpm materials:verify` 只读核验正式素材，使用 `corepack pnpm check` 检查格式、Lint、类型、测试、构建和素材。`corepack pnpm dev:mcp` 仅在本机配置好管理员环境后使用。

`packages/contracts` 是 MCP 实际使用的原项目 HTTP 契约快照。[来源清单](docs/source-snapshot.json)记录每个迁入文件的源提交和 SHA-256；原项目更新相关接口后，需要明确同步快照并验证兼容性。迁入的八个 MCP 测试文件保持原始字节，因此格式检查跳过它们，Lint 和测试仍覆盖它们。

正式素材位于 [`mcp-test/materials/`](mcp-test/materials/)；迁入时的 92 个文件清单、大小和 SHA-256 记录在 [`docs/materials-source-snapshot.json`](docs/materials-source-snapshot.json)。其中 71 张图片被 `.gitattributes` 的 Git LFS 规则匹配，获准暂存时再核对 LFS 指针；档案和规则使用普通 Git。旧候选登记和执行进度没有迁入。项目的 `.local/` 保存私密配置、后续执行计划、生成结果和报告，由 Git 忽略；输入根目录为正式素材，输出根目录为 `.local/codex-template-mcp/outputs/`，计划位于 `.local/codex-template-mcp/plans/`。本机活动入口为受 Git 忽略的 `.codex/config.toml`，配置示例不含会话凭据。

## 结果对比页面

[`apps/comparison-preview/index.html`](apps/comparison-preview/index.html) 提供三套可独立打开的静态交互样稿：逐例评审台、批次联系表和局部差异台。样稿只展示标注清楚的演示数据。逐例评审台提供暖白墨绿、冷白蓝灰、石墨蓝紫三种视觉样式；选定的石墨蓝紫方案已用于真实批次汇总。每轮结果在 `.local/codex-template-mcp/outputs/<executionId>/comparison/index.html`，可从文件管理器直接打开，逐例查看候选生成图、输入图和各状态。实现与边界见[页面说明](apps/comparison-preview/README.md)。
