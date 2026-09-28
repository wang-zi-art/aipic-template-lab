/**
 * 多样本管理员试用的MCP应用服务。
 *
 * 提交路径依次完成本地校验、样本固化、管理员与测试版本复核、独立输入上传和单任务创建；
 * 收集路径每次只查询一轮并导出成功结果，不自动轮询、重试上传或重新提交生图。
 */
import { createHash, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type {
  GenerationAspectRatio,
  GenerationTaskCreateRequest,
  ModelQuality,
  ModelResolution,
} from '@aipic/contracts';
import {
  buildBatchComparison,
  batchSubmissionPlanSchema,
  parseBatchPlan,
  readBatchPlan,
  validateBatchInputs,
  type BatchSubmissionPlan,
} from './batch-comparison.js';
import { createAdminApiClient, type AdminApiClient } from './api-client.js';
import { loadMcpRuntimeConfig, type McpRuntimeConfig } from './config.js';
import { createTencentCosAssetUploader, type TemplateAssetUploader } from './cos-uploader.js';
import { McpOperationError, toSafeError } from './errors.js';
import { prepareGenerationInput, type PreparedGenerationInput } from './local-files.js';
import { copyTrialSampleInputs, exportTrialResult } from './trial-files.js';
import {
  aggregateTrialReport,
  initializeTrialReportDirectory,
  readTrialReport,
  writeTrialReport,
  type TrialExecutionReport,
  type TrialGenerationParameters,
  type TrialItemRecord,
  type TrialSampleRecord,
} from './trial-report.js';
import type { ReportPaths } from './report.js';

export interface TrialInputImage {
  slotKey: string;
  localPath: string;
}

export interface SubmitTemplateTrialInput {
  executionId: string;
  sampleId: string;
  candidateKey: 'A' | 'B' | 'C';
  versionId: string;
  expectedRevision: number;
  inputs: TrialInputImage[];
  generation: TrialGenerationParameters;
}

export interface CollectTemplateTrialInput {
  executionId: string;
  maxItems?: number;
}

export interface TrialServiceDependencies {
  loadConfig?: () => Promise<McpRuntimeConfig>;
  createApiClient?: (config: McpRuntimeConfig) => AdminApiClient;
  uploader?: TemplateAssetUploader;
  createId?: () => string;
  now?: () => Date;
  fetcher?: typeof fetch;
}

export interface TrialOperationResult {
  ok: boolean;
  executionId: string;
  status: TrialExecutionReport['status'] | 'failed';
  item: TrialItemRecord | null;
  reportPersisted: boolean;
  reportPaths: ReportPaths | null;
  error: { code: string; message: string; uncertain: boolean } | null;
}

/** 在任何远程写入前读取全部图片并拒绝重复栏位。 */
async function prepareTrialInputs(
  config: McpRuntimeConfig,
  inputs: TrialInputImage[],
): Promise<Array<{ slotKey: string; file: PreparedGenerationInput }>> {
  if (new Set(inputs.map((input) => input.slotKey)).size !== inputs.length) {
    throw new McpOperationError('MCP_TRIAL_INPUTS_INVALID', '试用图片栏不能重复');
  }
  const prepared = [];
  for (const input of inputs) {
    prepared.push({
      slotKey: input.slotKey,
      file: await prepareGenerationInput(config.inputRoot, input.localPath),
    });
  }
  return prepared;
}

/** 比较已固化样本，防止同一sampleId在不同候选中悄悄换图或换顺序。 */
function assertMatchingSample(
  sample: TrialSampleRecord,
  inputs: Array<{ slotKey: string; file: PreparedGenerationInput }>,
): void {
  if (sample.inputs.length !== inputs.length) {
    throw new McpOperationError('MCP_SAMPLE_CONFLICT', '同一样本编号的图片数量发生变化');
  }
  for (const [index, input] of inputs.entries()) {
    const existing = sample.inputs[index]!;
    const sha256 = createHash('sha256').update(input.file.bytes).digest('hex');
    if (
      existing.slotKey !== input.slotKey ||
      existing.sourceRelativePath !== input.file.relativePath ||
      existing.contentType !== input.file.contentType ||
      existing.sizeBytes !== input.file.sizeBytes ||
      existing.sha256 !== sha256
    ) {
      throw new McpOperationError(
        'MCP_SAMPLE_CONFLICT',
        '同一样本编号的栏位、路径或图片内容发生变化',
      );
    }
  }
}

/** 创建空试用报告；第一组样本随后在同一次本地事务式步骤中写入。 */
function createInitialReport(
  input: SubmitTemplateTrialInput,
  config: McpRuntimeConfig,
  now: Date,
): TrialExecutionReport {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    executionId: input.executionId,
    goal: 'run_template_trials',
    apiBaseUrl: config.apiBaseUrl,
    status: 'running',
    phase: 'submitting',
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    submissionHaltCode: null,
    summary: { total: 0, succeeded: 0, failed: 0, processing: 0, pendingReview: 0, notExecuted: 0 },
    samples: [],
    items: [],
  };
}

