/**
 * 项目级 stdio MCP 进程入口。
 *
 * stdout 专用于 MCP 协议；启动和异常诊断只写入 stderr，且不输出配置、令牌或请求内容。
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createTemplateMcpServer } from './tools.js';

/** 启动 stdio 服务并注册退出清理，避免协议流混入普通日志。 */
function startServer(): void {
  const handle = serveStdio(() => createTemplateMcpServer(), {
    onerror: () => console.error('[aipic-mcp] protocol error'),
  });

  /** 收到进程退出信号时关闭当前 MCP 连接。 */
  const shutdown = async () => {
    await handle.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.error('[aipic-mcp] ready');
}

startServer();
