/**
 * 生成任务创建与单任务查询接口的共享契约。
 *
 * 小程序提交模板版本、1至4栏输入、比例、分辨率、可选质量与补充描述；查询时只提交任务ID。
 * 服务端会按模板栏位重新排序，用户、积分价格、对象Key、供应商和内部投递状态均不能由前端指定。
 */

import {
  modelRatios,
  modelResolutions,
  modelQualities,
  type ModelRatio,
  type ModelResolution,
  type ModelQuality,
} from './generation-models.js';

export type GenerationAspectRatio = ModelRatio | 'auto';
/** 旧模板兼容列保留原比例，模型模板的实时能力读取model字段。 */
export type LegacyGenerationAspectRatio = '1:1' | '3:4' | '4:3';

/** 用户上传输入只允许携带uploadId，不能同时伪造系统预设。 */
export interface GenerationUserUploadInputRequest {
  slotKey: string;
  sourceType: 'user_upload';
  uploadId: string;
}

/** 系统预设输入只允许携带公开assetId，服务端会复核版本和栏位归属。 */
export interface GenerationSystemPresetInputRequest {
  slotKey: string;
  sourceType: 'system_preset';
  presetAssetId: string;
}

export type GenerationTaskInputRequest =
  GenerationUserUploadInputRequest | GenerationSystemPresetInputRequest;

export interface GenerationTaskCreateRequest {
  /** 仅管理员试用携带；服务端同时复核测试版本和当前权限。 */
  templateTrialRevision?: number;
  clientRequestId: string;
  templateVersionId: string;
  inputs: GenerationTaskInputRequest[];
  aspectRatio: GenerationAspectRatio;
  resolution?: ModelResolution | 'auto';
  quality?: ModelQuality;
  supplementalDescription?: string;
  customPromptOverride?: string;
}

/** 创建接口返回原始 queued 快照；实时状态由后续任务查询接口提供。 */
export interface GenerationTaskCreateResponse {
  taskId: string;
  status: 'queued';
  templateVersionId: string;
  pointsCost: number;
  createdAt: string;
}

/** 查询接口对失败任务返回统一提示，供应商和内部诊断信息只留在服务端。 */
export const generationTaskPublicFailureMessage = '生成失败，积分已退还，请重试' as const;

/** 四种查询状态共享的稳定业务字段。 */
interface GenerationTaskQueryBase {
  templateTrialRevision?: number;
  templateVersion?: number;
  templateName?: string;
  trialInputsArchived?: boolean;
  retryAllowed?: boolean;
  retryReason?: string | null;
  taskId: string;
  templateVersionId: string;
  pointsCost: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 查询响应按状态限制进度、结果和失败字段的组合。
 * 固定返回 null 可以让小程序直接按 status 渲染，不必猜测字段缺失代表什么。
 */
export type GenerationTaskQueryResponse =
  | (GenerationTaskQueryBase & {
      status: 'queued';
      progress: 0;
      result: null;
      failure: null;
    })
  | (GenerationTaskQueryBase & {
      status: 'processing';
      progress: number | null;
      result: null;
      failure: null;
    })
  | (GenerationTaskQueryBase & {
      status: 'succeeded';
      progress: 100;
      result: {
        url: string;
        expiresAt: string;
        width: number;
        height: number;
        availableUntil: string;
      };
      failure: null;
    })
  | (GenerationTaskQueryBase & {
      status: 'failed';
      progress: null;
      result: null;
      failure: {
        code: 'GENERATION_FAILED';
        message: typeof generationTaskPublicFailureMessage;
      };
    });

const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

/** 路径参数只接受规范 UUID，避免无效 ID 进入数据库查询。 */
export const generationTaskQueryParamsSchema = {
  $id: 'GenerationTaskQueryParams',
  type: 'object',
  additionalProperties: false,
  required: ['taskId'],
  properties: {
    taskId: {
      type: 'string',
      pattern: uuidPattern,
    },
  },
} as const;

export type GenerationTaskHistoryCategory = 'completed' | 'in_progress' | 'failed';

/** 列表图片始终是短期签名地址，原始COS对象Key不会进入客户端。 */
export interface GenerationTaskHistoryImage {
  url: string;
  expiresAt: string;
  width: number | null;
  height: number | null;
}

/** 三个Tab共用的任务说明字段，模板名称取自任务绑定的历史版本。 */
interface GenerationTaskHistoryBase {
  taskId: string;
  templateVersionId: string;
  templateTrialRevision?: number;
  templateVersion?: number;
  templateName: string;
  pointsCost: number;
  createdAt: string;
}

/** 任务历史列表使用分类判别联合，页面不需要猜测图片和退款字段是否存在。 */
export type GenerationTaskHistoryItem =
  | (GenerationTaskHistoryBase & {
      category: 'completed';
      status: 'succeeded';
      completedAt: string;
      image: GenerationTaskHistoryImage;
      availableUntil: string;
    })
  | (GenerationTaskHistoryBase & {
      category: 'in_progress';
      status: 'queued' | 'processing';
      progress: number | null;
      preview: GenerationTaskHistoryImage;
    })
  | (GenerationTaskHistoryBase & {
      category: 'failed';
      status: 'failed';
      failedAt: string;
      refundedPoints: number;
      preview: GenerationTaskHistoryImage;
      retryDeadline: string | null;
    });

export interface GenerationTaskHistoryResponse {
  items: GenerationTaskHistoryItem[];
  nextCursor: string | null;
}

export interface GenerationTaskRetryRequest {
  clientRequestId: string;
}

/** 列表查询只接受固定分类和服务端生成的不透明游标；失败分类固定有界返回，不接受游标。 */
export const generationTaskHistoryQuerySchema = {
  $id: 'GenerationTaskHistoryQuery',
  type: 'object',
  additionalProperties: false,
  required: ['category'],
  properties: {
    category: { enum: ['completed', 'in_progress', 'failed'] },
    cursor: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' },
  },
  allOf: [
    {
      if: {
        required: ['category'],
        properties: { category: { const: 'failed' } },
      },
      then: { not: { required: ['cursor'] } },
    },
  ],
} as const;

const historyImageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['url', 'expiresAt', 'width', 'height'],
  properties: {
    url: { type: 'string', minLength: 1 },
    expiresAt: { type: 'string', minLength: 1 },
    width: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    height: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
  },
} as const;

