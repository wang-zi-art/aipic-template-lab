/**
 * 平台管理员维护模板分类、查看执行配置目录时共用的 HTTP 契约。
 *
 * 管理后台把分类表单和排序结果交给管理员路由，路由按这些严格 Schema 校验后再调用模板
 * 目录应用服务；响应只返回运营页面需要的分类字段和执行配置兼容信息，不暴露供应商、模型、
 * 输出规格、内部业务 Key 或数据库实现字段。
 */

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const categoryKeyPattern = '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$';

/** 分类管理列表使用的完整运营字段；revision 用于阻止旧页面静默覆盖新数据。 */
export interface AdminTemplateCategoryResponse {
  categoryId: string;
  key: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  revision: number;
}

/** 分类列表不接受筛选参数，后台始终取得启用和停用的完整目录。 */
export type AdminTemplateCategoryListQuery = Record<string, never>;

/** 分类列表和排序结果都返回服务端确认后的完整顺序。 */
export interface AdminTemplateCategoryListResponse {
  items: AdminTemplateCategoryResponse[];
}

/** 新建分类只接收不可变 Key 和展示名称，顺序由服务端追加后再通过排序接口调整。 */
export interface AdminTemplateCategoryCreateRequest {
  key: string;
  name: string;
}

/** 新建和单项更新成功后返回服务端最新分类，供页面替换本地旧 revision。 */
export interface AdminTemplateCategoryWriteResponse {
  item: AdminTemplateCategoryResponse;
}

/** 单项更新路径只允许一个分类标识。 */
export interface AdminTemplateCategoryPathParams {
  categoryId: string;
}

/** 单项更新必须带旧 revision，并且至少修改名称或启用状态之一。 */
export type AdminTemplateCategoryUpdateRequest =
  | { expectedRevision: number; name: string; isActive?: boolean }
  | { expectedRevision: number; name?: string; isActive: boolean };

/** 排序项逐项携带页面看到的 revision，数组位置就是新的分类顺序。 */
export interface AdminTemplateCategoryOrderItemRequest {
  categoryId: string;
  expectedRevision: number;
}

/** 排序请求必须提交完整分类数组，不能由客户端直接指定数据库 sortOrder。 */
export interface AdminTemplateCategoryOrderRequest {
  items: AdminTemplateCategoryOrderItemRequest[];
}

/** 排序成功后返回按新顺序排列且 revision 已刷新的完整分类目录。 */
export type AdminTemplateCategoryOrderResponse = AdminTemplateCategoryListResponse;

const adminTemplateCategorySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId', 'key', 'name', 'sortOrder', 'isActive', 'revision'],
  properties: {
    categoryId: { type: 'string', pattern: uuidPattern },
    key: { type: 'string', minLength: 1, maxLength: 50, pattern: categoryKeyPattern },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    sortOrder: { type: 'integer', minimum: 0 },
    isActive: { type: 'boolean' },
    revision: { type: 'integer', minimum: 1 },
  },
} as const;

/** GET 分类目录的空查询对象；任何未知查询参数都会被拒绝。 */
export const adminTemplateCategoryListQuerySchema = {
  $id: 'AdminTemplateCategoryListQuery',
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

/** GET 分类目录和 PUT 排序共用的完整列表响应。 */
export const adminTemplateCategoryListResponseSchema = {
  $id: 'AdminTemplateCategoryListResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: adminTemplateCategorySchema },
  },
} as const;

/** POST 新建分类请求，额外字段和非小写蛇形 Key 会被拒绝。 */
export const adminTemplateCategoryCreateRequestSchema = {
  $id: 'AdminTemplateCategoryCreateRequest',
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 50, pattern: categoryKeyPattern },
    name: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;

/** POST 和 PATCH 成功后只返回一个服务端最新分类。 */
export const adminTemplateCategoryWriteResponseSchema = {
  $id: 'AdminTemplateCategoryWriteResponse',
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: adminTemplateCategorySchema,
  },
} as const;

/** PATCH 分类路径参数，拒绝客户端附带其他定位字段。 */
export const adminTemplateCategoryPathParamsSchema = {
  $id: 'AdminTemplateCategoryPathParams',
  type: 'object',
  additionalProperties: false,
  required: ['categoryId'],
  properties: {
    categoryId: { type: 'string', pattern: uuidPattern },
  },
} as const;

/** PATCH 分类请求要求 revision 加至少一个实际修改字段，Key 始终不可修改。 */
export const adminTemplateCategoryUpdateRequestSchema = {
  $id: 'AdminTemplateCategoryUpdateRequest',
  type: 'object',
  additionalProperties: false,
  minProperties: 2,
  required: ['expectedRevision'],
  properties: {
    expectedRevision: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    isActive: { type: 'boolean' },
  },
} as const;

const adminTemplateCategoryOrderItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId', 'expectedRevision'],
  properties: {
    categoryId: { type: 'string', pattern: uuidPattern },
    expectedRevision: { type: 'integer', minimum: 1 },
  },
} as const;

/** PUT 排序请求以数组顺序表达目标顺序，不接受客户端 sortOrder。 */
export const adminTemplateCategoryOrderRequestSchema = {
  $id: 'AdminTemplateCategoryOrderRequest',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', minItems: 1, items: adminTemplateCategoryOrderItemSchema },
  },
} as const;

/** PUT 排序响应沿用完整分类列表结构并拥有独立 OpenAPI 名称。 */
export const adminTemplateCategoryOrderResponseSchema = {
  $id: 'AdminTemplateCategoryOrderResponse',
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', items: adminTemplateCategorySchema },
  },
} as const;
