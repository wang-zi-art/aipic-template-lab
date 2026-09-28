/**
 * 多样本管理员试用编排测试。
 *
 * 使用内存HTTP端口、COS上传器和结果下载替身，验证六组合归属、全局停止、提交不明和导出恢复。
 */
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AdminApiClient } from '../src/api-client.js';
import { batchSubmissionPlanSchema } from '../src/batch-comparison.js';
import type { McpRuntimeConfig } from '../src/config.js';
import { McpOperationError } from '../src/errors.js';
import { initializeTrialReportDirectory, readTrialReport, writeTrialReport, type TrialExecutionReport } from '../src/trial-report.js';
import { createTrialService, type SubmitTemplateTrialInput } from '../src/trial-service.js';
import { describe, expect, it, vi } from 'vitest';

const versionIds = {
  A: '123e4567-e89b-42d3-a456-426614174101',
  B: '123e4567-e89b-42d3-a456-426614174102',
  C: '123e4567-e89b-42d3-a456-426614174103',
} as const;
const templateIds = {
  A: '123e4567-e89b-42d3-a456-426614174201',
  B: '123e4567-e89b-42d3-a456-426614174202',
  C: '123e4567-e89b-42d3-a456-426614174203',
} as const;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);

/** 创建两张测试样本和独立输出目录。 */
async function createConfig(): Promise<McpRuntimeConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'aipic-trials-'));
  const inputRoot = path.join(root, 'input');
  const outputRoot = path.join(root, 'output');
  await mkdir(inputRoot);
  await writeFile(path.join(inputRoot, 'T01.png'), png);
  await writeFile(path.join(inputRoot, 'T02.png'), png);
  return {
    apiBaseUrl: 'https://api.example.test',
    adminSessionToken: 'secret',
    inputRoot,
    outputRoot,
  };
}

/** 构造一个固定单栏、固定比例的组合输入。 */
function input(
  executionId: string,
  sampleId: 'T01' | 'T02',
  candidateKey: 'A' | 'B' | 'C',
): SubmitTemplateTrialInput {
  return {
    executionId,
    sampleId,
    candidateKey,
    versionId: versionIds[candidateKey],
    expectedRevision: 3,
    inputs: [{ slotKey: 'subject', localPath: `${sampleId}.png` }],
    generation: { aspectRatio: '4:3', resolution: '1k', quality: 'auto' },
  };
}

interface TrialModelFixture {
  modelId: string;
  sizeProfile: 'gpt_1k_pixels';
  displayName: string;
  basePoints: number;
  supportsAuto: boolean;
  sizes: Array<{ ratio: '4:3'; resolution: '1k' }>;
  qualities: Array<'auto'>;
  defaultRatio: '4:3';
  defaultResolution: '1k';
  defaultQuality: 'auto' | null;
  status: 'disabled' | 'admin_only' | 'public';
}

/** 构造与后台实时模型投影一致的测试能力，旧模板比例字段故意保持为1:1。 */
function createTrialModel(overrides: Partial<TrialModelFixture> = {}): TrialModelFixture {
  return {
    modelId: '123e4567-e89b-42d3-a456-426614174301',
    sizeProfile: 'gpt_1k_pixels',
    displayName: '测试图片模型',
    basePoints: 30,
    supportsAuto: true,
    sizes: [{ ratio: '4:3', resolution: '1k' }],
    qualities: ['auto'],
    defaultRatio: '4:3',
    defaultResolution: '1k',
    defaultQuality: 'auto',
    status: 'public',
    ...overrides,
  };
}