const historyBaseProperties = {
  taskId: { type: 'string', pattern: uuidPattern },
  templateVersionId: { type: 'string', pattern: uuidPattern },
  templateName: { type: 'string', minLength: 1 },
  templateTrialRevision: { type: 'integer', minimum: 1 },
  templateVersion: { type: 'integer', minimum: 1 },
  pointsCost: { type: 'integer', minimum: 1 },
  createdAt: { type: 'string', minLength: 1 },
} as const;

const historyBaseRequired = [
  'taskId',
  'category',
  'status',
  'templateVersionId',
  'templateName',
  'pointsCost',
  'createdAt',
] as const;

/** 历史列表响应锁定三个Tab互斥的数据结构。 */
export const generationTaskHistoryResponseSchema = {
  $id: 'GenerationTaskHistoryResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: [...historyBaseRequired, 'completedAt', 'image', 'availableUntil'],
            properties: {
              ...historyBaseProperties,
              category: { const: 'completed' },
              status: { const: 'succeeded' },
              completedAt: { type: 'string', minLength: 1 },
              image: historyImageSchema,
              availableUntil: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [...historyBaseRequired, 'progress', 'preview'],
            properties: {
              ...historyBaseProperties,
              category: { const: 'in_progress' },
              status: { enum: ['queued', 'processing'] },
              progress: {
                anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }],
              },
              preview: historyImageSchema,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              ...historyBaseRequired,
              'failedAt',
              'refundedPoints',
              'preview',
              'retryDeadline',
            ],
            properties: {
              ...historyBaseProperties,
              category: { const: 'failed' },
              status: { const: 'failed' },
              failedAt: { type: 'string', minLength: 1 },
              refundedPoints: { type: 'integer', minimum: 1 },
              preview: historyImageSchema,
              retryDeadline: {
                anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
              },
            },
          },
        ],
      },
    },
    nextCursor: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
  },
} as const;

/** 重试请求只有新的幂等UUID，其他参数全部从旧任务快照读取。 */
export const generationTaskRetryRequestSchema = {
  $id: 'GenerationTaskRetryRequest',
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId'],
  properties: { clientRequestId: { type: 'string', pattern: uuidPattern } },
} as const;

