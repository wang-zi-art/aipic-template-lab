/**
 * MCP 模板提示词更新与未发布候选删除编排测试。
 *
 * 使用内存 HTTP 客户端和临时报告目录，验证 revision 串联、完整表单合并、失败停止、删除重放
 * 以及报告不泄漏提示词和模型作用正文。
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  modelSizesForProfile,
  type AdminSystemTemplateVersionDetailResponse,
} from '@aipic/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApiClient } from '../src/api-client.js';
import type { McpRuntimeConfig } from '../src/config.js';
import { McpOperationError } from '../src/errors.js';
import { createTemplateMutationService } from '../src/template-mutation-service.js';

const templateId = '123e4567-e89b-42d3-a456-426614174701';
const versionId = '123e4567-e89b-42d3-a456-426614174702';
const modelId = '123e4567-e89b-42d3-a456-426614174703';
const categoryId = '123e4567-e89b-42d3-a456-426614174704';
const executionId = '123e4567-e89b-42d3-a456-426614174705';

/** 创建每个用例独享的报告目录配置。 */
async function createConfig(): Promise<McpRuntimeConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'aipic-template-mutation-'));
  return {
    apiBaseUrl: 'https://api.example.test',
    adminSessionToken: 'private-token',
    inputRoot: root,
    outputRoot: root,
  };
}

/** 构造可由现有 PUT 接口完整保存的权威版本详情。 */
function versionDetail(
  status: 'draft' | 'testing' = 'testing',
  revision = 3,
  executionPrompt = '旧的私密提示词',
): AdminSystemTemplateVersionDetailResponse {
  return {
    item: {
      templateId,
      templateRevision: 2,
      templateVersionId: versionId,
      version: 1,
      status,
      revision,
      name: '候选模板',
      description: '保持不变的说明',
      category: { categoryId, key: 'portrait', nameSnapshot: '人像', isActive: true },
      mode: 'multi_image',
      pointsCost: 30,
      inputs: [
        {
          key: 'subject',
          order: 1,
          label: '主体',
          required: true,
          uploadRequirement: '上传主体图',
          modelRole: '旧的私密模型作用',
        },
        {
          key: 'scene',
          order: 2,
          label: '场景',
          required: true,
          uploadRequirement: '上传场景图',
          modelRole: '未修改的模型作用',
        },
      ],
      defaultAspectRatio: '1:1',
      allowedAspectRatios: ['1:1'],
      allowsSupplementalDescription: true,
      supplementalDescriptionRecommendation: '补充光线偏好',
      executionPrompt,
      model: {
        modelId,
        sizeProfile: 'gpt_1k_pixels',
        displayName: '测试模型',
        basePoints: 30,
        supportsAuto: true,
        sizes: modelSizesForProfile('gpt_1k_pixels'),
        qualities: ['auto'],
        defaultRatio: '1:1',
        defaultResolution: '1k',
        defaultQuality: 'auto',
        status: 'admin_only',
      },
      testConfirmation: null,
      publication: null,
      assets: { effectAsset: null, inputs: [] },
      createdAt: '2026-09-20T00:00:00.000Z',
    },
  };
}

/** 用状态可变的 API 替身模拟正式 HTTP 状态机，并暴露关键写调用。 */
function createApi(initialStatus: 'draft' | 'testing' = 'testing') {
  let current = versionDetail(initialStatus, 3);
  const api = {
    getSystemTemplateVersion: vi.fn(async () => structuredClone(current)),
    returnToDraft: vi.fn(async (_id: string, revision: number) => {
      current = versionDetail('draft', revision + 1);
      return {
        item: {
          templateId,
          templateRevision: 2,
          templateVersionId: versionId,
          version: 1,
          status: 'draft' as const,
          revision: revision + 1,
          testConfirmation: null,
          publication: null,
        },
      };
    }),
    updateSystemTemplateVersion: vi.fn(async (_id: string, request) => {
      current = versionDetail('draft', request.expectedRevision + 1, request.executionPrompt);
      current.item.inputs = request.inputs;
      return structuredClone(current);
    }),
    enterTesting: vi.fn(async (_id: string, revision: number) => {
      current.item.status = 'testing';
      current.item.revision = revision + 1;
      return {
        item: {
          templateId,
          templateRevision: 2,
          templateVersionId: versionId,
          version: 1,
          status: 'testing' as const,
          revision: revision + 1,
          testConfirmation: null,
          publication: null,
        },
      };
    }),
    getSystemTemplate: vi.fn(async () => ({
      item: { templateId, revision: 2, workingVersion: { status: initialStatus } },
    })),
    deleteUnpublishedSystemTemplate: vi.fn(async () => ({
      body: {
        item: { templateId, status: 'deleted' as const, deletedAt: '2026-09-21T02:00:00.000Z' },
      },
      replayed: false,
    })),
  };
  return api as unknown as AdminApiClient;
}

