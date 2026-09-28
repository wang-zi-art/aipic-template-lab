/**
 * 现有管理员 HTTP 接口的 MCP 客户端。
 *
 * 客户端只请求固定路径、拒绝重定向并用共享 Schema 校验响应；任何底层响应正文都不会进入错误消息。
 */
import { Ajv, type ValidateFunction } from 'ajv';
import {
  adminSystemTemplateAssetUploadResponseSchema,
  adminSystemTemplateAssetWriteResponseSchema,
  adminSystemTemplateDetailResponseSchema,
  adminSystemTemplateDeleteResponseSchema,
  adminSystemTemplateVersionDetailResponseSchema,
  adminSystemTemplateVersionStateResponseSchema,
  adminTemplateCategoryListResponseSchema,
  generationTaskCreateResponseSchema,
  generationTaskQueryResponseSchema,
  generationModelListSchema,
  imageUploadCredentialResponseSchema,
  platformAdminMeResponseSchema,
  templateTrialDetailResponseSchema,
  type AdminSystemTemplateAssetUploadRequest,
  type AdminSystemTemplateAssetUploadResponse,
  type AdminSystemTemplateAssetWriteResponse,
  type AdminSystemTemplateCreateRequest,
  type AdminSystemTemplateDetailResponse,
  type AdminSystemTemplateDeleteResponse,
  type AdminSystemTemplateVersionDetailResponse,
  type AdminSystemTemplateVersionStateResponse,
  type AdminSystemTemplateVersionUpdateRequest,
  type AdminTemplateCategoryListResponse,
  type GenerationModelRecord,
  type GenerationTaskCreateRequest,
  type GenerationTaskCreateResponse,
  type GenerationTaskQueryResponse,
  type ImageUploadCredentialRequest,
  type ImageUploadCredentialResponse,
  type PlatformAdminMeResponse,
  type TemplateTrialDetailResponse,
} from '@aipic/contracts';
import type { McpRuntimeConfig } from './config.js';
import { McpOperationError } from './errors.js';

const ajv = new Ajv({ allErrors: true });
const validators = {
  admin: ajv.compile(platformAdminMeResponseSchema),
  categories: ajv.compile(adminTemplateCategoryListResponseSchema),
  models: ajv.compile(generationModelListSchema),
  template: ajv.compile(adminSystemTemplateDetailResponseSchema),
  version: ajv.compile(adminSystemTemplateVersionDetailResponseSchema),
  assetTicket: ajv.compile(adminSystemTemplateAssetUploadResponseSchema),
  assetWrite: ajv.compile(adminSystemTemplateAssetWriteResponseSchema),
  versionState: ajv.compile(adminSystemTemplateVersionStateResponseSchema),
  templateDelete: ajv.compile(adminSystemTemplateDeleteResponseSchema),
  trial: ajv.compile(templateTrialDetailResponseSchema),
  inputTicket: ajv.compile(imageUploadCredentialResponseSchema),
  taskCreate: ajv.compile(generationTaskCreateResponseSchema),
  taskQuery: ajv.compile(generationTaskQueryResponseSchema),
};

export interface GenerationModelListResponse {
  items: GenerationModelRecord[];
}

