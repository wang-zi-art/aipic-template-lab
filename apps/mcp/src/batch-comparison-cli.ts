/**
 * 本地批量试用计划与文件夹汇总命令入口。
 *
 * validate 只检查已准备的素材，不调用后台；build 只读取 MCP 报告并整理本地文件，
 * 生图提交和结果收集仍由项目 MCP 工具负责。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMcpRuntimeConfig, resolveDefaultConfigPath } from './config.js';
import { buildBatchComparison, readBatchPlan, validateBatchInputs } from './batch-comparison.js';

/** 根据命令选择只读预检或派生汇总，不输出私密配置内容。 */
async function main(): Promise<void> {
  const [command, planPath] = process.argv.slice(2);
  if (!planPath || !['validate', 'build'].includes(command ?? '')) {
    throw new Error('用法：batch-comparison <validate|build> <batch-plan.json 路径>');
  }
  // pnpm --filter 会把 cwd 切到 apps/mcp，配置仍固定从仓库根目录读取。
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const config = await loadMcpRuntimeConfig(resolveDefaultConfigPath(projectRoot));
  const plan = await readBatchPlan(path.resolve(projectRoot, planPath));
  if (command === 'validate') {
    await validateBatchInputs(plan, config.inputRoot);
    process.stdout.write(
      `已核对 ${plan.cases.length} 个用例、${plan.candidates.length} 个候选的本地素材。\n`,
    );
    return;
  }
  const result = await buildBatchComparison(plan, config.outputRoot);
  process.stdout.write(`汇总目录：${result.directory}\n`);
}

// 命令失败只返回安全错误文本，不泄露管理员会话与完整提示词。
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : '批量汇总失败'}\n`);
  process.exitCode = 1;
});
