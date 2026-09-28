/**
 * Codex 模板测试 MCP 的本地私密配置读取器。
 *
 * 每次工具调用都重新读取 `.local/codex-template-mcp/config.json`，会话更新后无需重启进程。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { McpOperationError } from './errors.js';

export interface McpRuntimeConfig {
  apiBaseUrl: string;
  adminSessionToken: string;
  inputRoot: string;
  outputRoot: string;
}

/** 返回默认私密配置位置；cwd 由项目级 Codex MCP 配置固定到仓库根目录。 */
export function resolveDefaultConfigPath(cwd = process.cwd()): string {
  return path.resolve(cwd, '.local', 'codex-template-mcp', 'config.json');
}

/** 校验 API 根地址，禁止凭据、查询、片段和 `/api` 之外的动态目标覆盖。 */
function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpOperationError('MCP_CONFIG_INVALID', 'apiBaseUrl 配置缺失');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpOperationError('MCP_CONFIG_INVALID', 'apiBaseUrl 不是有效地址');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new McpOperationError(
      'MCP_CONFIG_INVALID',
      'apiBaseUrl 只能是无凭据和参数的 HTTP 根地址',
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

/** 校验绝对目录配置，真实目录和越界检查由具体文件端口在使用时完成。 */
function readAbsoluteRoot(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new McpOperationError('MCP_CONFIG_INVALID', `${fieldName} 必须是绝对目录`);
  }
  return path.resolve(value);
}

/** 从磁盘重新读取并严格投影四个允许字段。 */
export async function loadMcpRuntimeConfig(
  configPath = resolveDefaultConfigPath(),
): Promise<McpRuntimeConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  } catch {
    throw new McpOperationError(
      'MCP_CONFIG_UNAVAILABLE',
      '无法读取本地 MCP 配置，请先复制并填写 config.example.json',
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new McpOperationError('MCP_CONFIG_INVALID', '本地 MCP 配置格式不正确');
  }
  const value = raw as Record<string, unknown>;
  const allowed = ['apiBaseUrl', 'adminSessionToken', 'inputRoot', 'outputRoot'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new McpOperationError('MCP_CONFIG_INVALID', '本地 MCP 配置包含未知字段');
  }
  if (typeof value.adminSessionToken !== 'string' || !value.adminSessionToken.trim()) {
    throw new McpOperationError('MCP_CONFIG_INVALID', 'adminSessionToken 配置缺失');
  }
  return {
    apiBaseUrl: normalizeApiBaseUrl(value.apiBaseUrl),
    adminSessionToken: value.adminSessionToken.trim(),
    inputRoot: readAbsoluteRoot(value.inputRoot, 'inputRoot'),
    outputRoot: readAbsoluteRoot(value.outputRoot, 'outputRoot'),
  };
}