export interface AdminApiClient {
  getCurrentAdmin(): Promise<PlatformAdminMeResponse>;
  listTemplateCategories(): Promise<AdminTemplateCategoryListResponse>;
  listGenerationModels(): Promise<GenerationModelListResponse>;
  getSystemTemplate(templateId: string): Promise<AdminSystemTemplateDetailResponse>;
  getSystemTemplateVersion(versionId: string): Promise<AdminSystemTemplateVersionDetailResponse>;
  createSystemTemplate(
    input: AdminSystemTemplateCreateRequest,
  ): Promise<AdminSystemTemplateDetailResponse>;
  issueAssetUpload(
    versionId: string,
    input: AdminSystemTemplateAssetUploadRequest,
  ): Promise<AdminSystemTemplateAssetUploadResponse>;
  completeAssetUpload(
    versionId: string,
    uploadId: string,
    clientRequestId: string,
  ): Promise<AdminSystemTemplateAssetWriteResponse>;
  enterTesting(
    versionId: string,
    expectedRevision: number,
  ): Promise<AdminSystemTemplateVersionStateResponse>;
  returnToDraft(
    versionId: string,
    expectedRevision: number,
  ): Promise<AdminSystemTemplateVersionStateResponse>;
  updateSystemTemplateVersion(
    versionId: string,
    input: AdminSystemTemplateVersionUpdateRequest,
  ): Promise<AdminSystemTemplateVersionDetailResponse>;
  deleteUnpublishedSystemTemplate(
    templateId: string,
    expectedRevision: number,
  ): Promise<{ body: AdminSystemTemplateDeleteResponse; replayed: boolean }>;
  getTemplateTrial(versionId: string): Promise<TemplateTrialDetailResponse>;
  issueImageUpload(input: ImageUploadCredentialRequest): Promise<ImageUploadCredentialResponse>;
  createGenerationTask(input: GenerationTaskCreateRequest): Promise<GenerationTaskCreateResponse>;
  getGenerationTask(taskId: string): Promise<GenerationTaskQueryResponse>;
}

interface SendOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  expectedStatus: number | readonly number[];
  validate: ValidateFunction<T>;
}

/** 从统一错误响应中只读取稳定 code 和安全 message。 */
function readSafeHttpError(status: number, value: unknown): McpOperationError {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const code = typeof item.code === 'string' ? item.code : `HTTP_${status}`;
  const message = typeof item.message === 'string' ? item.message : '管理员接口请求失败';
  return new McpOperationError(code, message, status >= 500, status);
}

