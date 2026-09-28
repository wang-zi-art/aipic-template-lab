/**
 * 平台管理员身份的共享 HTTP 契约。
 *
 * 后端权限服务先将正式会话转换为可信管理员身份，Express 再按本契约只返回
 * 管理页需要的脱敏字段，不让完整手机号、会话或数据库状态进入浏览器。
 */

/** 当前阶段只存在一种平台角色，不在契约中提前扩展通用 RBAC。 */
export const platformAdminRole = 'platform_admin' as const;

/** 后台壳初始化时获取的最小脱敏身份，根对象和用户对象都拒绝额外字段。 */
export const platformAdminMeResponseSchema = {
  $id: 'PlatformAdminMeResponse',
  type: 'object',
  additionalProperties: false,
  required: ['user', 'role'],
  properties: {
    user: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'displayName', 'maskedPhone'],
      properties: {
        id: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
        displayName: { type: 'string', minLength: 1 },
        maskedPhone: { type: 'string', pattern: '^1[3-9][0-9]\\*{4}[0-9]{4}$' },
      },
    },
    role: { const: platformAdminRole },
  },
} as const;

/** 管理后台页面可以消费的最小平台管理员身份。 */
export interface PlatformAdminMeResponse {
  user: {
    id: string;
    displayName: string;
    maskedPhone: string;
  };
  role: typeof platformAdminRole;
}
