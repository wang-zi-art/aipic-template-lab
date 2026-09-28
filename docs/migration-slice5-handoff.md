# 迁移切片五交接记录

> 日期：2026-09-28  
> 状态：活动入口已切换，本地验证通过；两项目改动待负责人审核，均未提交

## 本项目变更与数据流

项目级活动配置 `.codex/config.toml` 已从示例启用，并由 Git 忽略。Codex 从本项目的 `apps/mcp/dist/main.js` 启动九个 stdio 工具；MCP 读取本项目 `.local/codex-template-mcp/config.json`，通过原项目管理员 HTTP API 获取后台状态，读取 `mcp-test/materials/` 的正式素材，将未来的计划、报告和结果写入本项目 `.local/`。管理员会话不在活动 Codex 配置、示例或文档中。

本次仅更新配置示例的阶段说明、README、项目状态和本交接文档；未修改本项目 MCP 源码、工具协议、素材或共享契约。原项目的 `apps/mcp/`、九个 Skill 和旧本机目录退出日常路径，保存在原项目 `.local/template-testing-migration-backup/slice5-20260928-192321/`。旧候选、执行编号、报告与图片没有导入本项目；后台既有模板、任务与积分数据不变。

## 实际验证

- 切片四已在本项目原位置和独立副本完成安装、构建、替身写流程及真实管理员只读连接；见[切片四核验](migration-slice4-validation.md)。
- 切换后直接启动活动配置指向的构建产物，MCP 握手发现九个工具；仅调用 `get_admin_context`，得到 `platform_admin`、6 项分类和 3 项模型。没有调用真实写工具。
- `corepack pnpm check` 通过：格式、Lint、类型、构建、9 个测试文件共 63 项测试，以及 19 类／71 张／80,960,412 字节正式素材核验。
- 71 张正式图片全部命中 Git LFS 属性；`git check-ignore` 确认活动配置和 `.local/` 私密配置、计划、输出均被忽略。本项目没有 `candidates.json`，新计划与新结果目录为空。
- 原项目适用的 Lint、架构、类型、1,263 项测试及显式 HTTPS 测试配置下的构建通过。其组合检查仍被迁移前已有的 `pnpm-workspace.yaml` 格式问题阻塞；本轮修改的配置文件单独格式检查通过。详情见原项目 `docs/features/033-template-testing-project-migration.md` 的切片五实施记录。

## 回退与限制

如需回退，先暂停新测试调用，停用本项目 `.codex/config.toml` 中的 MCP 条目并停止准确指向本项目 MCP 的进程。原项目回退目录保存旧配置、两处旧 `.local/` 目录、旧 MCP 源码和九个 Skill；在确认原路径没有新增内容后，按原目录名放回，并只撤销原项目本轮根命令、锁文件、检查规则和文档差异。不要对原项目整仓重置，也不要把旧候选或旧执行报告作为本项目当前进度。逐文件大小和 SHA-256 清单为原项目回退目录中的 `old-local-manifest.json`。

本项目尚无 Git 提交或远端；Git LFS 图片尚未完成远程备份。真实 COS 上传和付费生图尚未从新项目执行，后续按对应 Skill 的后台身份与 revision 回读规则单独验收。两项目本轮均未暂存、提交或推送；本切片没有 HTTP 接口或数据库迁移。