/** 返回服务使用的完整API替身，并保留上传与任务映射供断言。 */
function createApi(
  options: {
    authError?: McpOperationError;
    submitError?: McpOperationError;
    model?: Partial<TrialModelFixture>;
  } = {},
) {
  let uploadSequence = 0;
  let taskSequence = 0;
  const tasks = new Map<string, { versionId: string; revision: number }>();
  const api = {
    getCurrentAdmin: vi.fn(async () => {
      if (options.authError) throw options.authError;
      return { user: { id: '123e4567-e89b-42d3-a456-426614174300' }, role: 'platform_admin' };
    }),
    getTemplateTrial: vi.fn(async (versionId: string) => {
      const candidate = (Object.entries(versionIds).find(([, value]) => value === versionId)?.[0] ??
        'A') as 'A';
      return {
        item: {
          templateId: templateIds[candidate],
          templateVersionId: versionId,
          version: 1,
          revision: 3,
          status: 'testing',
          name: `候选${candidate}`,
          inputs: [{ key: 'subject', order: 1, required: true }],
          allowedAspectRatios: ['1:1'],
          supplementalDescription: { allowed: false },
          model: createTrialModel(options.model),
        },
      };
    }),
    issueImageUpload: vi.fn(async () => {
      uploadSequence += 1;
      return {
        uploadId: `123e4567-e89b-42d3-a456-${String(426614175000 + uploadSequence).padStart(12, '0')}`,
        storage: {
          provider: 'tencent_cos',
          bucket: 'bucket',
          region: 'region',
          objectKey: 'hidden',
        },
        credentials: {
          temporarySecretId: 'hidden',
          temporarySecretKey: 'hidden',
          sessionToken: 'hidden',
          startTime: 1,
          expiredTime: 2,
        },
      };
    }),
    createGenerationTask: vi.fn(
      async (request: { templateVersionId: string; templateTrialRevision: number }) => {
        if (options.submitError) throw options.submitError;
        taskSequence += 1;
        const taskId = `123e4567-e89b-42d3-a456-${String(426614176000 + taskSequence).padStart(12, '0')}`;
        tasks.set(taskId, {
          versionId: request.templateVersionId,
          revision: request.templateTrialRevision,
        });
        return {
          taskId,
          status: 'queued',
          templateVersionId: request.templateVersionId,
          pointsCost: 10,
          createdAt: '2026-09-21T00:00:00.000Z',
        };
      },
    ),
    getGenerationTask: vi.fn(async (taskId: string) => {
      const task = tasks.get(taskId)!;
      return {
        taskId,
        templateVersionId: task.versionId,
        templateTrialRevision: task.revision,
        pointsCost: 10,
        status: 'succeeded',
        progress: 100,
        result: {
          url: 'https://result.example.test/image',
          expiresAt: '2026-09-21T01:00:00.000Z',
          width: 1,
          height: 1,
          availableUntil: '2026-10-21T00:00:00.000Z',
        },
        failure: null,
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:01:00.000Z',
      };
    }),
  } as unknown as AdminApiClient;
  return { api, tasks };
}

/** 生成稳定且规范的UUID v4序列供clientRequestId使用。 */
function idFactory() {
  let value = 1;
  return () => `123e4567-e89b-42d3-a456-${String(426614177000 + value++).padStart(12, '0')}`;
}

