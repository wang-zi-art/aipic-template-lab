/** 管理员试用安全契约：复用系统模板展示字段，明确测试状态和修订，不开放执行私有信息。 */
import {
  systemTemplateListResponseSchema,
  systemTemplateDetailResponseSchema,
  type SystemTemplateResponse,
  type SystemTemplateDetailItemResponse,
} from './template-catalog.js';

export type TemplateTrialSummary = Omit<SystemTemplateResponse, 'status'> & {
  status: 'testing';
  revision: number;
};
export type TemplateTrialDetail = Omit<SystemTemplateDetailItemResponse, 'status'> & {
  status: 'testing';
  revision: number;
};
export interface TemplateTrialListResponse {
  items: TemplateTrialSummary[];
  nextCursor: string | null;
}
export interface TemplateTrialDetailResponse {
  item: TemplateTrialDetail;
}
const revision = { type: 'integer', minimum: 1, maximum: 2147483647 } as const;
const summary = systemTemplateListResponseSchema.properties.items.items;
const detail = systemTemplateDetailResponseSchema.properties.item;
export const templateTrialListResponseSchema = {
  ...systemTemplateListResponseSchema,
  $id: 'TemplateTrialListResponse',
  properties: {
    ...systemTemplateListResponseSchema.properties,
    items: {
      type: 'array',
      items: {
        ...summary,
        required: [...summary.required, 'revision'],
        properties: { ...summary.properties, status: { const: 'testing' }, revision },
      },
    },
  },
} as const;
export const templateTrialDetailResponseSchema = {
  ...systemTemplateDetailResponseSchema,
  $id: 'TemplateTrialDetailResponse',
  properties: {
    item: {
      ...detail,
      required: [...detail.required, 'revision'],
      properties: { ...detail.properties, status: { const: 'testing' }, revision },
    },
  },
} as const;

/** 试用读取接口共享正式Bearer身份；生成仍使用原任务和批次路径。 */
function operation(summary: string, schema: string, parameters: object[] = []) {
  return {
    summary,
    security: [{ BearerAuth: [] }],
    parameters,
    responses: {
      '200': {
        description: '试用安全内容',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/' + schema } } },
      },
      ...Object.fromEntries(
        ['400', '401', '403', '404', '409', '503'].map((code) => [
          code,
          {
            description: '请求无效、权限失效、测试版本变化或暂不可用',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
            },
          },
        ]),
      ),
    },
  };
}
/** 路径ID沿用UUID校验，不接受对象Key。 */
function pathId(name: string) {
  return { name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
}
export const templateTrialOpenApiPaths = {
  '/api/v1/admin/template-trials': {
    get: operation(
      '管理员测试版本目录',
      'TemplateTrialListResponse',
      ['search', 'categoryId', 'cursor'].map((name) => ({
        name,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      })),
    ),
  },
  '/api/v1/admin/template-trials/{versionId}': {
    get: operation('指定测试版本详情', 'TemplateTrialDetailResponse', [pathId('versionId')]),
  },
  '/api/v1/admin/template-trials/{versionId}/assets/{assetId}/original-access': {
    get: operation('测试版本素材访问', 'TemplateImageOriginalAccessResponse', [
      pathId('versionId'),
      pathId('assetId'),
    ]),
  },
};
