/**
 * 正式素材的只读核验入口。
 *
 * 从目录索引找到每份档案，再按档案引用读取真实图片，核对编号、路径、大小、哈希和文件类型。
 * 这一步不依赖管理员配置，也不创建候选或执行任务。
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { detectGenerationInputContentType } from './local-files.js';

const imageSchema = z.object({
  path: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  contentType: z.string(),
  order: z.number().int().positive(),
});

const manifestSchema = z.object({
  schemaVersion: z.number().int(),
  templateTypeId: z.string().regex(/^TPL\d{4}$/),
  name: z.string(),
  revision: z.number().int().positive(),
  slots: z.array(z.object({ order: z.number().int().positive(), slotKey: z.string().nullable() })),
  competitorReference: z
    .object({ inputs: z.array(imageSchema), effects: z.array(imageSchema) })
    .nullable(),
  imageSets: z.array(z.object({ id: z.string().regex(/^S\d{3}$/), inputs: z.array(imageSchema) })),
  testCases: z.array(
    z.object({
      id: z.string().regex(/^T\d{3}$/),
      imageSetId: z.string().regex(/^S\d{3}$/),
      supplementalDescription: z.string().nullable(),
    }),
  ),
});

const catalogSchema = z.object({
  schemaVersion: z.number().int(),
  templates: z.array(
    z.object({
      templateTypeId: z.string().regex(/^TPL\d{4}$/),
      name: z.string(),
      directory: z.string(),
    }),
  ),
});

const extensionContentTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.svg': 'image/svg+xml',
};

export interface MaterialsVerificationResult {
  templateCount: number;
  imageCount: number;
  imageBytes: number;
}

/** 只接受简单相对路径，防止档案把读取范围移到其他目录。 */
function assertSafeRelativePath(relativePath: string): void {
  const segments = relativePath.split('/');
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`素材路径越界或格式无效：${relativePath}`);
  }
}

/** 用真实路径复核文件仍位于所属模板目录内，符号链接也不能绕过边界。 */
async function resolveInsideDirectory(root: string, relativePath: string): Promise<string> {
  assertSafeRelativePath(relativePath);
  let target: string;
  try {
    target = await realpath(path.join(root, ...relativePath.split('/')));
  } catch {
    throw new Error(`素材文件或目录不存在：${relativePath}`);
  }
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`素材路径越界：${relativePath}`);
  }
  return target;
}

/** 读取 JSON 并保留具体文件名，让档案损坏时能直接定位。 */
async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`无法解析 JSON：${filePath}`, { cause: error });
  }
}

