/**
 * 系统模板素材与收藏的公开HTTP契约。
 *
 * 契约只允许展示字段、3600秒HTTPS缩略图和当前用户收藏状态通过；模型作用、提示词、执行
 * 配置、COS对象Key以及云服务原始错误均不得进入响应。
 */

import { templateModelSchema, type TemplateModel } from './generation-models.js';

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const httpsUrlPattern = '^https://';
const isoDateTimePattern = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$';

/** 平台维护的平铺分类；用户端只读取启用项。 */
export interface TemplateCategoryResponse {
  categoryId: string;
  key: string;
  name: string;
  sortOrder: number;
}

/** 分类列表使用容器对象，为后续增加展示配置保留兼容空间。 */
export interface TemplateCategoryListResponse {
  items: TemplateCategoryResponse[];
}

/** 系统模板展示图片使用短期HTTPS地址，assetId用于过期刷新后的稳定合并。 */
export interface SystemTemplateImageResponse {
  assetId: string;
  url: string;
  expiresAt: string;
  width: number;
  height: number;
}

/** 按稳定素材ID换取的十分钟原图访问结果，不携带模板归属或对象存储元数据。 */
export interface TemplateImageOriginalAccessResponse {
  assetId: string;
  url: string;
  expiresAt: string;
  width: number;
  height: number;
}

/** 列表中的栏位只保留公开上传说明。 */
export interface SystemTemplateInputResponse {
  key: string;
  order: number;
  label: string;
  required: boolean;
  uploadRequirement: string;
}

/** 模板是否允许补充描述及只读推荐说明；推荐内容不会被自动提交。 */
export interface TemplateSupplementalDescriptionRuleResponse {
  allowed: boolean;
  recommendation: string | null;
  maxLength: 500;
}

/** 详情栏位增加示例和最多二十张预设缩略图。 */
export interface SystemTemplateDetailInputResponse extends SystemTemplateInputResponse {
  exampleImage: SystemTemplateImageResponse | null;
  presetImages: SystemTemplateImageResponse[];
}

/** 系统和收藏列表共用的卡片摘要。 */
export interface SystemTemplateResponse {
  templateId: string;
  model?: TemplateModel | null;
  templateVersionId: string;
  version: number;
  source: 'system';
  name: string;
  description: string;
  category: TemplateCategoryResponse;
  mode: 'single_image' | 'multi_image';
  status: 'published';
  inputs: SystemTemplateInputResponse[];
  defaultAspectRatio: '1:1' | '3:4' | '4:3';
  allowedAspectRatios: Array<'1:1' | '3:4' | '4:3'>;
  supplementalDescription: TemplateSupplementalDescriptionRuleResponse;
  pointsCost: number;
  isFavorited: boolean;
  coverImage: SystemTemplateImageResponse | null;
}

/** 详情提供完整展示素材，不重复返回卡片封面。 */
export interface SystemTemplateDetailItemResponse extends Omit<
  SystemTemplateResponse,
  'inputs' | 'coverImage'
> {
  effectImage: SystemTemplateImageResponse | null;
  inputs: SystemTemplateDetailInputResponse[];
}

/** 游标分页列表；nextCursor为空表示已经到达末页。 */
export interface SystemTemplateListResponse {
  items: SystemTemplateResponse[];
  nextCursor: string | null;
}

/** 详情继续包在item中，使错误响应与成功响应边界清晰。 */
export interface SystemTemplateDetailResponse {
  item: SystemTemplateDetailItemResponse;
}

/** 自建模板列表栏位不暴露模型作用，详情才向所有者返回私有字段。 */
export type CustomTemplateInputResponse = SystemTemplateInputResponse;

/** 自建详情栏位只比公开上传要求多出所有者可见的模型作用。 */
export interface CustomTemplateDetailInputResponse extends CustomTemplateInputResponse {
  modelRole: string;
}

