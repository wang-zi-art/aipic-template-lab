/**
 * MCP 提示词更新与未发布候选删除编排服务。
 *
 * 本服务每次重新读取本机配置，只通过管理员 HTTP 契约推进状态；提示词更新始终从权威完整
 * 表单重建写请求，删除始终交给服务端事务，任何不明确写入都停止后续动作而不自动重发。
 */
import { randomUUID } from 'node:crypto';
import type {
  AdminSystemTemplateVersionDetailResponse,
  AdminSystemTemplateVersionUpdateRequest,
} from '@aipic/contracts';
import { createAdminApiClient, type AdminApiClient } from './api-client.js';
import { loadMcpRuntimeConfig, type McpRuntimeConfig } from './config.js';
import { McpOperationError, toSafeError } from './errors.js';
import {
  initializeTemplateMutationDirectory,
  writeTemplateMutationReport,
  type TemplateMutationReport,
  type TemplateMutationStep,
} from './mutation-report.js';
import type { ReportPaths } from './report.js';

export interface PromptModelRoleUpdate {
  key: string;
  modelRole: string;
}

export interface UpdateSystemTemplatePromptInput {
  executionId?: string;
  versionId: string;
  expectedRevision: number;
  executionPrompt: string;
  inputModelRoles?: PromptModelRoleUpdate[];
}

export interface DeleteUnpublishedSystemTemplateInput {
  executionId?: string;
  templateId: string;
  expectedRevision: number;
}

export interface TemplateMutationResult {
  ok: boolean;
  executionId: string | null;
  templateId: string | null;
  versionId: string | null;
  revision: number | null;
  serverStatus: string | null;
  deletedAt: string | null;
  replayed: boolean | null;
  completedStep: TemplateMutationStep | null;
  stoppedStep: TemplateMutationStep | null;
  reportPersisted: boolean;
  reportPaths: ReportPaths | null;
  error: { code: string; message: string; uncertain: boolean } | null;
}

export interface TemplateMutationServiceDependencies {
  loadConfig?: () => Promise<McpRuntimeConfig>;
  createApiClient?: (config: McpRuntimeConfig) => AdminApiClient;
  createId?: () => string;
  now?: () => Date;
}

/** 由权威详情重建现有 PUT 接口需要的完整表单，只覆盖明确指定的私有字段。 */
function createPromptUpdateRequest(
  item: AdminSystemTemplateVersionDetailResponse['item'],
  expectedRevision: number,
  executionPrompt: string,
  roleUpdates: PromptModelRoleUpdate[],
): AdminSystemTemplateVersionUpdateRequest {
  if (!item.model) {
    throw new McpOperationError('GENERATION_MODEL_UNAVAILABLE', '模板当前没有可保存的模型绑定');
  }
  const updates = new Map<string, string>();
  for (const update of roleUpdates) {
    if (updates.has(update.key)) {
      throw new McpOperationError('MCP_INPUT_MODEL_ROLE_INVALID', '图片栏模型作用包含重复 key');
    }
    updates.set(update.key, update.modelRole);
  }
  const knownKeys = new Set(item.inputs.map((input) => input.key));
  if ([...updates.keys()].some((key) => !knownKeys.has(key))) {
    throw new McpOperationError('MCP_INPUT_MODEL_ROLE_INVALID', '图片栏模型作用引用了不存在的 key');
  }
  return {
    generationModelId: item.model.modelId,
    name: item.name,
    description: item.description,
    categoryId: item.category.categoryId,
    inputs: item.inputs.map((input) => ({
      key: input.key,
      order: input.order,
      label: input.label,
      required: true,
      uploadRequirement: input.uploadRequirement,
      modelRole: updates.get(input.key) ?? input.modelRole,
    })),
    allowsSupplementalDescription: item.allowsSupplementalDescription,
    ...(item.supplementalDescriptionRecommendation
      ? { supplementalDescriptionRecommendation: item.supplementalDescriptionRecommendation }
      : {}),
    executionPrompt,
    expectedRevision,
  };
}

