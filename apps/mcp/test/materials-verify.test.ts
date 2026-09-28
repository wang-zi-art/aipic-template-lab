/**
 * 正式素材核验的独立目录测试。
 *
 * 使用临时图片和档案验证读取边界与损坏提示，不接触正式素材或管理员接口。
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyMaterialsRoot } from '../src/materials-verify.js';

const temporaryRoots: string[] = [];
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

/** 创建最小有效目录，测试可按需要修改档案或图片。 */
async function fixture(): Promise<{
  root: string;
  imagePath: string;
  manifestPath: string;
  manifest: Record<string, unknown>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'aipic-materials-'));
  temporaryRoots.push(root);
  const templateRoot = path.join(root, 'TPL0001-example');
  const imagePath = path.join(templateRoot, 'test-inputs', 'S001', 'input_01.jpg');
  const manifestPath = path.join(templateRoot, 'manifest.json');
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, jpeg);
  await writeFile(
    path.join(root, 'catalog.json'),
    JSON.stringify({
      schemaVersion: 1,
      templates: [{ templateTypeId: 'TPL0001', name: '示例', directory: 'TPL0001-example' }],
    }),
  );
  const manifest = {
    schemaVersion: 1,
    templateTypeId: 'TPL0001',
    name: '示例',
    revision: 1,
    slots: [{ order: 1, slotKey: null }],
    competitorReference: null,
    imageSets: [
      {
        id: 'S001',
        inputs: [
          {
            path: 'test-inputs/S001/input_01.jpg',
            order: 1,
            sizeBytes: jpeg.length,
            sha256: createHash('sha256').update(jpeg).digest('hex'),
            contentType: 'image/jpeg',
          },
        ],
      },
    ],
    testCases: [{ id: 'T001', imageSetId: 'S001', supplementalDescription: null }],
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, imagePath, manifestPath, manifest };
}

/** 清除每项测试的临时目录，避免影响后续核验。 */
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('verifyMaterialsRoot', () => {
  /** 有效档案应得到实际图片数量和字节数。 */
  it('核验完整素材', async () => {
    const data = await fixture();
    await expect(verifyMaterialsRoot(data.root)).resolves.toEqual({
      templateCount: 1,
      imageCount: 1,
      imageBytes: jpeg.length,
    });
  });

  /** 缺图应失败，不能把不存在的输入当作可试用素材。 */
  it('拒绝缺失图片', async () => {
    const data = await fixture();
    await rm(data.imagePath);
    await expect(verifyMaterialsRoot(data.root)).rejects.toThrow('素材文件或目录不存在');
  });

  /** 图片字节变化即使仍是 JPEG，也必须由档案重新登记。 */
  it('拒绝内容损坏', async () => {
    const data = await fixture();
    await writeFile(data.imagePath, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    await expect(verifyMaterialsRoot(data.root)).rejects.toThrow('SHA-256 不一致');
  });

  /** 档案不能用父目录访问其他模板或素材根目录外的文件。 */
  it('拒绝越界路径', async () => {
    const data = await fixture();
    const imageSets = data.manifest.imageSets as Array<{ inputs: Array<{ path: string }> }>;
    imageSets[0]!.inputs[0]!.path = '../outside.jpg';
    await writeFile(data.manifestPath, JSON.stringify(data.manifest));
    await expect(verifyMaterialsRoot(data.root)).rejects.toThrow('素材路径越界');
  });

  /** T 用例必须指向同一模板中实际存在的 S 图片组。 */
  it('拒绝无效用例引用', async () => {
    const data = await fixture();
    const testCases = data.manifest.testCases as Array<{ imageSetId: string }>;
    testCases[0]!.imageSetId = 'S002';
    await writeFile(data.manifestPath, JSON.stringify(data.manifest));
    await expect(verifyMaterialsRoot(data.root)).rejects.toThrow('测试用例编号重复或引用无效');
  });

  /** 索引遗漏的模板目录不能被当作已经核验。 */
  it('拒绝未登记的模板目录', async () => {
    const data = await fixture();
    await mkdir(path.join(data.root, 'TPL0002-extra'));
    await expect(verifyMaterialsRoot(data.root)).rejects.toThrow('模板目录未在索引中登记');
  });

  /** 下载 LFS 内容前，指针文本不能冒充已具备的真实图片。 */
  it('明确报告尚未还原的 Git LFS 指针', async () => {
    const data = await fixture();
    await writeFile(
      data.imagePath,
      'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 4\n',
    );
    await expect(verifyMaterialsRoot(data.root)).rejects.toThrow('Git LFS 图片尚未还原真实内容');
  });
});
