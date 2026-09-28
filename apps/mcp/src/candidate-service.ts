/**
 * 单个系统模板候选的 MCP 应用服务。
 *
 * 本服务先完成全部本地校验，再按管理员身份复核、草稿创建、逐张素材登记、进入 testing、
 * 权威状态回读的顺序推进；失败时保留已经提交的服务端状态，不执行回滚或自动重试。
 */
import { randomUUID } from 'node:crypto';
import type {
  AdminSystemTemplateAssetKind,
  AdminSystemTemplateCreateRequest,
  AdminSystemTemplateVersionDetailResponse,
  AdminTemplateCategoryResponse,
  GenerationModelRecord,
  PlatformAdminMeResponse,
} from '@aipic/contracts';
import { createAdminApiClient, type AdminApiClient } from './api-client.js';
import { loadMcpRuntimeConfig, type McpRuntimeConfig } from './config.js';
import { createTencentCosAssetUploader, type TemplateAssetUploader } from './cos-uploader.js';
import { McpOperationError, toSafeError } from './errors.js';
import { prepareInputFile, type PreparedInputFile } from './local-files.js';
import {
  initializeExecutionDirectory,
  writeCandidateReport,
  type CandidateExecutionReport,
  type CandidateExecutionStep,
  type ReportPaths,
} from './report.js';
import { readAnyExecutionReport } from './trial-report.js';

export interface CandidateAssetInput {
  kind: AdminSystemTemplateAssetKind;
  inputKey?: string;
  order: number;
  localPath: string;
}

export interface CreateCandidateInput {
  executionId?: string;
  template: AdminSystemTemplateCreateRequest;
  assets: CandidateAssetInput[];
}

interface PreparedCandidateAsset {
  request: CandidateAssetInput;
  file: PreparedInputFile;
}

export interface CandidateOperationResult {
  ok: boolean;
  executionId: string | null;
  status: 'completed' | 'partial' | 'failed';
  templateId: string | null;
  versionId: string | null;
  revision: number | null;
  serverStatus: string | null;
  completedStep: CandidateExecutionStep | null;
  stoppedStep: CandidateExecutionStep | null;
  reportPersisted: boolean;
  reportPaths: ReportPaths | null;
  error: { code: string; message: string; uncertain: boolean } | null;
}

export interface AdminContextResult {
  admin: PlatformAdminMeResponse;
  categories: AdminTemplateCategoryResponse[];
  models: Array<
    Pick<
      GenerationModelRecord,
      | 'modelId'
      | 'displayName'
      | 'status'
      | 'basePoints'
      | 'supportsAuto'
      | 'sizes'
      | 'qualities'
      | 'defaultRatio'
      | 'defaultResolution'
      | 'defaultQuality'
    >
  >;
}

export interface CandidateServiceDependencies {
  loadConfig?: () => Promise<McpRuntimeConfig>;
  createApiClient?: (config: McpRuntimeConfig) => AdminApiClient;
  uploader?: TemplateAssetUploader;
  createId?: () => string;
  now?: () => Date;
}

/** 只投影系统模板创建需要的模型能力，剔除供应商 ID、引用数和审计时间。 */
function toSafeModel(model: GenerationModelRecord): AdminContextResult['models'][number] {
  return {
    modelId: model.modelId,
    displayName: model.displayName,
    status: model.status,
    basePoints: model.basePoints,
    supportsAuto: model.supportsAuto,
    sizes: model.sizes.map((size) => ({ ...size })),
    qualities: [...model.qualities],
    defaultRatio: model.defaultRatio,
    defaultResolution: model.defaultResolution,
    defaultQuality: model.defaultQuality,
  };
}

/** 读取并聚合正式管理员身份、分类和当前可用模型。 */
export async function readAdminContext(api: AdminApiClient): Promise<AdminContextResult> {
  const admin = await api.getCurrentAdmin();
  const [categoryResponse, modelResponse] = await Promise.all([
    api.listTemplateCategories(),
    api.listGenerationModels(),
  ]);
  return {
    admin,
    categories: categoryResponse.items.map((item) => ({ ...item })),
    models: modelResponse.items
      .filter((model) => model.status === 'admin_only' || model.status === 'public')
      .map(toSafeModel),
  };
}

