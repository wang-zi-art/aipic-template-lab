/**
 * 私密配置重载、独立项目根目录和受控输入输出边界测试。
 *
 * 测试保证令牌只来自磁盘，新位置能独立读写，路径不能逃逸受控根目录。
 */
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMcpRuntimeConfig, resolveDefaultConfigPath } from '../src/config.js';
import {
  detectGenerationInputContentType,
  detectTemplateAssetContentType,
  prepareInputFile,
  resolveExistingExecutionDirectory,
} from '../src/local-files.js';
import { initializeExecutionDirectory } from '../src/report.js';

/** 创建每个用例独享的临时目录，避免测试互相复用执行状态。 */
async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'aipic-mcp-'));
}

describe('runtime config', () => {
  /** 核对配置、素材和报告都落在当前独立项目内。 */
  it('从独立项目根目录读取配置并仅使用其素材和输出根目录', async () => {
    const root = await createTemporaryDirectory();
    const projectRoot = path.join(root, 'template-lab');
    const inputRoot = path.join(projectRoot, 'mcp-test', 'materials');
    const outputRoot = path.join(projectRoot, '.local', 'codex-template-mcp', 'outputs');
    const configPath = resolveDefaultConfigPath(projectRoot);
    await mkdir(inputRoot, { recursive: true });
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(path.join(inputRoot, 'sample.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    await writeFile(configPath, JSON.stringify({
      apiBaseUrl: 'https://example.test', adminSessionToken: 'test-session', inputRoot, outputRoot,
    }));

    const config = await loadMcpRuntimeConfig(configPath);
    const input = await prepareInputFile(config.inputRoot, 'sample.png');
    const executionId = '123e4567-e89b-42d3-a456-426614174801';
    const paths = await initializeExecutionDirectory(config.outputRoot, executionId);

    expect(configPath).toBe(path.join(projectRoot, '.local', 'codex-template-mcp', 'config.json'));
    expect(input.absolutePath).toBe(await realpath(path.join(inputRoot, 'sample.png')));
    expect(paths.directory).toBe(path.join(await realpath(outputRoot), executionId));
  });

  it('每次调用重新读取管理员会话', async () => {
    const root = await createTemporaryDirectory();
    const configPath = path.join(root, 'config.json');
    const inputRoot = path.join(root, 'input');
    const outputRoot = path.join(root, 'output');
    await mkdir(inputRoot);
    const base = { apiBaseUrl: 'https://example.test', inputRoot, outputRoot };
    await writeFile(configPath, JSON.stringify({ ...base, adminSessionToken: 'first' }));
    expect((await loadMcpRuntimeConfig(configPath)).adminSessionToken).toBe('first');
    await writeFile(configPath, JSON.stringify({ ...base, adminSessionToken: 'second' }));
    expect((await loadMcpRuntimeConfig(configPath)).adminSessionToken).toBe('second');
  });

  it.each(['ftp://example.test', 'https://user:pass@example.test', 'https://example.test?a=1']) (
    '拒绝不安全 API 地址 %s',
    async (apiBaseUrl) => {
      const root = await createTemporaryDirectory();
      const configPath = path.join(root, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({ apiBaseUrl, adminSessionToken: 'secret', inputRoot: root, outputRoot: root }),
      );
      await expect(loadMcpRuntimeConfig(configPath)).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' });
    },
  );
});

describe('controlled input files', () => {
  it('识别 JPEG、PNG、WebP 并拒绝动画 WebP', () => {
    expect(detectTemplateAssetContentType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(
      detectTemplateAssetContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])),
    ).toBe('image/png');
    const still = Buffer.from('RIFF0000WEBPVP8 0000');
    expect(detectTemplateAssetContentType(still)).toBe('image/webp');
    const animated = Buffer.from('RIFF0000WEBPVP8X000000000');
    animated[20] = 0x02;
    expect(detectTemplateAssetContentType(animated)).toBeNull();
  });

  it('按真实内容识别六类试用输入并排除AVIF与图片序列', () => {
    expect(detectGenerationInputContentType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(detectGenerationInputContentType(Buffer.from('RIFF0000WEBPVP8 0000'))).toBe('image/webp');
    expect(detectGenerationInputContentType(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0heic', 'binary'))).toBe('image/heic');
    expect(detectGenerationInputContentType(Buffer.from('\0\0\0\x18ftypmif1\0\0\0\0mif1', 'binary'))).toBe('image/heif');
    expect(detectGenerationInputContentType(Buffer.from('\uFEFF<?xml version="1.0"?><svg></svg>'))).toBe('image/svg+xml');
    expect(detectGenerationInputContentType(Buffer.from('\0\0\0\x18ftypavif\0\0\0\0avif', 'binary'))).toBeNull();
  });

  it('拒绝父目录穿越和伪图片', async () => {
    const root = await createTemporaryDirectory();
    const inputRoot = path.join(root, 'input');
    await mkdir(inputRoot);
    await writeFile(path.join(root, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    await writeFile(path.join(inputRoot, 'fake.png'), 'not an image');
    await expect(prepareInputFile(inputRoot, '../outside.png')).rejects.toMatchObject({
      code: 'MCP_INPUT_PATH_OUTSIDE_ROOT',
    });
    await expect(prepareInputFile(inputRoot, 'fake.png')).rejects.toMatchObject({
      code: 'MCP_INPUT_FILE_INVALID',
    });
  });
});

describe('controlled output files', () => {
  /** 执行目录即使通过链接指向外部，也不能被报告读取器接受。 */
  it('拒绝指向输出根目录外的执行目录链接', async () => {
    const root = await createTemporaryDirectory();
    const outputRoot = path.join(root, 'output');
    const outside = path.join(root, 'outside');
    const executionId = '123e4567-e89b-42d3-a456-426614174802';
    await mkdir(outputRoot);
    await mkdir(outside);
    await symlink(outside, path.join(outputRoot, executionId), 'junction');

    await expect(resolveExistingExecutionDirectory(outputRoot, executionId)).rejects.toMatchObject({
      code: 'MCP_OUTPUT_PATH_OUTSIDE_ROOT',
    });
  });
});
