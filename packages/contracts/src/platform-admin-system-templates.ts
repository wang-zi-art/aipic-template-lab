/**
 * 平台管理员维护系统模板稳定记录、工作版本、线上顺序与停用状态时共用的 HTTP 契约。
 *
 * 管理后台把完整两步表单交给管理员路由；路由按这些严格 Schema 校验后调用模板目录应用
 * 服务。响应只返回运营编辑需要的版本内容、目录位置、停用影响和安全配置展示信息，不包含
 * 供应商、原始模型、输出规格、收藏用户身份、内部业务 Key、COS 对象 Key或签名地址。
 */
import {
  adminSystemTemplateAssetCatalogSchema,
  type AdminSystemTemplateAssetCatalogResponse,
} from './platform-admin-system-template-assets.js';

import {
  templateModelSchema,
  modelRatios,
  type ModelRatio,
  type TemplateModel,
} from './generation-models.js';

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const isoDateTimePattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$';
const inputKeyPattern = '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$';
const versionStatuses = ['draft', 'testing', 'published', 'replaced'] as const;

export type AdminSystemTemplateAspectRatio = '1:1' | '3:4' | '4:3';
export type AdminSystemTemplateVersionStatus = (typeof versionStatuses)[number];

/** 管理列表和版本历史共用的安全版本摘要。 */
export interface AdminSystemTemplateVersionSummaryResponse {
  templateVersionId: string;
  version: number;
  name: string;
  status: AdminSystemTemplateVersionStatus;
  revision: number;
  createdAt: string;
}

/** 管理列表中的稳定模板，分别表达当前发布版本和唯一工作版本。 */
export interface AdminSystemTemplateSummaryResponse {
  templateId: string;
  sortOrder: number;
  revision: number;
  availabilityStatus: 'active' | 'disabled';
  disabledAt: string | null;
  disabledBy: AdminSystemTemplateActorResponse | null;
  currentVersion: AdminSystemTemplateVersionSummaryResponse | null;
  workingVersion: AdminSystemTemplateVersionSummaryResponse | null;
  createdAt: string;
  updatedAt: string;
}

/** 系统模板管理列表不接收筛选或分页参数。 */
export type AdminSystemTemplateListQuery = Record<string, never>;

/** 系统模板管理列表返回全部稳定系统模板。 */
export interface AdminSystemTemplateListResponse {
  items: AdminSystemTemplateSummaryResponse[];
}

/** 稳定模板详情在列表字段之外返回倒序版本历史。 */
export interface AdminSystemTemplateDetailResponse {
  item: AdminSystemTemplateSummaryResponse & {
    versions: AdminSystemTemplateVersionSummaryResponse[];
  };
}

/** 线上目录排序只返回当前 active + published 系统模板需要的最小安全字段。 */
export interface AdminSystemTemplateDirectoryItemResponse {
  templateId: string;
  name: string;
  version: number;
  revision: number;
  sortOrder: number;
}

/** GET 与 PUT 目录接口共用同一最新顺序响应。 */
export interface AdminSystemTemplateDirectoryResponse {
  items: AdminSystemTemplateDirectoryItemResponse[];
}

/** 完整排序数组中的每项携带页面读取到的稳定模板 revision。 */
export interface AdminSystemTemplateDirectoryOrderRequest {
  items: Array<{ templateId: string; expectedRevision: number }>;
}

/** 停用前影响查询不返回收藏用户身份，只返回总数和已有停用状态。 */
export interface AdminSystemTemplateDisableImpactResponse {
  item: {
    templateId: string;
    availabilityStatus: 'active' | 'disabled';
    favoriteCount: number;
    disabledAt: string | null;
    disabledBy: AdminSystemTemplateActorResponse | null;
  };
}

/** 停用不比较旧页面 revision，严格空对象只承担显式 POST 边界。 */
export type AdminSystemTemplateDisableRequest = Record<string, never>;

/** 停用与幂等重放返回相同的最新稳定状态。 */
export interface AdminSystemTemplateDisableResponse {
  item: {
    templateId: string;
    revision: number;
    availabilityStatus: 'disabled';
    disabledAt: string;
    disabledBy: AdminSystemTemplateActorResponse;
  };
}

/** 软删除未发布候选时必须提交稳定模板 revision，防止旧页面误删新状态。 */
export interface AdminSystemTemplateDeleteRequest {
  expectedRevision: number;
}

/** 首次删除和幂等重放都返回同一删除时间，不暴露保留的内部数据。 */
export interface AdminSystemTemplateDeleteResponse {
  item: {
    templateId: string;
    status: 'deleted';
    deletedAt: string;
  };
}

