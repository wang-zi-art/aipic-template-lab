/**
 * MCP 受控本地文件端口。
 *
 * 输入图片必须位于配置根目录内并通过真实路径复核；输出执行目录只能由安全 UUID 创建或读取。
 */
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  adminSystemTemplateAssetMaxOriginalBytes,
  imageUploadMaxSizeBytes,
  type AdminSystemTemplateAssetContentType,
  type ImageUploadContentType,
} from '@aipic/contracts';
import { McpOperationError } from './errors.js';

export interface PreparedInputFile {
  absolutePath: string;
  relativePath: string;
  contentType: AdminSystemTemplateAssetContentType;
  sizeBytes: number;
  bytes: Buffer;
}

/** 生图试用输入比后台模板素材多支持HEIC、HEIF与静态SVG。 */
export interface PreparedGenerationInput {
  absolutePath: string;
  relativePath: string;
  contentType: ImageUploadContentType;
  sizeBytes: number;
  bytes: Buffer;
}

/** 使用 path.relative 判断真实目标是否仍位于授权根目录内。 */
function assertInsideRoot(root: string, target: string, code: string): void {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '.' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new McpOperationError(code, '本地路径超出授权根目录');
  }
}

/** 根据真实文件头识别后台素材接口接受的三种图片容器。 */
export function detectTemplateAssetContentType(
  bytes: Uint8Array,
): AdminSystemTemplateAssetContentType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((value, index) => bytes[index] === value)) return 'image/png';
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 16 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    // VP8X 第 20 字节的 animation 位表示动图；短的 VP8/VP8L 文件不含该扩展标记。
    if (text(12, 4) === 'VP8X' && bytes.length >= 21 && (bytes[20]! & 0x02) !== 0) return null;
    return 'image/webp';
  }
  return null;
}

/** 读取ISO BMFF品牌，只接受项目现有契约支持的静态HEIC或HEIF容器。 */
function detectHeifContentType(bytes: Uint8Array): 'image/heic' | 'image/heif' | null {
  const text = (start: number, length: number) =>
    Buffer.from(bytes.slice(start, start + length)).toString('ascii');
  if (bytes.length < 16 || text(4, 4) !== 'ftyp') return null;
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 128); offset += offset === 8 ? 8 : 4) {
    brands.push(text(offset, 4));
  }
  if (brands.some((brand) => ['avif', 'avis', 'msf1'].includes(brand))) return null;
  if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) {
    return 'image/heic';
  }
  return brands.some((brand) => ['mif1', 'heim', 'heis'].includes(brand)) ? 'image/heif' : null;
}

/** 根据真实字节识别六类生成输入，不信任扩展名或调用者声明的MIME。 */
export function detectGenerationInputContentType(bytes: Uint8Array): ImageUploadContentType | null {
  const templateType = detectTemplateAssetContentType(bytes);
  if (templateType) return templateType;
  const heifType = detectHeifContentType(bytes);
  if (heifType) return heifType;
  const header = Buffer.from(bytes.slice(0, Math.min(bytes.length, 4_096)))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  return /^(?:<\?xml[\s\S]*?\?>\s*)?<svg(?:\s|>)/i.test(header) ? 'image/svg+xml' : null;
}

/** 解析、复核并读取一张授权素材；报告只保留相对路径。 */
export async function prepareInputFile(
  inputRoot: string,
  requestedPath: string,
): Promise<PreparedInputFile> {
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await realpath(inputRoot);
    const candidate = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(realRoot, requestedPath);
    realFile = await realpath(candidate);
  } catch {
    throw new McpOperationError('MCP_INPUT_FILE_UNAVAILABLE', '素材文件或输入根目录不存在');
  }
  assertInsideRoot(realRoot, realFile, 'MCP_INPUT_PATH_OUTSIDE_ROOT');
  const info = await stat(realFile);
  if (!info.isFile() || info.size < 1 || info.size > adminSystemTemplateAssetMaxOriginalBytes) {
    throw new McpOperationError('MCP_INPUT_FILE_INVALID', '素材必须是 20 MiB 以内的非空文件');
  }
  const bytes = await readFile(realFile);
  const contentType = detectTemplateAssetContentType(bytes);
  if (!contentType) {
    throw new McpOperationError('MCP_INPUT_FILE_INVALID', '素材只支持真实 JPEG、PNG 或静态 WebP');
  }
  return {
    absolutePath: realFile,
    relativePath: path.relative(realRoot, realFile).split(path.sep).join('/'),
    contentType,
    sizeBytes: info.size,
    bytes,
  };
}

/** 解析并完整读取一张受控生图输入，返回后可直接用于本地副本和COS直传。 */
export async function prepareGenerationInput(
  inputRoot: string,
  requestedPath: string,
): Promise<PreparedGenerationInput> {
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await realpath(inputRoot);
    const candidate = path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(realRoot, requestedPath);
    realFile = await realpath(candidate);
  } catch {
    throw new McpOperationError('MCP_INPUT_FILE_UNAVAILABLE', '试用图片或输入根目录不存在');
  }
  assertInsideRoot(realRoot, realFile, 'MCP_INPUT_PATH_OUTSIDE_ROOT');
  const info = await stat(realFile);
  if (!info.isFile() || info.size < 1 || info.size > imageUploadMaxSizeBytes) {
    throw new McpOperationError('MCP_INPUT_FILE_INVALID', '试用图片必须是20 MiB以内的非空文件');
  }
  const bytes = await readFile(realFile);
  const contentType = detectGenerationInputContentType(bytes);
  if (!contentType) {
    throw new McpOperationError(
      'MCP_INPUT_FILE_INVALID',
      '试用图片只支持真实JPEG、PNG、静态WebP、HEIC、HEIF或静态SVG',
    );
  }
  return {
    absolutePath: realFile,
    relativePath: path.relative(realRoot, realFile).split(path.sep).join('/'),
    contentType,
    sizeBytes: info.size,
    bytes,
  };
}

/** 创建输出根目录并返回其真实路径。 */
export async function prepareOutputRoot(outputRoot: string): Promise<string> {
  try {
    await mkdir(outputRoot, { recursive: true });
    return await realpath(outputRoot);
  } catch {
    throw new McpOperationError('MCP_OUTPUT_ROOT_UNAVAILABLE', '无法创建或访问输出根目录');
  }
}

/** 校验已有执行目录，供报告查询使用。 */
export async function resolveExistingExecutionDirectory(
  outputRoot: string,
  executionId: string,
): Promise<string> {
  const root = await prepareOutputRoot(outputRoot);
  let directory: string;
  try {
    directory = await realpath(path.join(root, executionId));
  } catch {
    throw new McpOperationError('MCP_EXECUTION_NOT_FOUND', '执行记录不存在');
  }
  assertInsideRoot(root, directory, 'MCP_OUTPUT_PATH_OUTSIDE_ROOT');
  return directory;
}
