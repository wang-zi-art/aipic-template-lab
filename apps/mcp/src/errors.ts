/**
 * MCP 应用内部的安全错误类型。
 *
 * 所有底层网络、文件系统和供应商异常先收口为稳定错误码，工具响应与报告不会透传原始错误。
 */

/** 工具和编排服务可以安全返回给 Codex 的错误。 */
export class McpOperationError extends Error {
  /** 保存稳定错误码、失败是否可能已产生写入，以及可选 HTTP 状态。 */
  constructor(
    readonly code: string,
    message: string,
    readonly uncertain = false,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'McpOperationError';
  }
}

/** 把未知异常转换为不泄漏底层细节的安全错误。 */
export function toSafeError(
  error: unknown,
  fallbackCode = 'MCP_OPERATION_FAILED',
): McpOperationError {
  return error instanceof McpOperationError
    ? error
    : new McpOperationError(fallbackCode, '本地 MCP 操作失败，请检查配置和服务状态');
}