/** 创建只允许访问配置目标和固定 API 路径的管理员客户端。 */
export function createAdminApiClient(
  config: McpRuntimeConfig,
  request: typeof fetch = globalThis.fetch,
): AdminApiClient {
  /** 执行单次请求并保留响应头，区分明确业务失败与无法确认的网络或契约失败。 */
  async function sendWithResponse<T>(
    path: string,
    options: SendOptions<T>,
  ): Promise<{ value: T; response: Response }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await request(new URL(path, `${config.apiBaseUrl}/`), {
        method: options.method ?? 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.adminSessionToken}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new McpOperationError('ADMIN_API_UNAVAILABLE', '管理员接口网络连接失败', true);
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new McpOperationError(
        'ADMIN_API_REDIRECT_REJECTED',
        '管理员接口返回了不允许的重定向',
        true,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new McpOperationError('ADMIN_API_INVALID_RESPONSE', '管理员接口返回格式不正确', true);
    }
    if (!response.ok) throw readSafeHttpError(response.status, value);
    const expectedStatuses = Array.isArray(options.expectedStatus)
      ? options.expectedStatus
      : [options.expectedStatus];
    if (!expectedStatuses.includes(response.status) || !options.validate(value)) {
      throw new McpOperationError(
        'ADMIN_API_INVALID_RESPONSE',
        '管理员接口响应不符合共享契约',
        true,
      );
    }
    return { value, response };
  }

  /** 普通调用只读取已经通过 Schema 校验的响应正文。 */
  async function send<T>(path: string, options: SendOptions<T>): Promise<T> {
    return (await sendWithResponse(path, options)).value;
  }

  return {
    /** 复核正式会话、用户状态和 platform_admin 角色。 */
    getCurrentAdmin() {
      return send('/api/v1/admin/me', { expectedStatus: 200, validate: validators.admin });
    },
    /** 读取完整平台分类目录，调用方再显式判断启用状态。 */
    listTemplateCategories() {
      return send('/api/v1/admin/template-categories', {
        expectedStatus: 200,
        validate: validators.categories,
      });
    },
    /** 读取管理员模型目录，工具输出会再剔除供应商字段。 */
    listGenerationModels() {
      return send('/api/v1/admin/generation-models', {
        expectedStatus: 200,
        validate: validators.models,
      });
    },
    /** 读取稳定模板及全部版本摘要。 */
    getSystemTemplate(templateId) {
      return send(`/api/v1/admin/system-templates/${encodeURIComponent(templateId)}`, {
        expectedStatus: 200,
        validate: validators.template,
      });
    },
    /** 读取指定版本的完整管理员表单和安全素材目录。 */
    getSystemTemplateVersion(versionId) {
      return send(`/api/v1/admin/system-template-versions/${encodeURIComponent(versionId)}`, {
        expectedStatus: 200,
        validate: validators.version,
      });
    },
    /** 原子创建稳定系统模板和首个草稿版本。 */
    createSystemTemplate(input) {
      return send('/api/v1/admin/system-templates', {
        method: 'POST',
        body: input,
        expectedStatus: 201,
        validate: validators.template,
      });
    },
    /** 为单个本地素材申请精确对象 Key 的临时上传票据。 */
    issueAssetUpload(versionId, input) {
      return send(
        `/api/v1/admin/system-template-versions/${encodeURIComponent(versionId)}/asset-uploads`,
        {
          method: 'POST',
          body: input,
          expectedStatus: 201,
          validate: validators.assetTicket,
        },
      );
    },
    /** 使用原幂等标识通知 API 复核并登记已经直传的素材。 */
    completeAssetUpload(versionId, uploadId, clientRequestId) {
      return send(
        `/api/v1/admin/system-template-versions/${encodeURIComponent(versionId)}/asset-uploads/${encodeURIComponent(uploadId)}/complete`,
        {
          method: 'POST',
          body: { clientRequestId },
          expectedStatus: 200,
          validate: validators.assetWrite,
        },
      );
    },
    /** 用最新版本 revision 将草稿冻结为 testing。 */
    enterTesting(versionId, expectedRevision) {
      return send(
        `/api/v1/admin/system-template-versions/${encodeURIComponent(versionId)}/testing`,
        {
          method: 'POST',
          body: { expectedRevision },
          expectedStatus: 200,
          validate: validators.versionState,
        },
      );
    },
    /** 将 testing 版本退回 draft；活跃试用由服务端事务阻止。 */
    returnToDraft(versionId, expectedRevision) {
      return send(
        `/api/v1/admin/system-template-versions/${encodeURIComponent(versionId)}/return-to-draft`,
        {
          method: 'POST',
          body: { expectedRevision },
          expectedStatus: 200,
          validate: validators.versionState,
        },
      );
    },
    /** 保存由权威版本详情重建的完整草稿表单。 */
    updateSystemTemplateVersion(versionId, input) {
      return send(`/api/v1/admin/system-template-versions/${encodeURIComponent(versionId)}`, {
        method: 'PUT',
        body: input,
        expectedStatus: 200,
        validate: validators.version,
      });
    },
    /** 软删除单个未发布候选，并读取响应头中的幂等重放标记。 */
    async deleteUnpublishedSystemTemplate(templateId, expectedRevision) {
      const result = await sendWithResponse(
        `/api/v1/admin/system-templates/${encodeURIComponent(templateId)}`,
        {
          method: 'DELETE',
          body: { expectedRevision },
          expectedStatus: 200,
          validate: validators.templateDelete,
        },
      );
      return {
        body: result.value,
        replayed: result.response.headers.get('Idempotent-Replayed') === 'true',
      };
    },
    /** 读取公开安全的测试版本，提交前据此复核栏位、状态和revision。 */
    getTemplateTrial(versionId) {
      return send(`/api/v1/admin/template-trials/${encodeURIComponent(versionId)}`, {
        expectedStatus: 200,
        validate: validators.trial,
      });
    },
    /** 为一张生成输入申请独立的短期COS上传凭据。 */
    issueImageUpload(input) {
      return send('/api/v1/image-uploads/credentials', {
        method: 'POST',
        body: input,
        expectedStatus: 201,
        validate: validators.inputTicket,
      });
    },
    /** 使用已经落盘的幂等标识创建单张管理员试用任务。 */
    createGenerationTask(input) {
      return send('/api/v1/generation-tasks', {
        method: 'POST',
        body: input,
        expectedStatus: [200, 201],
        validate: validators.taskCreate,
      });
    },
    /** 查询当前正式账号拥有的单条生成任务，并取得最新结果签名。 */
    getGenerationTask(taskId) {
      return send(`/api/v1/generation-tasks/${encodeURIComponent(taskId)}`, {
        expectedStatus: 200,
        validate: validators.taskQuery,
      });
    },
  };
}