/** 自建模板列表不携带本机效果图路径，页面按稳定模板ID从微信文件区读取。 */
export interface CustomTemplateResponse {
  templateId: string;
  model?: TemplateModel | null;
  templateVersionId: string;
  version: number;
  source: 'custom';
  name: string;
  description: string;
  category: TemplateCategoryResponse;
  mode: 'single_image' | 'multi_image';
  status: 'published';
  inputs: CustomTemplateInputResponse[];
  defaultAspectRatio: '1:1' | '3:4' | '4:3';
  allowedAspectRatios: Array<'1:1' | '3:4' | '4:3'>;
  supplementalDescription: TemplateSupplementalDescriptionRuleResponse;
  pointsCost: number;
  updatedAt: string;
  coverImage: null;
}

/** 自建详情返回基础提示词和模型作用，但仍排除执行配置与本机文件引用。 */
export interface CustomTemplateDetailItemResponse extends Omit<
  CustomTemplateResponse,
  'inputs' | 'coverImage'
> {
  executionPrompt: string;
  effectImage: null;
  inputs: CustomTemplateDetailInputResponse[];
}

/** 本人自建列表按更新时间游标分页。 */
export interface CustomTemplateListResponse {
  items: CustomTemplateResponse[];
  nextCursor: string | null;
}

/** 统一详情由source判别系统公开字段或本人自建私有字段。 */
export interface TemplateDetailResponse {
  item: SystemTemplateDetailItemResponse | CustomTemplateDetailItemResponse;
}

/** 创建和版本编辑共用同一完整表单；图片效果图只保存在客户端，不属于请求。 */
export interface CustomTemplateWriteRequest {
  generationModelId: string;
  name: string;
  description: string;
  categoryId: string;
  inputs: Array<{
    key: string;
    order: number;
    label: string;
    required: true;
    uploadRequirement: string;
    modelRole: string;
  }>;
  allowsSupplementalDescription: boolean;
  supplementalDescriptionRecommendation?: string;
  executionPrompt: string;
}

/** 创建和编辑成功后直接返回当前所有者详情。 */
export interface CustomTemplateWriteResponse {
  item: CustomTemplateDetailItemResponse;
}

const templateCategorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId', 'key', 'name', 'sortOrder'],
  properties: {
    categoryId: { type: 'string', pattern: uuidPattern },
    key: { type: 'string', minLength: 1, maxLength: 50 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    sortOrder: { type: 'integer' },
  },
} as const;

const systemTemplateImageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assetId', 'url', 'expiresAt', 'width', 'height'],
  properties: {
    assetId: { type: 'string', pattern: uuidPattern },
    url: { type: 'string', pattern: httpsUrlPattern, maxLength: 4096 },
    expiresAt: { type: 'string', pattern: isoDateTimePattern },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
  },
} as const;

const systemTemplateInputProperties = {
  key: { type: 'string', minLength: 1 },
  order: { type: 'integer', minimum: 1 },
  label: { type: 'string', minLength: 1 },
  required: { type: 'boolean' },
  uploadRequirement: { type: 'string', minLength: 1, maxLength: 500 },
} as const;

const systemTemplateInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'order', 'label', 'required', 'uploadRequirement'],
  properties: systemTemplateInputProperties,
} as const;

const supplementalDescriptionRuleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['allowed', 'recommendation', 'maxLength'],
  properties: {
    allowed: { type: 'boolean' },
    recommendation: {
      anyOf: [{ type: 'string', minLength: 1, maxLength: 500 }, { type: 'null' }],
    },
    maxLength: { const: 500 },
  },
} as const;

const systemTemplateDetailInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'key',
    'order',
    'label',
    'required',
    'uploadRequirement',
    'exampleImage',
    'presetImages',
  ],
  properties: {
    ...systemTemplateInputProperties,
    exampleImage: { anyOf: [systemTemplateImageSchema, { type: 'null' }] },
    presetImages: {
      type: 'array',
      maxItems: 20,
      items: systemTemplateImageSchema,
    },
  },
} as const;

const systemTemplateBaseRequired = [
  'templateId',
  'templateVersionId',
  'version',
  'source',
  'name',
  'description',
  'category',
  'mode',
  'status',
  'defaultAspectRatio',
  'allowedAspectRatios',
  'supplementalDescription',
  'pointsCost',
  'isFavorited',
] as const;

