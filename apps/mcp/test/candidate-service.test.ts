/**
 * 单候选编排测试。
 *
 * 通过内存管理员 API 与上传器验证调用顺序、revision 传递、失败停止和草稿保留语义。
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { modelSizesForProfile } from '@aipic/contracts';
import type { AdminApiClient } from '../src/api-client.js';
import { createCandidateService, type CreateCandidateInput } from '../src/candidate-service.js';
import type { McpRuntimeConfig } from '../src/config.js';
import { McpOperationError } from '../src/errors.js';
import { describe, expect, it, vi } from 'vitest';

const categoryId = '123e4567-e89b-42d3-a456-426614174010';
const modelId = '123e4567-e89b-42d3-a456-426614174011';
const templateId = '123e4567-e89b-42d3-a456-426614174012';
const versionId = '123e4567-e89b-42d3-a456-426614174013';

/** 创建两张合法 PNG 与独立输出目录。 */
async function createConfig(): Promise<McpRuntimeConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'aipic-candidate-'));
  const inputRoot = path.join(root, 'input');
  const outputRoot = path.join(root, 'output');
  await mkdir(inputRoot);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  await writeFile(path.join(inputRoot, 'effect.png'), png);
  await writeFile(path.join(inputRoot, 'preset.png'), png);
  return { apiBaseUrl: 'https://example.test', adminSessionToken: 'secret', inputRoot, outputRoot };
}

/** 构造符合现有表单契约的最小候选输入。 */
function createInput(): CreateCandidateInput {
  return {
    executionId: '123e4567-e89b-42d3-a456-426614174020',
    template: {
      generationModelId: modelId,
      name: '测试候选',
      description: '测试说明',
      categoryId,
      inputs: [{ key: 'subject', order: 1, label: '主体', required: true, uploadRequirement: '上传主体', modelRole: '主体参考' }],
      allowsSupplementalDescription: false,
      executionPrompt: '仅用于工具响应，不得进入报告',
    },
    assets: [
      { kind: 'effect', order: 1, localPath: 'effect.png' },
      { kind: 'preset', inputKey: 'subject', order: 1, localPath: 'preset.png' },
    ],
  };
}