/** 写报告前统一更新时间和完成时间。 */
async function persist(
  report: TrialExecutionReport,
  paths: ReportPaths,
  now: () => Date,
): Promise<void> {
  report.updatedAt = now().toISOString();
  aggregateTrialReport(report);
  if (report.status !== 'running' && !report.finishedAt) report.finishedAt = report.updatedAt;
  await writeTrialReport(paths, report);
}

/** 判断错误是否代表后续新的付费提交必须全部停止。 */
function shouldHaltSubmissions(error: McpOperationError): boolean {
  return (
    error.uncertain ||
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.code === 'INSUFFICIENT_POINTS' ||
    error.code === 'POINT_ACCOUNT_NOT_FOUND'
  );
}

/** 复核测试版本、栏位顺序和当前模型能力，确保上传前即可发现陈旧参数。 */
function validateTrialRequest(
  item: Awaited<ReturnType<AdminApiClient['getTemplateTrial']>>['item'],
  input: SubmitTemplateTrialInput,
): void {
  if (item.status !== 'testing' || item.templateVersionId !== input.versionId) {
    throw new McpOperationError('TEMPLATE_TRIAL_STATE_CONFLICT', '测试版本身份或状态已经变化');
  }
  if (item.revision !== input.expectedRevision) {
    throw new McpOperationError('TEMPLATE_TRIAL_REVISION_CONFLICT', '测试版本revision已经变化');
  }
  const slots = [...item.inputs].sort((left, right) => left.order - right.order);
  if (
    slots.length !== input.inputs.length ||
    slots.some((slot, index) => slot.key !== input.inputs[index]?.slotKey)
  ) {
    throw new McpOperationError('MCP_TRIAL_INPUTS_INVALID', '本地图片顺序与测试版本图片栏不一致');
  }
  if (input.generation.supplementalDescription && !item.supplementalDescription.allowed) {
    throw new McpOperationError(
      'GENERATION_SUPPLEMENTAL_DESCRIPTION_NOT_ALLOWED',
      '当前模板不允许补充描述',
    );
  }
  const model = item.model;
  if (!model || model.status === 'disabled') {
    throw new McpOperationError('GENERATION_MODEL_UNAVAILABLE', '测试版本没有可用模型');
  }
  const aspectRatio = input.generation.aspectRatio;
  const resolution = input.generation.resolution;
  const automatic = aspectRatio === 'auto' && resolution === 'auto';
  const fixed =
    aspectRatio !== 'auto' &&
    resolution !== 'auto' &&
    model.sizes.some((size) => size.ratio === aspectRatio && size.resolution === resolution);
  if (!(automatic ? model.supportsAuto : fixed)) {
    throw new McpOperationError('GENERATION_MODEL_SIZE_NOT_ALLOWED', '当前模型不支持指定尺寸');
  }
  const quality = input.generation.quality;
  const qualityAllowed = model.qualities.length
    ? Boolean(quality && model.qualities.includes(quality))
    : quality === undefined;
  if (!qualityAllowed) {
    throw new McpOperationError('GENERATION_MODEL_QUALITY_NOT_ALLOWED', '当前模型不支持指定质量');
  }
}