/** 校验素材目标与表单图片栏一致，并禁止同一单图位置或预设顺序重复。 */
function validateAssetManifest(
  template: AdminSystemTemplateCreateRequest,
  assets: CandidateAssetInput[],
): void {
  const inputKeys = new Set(template.inputs.map((input) => input.key));
  const targets = new Set<string>();
  for (const asset of assets) {
    if (asset.kind === 'effect') {
      if (asset.inputKey !== undefined || asset.order !== 1) {
        throw new McpOperationError(
          'MCP_ASSET_MANIFEST_INVALID',
          '效果图不能指定图片栏且顺序必须为 1',
        );
      }
    } else if (!asset.inputKey || !inputKeys.has(asset.inputKey)) {
      throw new McpOperationError('MCP_ASSET_MANIFEST_INVALID', '素材引用了不存在的图片栏');
    } else if (asset.kind === 'slot_example' && asset.order !== 1) {
      throw new McpOperationError('MCP_ASSET_MANIFEST_INVALID', '图片栏示例图顺序必须为 1');
    }
    const target = `${asset.kind}:${asset.inputKey ?? ''}:${asset.order}`;
    if (targets.has(target)) {
      throw new McpOperationError('MCP_ASSET_MANIFEST_INVALID', '素材位置或预设顺序重复');
    }
    targets.add(target);
  }
  for (const inputKey of inputKeys) {
    const orders = assets
      .filter((asset) => asset.kind === 'preset' && asset.inputKey === inputKey)
      .map((asset) => asset.order)
      .sort((left, right) => left - right);
    if (orders.some((order, index) => order !== index + 1)) {
      throw new McpOperationError(
        'MCP_ASSET_MANIFEST_INVALID',
        '每个图片栏的预设素材必须从 1 连续排序',
      );
    }
  }
}

/** 在任何远程写入前读取并验证全部本地素材。 */
async function prepareAssets(
  config: McpRuntimeConfig,
  template: AdminSystemTemplateCreateRequest,
  assets: CandidateAssetInput[],
): Promise<PreparedCandidateAsset[]> {
  validateAssetManifest(template, assets);
  const prepared: PreparedCandidateAsset[] = [];
  for (const asset of assets) {
    prepared.push({
      request: asset,
      file: await prepareInputFile(config.inputRoot, asset.localPath),
    });
  }
  return prepared;
}

/** 构造不含提示词、模型作用和绝对路径的初始执行记录。 */
function createInitialReport(
  executionId: string,
  config: McpRuntimeConfig,
  input: CreateCandidateInput,
  assets: PreparedCandidateAsset[],
  now: Date,
): CandidateExecutionReport {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    executionId,
    goal: 'create_system_template_candidate',
    apiBaseUrl: config.apiBaseUrl,
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    completedStep: 'initialized',
    stoppedStep: null,
    requiresReview: false,
    errorCode: null,
    candidate: {
      name: input.template.name,
      categoryId: input.template.categoryId,
      generationModelId: input.template.generationModelId,
      templateId: null,
      versionId: null,
      version: null,
      revision: null,
      serverStatus: null,
    },
    assets: assets.map(({ request, file }) => ({
      kind: request.kind,
      inputKey: request.inputKey ?? null,
      order: request.order,
      relativePath: file.relativePath,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      status: 'pending',
      errorCode: null,
    })),
  };
}

/** 更新报告时间并持久化，调用方必须等待成功后才能继续下一项远程写入。 */
async function persistReport(
  report: CandidateExecutionReport,
  paths: ReportPaths,
  now: () => Date,
): Promise<void> {
  report.updatedAt = now().toISOString();
  await writeCandidateReport(paths, report);
}

/** 将失败状态安全写入报告；报告自身失败时不得再次声称已经落盘。 */
async function finishWithFailure(
  report: CandidateExecutionReport,
  paths: ReportPaths,
  step: CandidateExecutionStep,
  error: McpOperationError,
  now: () => Date,
): Promise<boolean> {
  report.status = report.candidate.templateId ? 'partial' : 'failed';
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

/** 从版本详情构造不含签名 URL 的素材摘要，完整提示词仅保留在工具响应内。 */
export function sanitizeVersionDetail(item: AdminSystemTemplateVersionDetailResponse['item']) {
  return {
    ...item,
    inputs: item.inputs.map((input) => ({ ...input })),
    allowedAspectRatios: [...item.allowedAspectRatios],
    model: item.model
      ? {
          ...item.model,
          sizes: item.model.sizes.map((size) => ({ ...size })),
          qualities: [...item.model.qualities],
        }
      : null,
    assets: {
      effectAsset: item.assets.effectAsset ? sanitizeAsset(item.assets.effectAsset) : null,
      inputs: item.assets.inputs.map((slot) => ({
        inputKey: slot.inputKey,
        exampleAsset: slot.exampleAsset ? sanitizeAsset(slot.exampleAsset) : null,
        presetAssets: slot.presetAssets.map(sanitizeAsset),
      })),
    },
  };
}

/** 删除素材响应中的短期签名地址，只保留版本归属和展示元数据。 */
function sanitizeAsset(
  asset: AdminSystemTemplateVersionDetailResponse['item']['assets']['inputs'][number]['presetAssets'][number],
) {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    inputKey: asset.inputKey,
    order: asset.order,
    originalContentType: asset.originalContentType,
    originalSizeBytes: asset.originalSizeBytes,
    originalWidth: asset.originalWidth,
    originalHeight: asset.originalHeight,
    thumbnailWidth: asset.thumbnailWidth,
    thumbnailHeight: asset.thumbnailHeight,
  };
}