/** 核对最终版本与完整保存表单及原素材归属一致，不把私密正文写入报告。 */
function matchesSavedPrompt(
  final: AdminSystemTemplateVersionDetailResponse['item'],
  update: AdminSystemTemplateVersionUpdateRequest,
  original: AdminSystemTemplateVersionDetailResponse['item'],
  expectedRevision: number,
): boolean {
  const assetIds = (item: AdminSystemTemplateVersionDetailResponse['item']) => [
    item.assets.effectAsset?.assetId ?? null,
    ...item.assets.inputs.flatMap((slot) => [
      slot.inputKey,
      slot.exampleAsset?.assetId ?? null,
      ...slot.presetAssets.map((asset) => asset.assetId),
    ]),
  ];
  const actualInputs = [...final.inputs].sort((left, right) => left.order - right.order);
  const expectedInputs = [...update.inputs].sort((left, right) => left.order - right.order);
  return (
    final.templateId === original.templateId &&
    final.templateVersionId === original.templateVersionId &&
    final.status === 'testing' &&
    final.revision === expectedRevision &&
    final.model?.modelId === update.generationModelId &&
    final.name === update.name &&
    final.description === update.description &&
    final.category.categoryId === update.categoryId &&
    final.executionPrompt === update.executionPrompt &&
    final.allowsSupplementalDescription === update.allowsSupplementalDescription &&
    (final.supplementalDescriptionRecommendation ?? null) ===
      (update.supplementalDescriptionRecommendation ?? null) &&
    actualInputs.length === expectedInputs.length &&
    actualInputs.every((actual, index) => {
      const expected = expectedInputs[index]!;
      return (
        actual.key === expected.key &&
        actual.order === expected.order &&
        actual.label === expected.label &&
        actual.required === expected.required &&
        actual.uploadRequirement === expected.uploadRequirement &&
        actual.modelRole === expected.modelRole
      );
    }) &&
    JSON.stringify(assetIds(final)) === JSON.stringify(assetIds(original))
  );
}

/** 创建一份不含提示词正文和模型作用正文的初始变更报告。 */
function createInitialReport(
  executionId: string,
  config: McpRuntimeConfig,
  goal: TemplateMutationReport['goal'],
  expectedRevision: number,
  now: Date,
  changedFields: string[],
): TemplateMutationReport {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    executionId,
    goal,
    apiBaseUrl: config.apiBaseUrl,
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    completedStep: 'initialized',
    stoppedStep: null,
    requiresReview: false,
    errorCode: null,
    templateId: null,
    versionId: null,
    initialRevision: expectedRevision,
    currentRevision: null,
    serverStatus: null,
    changedFields,
    deletedAt: null,
    replayed: null,
  };
}

/** 更新时间并持久化报告，写入失败时阻止下一次远程写操作。 */
async function persistReport(
  report: TemplateMutationReport,
  paths: ReportPaths,
  now: () => Date,
): Promise<void> {
  report.updatedAt = now().toISOString();
  await writeTemplateMutationReport(paths, report);
}

/** 把失败后的实际状态和安全错误落盘，不尝试补偿或重放远程写入。 */
async function finishFailure(
  report: TemplateMutationReport,
  paths: ReportPaths,
  step: TemplateMutationStep,
  error: McpOperationError,
  wroteRemote: boolean,
  now: () => Date,
): Promise<boolean> {
  report.status = wroteRemote || error.uncertain ? 'partial' : 'failed';
  report.stoppedStep = step;
  report.requiresReview = error.uncertain;
  report.errorCode = error.code;
  report.finishedAt = now().toISOString();
  try {
    await persistReport(report, paths, now);
    return true;
  } catch {
    return false;
  }
}

/** 把报告转换为不含私有内容的稳定工具结果。 */
function toResult(
  report: TemplateMutationReport,
  paths: ReportPaths,
  reportPersisted: boolean,
  error: McpOperationError | null,
): TemplateMutationResult {
  return {
    ok: error === null,
    executionId: report.executionId,
    templateId: report.templateId,
    versionId: report.versionId,
    revision: report.currentRevision,
    serverStatus: report.serverStatus,
    deletedAt: report.deletedAt,
    replayed: report.replayed,
    completedStep: report.completedStep,
    stoppedStep: report.stoppedStep,
    reportPersisted,
    reportPaths: paths,
    error: error ? { code: error.code, message: error.message, uncertain: error.uncertain } : null,
  };
}