export const generationTaskCreateRequestSchema = {
  $id: 'GenerationTaskCreateRequest',
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId', 'templateVersionId', 'inputs', 'aspectRatio'],
  properties: {
    templateTrialRevision: { type: 'integer', minimum: 1, maximum: 2147483647 },
    clientRequestId: {
      type: 'string',
      pattern: uuidPattern,
    },
    templateVersionId: {
      type: 'string',
      pattern: uuidPattern,
    },
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['slotKey', 'sourceType', 'uploadId'],
            properties: {
              slotKey: { type: 'string', minLength: 1, maxLength: 50 },
              sourceType: { const: 'user_upload' },
              uploadId: { type: 'string', pattern: uuidPattern },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['slotKey', 'sourceType', 'presetAssetId'],
            properties: {
              slotKey: { type: 'string', minLength: 1, maxLength: 50 },
              sourceType: { const: 'system_preset' },
              presetAssetId: { type: 'string', pattern: uuidPattern },
            },
          },
        ],
      },
    },
    aspectRatio: { enum: ['auto', ...modelRatios] },
    resolution: { enum: ['auto', ...modelResolutions] },
    quality: { enum: modelQualities },
    supplementalDescription: { type: 'string', maxLength: 500 },
    customPromptOverride: { type: 'string', maxLength: 5000 },
  },
} as const;

/** 响应不包含内部投递状态、冻结单或 COS 字段，避免基础设施细节扩散到小程序。 */
export const generationTaskCreateResponseSchema = {
  $id: 'GenerationTaskCreateResponse',
  type: 'object',
  additionalProperties: false,
  required: ['taskId', 'status', 'templateVersionId', 'pointsCost', 'createdAt'],
  properties: {
    taskId: {
      type: 'string',
      pattern: uuidPattern,
    },
    status: {
      const: 'queued',
    },
    templateVersionId: {
      type: 'string',
      pattern: uuidPattern,
    },
    pointsCost: {
      type: 'integer',
      minimum: 1,
    },
    createdAt: {
      type: 'string',
      minLength: 1,
    },
  },
} as const;

const generationTaskQueryBaseRequired = [
  'taskId',
  'status',
  'templateVersionId',
  'pointsCost',
  'progress',
  'result',
  'failure',
  'createdAt',
  'updatedAt',
] as const;

const generationTaskQueryBaseProperties = {
  templateTrialRevision: { type: 'integer', minimum: 1 },
  templateVersion: { type: 'integer', minimum: 1 },
  templateName: { type: 'string' },
  trialInputsArchived: { type: 'boolean' },
  retryAllowed: { type: 'boolean' },
  retryReason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  taskId: {
    type: 'string',
    pattern: uuidPattern,
  },
  templateVersionId: {
    type: 'string',
    pattern: uuidPattern,
  },
  pointsCost: {
    type: 'integer',
    minimum: 1,
  },
  createdAt: {
    type: 'string',
    minLength: 1,
  },
  updatedAt: {
    type: 'string',
    minLength: 1,
  },
} as const;

/** 查询响应 Schema 同时锁定四种状态的数据组合，并阻止任何内部字段穿透。 */
export const generationTaskQueryResponseSchema = {
  $id: 'GenerationTaskQueryResponse',
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: generationTaskQueryBaseRequired,
      properties: {
        ...generationTaskQueryBaseProperties,
        status: { const: 'queued' },
        progress: { const: 0 },
        result: { type: 'null' },
        failure: { type: 'null' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: generationTaskQueryBaseRequired,
      properties: {
        ...generationTaskQueryBaseProperties,
        status: { const: 'processing' },
        progress: {
          anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }],
        },
        result: { type: 'null' },
        failure: { type: 'null' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: generationTaskQueryBaseRequired,
      properties: {
        ...generationTaskQueryBaseProperties,
        status: { const: 'succeeded' },
        progress: { const: 100 },
        result: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'expiresAt', 'width', 'height', 'availableUntil'],
          properties: {
            url: { type: 'string', minLength: 1 },
            expiresAt: { type: 'string', minLength: 1 },
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 },
            availableUntil: { type: 'string', minLength: 1 },
          },
        },
        failure: { type: 'null' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: generationTaskQueryBaseRequired,
      properties: {
        ...generationTaskQueryBaseProperties,
        status: { const: 'failed' },
        progress: { type: 'null' },
        result: { type: 'null' },
        failure: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message'],
          properties: {
            code: { const: 'GENERATION_FAILED' },
            message: { const: generationTaskPublicFailureMessage },
          },
        },
      },
    },
  ],
} as const;