/** 按提交表单逐字段检查最终版本，避免调用方再次读取同一版本才能登记候选。 */
function matchesCreatedCandidate(
  input: CreateCandidateInput,
  version: AdminSystemTemplateVersionDetailResponse['item'],
  expectedRevision: number,
): boolean {
  const fields = input.template;
  const actualInputs = [...version.inputs].sort((left, right) => left.order - right.order);
  const expectedInputs = [...fields.inputs].sort((left, right) => left.order - right.order);
  const actualAssets = [
    ...(version.assets.effectAsset ? [version.assets.effectAsset] : []),
    ...version.assets.inputs.flatMap((slot) => [
      ...(slot.exampleAsset ? [slot.exampleAsset] : []),
      ...slot.presetAssets,
    ]),
  ];
  return (
    version.status === 'testing' &&
    version.revision === expectedRevision &&
    version.name === fields.name &&
    version.description === fields.description &&
    version.category.categoryId === fields.categoryId &&
    version.model?.modelId === fields.generationModelId &&
    version.executionPrompt === fields.executionPrompt &&
    version.allowsSupplementalDescription === fields.allowsSupplementalDescription &&
    (version.supplementalDescriptionRecommendation ?? null) ===
      (fields.supplementalDescriptionRecommendation ?? null) &&
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
    actualAssets.length === input.assets.length &&
    input.assets.every((expected) =>
      actualAssets.some(
        (actual) =>
          actual.kind === expected.kind &&
          (actual.inputKey ?? null) === (expected.inputKey ?? null) &&
          actual.order === expected.order,
      ),
    )
  );
}