/** 创建只实现本流程所需方法的管理员 API 替身，并记录写调用。 */
function createApi(events: string[], failSecondTicket = false): AdminApiClient {
  let ticketCount = 0;
  let submitted: CreateCandidateInput['template'] | null = null;
  const registeredAssets: Array<{ kind: string; inputKey: string | null; order: number }> = [];
  return {
    getCurrentAdmin: vi.fn(async () => ({ user: { id: templateId, displayName: '管理员', maskedPhone: '138****0000' }, role: 'platform_admin' as const })),
    listTemplateCategories: vi.fn(async () => ({ items: [{ categoryId, key: 'portrait', name: '人像', sortOrder: 1, isActive: true, revision: 1 }] })),
    listGenerationModels: vi.fn(async () => ({ items: [{ modelId, provider: 'grsai' as const, providerModelId: 'gpt-image-2', sizeProfile: 'gpt_1k_pixels' as const, displayName: '模型', basePoints: 1, supportsAuto: true, sizes: modelSizesForProfile('gpt_1k_pixels'), qualities: ['auto' as const], defaultRatio: 'auto' as const, defaultResolution: 'auto' as const, defaultQuality: 'auto' as const, status: 'admin_only' as const, referenceCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] })),
    createSystemTemplate: vi.fn(async (template) => {
      submitted = template;
      events.push('create:template');
      return { item: { templateId, workingVersion: { templateVersionId: versionId, version: 1, revision: 1, status: 'draft' } } } as never;
    }),
    issueAssetUpload: vi.fn(async (_id, request) => {
      ticketCount += 1;
      events.push(`ticket:${request.expectedRevision}`);
      if (failSecondTicket && ticketCount === 2) throw new McpOperationError('TICKET_FAILED', '票据失败');
      registeredAssets.push({ kind: request.kind, inputKey: request.inputKey ?? null, order: request.order });
      return { uploadId: `upload-${ticketCount}`, clientRequestId: request.clientRequestId, templateVersionId: versionId, expiresAt: '2026-01-01T00:30:00.000Z', storage: { provider: 'tencent_cos' as const, bucket: 'bucket', region: 'region', objectKey: 'hidden' }, credentials: { temporarySecretId: 'hidden', temporarySecretKey: 'hidden', sessionToken: 'hidden', startTime: 1, expiredTime: 2 } };
    }),
    completeAssetUpload: vi.fn(async () => {
      events.push(`complete:${ticketCount}`);
      return { item: { templateVersionId: versionId, revision: ticketCount + 1, assets: { effectAsset: null, inputs: [] } } };
    }),
    enterTesting: vi.fn(async (_id, revision) => {
      events.push(`testing:${revision}`);
      return { item: { templateId, templateRevision: 1, templateVersionId: versionId, version: 1, status: 'testing' as const, revision: revision + 1, testConfirmation: null, publication: null } };
    }),
    returnToDraft: vi.fn(async () => { throw new Error('unused'); }),
    updateSystemTemplateVersion: vi.fn(async () => { throw new Error('unused'); }),
    deleteUnpublishedSystemTemplate: vi.fn(async () => { throw new Error('unused'); }),
    getSystemTemplate: vi.fn(async () => ({ item: { templateId, workingVersion: { templateVersionId: versionId } } }) as never),
    getSystemTemplateVersion: vi.fn(async () => ({ item: {
      templateId,
      templateVersionId: versionId,
      status: 'testing',
      revision: ticketCount + 2,
      name: submitted!.name,
      description: submitted!.description,
      category: { categoryId: submitted!.categoryId },
      model: { modelId: submitted!.generationModelId },
      inputs: submitted!.inputs,
      allowsSupplementalDescription: submitted!.allowsSupplementalDescription,
      supplementalDescriptionRecommendation: submitted!.supplementalDescriptionRecommendation ?? null,
      executionPrompt: submitted!.executionPrompt,
      assets: {
        effectAsset: registeredAssets.some((asset) => asset.kind === 'effect') ? { assetId: 'effect', kind: 'effect', inputKey: null, order: 1 } : null,
        inputs: submitted!.inputs.map((input) => ({
          inputKey: input.key,
          exampleAsset: registeredAssets.some((asset) => asset.kind === 'slot_example' && asset.inputKey === input.key) ? { assetId: 'example', kind: 'slot_example', inputKey: input.key, order: 1 } : null,
          presetAssets: registeredAssets.filter((asset) => asset.kind === 'preset' && asset.inputKey === input.key).map((asset) => ({ assetId: `preset-${asset.order}`, ...asset })),
        })),
      },
    } }) as never),
    getTemplateTrial: vi.fn(async () => { throw new Error('unused'); }),
    issueImageUpload: vi.fn(async () => { throw new Error('unused'); }),
    createGenerationTask: vi.fn(async () => { throw new Error('unused'); }),
    getGenerationTask: vi.fn(async () => { throw new Error('unused'); }),
  };
}

describe('single candidate workflow', () => {
  it('没有模板素材时直接创建候选并进入 testing', async () => {
    const config = await createConfig();
    const events: string[] = [];
    const api = createApi(events);
    const uploader = { upload: vi.fn(async () => undefined) };
    const service = createCandidateService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader,
    });
    const input = createInput();
    input.executionId = '123e4567-e89b-42d3-a456-426614174019';
    input.assets = [];

    const result = await service.createCandidate(input);

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      serverStatus: 'testing',
      reportPersisted: true,
    });
    expect(events).toEqual(['create:template', 'testing:1']);
    expect(api.issueAssetUpload).not.toHaveBeenCalled();
    expect(api.completeAssetUpload).not.toHaveBeenCalled();
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it('按素材顺序传递最新 revision，最终以服务端 testing 状态完成', async () => {
    const config = await createConfig();
    const events: string[] = [];
    const api = createApi(events);
    const uploader = { upload: vi.fn(async () => { events.push('upload'); }) };
    const service = createCandidateService({ loadConfig: async () => config, createApiClient: () => api, uploader });
    const result = await service.createCandidate(createInput());
    expect(result).toMatchObject({ ok: true, status: 'completed', revision: 4, serverStatus: 'testing', reportPersisted: true });
    expect(events).toEqual(['create:template', 'ticket:1', 'upload', 'complete:1', 'ticket:2', 'upload', 'complete:2', 'testing:3']);
  });

  it('最终回读的完整提示词不符时保留部分完成，不把候选登记为已核实', async () => {
    const config = await createConfig();
    const api = createApi([]);
    const originalRead = vi.mocked(api.getSystemTemplateVersion).getMockImplementation()!;
    vi.mocked(api.getSystemTemplateVersion).mockImplementation(async (id) => {
      const result = await originalRead(id);
      return { ...result, item: { ...result.item, executionPrompt: '被其他操作改写' } };
    });
    const input = createInput();
    input.executionId = '123e4567-e89b-42d3-a456-426614174022';
    input.assets = [];
    const result = await createCandidateService({ loadConfig: async () => config, createApiClient: () => api }).createCandidate(input);
    expect(result).toMatchObject({ ok: false, status: 'partial', stoppedStep: 'final_read', error: { code: 'ADMIN_SYSTEM_TEMPLATE_STATE_MISMATCH' } });
  });

  it('第二张素材失败后保留草稿并停止进入 testing', async () => {
    const config = await createConfig();
    const events: string[] = [];
    const api = createApi(events, true);
    const service = createCandidateService({ loadConfig: async () => config, createApiClient: () => api, uploader: { upload: vi.fn(async () => undefined) } });
    const input = createInput();
    input.executionId = '123e4567-e89b-42d3-a456-426614174021';
    const result = await service.createCandidate(input);
    expect(result).toMatchObject({ ok: false, status: 'partial', templateId, revision: 2, stoppedStep: 'asset_ticket', reportPersisted: true });
    expect(api.enterTesting).not.toHaveBeenCalled();
  });

  it('本地素材失败时不创建执行目录也不调用管理员 API', async () => {
    const config = await createConfig();
    const events: string[] = [];
    const api = createApi(events);
    const service = createCandidateService({ loadConfig: async () => config, createApiClient: () => api });
    const input = createInput();
    input.assets[0]!.localPath = '../outside.png';
    const result = await service.createCandidate(input);
    expect(result).toMatchObject({ ok: false, executionId: null, reportPersisted: false });
    expect(api.createSystemTemplate).not.toHaveBeenCalled();
  });
});
