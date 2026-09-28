/**
 * 使用正式 MCP 客户端验证 stdio 工具发现和输入 Schema 拒绝。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

let client: Client | null = null;

/** 启动真实 stdio 入口并完成 MCP 初始化握手。 */
async function connectClient(): Promise<Client> {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(currentDirectory, '..');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/main.ts'],
    cwd: appRoot,
    stderr: 'pipe',
  });
  client = new Client({ name: 'aipic-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = null;
});

describe('MCP protocol surface', () => {
  it('发现九个工具及正确读写标记', async () => {
    const connected = await connectClient();
    const result = await connected.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      'collect_template_trial_results',
      'create_system_template_candidate',
      'delete_unpublished_system_template',
      'get_admin_context',
      'get_system_template',
      'get_template_trial_report',
      'submit_template_trial',
      'submit_template_trial_batch',
      'update_system_template_prompt',
    ]);
    expect(result.tools.find((tool) => tool.name === 'get_admin_context')?.annotations?.readOnlyHint).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === 'create_system_template_candidate')?.annotations?.idempotentHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === 'submit_template_trial')?.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === 'submit_template_trial_batch')?.annotations
        ?.idempotentHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === 'update_system_template_prompt')?.annotations
        ?.destructiveHint,
    ).toBe(false);
    expect(
      result.tools.find((tool) => tool.name === 'delete_unpublished_system_template')?.annotations
        ?.destructiveHint,
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === 'delete_unpublished_system_template')?.annotations
        ?.idempotentHint,
    ).toBe(true);
    const createSchema = result.tools.find(
      (tool) => tool.name === 'create_system_template_candidate',
    )?.inputSchema as {
      properties?: { assets?: { minItems?: number; maxItems?: number } };
    };
    expect(createSchema.properties?.assets).toMatchObject({ maxItems: 85 });
    expect(createSchema.properties?.assets?.minItems).toBeUndefined();
    const submitSchema = result.tools.find((tool) => tool.name === 'submit_template_trial')
      ?.inputSchema as {
      properties?: { generation?: { required?: string[] } };
    };
    expect(submitSchema.properties?.generation?.required).toContain('resolution');
  });

  it('在进入业务服务前拒绝 templateId 与 versionId 同时出现', async () => {
    const connected = await connectClient();
    const result = await connected.callTool({
        name: 'get_system_template',
        arguments: {
          templateId: '123e4567-e89b-42d3-a456-426614174000',
          versionId: '123e4567-e89b-42d3-a456-426614174001',
        },
      });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
    );
  });

  it('在读取私密配置前拒绝不安全样本编号和候选标识', async () => {
    const connected = await connectClient();
    const result = await connected.callTool({
      name: 'submit_template_trial',
      arguments: {
        executionId: '123e4567-e89b-42d3-a456-426614174601',
        sampleId: '../T01',
        candidateKey: 'D',
        versionId: '123e4567-e89b-42d3-a456-426614174602',
        expectedRevision: 1,
        inputs: [{ slotKey: 'subject', localPath: 'T01.png' }],
        generation: { aspectRatio: '1:1' },
      },
    });
    expect(result.isError).toBe(true);
  });

  it('批量入口在读取私密配置前拒绝不完整计划', async () => {
    const connected = await connectClient();
    const result = await connected.callTool({
      name: 'submit_template_trial_batch',
      arguments: { plan: { schemaVersion: 1, executionId: 'not-a-uuid' } },
    });
    expect(result.isError).toBe(true);
  });

  it.each([
    { name: '缺少分辨率', generation: { aspectRatio: '4:3', quality: 'auto' } },
    {
      name: '固定比例搭配auto分辨率',
      generation: { aspectRatio: '4:3', resolution: 'auto', quality: 'auto' },
    },
    {
      name: 'auto比例搭配固定分辨率',
      generation: { aspectRatio: 'auto', resolution: '1k', quality: 'auto' },
    },
  ])('在读取私密配置前拒绝$name', async ({ generation }) => {
    const connected = await connectClient();
    const result = await connected.callTool({
      name: 'submit_template_trial',
      arguments: {
        executionId: '123e4567-e89b-42d3-a456-426614174603',
        sampleId: 'T01',
        candidateKey: 'A',
        versionId: '123e4567-e89b-42d3-a456-426614174604',
        expectedRevision: 1,
        inputs: [{ slotKey: 'subject', localPath: 'T01.png' }],
        generation,
      },
    });
    expect(result.isError).toBe(true);
  });

  it('在读取私密配置前严格拒绝变更工具额外字段和非法 revision', async () => {
    const connected = await connectClient();
    const update = await connected.callTool({
      name: 'update_system_template_prompt',
      arguments: {
        versionId: '123e4567-e89b-42d3-a456-426614174701',
        expectedRevision: 1,
        executionPrompt: '测试提示词',
        unexpected: true,
      },
    });
    const deletion = await connected.callTool({
      name: 'delete_unpublished_system_template',
      arguments: {
        templateId: '123e4567-e89b-42d3-a456-426614174702',
        expectedRevision: 0,
      },
    });

    expect(update.isError).toBe(true);
    expect(deletion.isError).toBe(true);
  });
});
