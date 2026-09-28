/**
 * 平台管理员维护系统模板版本素材时共用的 HTTP 契约。
 *
 * 浏览器先用上传票据把单张图片直传 COS，再通知 API 完成真实文件复核和数据库登记；普通
 * 素材响应只包含短期缩略图和安全元数据，只有上传票据临时暴露 staging 对象位置与凭据。
 */

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const isoDateTimePattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$';
const httpsUrlPattern = '^https://';
const inputKeyPattern = '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$';

export const adminSystemTemplateAssetMaxOriginalBytes = 20 * 1024 * 1024;
export const adminSystemTemplateAssetCredentialDurationSeconds = 1_800;
export const adminSystemTemplateAssetPreviewDurationSeconds = 3_600;

export type AdminSystemTemplateAssetKind = 'effect' | 'slot_example' | 'preset';
export type AdminSystemTemplateAssetContentType = 'image/jpeg' | 'image/png' | 'image/webp';

/** 管理员素材页展示的一张版本素材，不包含任何 COS 对象 Key。 */
export interface AdminSystemTemplateAssetResponse {
  assetId: string;
  kind: AdminSystemTemplateAssetKind;
  inputKey: string | null;
  order: number;
  originalContentType: AdminSystemTemplateAssetContentType;
  originalSizeBytes: number;
  originalWidth: number;
  originalHeight: number;
  thumbnailUrl: string;
  thumbnailExpiresAt: string;
  originalUrl: string;
  originalExpiresAt: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
}

/** 一个图片栏的示例与有序预设集合。 */
export interface AdminSystemTemplateSlotAssetCatalogResponse {
  inputKey: string;
  exampleAsset: AdminSystemTemplateAssetResponse | null;
  presetAssets: AdminSystemTemplateAssetResponse[];
}

/** 版本详情中的安全素材目录。 */
export interface AdminSystemTemplateAssetCatalogResponse {
  effectAsset: AdminSystemTemplateAssetResponse | null;
  inputs: AdminSystemTemplateSlotAssetCatalogResponse[];
}

/** 创建一次单对象 staging 上传意图。 */
export interface AdminSystemTemplateAssetUploadRequest {
  clientRequestId: string;
  expectedRevision: number;
  kind: AdminSystemTemplateAssetKind;
  inputKey?: string;
  order: number;
  replaceAssetId?: string;
  contentType: AdminSystemTemplateAssetContentType;
  sizeBytes: number;
}

/** 浏览器直传所需的唯一临时票据；对象 Key 只允许出现在这个响应中。 */
export interface AdminSystemTemplateAssetUploadResponse {
  uploadId: string;
  clientRequestId: string;
  templateVersionId: string;
  expiresAt: string;
  storage: {
    provider: 'tencent_cos';
    bucket: string;
    region: string;
    objectKey: string;
  };
  credentials: {
    temporarySecretId: string;
    temporarySecretKey: string;
    sessionToken: string;
    startTime: number;
    expiredTime: number;
  };
}

/** 完成请求必须回传原客户端幂等键，阻止票据被其他动作误用。 */
export interface AdminSystemTemplateAssetUploadCompleteRequest {
  clientRequestId: string;
}

/** 删除素材只提交页面读取到的版本 revision。 */
export interface AdminSystemTemplateAssetDeleteRequest {
  expectedRevision: number;
}

/** 预设排序按一个栏位提交完整素材 ID 列表。 */
export interface AdminSystemTemplateAssetOrderRequest {
  expectedRevision: number;
  inputKey: string;
  assetIds: string[];
}

/** 素材写动作返回最新 revision 和完整安全目录。 */
export interface AdminSystemTemplateAssetWriteResponse {
  item: {
    templateVersionId: string;
    revision: number;
    assets: AdminSystemTemplateAssetCatalogResponse;
  };
}

const adminSystemTemplateAssetSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'assetId',
    'kind',
    'inputKey',
    'order',
    'originalContentType',
    'originalSizeBytes',
    'originalWidth',
    'originalHeight',
    'thumbnailUrl',
    'thumbnailExpiresAt',
    'originalUrl',
    'originalExpiresAt',
    'thumbnailWidth',
    'thumbnailHeight',
  ],
  properties: {
    assetId: { type: 'string', pattern: uuidPattern },
    kind: { enum: ['effect', 'slot_example', 'preset'] },
    inputKey: { anyOf: [{ type: 'string', pattern: inputKeyPattern }, { type: 'null' }] },
    order: { type: 'integer', minimum: 1, maximum: 20 },
    originalContentType: { enum: ['image/jpeg', 'image/png', 'image/webp'] },
    originalSizeBytes: {
      type: 'integer',
      minimum: 1,
      maximum: adminSystemTemplateAssetMaxOriginalBytes,
    },
    originalWidth: { type: 'integer', minimum: 1 },
    originalHeight: { type: 'integer', minimum: 1 },
    thumbnailUrl: { type: 'string', pattern: httpsUrlPattern, maxLength: 4096 },
    thumbnailExpiresAt: { type: 'string', pattern: isoDateTimePattern },
    originalUrl: { type: 'string', pattern: httpsUrlPattern, maxLength: 4096 },
    originalExpiresAt: { type: 'string', pattern: isoDateTimePattern },
    thumbnailWidth: { type: 'integer', minimum: 1 },
    thumbnailHeight: { type: 'integer', minimum: 1 },
  },
} as const;

const nullableAssetSchema = { anyOf: [adminSystemTemplateAssetSchema, { type: 'null' }] } as const;

