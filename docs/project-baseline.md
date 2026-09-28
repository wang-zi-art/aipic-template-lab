# 模板提示词测试项目基线

> 更新日期：2026-09-28

## 目标与使用者

项目负责人通过中文任务选择项目 Skill，利用正式素材研发系统模板提示词；本地 MCP 通过原项目的管理员 HTTP API 读取模板与模型、上传素材、提交管理员试用及收集结果。原项目 API、Worker、PostgreSQL、COS 和积分账本继续保存业务真相。

## 工程边界

- 独立 Git 与 pnpm workspace；Node.js 24、pnpm 11.9、TypeScript。`packages/contracts` 是 MCP 所需 HTTP 契约快照，来源与 SHA-256 见 `docs/source-snapshot.json`。
- `apps/mcp` 提供九个 stdio 工具。工具只走管理员 HTTP API，不直连原项目源码、数据库、队列或长期云凭据。
- `mcp-test/materials/` 保存 TPL/S/T 编号、正式图片和素材档案；图片使用 Git LFS。`mcp-test/CORE.md` 是稳定素材与候选规则入口。
- `docs/skills/` 保存九个项目 Skill 和中文索引；它们不安装到全局技能目录。接口使用边界见 `docs/template-testing-interface-baseline.md`。
- `.local/codex-template-mcp/config.json` 保存本机四字段私密配置；`plans/` 保存新执行计划，`outputs/` 保存报告、生成图片和横向对比。整个 `.local/` 被 Git 忽略。
- 本项目不继承原项目候选登记、执行计划和报告，也不自行发布模板。后台候选、任务及积分以实时管理员回读为准。

## 维护与验证

原项目相关 HTTP 契约变化时，明确安排契约同步，更新来源记录，并执行兼容检查。每次代码与文档改动只覆盖当前业务切片；运行适用的 `corepack pnpm check` 和实际主流程检查，不用未执行的验证结果代替验收。完成后保持未提交状态，由负责人审核。