/** 系统模板与版本路径分别只接受服务端 UUID。 */
export interface AdminSystemTemplatePathParams {
  templateId: string;
}

/** 系统版本详情路径不接受稳定模板 ID 或版本号替代版本 UUID。 */
export interface AdminSystemTemplateVersionPathParams {
  versionId: string;
}

/** 完整管理员表单中的一个必需图片栏。 */
export interface AdminSystemTemplateInputRequest {
  key: string;
  order: number;
  label: string;
  required: true;
  uploadRequirement: string;
  modelRole: string;
}

/** 新建系统模板必须一次提交的完整表单。 */
export interface AdminSystemTemplateCreateRequest {
  generationModelId: string;
  name: string;
  description: string;
  categoryId: string;
  inputs: AdminSystemTemplateInputRequest[];
  allowsSupplementalDescription: boolean;
  supplementalDescriptionRecommendation?: string;
  executionPrompt: string;
}

/** 创建下一工作版本只提交稳定模板 revision，内容由当前发布版本复制。 */
export interface AdminSystemTemplateVersionCreateRequest {
  expectedRevision: number;
}

/** 更新草稿提交完整表单和页面读取到的版本 revision。 */
export interface AdminSystemTemplateVersionUpdateRequest extends AdminSystemTemplateCreateRequest {
  expectedRevision: number;
}

/** 版本状态动作只接受页面读取到的版本revision，不接收状态或操作者。 */
export interface AdminSystemTemplateVersionActionRequest {
  expectedRevision: number;
}

/** 管理员版本详情中的实时分类安全投影与保存时名称快照。 */
export interface AdminSystemTemplateVersionCategoryResponse {
  categoryId: string;
  key: string;
  nameSnapshot: string;
  isActive: boolean;
}

/** 测试确认与发布记录中的最小管理员身份，不包含手机号或会话信息。 */
export interface AdminSystemTemplateActorResponse {
  id: string;
  displayName: string;
}

/** 测试确认始终绑定确认时的版本revision。 */
export interface AdminSystemTemplateTestConfirmationResponse {
  confirmedRevision: number;
  confirmedAt: string;
  confirmedBy: AdminSystemTemplateActorResponse;
}

/** 历史发布记录允许没有可追溯操作者，新发布记录必须写入当前管理员。 */
export interface AdminSystemTemplatePublicationResponse {
  publishedAt: string;
  publishedBy: AdminSystemTemplateActorResponse | null;
}

/** 四个状态动作返回不依赖COS预览签名的最小最新状态。 */
export interface AdminSystemTemplateVersionStateResponse {
  item: {
    templateId: string;
    templateRevision: number;
    templateVersionId: string;
    version: number;
    status: AdminSystemTemplateVersionStatus;
    revision: number;
    testConfirmation: AdminSystemTemplateTestConfirmationResponse | null;
    publication: AdminSystemTemplatePublicationResponse | null;
  };
}

/** 管理员可编辑或只读查看的完整版本，素材只使用安全短期预览字段。 */
export interface AdminSystemTemplateVersionDetailResponse {
  item: {
    templateId: string;
    templateRevision: number;
    templateVersionId: string;
    version: number;
    status: AdminSystemTemplateVersionStatus;
    revision: number;
    name: string;
    description: string;
    category: AdminSystemTemplateVersionCategoryResponse;
    mode: 'single_image' | 'multi_image';
    pointsCost: number;
    inputs: AdminSystemTemplateInputRequest[];
    defaultAspectRatio: ModelRatio | 'auto';
    allowedAspectRatios: Array<ModelRatio | 'auto'>;
    allowsSupplementalDescription: boolean;
    supplementalDescriptionRecommendation: string | null;
    executionPrompt: string;
    model?: TemplateModel | null;
    testConfirmation: AdminSystemTemplateTestConfirmationResponse | null;
    publication: AdminSystemTemplatePublicationResponse | null;
    assets: AdminSystemTemplateAssetCatalogResponse;
    createdAt: string;
  };
}

const aspectRatioArraySchema = {
  type: 'array',
  minItems: 1,
  maxItems: modelRatios.length + 1,
  uniqueItems: true,
  items: { enum: ['auto', ...modelRatios] },
} as const;

const adminSystemTemplateVersionSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateVersionId', 'version', 'name', 'status', 'revision', 'createdAt'],
  properties: {
    templateVersionId: { type: 'string', pattern: uuidPattern },
    version: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    status: { enum: versionStatuses },
    revision: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', pattern: isoDateTimePattern },
  },
} as const;

