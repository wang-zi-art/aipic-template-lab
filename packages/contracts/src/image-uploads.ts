/**
 * “签发单对象图片上传凭证”接口的共享契约。
 *
 * 前端只声明准备上传的图片类型和大小，用户、文件名、COS 对象 Key 与权限范围全部由
 * 服务端决定。请求与响应 Schema 同时用于 API 运行时校验、OpenAPI 和契约回归测试。
 */

/** 生图输入允许的原始格式；Worker 会在提交供应商前复核并按需转换。 */
export type ImageUploadContentType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' | 'image/svg+xml';

/** 契约、服务端和客户端共用同一组格式，避免各端白名单漂移。 */
export const imageUploadContentTypes: ImageUploadContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/svg+xml',
];

/** 单张输入图最大 20 MiB；实际 COS 对象会在创建生成任务时再次核对。 */
export const imageUploadMaxSizeBytes = 20 * 1024 * 1024;

/** STS 临时凭证固定有效 30 分钟，不允许客户端自行延长。 */
export const imageUploadCredentialDurationSeconds = 1_800;

export interface ImageUploadCredentialRequest {
  contentType: ImageUploadContentType;
  sizeBytes: number;
}

/**
 * 临时密钥名称使用系统统一语义，不直接把腾讯云 SDK 的 tmpSecretId 等命名扩散到业务层。
 * 小程序平台适配器后续负责把这些字段映射为 COS SDK 所需参数。
 */
export interface ImageUploadCredentialResponse {
  uploadId: string;
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

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const imageUploadCredentialRequestSchema = {
  $id: 'ImageUploadCredentialRequest',
  type: 'object',
  additionalProperties: false,
  required: ['contentType', 'sizeBytes'],
  properties: {
    contentType: {
      enum: imageUploadContentTypes,
    },
    sizeBytes: {
      type: 'integer',
      minimum: 1,
      maximum: imageUploadMaxSizeBytes,
    },
  },
} as const;

/** 响应的每一层都禁止额外字段，避免长期密钥或云端原始响应被意外序列化。 */
export const imageUploadCredentialResponseSchema = {
  $id: 'ImageUploadCredentialResponse',
  type: 'object',
  additionalProperties: false,
  required: ['uploadId', 'storage', 'credentials'],
  properties: {
    uploadId: {
      type: 'string',
      pattern: uuidPattern,
    },
    storage: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'bucket', 'region', 'objectKey'],
      properties: {
        provider: {
          const: 'tencent_cos',
        },
        bucket: {
          type: 'string',
          minLength: 1,
        },
        region: {
          type: 'string',
          minLength: 1,
        },
        objectKey: {
          type: 'string',
          minLength: 1,
        },
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
        temporarySecretId: {
          type: 'string',
          minLength: 1,
        },
        temporarySecretKey: {
          type: 'string',
          minLength: 1,
        },
        sessionToken: {
          type: 'string',
          minLength: 1,
        },
        startTime: {
          type: 'integer',
          minimum: 0,
        },
        expiredTime: {
          type: 'integer',
          minimum: 1,
        },
      },
    },
  },
} as const;