const systemTemplateBaseProperties = {
  templateId: { type: 'string', pattern: uuidPattern },
  model: { anyOf: [templateModelSchema, { type: 'null' }] },
  templateVersionId: { type: 'string', pattern: uuidPattern },
  version: { type: 'integer', minimum: 1 },
  source: { const: 'system' },
  name: { type: 'string', minLength: 1, maxLength: 100 },
  description: { type: 'string', minLength: 1, maxLength: 500 },
  category: templateCategorySchema,
  mode: { enum: ['single_image', 'multi_image'] },
  status: { const: 'published' },
  defaultAspectRatio: { enum: ['1:1', '3:4', '4:3'] },
  allowedAspectRatios: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    maxItems: 3,
    items: { enum: ['1:1', '3:4', '4:3'] },
  },
  supplementalDescription: supplementalDescriptionRuleSchema,
  pointsCost: { type: 'integer', minimum: 1 },
  isFavorited: { type: 'boolean' },
} as const;

const systemTemplateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...systemTemplateBaseRequired, 'inputs', 'coverImage'],
  properties: {
    ...systemTemplateBaseProperties,
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: systemTemplateInputSchema,
    },
    coverImage: { anyOf: [systemTemplateImageSchema, { type: 'null' }] },
  },
} as const;

const systemTemplateDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...systemTemplateBaseRequired, 'inputs', 'effectImage'],
  properties: {
    ...systemTemplateBaseProperties,
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: systemTemplateDetailInputSchema,
    },
    effectImage: { anyOf: [systemTemplateImageSchema, { type: 'null' }] },
  },
} as const;

const customTemplateInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'order', 'label', 'required', 'uploadRequirement'],
  properties: systemTemplateInputProperties,
} as const;

const customTemplateBaseProperties = {
  templateId: { type: 'string', pattern: uuidPattern },
  model: { anyOf: [templateModelSchema, { type: 'null' }] },
  templateVersionId: { type: 'string', pattern: uuidPattern },
  version: { type: 'integer', minimum: 1 },
  source: { const: 'custom' },
  name: { type: 'string', minLength: 1, maxLength: 100 },
  description: { type: 'string', minLength: 1, maxLength: 500 },
  category: templateCategorySchema,
  mode: { enum: ['single_image', 'multi_image'] },
  status: { const: 'published' },
  defaultAspectRatio: { enum: ['1:1', '3:4', '4:3'] },
  allowedAspectRatios: {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    items: { enum: ['1:1', '3:4', '4:3'] },
  },
  supplementalDescription: supplementalDescriptionRuleSchema,
  pointsCost: { type: 'integer', minimum: 1 },
  updatedAt: { type: 'string', pattern: isoDateTimePattern },
} as const;

const customTemplateBaseRequired = [
  'templateId',
  'templateVersionId',
  'version',
  'source',
  'name',
  'description',
  'category',
  'mode',
  'status',
  'defaultAspectRatio',
  'allowedAspectRatios',
  'supplementalDescription',
  'pointsCost',
  'updatedAt',
] as const;

const customTemplateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...customTemplateBaseRequired, 'inputs', 'coverImage'],
  properties: {
    ...customTemplateBaseProperties,
    inputs: { type: 'array', minItems: 1, maxItems: 4, items: customTemplateInputSchema },
    coverImage: { type: 'null' },
  },
} as const;

const customTemplateDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...customTemplateBaseRequired, 'inputs', 'executionPrompt', 'effectImage'],
  properties: {
    ...customTemplateBaseProperties,
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'order', 'label', 'required', 'uploadRequirement', 'modelRole'],
        properties: {
          ...systemTemplateInputProperties,
          modelRole: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    executionPrompt: { type: 'string', minLength: 1, maxLength: 5000 },
    effectImage: { type: 'null' },
  },
} as const;