describe('template mutation service', () => {
  it('testing 候选按退回、完整保存、重进 testing 和回读顺序更新', async () => {
    const config = await createConfig();
    const api = createApi('testing');
    const service = createTemplateMutationService({
      loadConfig: async () => config,
      createApiClient: () => api,
    });
    const privatePrompt = '新的绝密提示词正文';
    const privateRole = '新的绝密主体作用';

    const result = await service.updatePrompt({
      executionId,
      versionId,
      expectedRevision: 3,
      executionPrompt: privatePrompt,
      inputModelRoles: [{ key: 'subject', modelRole: privateRole }],
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 6,
      serverStatus: 'testing',
      completedStep: 'final_read',
    });
    expect(api.returnToDraft).toHaveBeenCalledWith(versionId, 3);
    expect(api.updateSystemTemplateVersion).toHaveBeenCalledWith(
      versionId,
      expect.objectContaining({
        expectedRevision: 4,
        executionPrompt: privatePrompt,
        name: '候选模板',
        inputs: [
          expect.objectContaining({ key: 'subject', modelRole: privateRole }),
          expect.objectContaining({ key: 'scene', modelRole: '未修改的模型作用' }),
        ],
      }),
    );
    expect(api.enterTesting).toHaveBeenCalledWith(versionId, 5);
    const report = await readFile(result.reportPaths!.json, 'utf8');
    expect(report).not.toContain(privatePrompt);
    expect(report).not.toContain(privateRole);
    expect(report).toContain('inputs.subject.modelRole');
  });

  it('draft 候选跳过退回，保存失败后停止且不进入 testing', async () => {
    const config = await createConfig();
    const api = createApi('draft');
    vi.mocked(api.updateSystemTemplateVersion).mockRejectedValueOnce(
      new McpOperationError('ADMIN_SYSTEM_TEMPLATE_REVISION_CONFLICT', 'revision 冲突'),
    );
    const service = createTemplateMutationService({
      loadConfig: async () => config,
      createApiClient: () => api,
    });

    const result = await service.updatePrompt({
      versionId,
      expectedRevision: 3,
      executionPrompt: '不会落入报告的正文',
    });

    expect(result).toMatchObject({
      ok: false,
      serverStatus: 'draft',
      stoppedStep: 'form_saved',
      error: { code: 'ADMIN_SYSTEM_TEMPLATE_REVISION_CONFLICT' },
    });
    expect(api.returnToDraft).not.toHaveBeenCalled();
    expect(api.enterTesting).not.toHaveBeenCalled();
  });

  it('最终回读的未修改表单字段不符时拒绝标记更新完成', async () => {
    const config = await createConfig();
    const api = createApi('testing');
    const originalRead = vi.mocked(api.getSystemTemplateVersion).getMockImplementation()!;
    let reads = 0;
    vi.mocked(api.getSystemTemplateVersion).mockImplementation(async (id) => {
      reads += 1;
      const result = await originalRead(id);
      return reads === 3 ? { ...result, item: { ...result.item, name: '意外改名' } } : result;
    });
    const result = await createTemplateMutationService({ loadConfig: async () => config, createApiClient: () => api }).updatePrompt({
      versionId, expectedRevision: 3, executionPrompt: '新提示词',
    });
    expect(result).toMatchObject({ ok: false, stoppedStep: 'final_read', error: { code: 'ADMIN_SYSTEM_TEMPLATE_STATE_MISMATCH' } });
  });

  it('删除返回服务端删除时间与幂等重放，不在报告中记录私密内容', async () => {
    const config = await createConfig();
    const api = createApi('draft');
    vi.mocked(api.deleteUnpublishedSystemTemplate).mockResolvedValueOnce({
      body: {
        item: { templateId, status: 'deleted', deletedAt: '2026-09-21T02:00:00.000Z' },
      },
      replayed: true,
    });
    const service = createTemplateMutationService({
      loadConfig: async () => config,
      createApiClient: () => api,
    });

    const result = await service.deleteCandidate({ templateId, expectedRevision: 2 });

    expect(result).toMatchObject({
      ok: true,
      templateId,
      deletedAt: '2026-09-21T02:00:00.000Z',
      replayed: true,
      serverStatus: 'deleted',
    });
    expect(api.deleteUnpublishedSystemTemplate).toHaveBeenCalledWith(templateId, 2);
    const report = await readFile(result.reportPaths!.json, 'utf8');
    expect(report).not.toMatch(/私密提示词|模型作用|private-token/);
  });
});
