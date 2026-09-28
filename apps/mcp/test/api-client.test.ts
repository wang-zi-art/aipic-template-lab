/**
 * 管理员 HTTP 客户端的传输与响应安全测试。
 *
 * 覆盖固定认证、重定向拒绝、非 JSON、契约错误、网络和 5xx 的安全错误映射。
 */
import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../src/api-client.js';
import type { McpRuntimeConfig } from '../src/config.js';

const config: McpRuntimeConfig = {
  apiBaseUrl: 'https://example.test',
  adminSessionToken: 'private-token',
  inputRoot: 'D:/input',
  outputRoot: 'D:/output',
};

/** 把单次 Fetch 替身适配成原生 fetch 类型，测试仍从公开客户端入口调用。 */
function createClient(response: Response | Error) {
  const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: createAdminApiClient(config, request as unknown as typeof fetch), request };
}

describe('admin API client', () => {
  it('使用 Bearer 会话且禁止自动跟随重定向', async () => {
    const { client, request } = createClient(new Response(null, { status: 302 }));
    await expect(client.getCurrentAdmin()).rejects.toMatchObject({
      code: 'ADMIN_API_REDIRECT_REJECTED',
      uncertain: true,
    });
    const init = request.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer private-token');
  });

  it('把非 JSON 和共享契约不匹配统一标记为待核对', async () => {
    const nonJson = createClient(new Response('html', { status: 200 }));
    await expect(nonJson.client.getCurrentAdmin()).rejects.toMatchObject({
      code: 'ADMIN_API_INVALID_RESPONSE', uncertain: true,
    });
    const invalidContract = createClient(
      new Response(JSON.stringify({ role: 'platform_admin' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(invalidContract.client.getCurrentAdmin()).rejects.toMatchObject({
      code: 'ADMIN_API_INVALID_RESPONSE', uncertain: true,
    });
  });

  it('不暴露网络底层错误，并将网络和 5xx 标记为待核对', async () => {
    const network = createClient(new Error('socket private details'));
    await expect(network.client.getCurrentAdmin()).rejects.toMatchObject({
      code: 'ADMIN_API_UNAVAILABLE', message: '管理员接口网络连接失败', uncertain: true,
    });
    const server = createClient(
      new Response(JSON.stringify({ code: 'SERVER_BUSY', message: '服务暂不可用' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(server.client.getCurrentAdmin()).rejects.toMatchObject({
      code: 'SERVER_BUSY', uncertain: true, statusCode: 503,
    });
  });

  it('保留 401 与 403 为明确权限失败，不标记为写入不明', async () => {
    for (const status of [401, 403]) {
      const { client } = createClient(
        new Response(JSON.stringify({ code: `HTTP_${status}`, message: '身份不可用' }), {
          status, headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(client.getCurrentAdmin()).rejects.toMatchObject({
        code: `HTTP_${status}`, uncertain: false, statusCode: status,
      });
    }
  });

  it('单任务创建只访问固定路径并接受首次201与幂等恢复200', async () => {
    for (const status of [200, 201]) {
      const body = {
        taskId: '123e4567-e89b-42d3-a456-426614174501',
        status: 'queued' as const,
        templateVersionId: '123e4567-e89b-42d3-a456-426614174502',
        pointsCost: 10,
        createdAt: '2026-09-21T00:00:00.000Z',
      };
      const { client, request } = createClient(new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json' },
      }));
      await expect(client.createGenerationTask({
        clientRequestId: '123e4567-e89b-42d3-a456-426614174503',
        templateVersionId: body.templateVersionId,
        templateTrialRevision: 3,
        inputs: [{
          slotKey: 'subject', sourceType: 'user_upload',
          uploadId: '123e4567-e89b-42d3-a456-426614174504',
        }],
        aspectRatio: '1:1',
      })).resolves.toEqual(body);
      expect(String(request.mock.calls[0]![0])).toBe('https://example.test/api/v1/generation-tasks');
      expect((request.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    }
  });

  it('候选删除使用固定 DELETE 路径并读取服务端幂等标记', async () => {
    const templateId = '123e4567-e89b-42d3-a456-426614174510';
    const body = {
      item: {
        templateId,
        status: 'deleted' as const,
        deletedAt: '2026-09-21T02:00:00.000Z',
      },
    };
    const { client, request } = createClient(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Idempotent-Replayed': 'true',
        },
      }),
    );

    await expect(client.deleteUnpublishedSystemTemplate(templateId, 2)).resolves.toEqual({
      body,
      replayed: true,
    });
    expect(String(request.mock.calls[0]![0])).toBe(
      `https://example.test/api/v1/admin/system-templates/${templateId}`,
    );
    const init = request.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(init.body).toBe(JSON.stringify({ expectedRevision: 2 }));
  });
});