/** 分类接口查询必须为空，未知参数统一返回400。 */
export const templateCategoryListQuerySchema = {
  $id: 'TemplateCategoryListQuery',
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

/** 分类接口响应禁止额外字段，避免后台状态或时间字段进入用户端。 */
export const templateCategoryListResponseSchema = {
  $id: 'TemplateCategoryListResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: templateCategorySchema } },
} as const;

/** 系统模板列表查询参数；搜索词和游标长度先在HTTP边界收紧。 */
export const systemTemplateListQuerySchema = {
  $id: 'SystemTemplateListQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    categoryId: { type: 'string', pattern: uuidPattern },
    search: { type: 'string', maxLength: 50 },
    cursor: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const;

/** 我的模板库按favorite/created判别来源，其余筛选与系统列表一致。 */
export const mineTemplateListQuerySchema = {
  $id: 'MineTemplateListQuery',
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { enum: ['favorite', 'created'] },
    categoryId: { type: 'string', pattern: uuidPattern },
    search: { type: 'string', maxLength: 50 },
    cursor: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const;

/** 旧导出名继续指向扩展后的我的模板查询，避免已有调用方深层改名。 */
export const favoriteTemplateListQuerySchema = mineTemplateListQuerySchema;

/** 模板详情与收藏写操作都使用稳定templateId。 */
export const systemTemplatePathParamsSchema = {
  $id: 'SystemTemplatePathParams',
  type: 'object',
  additionalProperties: false,
  required: ['templateId'],
  properties: { templateId: { type: 'string', pattern: uuidPattern } },
} as const;

/** 公共原图接口只接收全局唯一素材ID，不让调用方拼装模板或版本归属。 */
export const templateImageOriginalAccessPathParamsSchema = {
  $id: 'TemplateImageOriginalAccessPathParams',
  type: 'object',
  additionalProperties: false,
  required: ['assetId'],
  properties: { assetId: { type: 'string', pattern: uuidPattern } },
} as const;

/** 原图访问响应与缩略图共用安全字段，但由独立Schema固定接口边界。 */
export const templateImageOriginalAccessResponseSchema = {
  $id: 'TemplateImageOriginalAccessResponse',
  ...systemTemplateImageSchema,
} as const;

/** 列表响应严格限制公开模板字段，并显式给出分页游标。 */
export const systemTemplateListResponseSchema = {
  $id: 'SystemTemplateListResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: systemTemplateSchema },
    nextCursor: { type: ['string', 'null'] },
  },
} as const;

/** 详情契约包含效果图和栏位展示素材。 */
export const systemTemplateDetailResponseSchema = {
  $id: 'SystemTemplateDetailResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: systemTemplateDetailSchema },
} as const;

/** 自建模板列表只接受服务端文字数据，本机图片路径不会出现在响应。 */
export const customTemplateListResponseSchema = {
  $id: 'CustomTemplateListResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: customTemplateSchema },
    nextCursor: { type: ['string', 'null'] },
  },
} as const;

/** 通用详情按source严格区分系统脱敏结构和自建所有者私有结构。 */
export const templateDetailResponseSchema = {
  $id: 'TemplateDetailResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: { oneOf: [systemTemplateDetailSchema, customTemplateDetailSchema] } },
} as const;

const customTemplateWriteInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'order', 'label', 'required', 'uploadRequirement', 'modelRole'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z][a-z0-9_]*$' },
    order: { type: 'integer', minimum: 1, maximum: 4 },
    label: { type: 'string', minLength: 1, maxLength: 100 },
    required: { const: true },
    uploadRequirement: { type: 'string', minLength: 1, maxLength: 500 },
    modelRole: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

/** 创建和编辑必须一次提交完整表单，客户端不能携带价格、所有者或执行配置ID。 */
export const customTemplateWriteRequestSchema = {
  $id: 'CustomTemplateWriteRequest',
  type: 'object',
  additionalProperties: false,
  required: [
    'generationModelId',
    'name',
    'description',
    'categoryId',
    'inputs',
    'allowsSupplementalDescription',
    'executionPrompt',
  ],
  properties: {
    generationModelId: { type: 'string', pattern: uuidPattern },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', minLength: 1, maxLength: 500 },
    categoryId: { type: 'string', pattern: uuidPattern },
    inputs: { type: 'array', minItems: 1, maxItems: 4, items: customTemplateWriteInputSchema },
    allowsSupplementalDescription: { type: 'boolean' },
    supplementalDescriptionRecommendation: { type: 'string', minLength: 1, maxLength: 500 },
    executionPrompt: { type: 'string', minLength: 1, maxLength: 5000 },
  },
} as const;

/** 写接口返回保存后的所有者详情，页面可立即进入使用或继续绑定本机效果图。 */
export const customTemplateWriteResponseSchema = {
  $id: 'CustomTemplateWriteResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: customTemplateDetailSchema },
} as const;