const nullableVersionSummarySchema = {
  anyOf: [adminSystemTemplateVersionSummarySchema, { type: 'null' }],
} as const;

const adminSystemTemplateActorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'displayName'],
  properties: {
    id: { type: 'string', pattern: uuidPattern },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;

const adminSystemTemplateSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'templateId',
    'sortOrder',
    'revision',
    'availabilityStatus',
    'disabledAt',
    'disabledBy',
    'currentVersion',
    'workingVersion',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    templateId: { type: 'string', pattern: uuidPattern },
    sortOrder: { type: 'integer', minimum: 1 },
    revision: { type: 'integer', minimum: 1 },
    availabilityStatus: { enum: ['active', 'disabled'] },
    disabledAt: {
      anyOf: [{ type: 'string', pattern: isoDateTimePattern }, { type: 'null' }],
    },
    disabledBy: { anyOf: [adminSystemTemplateActorSchema, { type: 'null' }] },
    currentVersion: nullableVersionSummarySchema,
    workingVersion: nullableVersionSummarySchema,
    createdAt: { type: 'string', pattern: isoDateTimePattern },
    updatedAt: { type: 'string', pattern: isoDateTimePattern },
  },
} as const;

const adminSystemTemplateInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'order', 'label', 'required', 'uploadRequirement', 'modelRole'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 50, pattern: inputKeyPattern },
    order: { type: 'integer', minimum: 1, maximum: 4 },
    label: { type: 'string', minLength: 1, maxLength: 100 },
    required: { const: true },
    uploadRequirement: { type: 'string', minLength: 1, maxLength: 500 },
    modelRole: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

const adminSystemTemplateWriteProperties = {
  generationModelId: { type: 'string', pattern: uuidPattern },
  name: { type: 'string', minLength: 1, maxLength: 100 },
  description: { type: 'string', minLength: 1, maxLength: 500 },
  categoryId: { type: 'string', pattern: uuidPattern },
  inputs: {
    type: 'array',
    minItems: 1,
    maxItems: 4,
    items: adminSystemTemplateInputSchema,
  },
  allowsSupplementalDescription: { type: 'boolean' },
  supplementalDescriptionRecommendation: { type: 'string', minLength: 1, maxLength: 500 },
  executionPrompt: { type: 'string', minLength: 1, maxLength: 5000 },
} as const;

const adminSystemTemplateWriteRequired = [
  'generationModelId',
  'name',
  'description',
  'categoryId',
  'inputs',
  'allowsSupplementalDescription',
  'executionPrompt',
] as const;

const adminSystemTemplateCategorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId', 'key', 'nameSnapshot', 'isActive'],
  properties: {
    categoryId: { type: 'string', pattern: uuidPattern },
    key: { type: 'string', minLength: 1, maxLength: 50 },
    nameSnapshot: { type: 'string', minLength: 1, maxLength: 100 },
    isActive: { type: 'boolean' },
  },
} as const;

const adminSystemTemplateTestConfirmationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmedRevision', 'confirmedAt', 'confirmedBy'],
  properties: {
    confirmedRevision: { type: 'integer', minimum: 1 },
    confirmedAt: { type: 'string', pattern: isoDateTimePattern },
    confirmedBy: adminSystemTemplateActorSchema,
  },
} as const;

const adminSystemTemplatePublicationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['publishedAt', 'publishedBy'],
  properties: {
    publishedAt: { type: 'string', pattern: isoDateTimePattern },
    publishedBy: { anyOf: [adminSystemTemplateActorSchema, { type: 'null' }] },
  },
} as const;

const adminSystemTemplateVersionStateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'templateId',
    'templateRevision',
    'templateVersionId',
    'version',
    'status',
    'revision',
    'testConfirmation',
    'publication',
  ],
  properties: {
    templateId: { type: 'string', pattern: uuidPattern },
    templateRevision: { type: 'integer', minimum: 1 },
    templateVersionId: { type: 'string', pattern: uuidPattern },
    version: { type: 'integer', minimum: 1 },
    status: { enum: versionStatuses },
    revision: { type: 'integer', minimum: 1 },
    testConfirmation: {
      anyOf: [adminSystemTemplateTestConfirmationSchema, { type: 'null' }],
    },
    publication: { anyOf: [adminSystemTemplatePublicationSchema, { type: 'null' }] },
  },
} as const;

const adminSystemTemplateVersionDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'templateId',
    'templateRevision',
    'templateVersionId',
    'version',
    'status',
    'revision',
    'name',
    'description',
    'category',
    'mode',
    'pointsCost',
    'inputs',
    'defaultAspectRatio',
    'allowedAspectRatios',
    'allowsSupplementalDescription',
    'supplementalDescriptionRecommendation',
    'executionPrompt',
    'testConfirmation',
    'publication',
    'assets',
    'createdAt',
  ],
  properties: {
    templateId: { type: 'string', pattern: uuidPattern },
    templateRevision: { type: 'integer', minimum: 1 },
    templateVersionId: { type: 'string', pattern: uuidPattern },
    version: { type: 'integer', minimum: 1 },
    status: { enum: versionStatuses },
    revision: { type: 'integer', minimum: 1 },
    name: adminSystemTemplateWriteProperties.name,
    description: adminSystemTemplateWriteProperties.description,
    category: adminSystemTemplateCategorySchema,
    mode: { enum: ['single_image', 'multi_image'] },
    pointsCost: { type: 'integer', minimum: 1 },
    inputs: adminSystemTemplateWriteProperties.inputs,
    defaultAspectRatio: { enum: ['auto', ...modelRatios] },
    allowedAspectRatios: aspectRatioArraySchema,
    allowsSupplementalDescription: adminSystemTemplateWriteProperties.allowsSupplementalDescription,
    supplementalDescriptionRecommendation: {
      anyOf: [
        adminSystemTemplateWriteProperties.supplementalDescriptionRecommendation,
        { type: 'null' },
      ],
    },
    executionPrompt: adminSystemTemplateWriteProperties.executionPrompt,
    model: { anyOf: [templateModelSchema, { type: 'null' }] },
    testConfirmation: {
      anyOf: [adminSystemTemplateTestConfirmationSchema, { type: 'null' }],
    },
    publication: { anyOf: [adminSystemTemplatePublicationSchema, { type: 'null' }] },
    assets: adminSystemTemplateAssetCatalogSchema,
    createdAt: { type: 'string', pattern: isoDateTimePattern },
  },
} as const;

/** GET 系统模板列表和详情共用空查询，任何未知参数都会被拒绝。 */
export const adminSystemTemplateListQuerySchema = {
  $id: 'AdminSystemTemplateListQuery',
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

/** GET 系统模板管理列表响应。 */
export const adminSystemTemplateListResponseSchema = {
  $id: 'AdminSystemTemplateListResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: adminSystemTemplateSummarySchema } },
} as const;

/** GET 稳定模板详情响应，版本历史按版本号倒序。 */
export const adminSystemTemplateDetailResponseSchema = {
  $id: 'AdminSystemTemplateDetailResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      ...adminSystemTemplateSummarySchema,
      required: [...adminSystemTemplateSummarySchema.required, 'versions'],
      properties: {
        ...adminSystemTemplateSummarySchema.properties,
        versions: { type: 'array', items: adminSystemTemplateVersionSummarySchema },
      },
    },
  },
} as const;

const adminSystemTemplateDirectoryItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateId', 'name', 'version', 'revision', 'sortOrder'],
  properties: {
    templateId: { type: 'string', pattern: uuidPattern },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    version: { type: 'integer', minimum: 1 },
    revision: { type: 'integer', minimum: 1 },
    sortOrder: { type: 'integer', minimum: 1 },
  },
} as const;

/** GET 与 PUT 系统模板线上目录响应。 */
export const adminSystemTemplateDirectoryResponseSchema = {
  $id: 'AdminSystemTemplateDirectoryResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: adminSystemTemplateDirectoryItemSchema } },
} as const;

/** PUT 线上目录完整顺序请求，重复ID由应用服务作为409集合冲突处理。 */
export const adminSystemTemplateDirectoryOrderRequestSchema = {
  $id: 'AdminSystemTemplateDirectoryOrderRequest',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['templateId', 'expectedRevision'],
        properties: {
          templateId: { type: 'string', pattern: uuidPattern },
          expectedRevision: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
} as const;

/** GET 停用影响响应，只公开收藏数量和可信停用管理员展示名。 */
export const adminSystemTemplateDisableImpactResponseSchema = {
  $id: 'AdminSystemTemplateDisableImpactResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: false,
      required: ['templateId', 'availabilityStatus', 'favoriteCount', 'disabledAt', 'disabledBy'],
      properties: {
        templateId: { type: 'string', pattern: uuidPattern },
        availabilityStatus: { enum: ['active', 'disabled'] },
        favoriteCount: { type: 'integer', minimum: 0 },
        disabledAt: {
          anyOf: [{ type: 'string', pattern: isoDateTimePattern }, { type: 'null' }],
        },
        disabledBy: { anyOf: [adminSystemTemplateActorSchema, { type: 'null' }] },
      },
    },
  },
} as const;