/** 把安全工具参数转换为现有单任务创建契约。 */
function createTaskRequest(
  input: SubmitTemplateTrialInput,
  item: TrialItemRecord,
): GenerationTaskCreateRequest {
  return {
    templateTrialRevision: input.expectedRevision,
    clientRequestId: item.clientRequestId,
    templateVersionId: input.versionId,
    inputs: input.inputs.map((image, index) => ({
      slotKey: image.slotKey,
      sourceType: 'user_upload' as const,
      uploadId: item.uploadIds[index]!,
    })),
    aspectRatio: input.generation.aspectRatio,
    ...(input.generation.resolution ? { resolution: input.generation.resolution } : {}),
    ...(input.generation.quality ? { quality: input.generation.quality } : {}),
    ...(input.generation.supplementalDescription
      ? { supplementalDescription: input.generation.supplementalDescription }
      : {}),
  };
}

/** 确认查询响应仍属于原测试版本和提交修订，防止错误任务污染报告。 */
function assertMatchingTask(
  item: TrialItemRecord,
  response: Awaited<ReturnType<AdminApiClient['getGenerationTask']>>,
): void {
  if (
    response.taskId !== item.taskId ||
    response.templateVersionId !== item.versionId ||
    response.templateTrialRevision !== item.revision
  ) {
    throw new McpOperationError('MCP_TASK_IDENTITY_MISMATCH', '任务查询结果与执行记录不一致');
  }
}