describe('template trial workflow', () => {
  it('一次批量调用串行提交六项，旧执行编号不能再次付费提交', async () => {
    const config = await createConfig();
    const { api } = createApi();
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader: { upload: vi.fn(async () => undefined) },
      createId: idFactory(),
      fetcher: vi.fn(async () => new Response(png, { status: 200 })),
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174410';
    const plan = batchSubmissionPlanSchema.parse({
      schemaVersion: 1,
      executionId,
      templateTypeId: 'TPL0001',
      manifestRevision: 1,
      candidates: (['A', 'B', 'C'] as const).map((key) => ({
        key, promptLabel: `${key}-v1`, templateId: templateIds[key], versionId: versionIds[key],
        revision: 3, modelId: createTrialModel().modelId,
      })),
      generation: { aspectRatio: '4:3', resolution: '1k', quality: 'auto' },
      cases: (['T01', 'T02'] as const).map((id) => ({
        id, imageSetId: null, supplementalDescription: null,
        inputs: [{ order: 1, slotKey: 'subject', path: `${id}.png` }],
      })),
    });
    const submitted = await service.submitBatch(plan);
    expect(submitted).toMatchObject({ ok: true, processed: 6, reportPersisted: true });
    expect(api.getCurrentAdmin).toHaveBeenCalledTimes(1);
    expect(api.getTemplateTrial).toHaveBeenCalledTimes(3);
    expect(api.createGenerationTask).toHaveBeenCalledTimes(6);
    expect(await service.collect({ executionId })).toMatchObject({ status: 'completed', processed: 6, comparisonUpdated: true });
    const { report, paths } = await readTrialReport(config.outputRoot, executionId);
    expect(report.items.map((item) => `${item.sampleId}/${item.candidateKey}`)).toEqual([
      'T01/A', 'T01/B', 'T01/C', 'T02/A', 'T02/B', 'T02/C',
    ]);
    expect(report.timingsMs).toEqual(expect.objectContaining({ preflight: expect.any(Number), submission: expect.any(Number), collection: expect.any(Number) }));
    await expect(readFile(path.join(paths.directory, 'comparison', 'summary.json'))).resolves.toBeDefined();
    await expect(service.submitBatch(plan)).rejects.toMatchObject({ code: 'MCP_EXECUTION_EXISTS' });
    expect(api.createGenerationTask).toHaveBeenCalledTimes(6);
  }, 15_000);

  it('批量提交响应不明时只创建一次任务尝试，其余组合记录未执行', async () => {
    const config = await createConfig();
    const { api } = createApi({ submitError: new McpOperationError('ADMIN_API_UNAVAILABLE', '网络失败', true) });
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader: { upload: vi.fn(async () => undefined) },
      createId: idFactory(),
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174411';
    const plan = batchSubmissionPlanSchema.parse({
      schemaVersion: 1, executionId, templateTypeId: 'TPL0001', manifestRevision: 1,
      candidates: (['A', 'B'] as const).map((key) => ({ key, promptLabel: `${key}-v1`, templateId: templateIds[key], versionId: versionIds[key], revision: 3, modelId: createTrialModel().modelId })),
      generation: { aspectRatio: '4:3', resolution: '1k', quality: 'auto' },
      cases: [{ id: 'T01', imageSetId: null, supplementalDescription: null, inputs: [{ order: 1, slotKey: 'subject', path: 'T01.png' }] }],
    });
    expect(await service.submitBatch(plan)).toMatchObject({ ok: false, processed: 2, summary: { pendingReview: 1, notExecuted: 1 } });
    const { report } = await readTrialReport(config.outputRoot, executionId);
    expect(report.items.map((item) => item.submissionStatus)).toEqual(['pending_review', 'not_executed']);
    expect(api.createGenerationTask).toHaveBeenCalledTimes(1);
  });

  it('批次缺图时在任何远程写入前失败', async () => {
    const config = await createConfig();
    const { api } = createApi();
    const service = createTrialService({ loadConfig: async () => config, createApiClient: () => api });
    const plan = batchSubmissionPlanSchema.parse({
      schemaVersion: 1, executionId: '123e4567-e89b-42d3-a456-426614174413', templateTypeId: 'TPL0001', manifestRevision: 1,
      candidates: [{ key: 'A', promptLabel: 'A-v1', templateId: templateIds.A, versionId: versionIds.A, revision: 3, modelId: createTrialModel().modelId }],
      generation: { aspectRatio: '4:3', resolution: '1k', quality: 'auto' },
      cases: [{ id: 'T01', imageSetId: null, supplementalDescription: null, inputs: [{ order: 1, slotKey: 'subject', path: 'missing.png' }] }],
    });
    await expect(service.submitBatch(plan)).rejects.toMatchObject({ code: 'MCP_INPUT_FILE_UNAVAILABLE' });
    expect(api.getCurrentAdmin).not.toHaveBeenCalled();
    expect(api.createGenerationTask).not.toHaveBeenCalled();
  });

  it('收集超过十项时轮换查询且每轮并发不超过三项', async () => {
    const config = await createConfig();
    const { api } = createApi();
    let active = 0;
    let maxActive = 0;
    vi.mocked(api.getGenerationTask).mockImplementation(async (taskId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { taskId, templateVersionId: versionIds.A, templateTrialRevision: 3, pointsCost: 10, status: 'processing', progress: 10, result: null, failure: null } as never;
    });
    const service = createTrialService({ loadConfig: async () => config, createApiClient: () => api, uploader: { upload: vi.fn(async () => undefined) }, createId: idFactory() });
    const executionId = '123e4567-e89b-42d3-a456-426614174412';
    const paths = await initializeTrialReportDirectory(config.outputRoot, executionId);
    const report: TrialExecutionReport = {
      schemaVersion: 1, executionId, goal: 'run_template_trials', apiBaseUrl: config.apiBaseUrl,
      status: 'running', phase: 'submitting', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finishedAt: null,
      submissionHaltCode: null, summary: { total: 0, succeeded: 0, failed: 0, processing: 0, pendingReview: 0, notExecuted: 0 }, samples: [],
      items: Array.from({ length: 12 }, (_, index) => ({
        sampleId: `T${String(index + 1).padStart(2, '0')}`, candidateKey: 'A', templateId: templateIds.A, templateName: '候选A',
        versionId: versionIds.A, version: 1, revision: 3, generation: { aspectRatio: '4:3', resolution: '1k', quality: 'auto' },
        uploadIds: [], clientRequestId: idFactory()(), taskId: `123e4567-e89b-42d3-a456-${String(426614178000 + index).padStart(12, '0')}`,
        pointsCost: 10, submissionStatus: 'submitted', taskStatus: 'queued', exportStatus: 'pending', resultRelativePath: null,
        errorCode: null, lastQueryErrorCode: null, lastQueriedAt: null,
      })),
    };
    await writeTrialReport(paths, report);
    expect(await service.collect({ executionId })).toMatchObject({ processed: 10, status: 'running' });
    expect(await service.collect({ executionId })).toMatchObject({ processed: 10, status: 'running' });
    const { report: savedReport } = await readTrialReport(config.outputRoot, executionId);
    expect(savedReport.items[10]!.lastQueriedAt).not.toBeNull();
    expect(savedReport.items[11]!.lastQueriedAt).not.toBeNull();
    expect(maxActive).toBe(3);
  }, 15_000);

  it('人工报告路径无法写入时返回安全错误且不留下成功结论', async () => {
    const config = await createConfig();
    const directory = path.join(config.outputRoot, 'blocked-report');
    await mkdir(directory, { recursive: true });
    const report: TrialExecutionReport = {
      schemaVersion: 1, executionId: '123e4567-e89b-42d3-a456-426614174414',
      goal: 'run_template_trials', apiBaseUrl: config.apiBaseUrl, status: 'running', phase: 'submitting',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finishedAt: null,
      submissionHaltCode: null, summary: { total: 0, succeeded: 0, failed: 0, processing: 0, pendingReview: 0, notExecuted: 0 },
      samples: [], items: [],
    };
    await expect(writeTrialReport({ directory, json: path.join(directory, 'report.json'), markdown: directory }, report)).rejects.toMatchObject({ code: 'MCP_REPORT_WRITE_FAILED' });
  });
  it('忽略模板旧比例字段并按实时模型能力导出六个可追溯结果', async () => {
    const config = await createConfig();
    const { api } = createApi();
    const uploader = { upload: vi.fn(async () => undefined) };
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader,
      createId: idFactory(),
      fetcher: vi.fn(async () => new Response(png, { status: 200 })),
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174401';
    for (const sample of ['T01', 'T02'] as const) {
      for (const candidate of ['A', 'B', 'C'] as const) {
        await expect(service.submit(input(executionId, sample, candidate))).resolves.toMatchObject({
          ok: true,
        });
      }
    }
    const collected = await service.collect({ executionId });
    expect(collected).toMatchObject({ ok: true, processed: 6, status: 'completed' });
    expect(api.getCurrentAdmin).toHaveBeenCalledTimes(6);
    expect(api.getTemplateTrial).toHaveBeenCalledTimes(6);
    expect(uploader.upload).toHaveBeenCalledTimes(6);
    const { report } = await readTrialReport(config.outputRoot, executionId);
    expect(report.samples).toHaveLength(2);
    expect(report.items).toHaveLength(6);
    expect(report.summary).toEqual({
      total: 6,
      succeeded: 6,
      failed: 0,
      processing: 0,
      pendingReview: 0,
      notExecuted: 0,
    });
    expect(new Set(report.items.map((item) => item.taskId)).size).toBe(6);
    expect(JSON.stringify(report)).not.toMatch(
      /private-token|temporarySecret|objectKey|result\.example|executionPrompt|modelRole/i,
    );
    for (const item of report.items) {
      expect(item.resultRelativePath).toContain(
        `${item.candidateKey}_${item.templateId}_v1_r3_${item.taskId}.png`,
      );
      await expect(
        readFile(path.join(collected.reportPaths!.directory, item.resultRelativePath!)),
      ).resolves.toEqual(png);
    }
  }, 15_000);

  it('模型支持时接受成对auto并原样创建任务', async () => {
    const config = await createConfig();
    const { api } = createApi();
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader: { upload: vi.fn(async () => undefined) },
      createId: idFactory(),
    });
    const request = input('123e4567-e89b-42d3-a456-426614174406', 'T01', 'A');
    request.generation = { aspectRatio: 'auto', resolution: 'auto', quality: 'auto' };

    await expect(service.submit(request)).resolves.toMatchObject({ ok: true });
    expect(api.createGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: 'auto', resolution: 'auto', quality: 'auto' }),
    );
  });

  it.each([
    {
      name: '模型不支持auto',
      generation: { aspectRatio: 'auto' as const, resolution: 'auto' as const, quality: 'auto' as const },
      model: { supportsAuto: false },
      code: 'GENERATION_MODEL_SIZE_NOT_ALLOWED',
    },
    {
      name: '固定比例搭配auto分辨率',
      generation: { aspectRatio: '4:3' as const, resolution: 'auto' as const, quality: 'auto' as const },
      model: {},
      code: 'GENERATION_MODEL_SIZE_NOT_ALLOWED',
    },
    {
      name: 'auto比例搭配固定分辨率',
      generation: { aspectRatio: 'auto' as const, resolution: '1k' as const, quality: 'auto' as const },
      model: {},
      code: 'GENERATION_MODEL_SIZE_NOT_ALLOWED',
    },
    {
      name: '模型尺寸矩阵不含固定组合',
      generation: { aspectRatio: '4:3' as const, resolution: '2k' as const, quality: 'auto' as const },
      model: {},
      code: 'GENERATION_MODEL_SIZE_NOT_ALLOWED',
    },
    {
      name: '模型已经停用',
      generation: { aspectRatio: '4:3' as const, resolution: '1k' as const, quality: 'auto' as const },
      model: { status: 'disabled' as const },
      code: 'GENERATION_MODEL_UNAVAILABLE',
    },
    {
      name: '模型要求质量但请求省略',
      generation: { aspectRatio: '4:3' as const, resolution: '1k' as const },
      model: {},
      code: 'GENERATION_MODEL_QUALITY_NOT_ALLOWED',
    },
    {
      name: '模型不支持质量但请求额外提交',
      generation: { aspectRatio: '4:3' as const, resolution: '1k' as const, quality: 'auto' as const },
      model: { qualities: [] },
      code: 'GENERATION_MODEL_QUALITY_NOT_ALLOWED',
    },
  ])('$name时在远程写入前失败', async ({ generation, model, code }) => {
    const config = await createConfig();
    const { api } = createApi({ model });
    const uploader = { upload: vi.fn(async () => undefined) };
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader,
      createId: idFactory(),
    });
    const request = input('123e4567-e89b-42d3-a456-426614174407', 'T01', 'A');
    request.generation = generation;

    await expect(service.submit(request)).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
    expect(api.issueImageUpload).not.toHaveBeenCalled();
    expect(uploader.upload).not.toHaveBeenCalled();
    expect(api.createGenerationTask).not.toHaveBeenCalled();
  });

  it('管理员鉴权失败后停止新写入并把后续组合记为未执行', async () => {
    const config = await createConfig();
    const { api } = createApi({
      authError: new McpOperationError('AUTH_REQUIRED', '登录失效', false, 401),
    });
    const uploader = { upload: vi.fn(async () => undefined) };
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader,
      createId: idFactory(),
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174402';
    await service.submit(input(executionId, 'T01', 'A'));
    await service.submit(input(executionId, 'T01', 'B'));
    const { report } = await readTrialReport(config.outputRoot, executionId);
    expect(report.submissionHaltCode).toBe('AUTH_REQUIRED');
    expect(report.items.map((item) => item.submissionStatus)).toEqual(['failed', 'not_executed']);
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it('任务提交结果不明时保留原clientRequestId且不允许同组合重发', async () => {
    const config = await createConfig();
    const { api } = createApi({
      submitError: new McpOperationError('ADMIN_API_UNAVAILABLE', '网络失败', true),
    });
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader: { upload: vi.fn(async () => undefined) },
      createId: idFactory(),
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174403';
    const first = await service.submit(input(executionId, 'T01', 'A'));
    expect(first).toMatchObject({ ok: false, item: { submissionStatus: 'pending_review' } });
    const requestId = first.item!.clientRequestId;
    const second = await service.submit(input(executionId, 'T01', 'A'));
    expect(second).toMatchObject({ ok: false, error: { code: 'MCP_TRIAL_COMBINATION_EXISTS' } });
    expect(api.createGenerationTask).toHaveBeenCalledTimes(1);
    expect(first.item!.clientRequestId).toBe(requestId);
  });

  it('积分不足明确失败后停止其余付费组合', async () => {
    const config = await createConfig();
    const { api } = createApi({
      submitError: new McpOperationError('INSUFFICIENT_POINTS', '积分不足', false, 409),
    });
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader: { upload: vi.fn(async () => undefined) },
      createId: idFactory(),
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174405';
    await expect(service.submit(input(executionId, 'T01', 'A'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_POINTS' },
    });
    await expect(service.submit(input(executionId, 'T01', 'B'))).resolves.toMatchObject({
      item: { submissionStatus: 'not_executed' },
    });
    expect(api.createGenerationTask).toHaveBeenCalledTimes(1);
  });

  it('结果下载失败后再次收集会刷新任务地址并完成导出', async () => {
    const config = await createConfig();
    const { api } = createApi();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not-image', { status: 200 }))
      .mockResolvedValueOnce(new Response(png, { status: 200 }));
    const service = createTrialService({
      loadConfig: async () => config,
      createApiClient: () => api,
      uploader: { upload: vi.fn(async () => undefined) },
      createId: idFactory(),
      fetcher,
    });
    const executionId = '123e4567-e89b-42d3-a456-426614174404';
    await service.submit(input(executionId, 'T01', 'A'));
    await expect(service.collect({ executionId })).resolves.toMatchObject({ status: 'partial' });
    await expect(service.collect({ executionId })).resolves.toMatchObject({ status: 'completed' });
    expect(api.getGenerationTask).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