/** 创建可供 MCP 工具使用的单候选服务。 */
export function createCandidateService(dependencies: CandidateServiceDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadMcpRuntimeConfig;
  const apiFactory = dependencies.createApiClient ?? createAdminApiClient;
  const uploader = dependencies.uploader ?? createTencentCosAssetUploader();
  const createId = dependencies.createId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  /** 每次调用重新读取私密配置并返回安全管理员上下文。 */
  async function getAdminContext(): Promise<AdminContextResult> {
    const config = await loadConfig();
    return readAdminContext(apiFactory(config));
  }

  /** 按稳定模板或版本 ID 查询完整表单；稳定模板优先选择唯一工作版本。 */
  async function getSystemTemplate(input: { templateId?: string; versionId?: string }) {
    const config = await loadConfig();
    const api = apiFactory(config);
    if (input.versionId) {
      const version = await api.getSystemTemplateVersion(input.versionId);
      const template = await api.getSystemTemplate(version.item.templateId);
      return { template: template.item, selectedVersion: sanitizeVersionDetail(version.item) };
    }
    const template = await api.getSystemTemplate(input.templateId!);
    const selected = template.item.workingVersion ?? template.item.currentVersion;
    if (!selected)
      throw new McpOperationError('ADMIN_SYSTEM_TEMPLATE_VERSION_NOT_FOUND', '模板没有可读取版本');
    const version = await api.getSystemTemplateVersion(selected.templateVersionId);
    return { template: template.item, selectedVersion: sanitizeVersionDetail(version.item) };
  }

  /** 执行创建、素材上传和进入 testing 的完整单候选闭环。 */
  async function createCandidate(input: CreateCandidateInput): Promise<CandidateOperationResult> {
    let executionId: string | null = null;
    let paths: ReportPaths | null = null;
    let report: CandidateExecutionReport | null = null;
    let step: CandidateExecutionStep = 'initialized';
    let activeAssetIndex = -1;
    try {
      // 所有本地配置、清单和文件必须在创建执行目录及远程写入前通过。
      const config = await loadConfig();
      const assets = await prepareAssets(config, input.template, input.assets);
      executionId = input.executionId ?? createId();
      paths = await initializeExecutionDirectory(config.outputRoot, executionId);
      report = createInitialReport(executionId, config, input, assets, now());
      await persistReport(report, paths, now);

      const api = apiFactory(config);
      step = 'admin_context';
      const context = await readAdminContext(api);
      if (
        !context.categories.some(
          (item) => item.categoryId === input.template.categoryId && item.isActive,
        )
      ) {
        throw new McpOperationError(
          'ADMIN_TEMPLATE_CATEGORY_UNAVAILABLE',
          '指定模板分类不存在或已停用',
        );
      }
      if (!context.models.some((item) => item.modelId === input.template.generationModelId)) {
        throw new McpOperationError('GENERATION_MODEL_UNAVAILABLE', '指定模型不可用于管理员模板');
      }
      report.completedStep = step;
      await persistReport(report, paths, now);

      step = 'template_created';
      const created = await api.createSystemTemplate(input.template);
      const working = created.item.workingVersion;
      if (!working)
        throw new McpOperationError('ADMIN_API_INVALID_RESPONSE', '创建结果缺少工作版本', true);
      report.candidate.templateId = created.item.templateId;
      report.candidate.versionId = working.templateVersionId;
      report.candidate.version = working.version;
      report.candidate.revision = working.revision;
      report.candidate.serverStatus = working.status;
      report.completedStep = step;
      await persistReport(report, paths, now);

      for (const [index, asset] of assets.entries()) {
        activeAssetIndex = index;
        const reportAsset = report.assets[index]!;
        const clientRequestId = createId();
        step = 'asset_ticket';
        const ticket = await api.issueAssetUpload(working.templateVersionId, {
          clientRequestId,
          expectedRevision: report.candidate.revision!,
          kind: asset.request.kind,
          ...(asset.request.inputKey ? { inputKey: asset.request.inputKey } : {}),
          order: asset.request.order,
          contentType: asset.file.contentType,
          sizeBytes: asset.file.sizeBytes,
        });

        step = 'asset_upload';
        await uploader.upload(ticket, asset.file.bytes, asset.file.contentType);
        reportAsset.status = 'uploaded';

        step = 'asset_complete';
        const completed = await api.completeAssetUpload(
          working.templateVersionId,
          ticket.uploadId,
          clientRequestId,
        );
        reportAsset.status = 'registered';
        report.candidate.revision = completed.item.revision;
        report.completedStep = step;
        await persistReport(report, paths, now);
      }

      activeAssetIndex = -1;
      step = 'enter_testing';
      const testing = await api.enterTesting(working.templateVersionId, report.candidate.revision!);
      report.candidate.revision = testing.item.revision;
      report.candidate.serverStatus = testing.item.status;
      report.completedStep = step;
      await persistReport(report, paths, now);

      step = 'final_read';
      const [latestTemplate, latestVersion] = await Promise.all([
        api.getSystemTemplate(created.item.templateId),
        api.getSystemTemplateVersion(working.templateVersionId),
      ]);
      if (
        latestVersion.item.templateId !== created.item.templateId ||
        latestVersion.item.templateVersionId !== working.templateVersionId ||
        !matchesCreatedCandidate(input, latestVersion.item, testing.item.revision) ||
        latestTemplate.item.workingVersion?.templateVersionId !== working.templateVersionId
      ) {
        throw new McpOperationError(
          'ADMIN_SYSTEM_TEMPLATE_STATE_MISMATCH',
          '服务端最终状态与预期不一致',
          true,
        );
      }
      report.candidate.revision = latestVersion.item.revision;
      report.candidate.serverStatus = latestVersion.item.status;
      report.completedStep = step;
      report.status = 'completed';
      report.finishedAt = now().toISOString();
      await persistReport(report, paths, now);
      return {
        ok: true,
        executionId,
        status: 'completed',
        templateId: report.candidate.templateId,
        versionId: report.candidate.versionId,
        revision: report.candidate.revision,
        serverStatus: report.candidate.serverStatus,
        completedStep: report.completedStep,
        stoppedStep: null,
        reportPersisted: true,
        reportPaths: paths,
        error: null,
      };
    } catch (unknownError) {
      const error = toSafeError(unknownError);
      if (report && activeAssetIndex >= 0) {
        report.assets[activeAssetIndex]!.status = error.uncertain ? 'uncertain' : 'failed';
        report.assets[activeAssetIndex]!.errorCode = error.code;
      }
      const reportPersisted =
        report && paths
          ? error.code === 'MCP_REPORT_WRITE_FAILED'
            ? false
            : await finishWithFailure(report, paths, step, error, now)
          : false;
      return {
        ok: false,
        executionId,
        status: report?.candidate.templateId ? 'partial' : 'failed',
        templateId: report?.candidate.templateId ?? null,
        versionId: report?.candidate.versionId ?? null,
        revision: report?.candidate.revision ?? null,
        serverStatus: report?.candidate.serverStatus ?? null,
        completedStep: report?.completedStep ?? null,
        stoppedStep: report ? step : null,
        reportPersisted,
        reportPaths: paths,
        error: { code: error.code, message: error.message, uncertain: error.uncertain },
      };
    }
  }

  /** 每次调用重新读取输出根目录并返回安全执行摘要。 */
  async function getReport(executionId: string) {
    const config = await loadConfig();
    return readAnyExecutionReport(config.outputRoot, executionId);
  }

  return { getAdminContext, getSystemTemplate, createCandidate, getReport };
}
