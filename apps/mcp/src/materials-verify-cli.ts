/**
 * 正式素材只读核验命令。
 *
 * 从当前工程位置定位 mcp-test/materials，不读取旧仓库、管理员会话或运行输出。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMaterialsRoot } from './materials-verify.js';

/** 核验正式素材并打印简短统计，失败时返回非零退出码。 */
async function main(): Promise<void> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const result = await verifyMaterialsRoot(path.join(projectRoot, 'mcp-test', 'materials'));
  process.stdout.write(
    `素材核验通过：${result.templateCount} 个模板类型，${result.imageCount} 张图片，${result.imageBytes} 字节。\n`,
  );
}

// 命令只输出素材相对错误信息，不打印管理员配置。
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : '素材核验失败'}\n`);
  process.exitCode = 1;
});