/** 创建供MCP工具使用的试用提交与结果收集服务。 */
export function createTrialService(dependencies: TrialServiceDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadMcpRuntimeConfig;
  const apiFactory = dependencies.createApiClient ?? createAdminApiClient;
  const uploader = dependencies.uploader ?? createTencentCosAssetUploader();
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  const fetcher = dependencies.fetcher ?? globalThis.fetch;

  /** 从一份批次计划展开单项调用；始终沿用原执行编号与精确版本。 */
  function batchItem(
    plan: BatchSubmissionPlan,
    testCase: BatchSubmissionPlan['cases'][number],
    candidate: BatchSubmissionPlan['candidates'][number],
  ): SubmitTemplateTrialInput {
    return {
      executionId: plan.executionId,
      sampleId: testCase.id,
      candidateKey: candidate.key,
      versionId: candidate.versionId,
      expectedRevision: candidate.revision,
      inputs: testCase.inputs.map((item) => ({ slotKey: item.slotKey, localPath: item.path })),
      generation: {
        aspectRatio: plan.generation.aspectRatio,
        resolution: plan.generation.resolution,
        ...(plan.generation.quality ? { quality: plan.generation.quality } : {}),
        ...(testCase.supplementalDescription
          ? { supplementalDescription: testCase.supplementalDescription }
          : {}),
      },
    };
  }

  /** 一次预检整批后串行提交；已有编号永不自动恢复付费写入。 */
  async function submitBatch(rawPlan: BatchSubmissionPlan) {
    const plan = batchSubmissionPlanSchema.parse(rawPlan);
    parseBatchPlan(plan);
    const config = await loadConfig();
    const startedAt = performance.now();
    try {
      await readTrialReport(config.outputRoot, plan.executionId);
      throw new McpOperationError('MCP_EXECUTION_EXISTS', '执行编号已有报告，禁止自动重提付费试用');
    } catch (error) {
      if (!(error instanceof McpOperationError) || error.code !== 'MCP_EXECUTION_NOT_FOUND') {
        throw error;
      }
    }
    await validateBatchInputs(plan, config.inputRoot);
    const api = apiFactory(config);
    await api.getCurrentAdmin();
    const liveCandidates = await Promise.all(
      plan.candidates.map((candidate) => api.getTemplateTrial(candidate.versionId)),
    );
    for (const [index, candidate] of plan.candidates.entries()) {
      const live = liveCandidates[index]!.item;
      if (
        live.templateId !== candidate.templateId ||
        live.templateVersionId !== candidate.versionId ||
        live.model?.modelId !== candidate.modelId
      ) {
        throw new McpOperationError(
          'TEMPLATE_TRIAL_IDENTITY_MISMATCH',
          '候选身份或绑定模型与计划不一致',
        );
      }
      for (const testCase of plan.cases) {
        validateTrialRequest(live, batchItem(plan, testCase, candidate));
      }
    }
    const preflightMs = Math.round(performance.now() - startedAt);
    const checkedTrials = new Map(
      plan.candidates.map((candidate, index) => [candidate.versionId, liveCandidates[index]!]),
    );
    let processed = 0;
    let halted = false;
    let lastError: TrialOperationResult['error'] = null;
    for (const testCase of plan.cases) {
      for (const candidate of plan.candidates) {
        const result = await submit(batchItem(plan, testCase, candidate), {
          config,
          api,
          trial: checkedTrials.get(candidate.versionId)!,
        });
        if (!result.reportPersisted) {
          return {
            ok: false,
            executionId: plan.executionId,
            processed,
            reportPersisted: false,
            reportPaths: result.reportPaths,
            summary: null,
            error: result.error,
            timingsMs: {
              preflight: preflightMs,
              submission: Math.round(performance.now() - startedAt - preflightMs),
              comparison: 0,
            },
          };
        }
        processed += 1;
        if (result.error) lastError = result.error;
        if (
          result.error?.uncertain ||
          (await readTrialReport(config.outputRoot, plan.executionId)).report.submissionHaltCode
        ) {
          halted = true;
        }
        // 已停机时仍遍历余项，单项服务只登记未执行组合，不再发起远程写入。
      }
    }
    const submissionMs = Math.round(performance.now() - startedAt - preflightMs);
    const { report, paths } = await readTrialReport(config.outputRoot, plan.executionId);
    const comparisonStart = performance.now();
    let comparisonError: McpOperationError | null = null;
    try {
      await buildBatchComparison(plan, config.outputRoot);
    } catch (error) {
      comparisonError = toSafeError(error, 'MCP_BATCH_COMPARISON_FAILED');
    }
    const comparisonMs = Math.round(performance.now() - comparisonStart);
    report.timingsMs = {
      preflight: preflightMs,
      submission: submissionMs,
      comparison: comparisonMs,
      collection: 0,
    };
    await persist(report, paths, now);
    return {
      ok: !halted && !lastError && !comparisonError,
      executionId: plan.executionId,
      processed,
      reportPersisted: true,
      reportPaths: paths,
      summary: report.summary,
      error:
        lastError ??
        (comparisonError
          ? { code: comparisonError.code, message: comparisonError.message, uncertain: false }
          : null),
      timingsMs: report.timingsMs,
    };
  }

  /** 提交一个样本与候选组合；所有恢复标识均在对应远程写入前落盘。 */
  async function submit(
    input: SubmitTemplateTrialInput,
    prechecked?: {
      config: McpRuntimeConfig;
      api: AdminApiClient;
      trial: Awaited<ReturnType<AdminApiClient['getTemplateTrial']>>;
    },
  ): Promise<TrialOperationResult> {
    let paths: ReportPaths | null = null;
    let report: TrialExecutionReport | null = null;
    let item: TrialItemRecord | null = null;
    let step: 'local' | 'context' | 'trial' | 'credential' | 'upload' | 'submit' = 'local';
    try {
      const config = prechecked?.config ?? (await loadConfig());
      const prepared = await prepareTrialInputs(config, input.inputs);
      try {
        ({ report, paths } = await readTrialReport(config.outputRoot, input.executionId));
      } catch (error) {
        if (!(error instanceof McpOperationError) || error.code !== 'MCP_EXECUTION_NOT_FOUND')
          throw error;
        paths = await initializeTrialReportDirectory(config.outputRoot, input.executionId);
        report = createInitialReport(input, config, now());
      }
      if (report.apiBaseUrl !== config.apiBaseUrl) {
        throw new McpOperationError(
          'MCP_EXECUTION_ENVIRONMENT_MISMATCH',
          '执行记录与当前API环境不一致',
        );
      }
      if (report.phase !== 'submitting') {
        throw new McpOperationError(
          'MCP_TRIAL_SUBMISSIONS_CLOSED',
          '该执行已经开始收集，不能新增试用',
        );
      }
      if (
        report.items.some(
          (entry) => entry.sampleId === input.sampleId && entry.candidateKey === input.candidateKey,
        )
      ) {
        throw new McpOperationError('MCP_TRIAL_COMBINATION_EXISTS', '该样本与候选组合已经记录');
      }

      const sample = report.samples.find((entry) => entry.sampleId === input.sampleId);
      if (sample) {
        assertMatchingSample(sample, prepared);
      } else {
        report.samples.push({
          sampleId: input.sampleId,
          inputs: await copyTrialSampleInputs(paths.directory, input.sampleId, prepared),
        });
      }
      item = {
        sampleId: input.sampleId,
        candidateKey: input.candidateKey,
        templateId: null,
        templateName: null,
        versionId: input.versionId,
        version: null,
        revision: input.expectedRevision,
        generation: { ...input.generation },
        uploadIds: input.inputs.map(() => null),
        clientRequestId: createId(),
        taskId: null,
        pointsCost: null,
        submissionStatus: report.submissionHaltCode ? 'not_executed' : 'preparing',
        taskStatus: 'not_submitted',
        exportStatus: 'not_applicable',
        resultRelativePath: null,
        errorCode: report.submissionHaltCode,
        lastQueryErrorCode: null,
        lastQueriedAt: null,
      };
      report.items.push(item);
      await persist(report, paths, now);
      if (report.submissionHaltCode) {
        return {
          ok: false,
          executionId: input.executionId,
          status: report.status,
          item,
          reportPersisted: true,
          reportPaths: paths,
          error: {
            code: report.submissionHaltCode,
            message: '执行已停止新的试用提交',
            uncertain: false,
          },
        };
      }

      const api = prechecked?.api ?? apiFactory(config);
      step = 'context';
      if (!prechecked) await api.getCurrentAdmin();
      step = 'trial';
      // 批次已在远程写入前核对全部版本；任务创建接口仍用 revision 防止期间被改动。
      const trial = prechecked?.trial ?? (await api.getTemplateTrial(input.versionId));
      validateTrialRequest(trial.item, input);
      item.templateId = trial.item.templateId;
      item.templateName = trial.item.name;
      item.version = trial.item.version;
      await persist(report, paths, now);

      for (const [index, preparedInput] of prepared.entries()) {
        step = 'credential';
        const ticket = await api.issueImageUpload({
          contentType: preparedInput.file.contentType,
          sizeBytes: preparedInput.file.sizeBytes,
        });
        item.uploadIds[index] = ticket.uploadId;
        await persist(report, paths, now);
        step = 'upload';
        await uploader.upload(ticket, preparedInput.file.bytes, preparedInput.file.contentType);
      }

      step = 'submit';
      // clientRequestId、完整参数和全部uploadId已经持久化，响应丢失时禁止生成新标识重发。
      await persist(report, paths, now);
      const created = await api.createGenerationTask(createTaskRequest(input, item));
      item.taskId = created.taskId;
      item.pointsCost = created.pointsCost;
      item.submissionStatus = 'submitted';
      item.taskStatus = created.status;
      item.exportStatus = 'pending';
      await persist(report, paths, now);
      return {
        ok: true,
        executionId: input.executionId,
        status: report.status,
        item,
        reportPersisted: true,
        reportPaths: paths,
        error: null,
      };
    } catch (unknownError) {
      const error = toSafeError(unknownError);
      if (report && item && paths) {
        if (step === 'submit' && error.uncertain) item.submissionStatus = 'pending_review';
        else if (item.submissionStatus !== 'not_executed') item.submissionStatus = 'failed';
        item.errorCode = error.code;
        if (shouldHaltSubmissions(error)) report.submissionHaltCode = error.code;
        const reportPersisted =
          error.code === 'MCP_REPORT_WRITE_FAILED'
            ? false
            : await persist(report, paths, now).then(
                () => true,
                () => false,
              );
        return {
          ok: false,
          executionId: input.executionId,
          status: report.status,
          item,
          reportPersisted,
          reportPaths: paths,
          error: { code: error.code, message: error.message, uncertain: error.uncertain },
        };
      }
      return {
        ok: false,
        executionId: input.executionId,
        status: 'failed',
        item: null,
        reportPersisted: false,
        reportPaths: paths,
        error: { code: error.code, message: error.message, uncertain: error.uncertain },
      };
    }
  }

  /** 查询至多十个已提交任务一次，并在成功时导出图片。 */
  async function collect(
    input: CollectTemplateTrialInput,
  ): Promise<TrialOperationResult & { processed: number; comparisonUpdated: boolean }> {
    const collectionStart = performance.now();
    const config = await loadConfig();
    const { report, paths } = await readTrialReport(config.outputRoot, input.executionId);
    if (report.apiBaseUrl !== config.apiBaseUrl) {
      throw new McpOperationError(
        'MCP_EXECUTION_ENVIRONMENT_MISMATCH',
        '执行记录与当前API环境不一致',
      );
    }
    if (!report.items.length)
      throw new McpOperationError('MCP_TRIAL_REPORT_EMPTY', '执行记录中没有试用组合');
    report.phase = 'collecting';
    report.finishedAt = null;
    await persist(report, paths, now);
    const api = apiFactory(config);
    const maxItems = Math.min(10, Math.max(1, input.maxItems ?? 10));
    const pending = report.items.filter(
      (entry) =>
        entry.submissionStatus === 'submitted' &&
        entry.taskId &&
        !(entry.taskStatus === 'failed' || entry.exportStatus === 'downloaded'),
    );
    const start = pending.length ? (report.collectCursor ?? 0) % pending.length : 0;
    const candidates = [...pending.slice(start), ...pending.slice(0, start)].slice(0, maxItems);
    report.collectCursor = pending.length ? (start + candidates.length) % pending.length : 0;
    await persist(report, paths, now);
    let changed = false;
    // 三项只读查询和图片下载同时进行，报告更新仍逐项串行持久化。
    for (let offset = 0; offset < candidates.length; offset += 3) {
      const group = candidates.slice(offset, offset + 3);
      const outcomes = await Promise.all(
        group.map(async (item) => {
          try {
            const current = await api.getGenerationTask(item.taskId!);
            assertMatchingTask(item, current);
            let exportedPath: string | null = null;
            let exportError: string | null = null;
            if (current.status === 'succeeded') {
              try {
                exportedPath = await exportTrialResult(
                  paths.directory,
                  item,
                  current.result.url,
                  fetcher,
                );
              } catch (error) {
                exportError = toSafeError(error, 'MCP_RESULT_DOWNLOAD_FAILED').code;
              }
            }
            return { current, exportedPath, exportError, queryError: null };
          } catch (error) {
            return {
              current: null,
              exportedPath: null,
              exportError: null,
              queryError: toSafeError(error).code,
            };
          }
        }),
      );
      for (const [index, item] of group.entries()) {
        const outcome = outcomes[index]!;
        const before = `${item.taskStatus}:${item.exportStatus}:${item.errorCode}:${item.lastQueryErrorCode}`;
        item.lastQueriedAt = now().toISOString();
        item.lastQueryErrorCode = outcome.queryError;
        if (outcome.current) {
          item.taskStatus = outcome.current.status;
          item.pointsCost = outcome.current.pointsCost;
          if (outcome.current.status === 'failed') {
            item.exportStatus = 'not_applicable';
            item.errorCode = outcome.current.failure.code;
          } else if (outcome.current.status === 'succeeded') {
            item.resultRelativePath = outcome.exportedPath;
            item.exportStatus = outcome.exportedPath ? 'downloaded' : 'failed';
            item.errorCode = outcome.exportError;
          }
        }
        changed ||=
          before !==
          `${item.taskStatus}:${item.exportStatus}:${item.errorCode}:${item.lastQueryErrorCode}`;
        await persist(report, paths, now);
      }
    }
    aggregateTrialReport(report);
    if (report.status !== 'running') report.finishedAt = now().toISOString();
    if (report.timingsMs) {
      report.timingsMs.collection += Math.round(performance.now() - collectionStart);
    }
    await persist(report, paths, now);
    const batchPlanPath = path.join(paths.directory, 'batch-plan.json');
    let comparisonUpdated = false;
    let comparisonError: McpOperationError | null = null;
    if (changed || report.status !== 'running') {
      try {
        await access(batchPlanPath);
        const comparisonStart = performance.now();
        await buildBatchComparison(await readBatchPlan(batchPlanPath), config.outputRoot);
        comparisonUpdated = true;
        if (report.timingsMs) {
          report.timingsMs.comparison += Math.round(performance.now() - comparisonStart);
          await persist(report, paths, now);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          comparisonError = toSafeError(error, 'MCP_BATCH_COMPARISON_FAILED');
        }
      }
    }
    return {
      ok: !comparisonError,
      executionId: input.executionId,
      status: report.status,
      item: null,
      processed: candidates.length,
      comparisonUpdated,
      reportPersisted: true,
      reportPaths: paths,
      error: comparisonError
        ? { code: comparisonError.code, message: comparisonError.message, uncertain: false }
        : null,
    };
  }

  return { submit, submitBatch, collect };
}

export type { GenerationAspectRatio, ModelQuality, ModelResolution };