/** 创建模板变更服务，测试可以注入配置、HTTP 客户端、时间和 UUID。 */
export function createTemplateMutationService(
  dependencies: TemplateMutationServiceDependencies = {},
) {
  const loadConfig = dependencies.loadConfig ?? loadMcpRuntimeConfig;
  const apiFactory = dependencies.createApiClient ?? createAdminApiClient;
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  /** 更新一个 draft/testing 候选的指定私有字段并重新进入 testing。 */
  async function updatePrompt(
    input: UpdateSystemTemplatePromptInput,
  ): Promise<TemplateMutationResult> {
    let report: TemplateMutationReport | null = null;
    let paths: ReportPaths | null = null;
    let api: AdminApiClient | null = null;
    let step: TemplateMutationStep = 'initialized';
    let wroteRemote = false;
    try {
      const config = await loadConfig();
      const executionId = input.executionId ?? createId();
      paths = await initializeTemplateMutationDirectory(config.outputRoot, executionId);
      report = createInitialReport(
        executionId,
        config,
        'update_system_template_prompt',
        input.expectedRevision,
        now(),
        [
          'executionPrompt',
          ...(input.inputModelRoles ?? []).map((item) => `inputs.${item.key}.modelRole`),
        ],
      );
      report.versionId = input.versionId;
      await persistReport(report, paths, now);
      api = apiFactory(config);

      step = 'template_read';
      let current = await api.getSystemTemplateVersion(input.versionId);
      report.templateId = current.item.templateId;
      report.currentRevision = current.item.revision;
      report.serverStatus = current.item.status;
      if (current.item.revision !== input.expectedRevision) {
        throw new McpOperationError(
          'ADMIN_SYSTEM_TEMPLATE_REVISION_CONFLICT',
          '模板已被其他页面修改，请重新读取最新版本',
        );
      }
      if (!['draft', 'testing'].includes(current.item.status)) {
        throw new McpOperationError(
          'ADMIN_SYSTEM_TEMPLATE_STATE_CONFLICT',
          '当前版本状态不允许修改提示词',
        );
      }
      report.completedStep = step;
      await persistReport(report, paths, now);

      if (current.item.status === 'testing') {
        step = 'returned_to_draft';
        const returned = await api.returnToDraft(input.versionId, current.item.revision);
        wroteRemote = true;
        report.currentRevision = returned.item.revision;
        report.serverStatus = returned.item.status;
        report.completedStep = step;
        await persistReport(report, paths, now);
        // 退回后重新读取完整权威表单，不能沿用退回前的旧详情。
        current = await api.getSystemTemplateVersion(input.versionId);
        if (current.item.status !== 'draft' || current.item.revision !== returned.item.revision) {
          throw new McpOperationError(
            'ADMIN_SYSTEM_TEMPLATE_STATE_MISMATCH',
            '退回后的模板状态与服务端响应不一致',
            true,
          );
        }
      }

      step = 'form_saved';
      const update = createPromptUpdateRequest(
        current.item,
        current.item.revision,
        input.executionPrompt,
        input.inputModelRoles ?? [],
      );
      const saved = await api.updateSystemTemplateVersion(input.versionId, update);
      wroteRemote = true;
      report.currentRevision = saved.item.revision;
      report.serverStatus = saved.item.status;
      report.completedStep = step;
      await persistReport(report, paths, now);

      step = 'entered_testing';
      const testing = await api.enterTesting(input.versionId, saved.item.revision);
      report.currentRevision = testing.item.revision;
      report.serverStatus = testing.item.status;
      report.completedStep = step;
      await persistReport(report, paths, now);

      step = 'final_read';
      const final = await api.getSystemTemplateVersion(input.versionId);
      if (!matchesSavedPrompt(final.item, update, current.item, testing.item.revision)) {
        throw new McpOperationError(
          'ADMIN_SYSTEM_TEMPLATE_STATE_MISMATCH',
          '服务端最终状态与提示词更新结果不一致',
          true,
        );
      }
      report.currentRevision = final.item.revision;
      report.serverStatus = final.item.status;
      report.completedStep = step;
      report.status = 'completed';
      report.finishedAt = now().toISOString();
      await persistReport(report, paths, now);
      return toResult(report, paths, true, null);
    } catch (unknownError) {
      const error = toSafeError(unknownError);
      // 不明确写入后只做一次只读核对，用于报告实际状态，绝不自动推进下一步。
      if (error.uncertain && api && report?.versionId) {
        try {
          const current = await api.getSystemTemplateVersion(report.versionId);
          report.templateId = current.item.templateId;
          report.currentRevision = current.item.revision;
          report.serverStatus = current.item.status;
        } catch {
          // 只读核对失败不覆盖原始安全错误。
        }
      }
      if (!report || !paths) {
        return {
          ok: false,
          executionId: null,
          templateId: null,
          versionId: input.versionId,
          revision: null,
          serverStatus: null,
          deletedAt: null,
          replayed: null,
          completedStep: null,
          stoppedStep: null,
          reportPersisted: false,
          reportPaths: null,
          error: { code: error.code, message: error.message, uncertain: error.uncertain },
        };
      }
      const persisted =
        error.code === 'MCP_REPORT_WRITE_FAILED'
          ? false
          : await finishFailure(report, paths, step, error, wroteRemote, now);
      return toResult(report, paths, persisted, error);
    }
  }

  /** 通过管理员删除接口软删除一个从未发布的候选。 */
  async function deleteCandidate(
    input: DeleteUnpublishedSystemTemplateInput,
  ): Promise<TemplateMutationResult> {
    let report: TemplateMutationReport | null = null;
    let paths: ReportPaths | null = null;
    let step: TemplateMutationStep = 'initialized';
    try {
      const config = await loadConfig();
      const executionId = input.executionId ?? createId();
      paths = await initializeTemplateMutationDirectory(config.outputRoot, executionId);
      report = createInitialReport(
        executionId,
        config,
        'delete_unpublished_system_template',
        input.expectedRevision,
        now(),
        ['deletedAt'],
      );
      report.templateId = input.templateId;
      await persistReport(report, paths, now);
      const api = apiFactory(config);

      step = 'template_read';
      try {
        const current = await api.getSystemTemplate(input.templateId);
        report.currentRevision = current.item.revision;
        report.serverStatus = current.item.workingVersion?.status ?? null;
        if (current.item.revision !== input.expectedRevision) {
          throw new McpOperationError(
            'ADMIN_SYSTEM_TEMPLATE_REVISION_CONFLICT',
            '模板已被其他页面修改，请重新读取最新版本',
          );
        }
      } catch (error) {
        // 已删除记录无法通过普通详情读取；404 仍交给幂等 DELETE 区分删除重放与真实不存在。
        if (
          !(error instanceof McpOperationError) ||
          error.code !== 'ADMIN_SYSTEM_TEMPLATE_NOT_FOUND'
        ) {
          throw error;
        }
      }
      report.completedStep = step;
      await persistReport(report, paths, now);

      step = 'deleted';
      const deleted = await api.deleteUnpublishedSystemTemplate(
        input.templateId,
        input.expectedRevision,
      );
      report.deletedAt = deleted.body.item.deletedAt;
      report.replayed = deleted.replayed;
      report.serverStatus = 'deleted';
      report.completedStep = step;
      report.status = 'completed';
      report.finishedAt = now().toISOString();
      await persistReport(report, paths, now);
      return toResult(report, paths, true, null);
    } catch (unknownError) {
      const error = toSafeError(unknownError);
      if (!report || !paths) {
        return {
          ok: false,
          executionId: null,
          templateId: input.templateId,
          versionId: null,
          revision: null,
          serverStatus: null,
          deletedAt: null,
          replayed: null,
          completedStep: null,
          stoppedStep: null,
          reportPersisted: false,
          reportPaths: null,
          error: { code: error.code, message: error.message, uncertain: error.uncertain },
        };
      }
      const persisted =
        error.code === 'MCP_REPORT_WRITE_FAILED'
          ? false
          : await finishFailure(report, paths, step, error, error.uncertain, now);
      return toResult(report, paths, persisted, error);
    }
  }

  return { updatePrompt, deleteCandidate };
}