/** 检查一张档案引用图片，并返回实际字节数供总览统计。 */
async function verifyImage(
  templateRoot: string,
  image: z.infer<typeof imageSchema>,
  referencedPaths: Set<string>,
): Promise<number> {
  const filePath = await resolveInsideDirectory(templateRoot, image.path);
  const relative = path.relative(templateRoot, filePath).split(path.sep).join('/');
  referencedPaths.add(path.posix.join(path.basename(templateRoot), relative));
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`素材不是文件：${image.path}`);
  const bytes = await readFile(filePath);
  if (bytes.toString('utf8', 0, 64).startsWith('version https://git-lfs.github.com/spec/v1')) {
    throw new Error(`Git LFS 图片尚未还原真实内容：${image.path}`);
  }
  if (bytes.length !== image.sizeBytes) throw new Error(`素材大小不一致：${image.path}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== image.sha256.toLowerCase()) throw new Error(`素材 SHA-256 不一致：${image.path}`);
  const actualType = detectGenerationInputContentType(bytes);
  const extensionType = extensionContentTypes[path.extname(filePath).toLowerCase()];
  if (!actualType || actualType !== image.contentType || actualType !== extensionType) {
    throw new Error(`素材真实类型、扩展名或档案类型不一致：${image.path}`);
  }
  return bytes.length;
}

/** 扫描实体图片，识别尚未加入档案的文件。 */
async function listImagePaths(directory: string, root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listImagePaths(absolute, root)));
    } else if (entry.isFile() && extensionContentTypes[path.extname(entry.name).toLowerCase()]) {
      paths.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return paths;
}

/** 按目录索引核验全部模板，不读取候选登记、私密配置或旧执行记录。 */
export async function verifyMaterialsRoot(
  materialsRoot: string,
): Promise<MaterialsVerificationResult> {
  const root = await realpath(materialsRoot);
  const catalog = catalogSchema.parse(await readJson(path.join(root, 'catalog.json')));
  const templateIds = new Set<string>();
  const templateDirectories = new Set<string>();
  const referencedPaths = new Set<string>();
  let imageBytes = 0;

  for (const item of catalog.templates) {
    assertSafeRelativePath(item.directory);
    if (item.directory.includes('/'))
      throw new Error(`模板目录必须直接位于素材根目录：${item.directory}`);
    if (templateIds.has(item.templateTypeId) || templateDirectories.has(item.directory)) {
      throw new Error(`目录索引存在重复模板编号或目录：${item.templateTypeId}`);
    }
    templateIds.add(item.templateTypeId);
    templateDirectories.add(item.directory);
    const templateRoot = await resolveInsideDirectory(root, item.directory);
    const manifest = manifestSchema.parse(await readJson(path.join(templateRoot, 'manifest.json')));
    if (manifest.templateTypeId !== item.templateTypeId || manifest.name !== item.name) {
      throw new Error(`目录索引与素材档案身份不一致：${item.templateTypeId}`);
    }
    if (manifest.slots.some((slot, index) => slot.order !== index + 1)) {
      throw new Error(`图片栏顺序无效：${item.templateTypeId}`);
    }
    for (const [label, images] of [
      ['友商输入', manifest.competitorReference?.inputs ?? []],
      ['友商效果', manifest.competitorReference?.effects ?? []],
    ] as const) {
      if (images.some((image, index) => image.order !== index + 1)) {
        throw new Error(`${label}顺序无效：${item.templateTypeId}`);
      }
    }
    const imageSetIds = new Set<string>();
    const testCaseIds = new Set<string>();
    const images = [
      ...(manifest.competitorReference?.inputs ?? []),
      ...(manifest.competitorReference?.effects ?? []),
    ];
    for (const imageSet of manifest.imageSets) {
      if (imageSetIds.has(imageSet.id))
        throw new Error(`图片组编号重复：${item.templateTypeId}/${imageSet.id}`);
      imageSetIds.add(imageSet.id);
      const orders = imageSet.inputs.map((input) => input.order);
      if (orders.some((order, index) => order !== index + 1)) {
        throw new Error(`图片组输入顺序无效：${item.templateTypeId}/${imageSet.id}`);
      }
      images.push(...imageSet.inputs);
    }
    for (const testCase of manifest.testCases) {
      if (testCaseIds.has(testCase.id) || !imageSetIds.has(testCase.imageSetId)) {
        throw new Error(`测试用例编号重复或引用无效：${item.templateTypeId}/${testCase.id}`);
      }
      testCaseIds.add(testCase.id);
    }
    // 逐张读取真实字节；重复引用同一文件时只在汇总中计一次。
    for (const image of images) {
      const previousCount = referencedPaths.size;
      const size = await verifyImage(templateRoot, image, referencedPaths);
      if (referencedPaths.size > previousCount) imageBytes += size;
    }
  }

  const unindexed = (await readdir(root, { withFileTypes: true })).find(
    (entry) =>
      entry.isDirectory() && /^TPL\d{4}-/.test(entry.name) && !templateDirectories.has(entry.name),
  );
  if (unindexed) throw new Error(`模板目录未在索引中登记：${unindexed.name}`);
  const actualPaths = await listImagePaths(root, root);
  const unreferenced = actualPaths.find((relative) => !referencedPaths.has(relative));
  if (unreferenced) throw new Error(`素材图片未在档案中登记：${unreferenced}`);
  return { templateCount: templateIds.size, imageCount: referencedPaths.size, imageBytes };
}
