/**
 * 管理员试用的样本副本与结果导出文件端口。
 *
 * 本文件只在受控执行目录内创建文件，按真实内容决定扩展名，并限制结果下载协议、时间和大小。
 */
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageUploadContentType } from '@aipic/contracts';
import { McpOperationError } from './errors.js';
import type { PreparedGenerationInput } from './local-files.js';
import type { TrialItemRecord, TrialSampleInputRecord } from './trial-report.js';

const resultMaxBytes = 20 * 1024 * 1024;
const resultTimeoutMs = 30_000;

/** 将真实内容类型映射为固定扩展名，避免沿用伪造或危险的源文件后缀。 */
function inputExtension(contentType: ImageUploadContentType): string {
  return {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/svg+xml': 'svg',
  }[contentType];
}

/** 把展示名称压成安全文件片段；身份仍使用报告中的UUID，不依赖该文本。 */
function safeFilePart(value: string, fallback: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

/** 用临时文件加独占目标写入，拒绝覆盖已有原图或结果。 */
async function writeBinaryExclusive(target: string, bytes: Buffer): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    // 同目录硬链接既保证目标独占创建，也让完整临时文件一次性出现为正式文件。
    await link(temporary, target);
  } catch {
    throw new McpOperationError('MCP_OUTPUT_FILE_WRITE_FAILED', '本地图片文件写入失败', true);
  } finally {
    try {
      await unlink(temporary);
    } catch {
      // 临时文件不存在或已经无法访问时无需覆盖原始错误。
    }
  }
}

/** 将同一组原图复制一次，并返回报告使用的相对路径和摘要。 */
export async function copyTrialSampleInputs(
  executionDirectory: string,
  sampleId: string,
  inputs: Array<{ slotKey: string; file: PreparedGenerationInput }>,
): Promise<TrialSampleInputRecord[]> {
  const sampleDirectory = path.join(executionDirectory, sampleId);
  const temporaryDirectory = path.join(executionDirectory, `.${sampleId}.${randomUUID()}.tmp`);
  try {
    await mkdir(temporaryDirectory);
  } catch {
    throw new McpOperationError('MCP_OUTPUT_FILE_WRITE_FAILED', '无法创建样本临时目录', true);
  }
  const records: TrialSampleInputRecord[] = [];
  try {
    for (const [index, input] of inputs.entries()) {
      const base = safeFilePart(path.parse(input.file.relativePath).name, input.slotKey);
      const filename = `input_${String(index + 1).padStart(2, '0')}_${base}.${inputExtension(input.file.contentType)}`;
      const temporaryPath = path.join(temporaryDirectory, filename);
      const finalPath = path.join(sampleDirectory, filename);
      await writeBinaryExclusive(temporaryPath, input.file.bytes);
      records.push({
        slotKey: input.slotKey,
        sourceRelativePath: input.file.relativePath,
        copyRelativePath: path.relative(executionDirectory, finalPath).split(path.sep).join('/'),
        contentType: input.file.contentType,
        sizeBytes: input.file.sizeBytes,
        sha256: createHash('sha256').update(input.file.bytes).digest('hex'),
      });
    }
    await rename(temporaryDirectory, sampleDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (error instanceof McpOperationError) throw error;
    throw new McpOperationError('MCP_SAMPLE_ALREADY_EXISTS', '样本目录已存在且没有可恢复记录');
  }
  return records;
}

/** 校验短期结果地址；禁止非HTTPS和URL内嵌账号。 */
function safeResultUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
    return url;
  } catch {
    throw new McpOperationError('MCP_RESULT_URL_INVALID', '结果图片地址不安全');
  }
}

/** 逐块下载有界结果，不能依赖可伪造的Content-Length或Content-Type。 */
async function downloadResultBytes(
  fetcher: typeof fetch,
  sourceUrl: string,
): Promise<{
  bytes: Buffer;
  extension: 'jpg' | 'png';
}> {
  let response: Response;
  try {
    response = await fetcher(safeResultUrl(sourceUrl), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(resultTimeoutMs),
    });
  } catch (error) {
    if (error instanceof McpOperationError) throw error;
    throw new McpOperationError('MCP_RESULT_DOWNLOAD_FAILED', '结果图片下载失败');
  }
  if (!response.ok || (response.url && new URL(response.url).protocol !== 'https:')) {
    throw new McpOperationError('MCP_RESULT_DOWNLOAD_FAILED', '结果图片下载失败');
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > resultMaxBytes) {
    throw new McpOperationError('MCP_RESULT_FILE_INVALID', '结果图片超过20 MiB限制');
  }
  if (!response.body) throw new McpOperationError('MCP_RESULT_DOWNLOAD_FAILED', '结果图片下载失败');
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      size += chunk.length;
      if (size > resultMaxBytes) {
        await reader.cancel();
        throw new McpOperationError('MCP_RESULT_FILE_INVALID', '结果图片超过20 MiB限制');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof McpOperationError) throw error;
    throw new McpOperationError('MCP_RESULT_DOWNLOAD_FAILED', '结果图片下载失败');
  }
  const bytes = Buffer.concat(chunks, size);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10].every(
    (value, index) => bytes[index] === value,
  );
  if (bytes.length < 1 || (!jpeg && !png)) {
    throw new McpOperationError('MCP_RESULT_FILE_INVALID', '结果文件不是有效JPEG或PNG图片');
  }
  return { bytes, extension: jpeg ? 'jpg' : 'png' };
}

/** 下载并以可追溯且不可覆盖的文件名保存一个成功结果。 */
export async function exportTrialResult(
  executionDirectory: string,
  item: TrialItemRecord,
  sourceUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<string> {
  if (!item.taskId || !item.templateId || item.version == null) {
    throw new McpOperationError('MCP_REPORT_INVALID', '任务记录缺少结果命名所需字段');
  }
  const downloaded = await downloadResultBytes(fetcher, sourceUrl);
  const filename = `${item.candidateKey}_${item.templateId}_v${item.version}_r${item.revision}_${item.taskId}.${downloaded.extension}`;
  const target = path.join(executionDirectory, item.sampleId, filename);
  try {
    await writeBinaryExclusive(target, downloaded.bytes);
  } catch (error) {
    // 报告落盘前中断时允许确认并复用同一任务的完整文件，绝不覆盖不同内容。
    try {
      const existing = await lstat(target);
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        !(await readFile(target)).equals(downloaded.bytes)
      ) {
        throw error;
      }
    } catch {
      throw error;
    }
  }
  return path.relative(executionDirectory, target).split(path.sep).join('/');
}