/** POST 停用请求严格为空，不接收revision、操作者或客户端影响数。 */
export const adminSystemTemplateDisableRequestSchema = {
  $id: 'AdminSystemTemplateDisableRequest',
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

/** POST 停用响应在首次执行和幂等重放时形状一致。 */
export const adminSystemTemplateDisableResponseSchema = {
  $id: 'AdminSystemTemplateDisableResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: false,
      required: ['templateId', 'revision', 'availabilityStatus', 'disabledAt', 'disabledBy'],
      properties: {
        templateId: { type: 'string', pattern: uuidPattern },
        revision: { type: 'integer', minimum: 1 },
        availabilityStatus: { const: 'disabled' },
        disabledAt: { type: 'string', pattern: isoDateTimePattern },
        disabledBy: adminSystemTemplateActorSchema,
      },
    },
  },
} as const;

/** DELETE 未发布候选只接受稳定模板并发基线。 */
export const adminSystemTemplateDeleteRequestSchema = {
  $id: 'AdminSystemTemplateDeleteRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision'],
  properties: { expectedRevision: { type: 'integer', minimum: 1 } },
} as const;

/** DELETE 首次执行和幂等重放都返回相同的安全删除结果。 */
export const adminSystemTemplateDeleteResponseSchema = {
  $id: 'AdminSystemTemplateDeleteResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: false,
      required: ['templateId', 'status', 'deletedAt'],
      properties: {
        templateId: { type: 'string', pattern: uuidPattern },
        status: { const: 'deleted' },
        deletedAt: { type: 'string', pattern: isoDateTimePattern },
      },
    },
  },
} as const;

/** 系统稳定模板路径参数。 */
export const adminSystemTemplatePathParamsSchema = {
  $id: 'AdminSystemTemplatePathParams',
  type: 'object',
  additionalProperties: false,
  required: ['templateId'],
  properties: { templateId: { type: 'string', pattern: uuidPattern } },
} as const;

/** 系统模板版本路径参数。 */
export const adminSystemTemplateVersionPathParamsSchema = {
  $id: 'AdminSystemTemplateVersionPathParams',
  type: 'object',
  additionalProperties: false,
  required: ['versionId'],
  properties: { versionId: { type: 'string', pattern: uuidPattern } },
} as const;

/** POST 新建系统模板必须一次提交完整表单，不接受服务端控制字段。 */
export const adminSystemTemplateCreateRequestSchema = {
  $id: 'AdminSystemTemplateCreateRequest',
  type: 'object',
  additionalProperties: false,
  required: adminSystemTemplateWriteRequired,
  properties: adminSystemTemplateWriteProperties,
} as const;

/** POST 创建下一版本只接受稳定模板并发基线。 */
export const adminSystemTemplateVersionCreateRequestSchema = {
  $id: 'AdminSystemTemplateVersionCreateRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision'],
  properties: { expectedRevision: { type: 'integer', minimum: 1 } },
} as const;

/** PUT 草稿版本要求完整表单与旧 revision，拒绝版本号、状态和兼容快照。 */
export const adminSystemTemplateVersionUpdateRequestSchema = {
  $id: 'AdminSystemTemplateVersionUpdateRequest',
  type: 'object',
  additionalProperties: false,
  required: [...adminSystemTemplateWriteRequired, 'expectedRevision'],
  properties: {
    ...adminSystemTemplateWriteProperties,
    expectedRevision: { type: 'integer', minimum: 1 },
  },
} as const;

/** 四个版本状态POST动作共用严格revision请求。 */
export const adminSystemTemplateVersionActionRequestSchema = {
  $id: 'AdminSystemTemplateVersionActionRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision'],
  properties: { expectedRevision: { type: 'integer', minimum: 1 } },
} as const;

/** 四个版本状态动作返回不需要访问COS的安全状态。 */
export const adminSystemTemplateVersionStateResponseSchema = {
  $id: 'AdminSystemTemplateVersionStateResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: adminSystemTemplateVersionStateSchema },
} as const;

/** GET、POST 与 PUT 版本详情共用同一安全响应。 */
export const adminSystemTemplateVersionDetailResponseSchema = {
  $id: 'AdminSystemTemplateVersionDetailResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: adminSystemTemplateVersionDetailSchema },
} as const;