/** 版本详情和素材写响应共用的安全素材目录 Schema。 */
export const adminSystemTemplateAssetCatalogSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['effectAsset', 'inputs'],
  properties: {
    effectAsset: nullableAssetSchema,
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inputKey', 'exampleAsset', 'presetAssets'],
        properties: {
          inputKey: { type: 'string', pattern: inputKeyPattern },
          exampleAsset: nullableAssetSchema,
          presetAssets: {
            type: 'array',
            maxItems: 20,
            items: adminSystemTemplateAssetSchema,
          },
        },
      },
    },
  },
} as const;

/** 创建上传意图时严格拒绝服务端状态、栏位 ID 和对象 Key。 */
export const adminSystemTemplateAssetUploadRequestSchema = {
  $id: 'AdminSystemTemplateAssetUploadRequest',
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId', 'expectedRevision', 'kind', 'order', 'contentType', 'sizeBytes'],
  properties: {
    clientRequestId: { type: 'string', pattern: uuidPattern },
    expectedRevision: { type: 'integer', minimum: 1 },
    kind: { enum: ['effect', 'slot_example', 'preset'] },
    inputKey: { type: 'string', pattern: inputKeyPattern },
    order: { type: 'integer', minimum: 1, maximum: 20 },
    replaceAssetId: { type: 'string', pattern: uuidPattern },
    contentType: { enum: ['image/jpeg', 'image/png', 'image/webp'] },
    sizeBytes: {
      type: 'integer',
      minimum: 1,
      maximum: adminSystemTemplateAssetMaxOriginalBytes,
    },
  },
  allOf: [
    {
      if: { properties: { kind: { const: 'effect' } }, required: ['kind'] },
      then: { properties: { order: { const: 1 } }, not: { required: ['inputKey'] } },
      else: { required: ['inputKey'] },
    },
    {
      if: { properties: { kind: { const: 'slot_example' } }, required: ['kind'] },
      then: { properties: { order: { const: 1 } } },
    },
  ],
} as const;

/** 上传票据响应严格限定为单对象临时能力。 */
export const adminSystemTemplateAssetUploadResponseSchema = {
  $id: 'AdminSystemTemplateAssetUploadResponse',
  type: 'object',
  additionalProperties: false,
  required: [
    'uploadId',
    'clientRequestId',
    'templateVersionId',
    'expiresAt',
    'storage',
    'credentials',
  ],
  properties: {
    uploadId: { type: 'string', pattern: uuidPattern },
    clientRequestId: { type: 'string', pattern: uuidPattern },
    templateVersionId: { type: 'string', pattern: uuidPattern },
    expiresAt: { type: 'string', pattern: isoDateTimePattern },
    storage: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'bucket', 'region', 'objectKey'],
      properties: {
        provider: { const: 'tencent_cos' },
        bucket: { type: 'string', minLength: 1 },
        region: { type: 'string', minLength: 1 },
        objectKey: { type: 'string', minLength: 1 },
      },
    },
    credentials: {
      type: 'object',
      additionalProperties: false,
      required: [
        'temporarySecretId',
        'temporarySecretKey',
        'sessionToken',
        'startTime',
        'expiredTime',
      ],
      properties: {
        temporarySecretId: { type: 'string', minLength: 1 },
        temporarySecretKey: { type: 'string', minLength: 1 },
        sessionToken: { type: 'string', minLength: 1 },
        startTime: { type: 'integer', minimum: 0 },
        expiredTime: { type: 'integer', minimum: 1 },
      },
    },
  },
} as const;

/** 完成上传只接受原客户端幂等键。 */
export const adminSystemTemplateAssetUploadCompleteRequestSchema = {
  $id: 'AdminSystemTemplateAssetUploadCompleteRequest',
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId'],
  properties: { clientRequestId: { type: 'string', pattern: uuidPattern } },
} as const;

/** 删除素材请求。 */
export const adminSystemTemplateAssetDeleteRequestSchema = {
  $id: 'AdminSystemTemplateAssetDeleteRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision'],
  properties: { expectedRevision: { type: 'integer', minimum: 1 } },
} as const;

/** 一个栏位的完整预设排序请求。 */
export const adminSystemTemplateAssetOrderRequestSchema = {
  $id: 'AdminSystemTemplateAssetOrderRequest',
  type: 'object',
  additionalProperties: false,
  required: ['expectedRevision', 'inputKey', 'assetIds'],
  properties: {
    expectedRevision: { type: 'integer', minimum: 1 },
    inputKey: { type: 'string', pattern: inputKeyPattern },
    assetIds: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', pattern: uuidPattern },
    },
  },
} as const;

/** 完成、删除和排序共用的最新素材响应。 */
export const adminSystemTemplateAssetWriteResponseSchema = {
  $id: 'AdminSystemTemplateAssetWriteResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'object',
      additionalProperties: false,
      required: ['templateVersionId', 'revision', 'assets'],
      properties: {
        templateVersionId: { type: 'string', pattern: uuidPattern },
        revision: { type: 'integer', minimum: 1 },
        assets: adminSystemTemplateAssetCatalogSchema,
      },
    },
  },
} as const;

/** 完成上传路径同时绑定版本和上传意图。 */
export const adminSystemTemplateAssetUploadPathParamsSchema = {
  $id: 'AdminSystemTemplateAssetUploadPathParams',
  type: 'object',
  additionalProperties: false,
  required: ['versionId', 'uploadId'],
  properties: {
    versionId: { type: 'string', pattern: uuidPattern },
    uploadId: { type: 'string', pattern: uuidPattern },
  },
} as const;

/** 删除素材路径同时绑定版本和素材。 */
export const adminSystemTemplateAssetPathParamsSchema = {
  $id: 'AdminSystemTemplateAssetPathParams',
  type: 'object',
  additionalProperties: false,
  required: ['versionId', 'assetId'],
  properties: {
    versionId: { type: 'string', pattern: uuidPattern },
    assetId: { type: 'string', pattern: uuidPattern },
  },
} as const;
