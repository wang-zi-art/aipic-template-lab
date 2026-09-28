/**
 * 候选报告的独占目录、双格式写入和敏感内容边界测试。
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  initializeExecutionDirectory,
  readCandidateReport,
  writeCandidateReport,
  type CandidateExecutionReport,
} from '../src/report.js';

const executionId = '123e4567-e89b-42d3-a456-426614174000';

/** 构造只含允许安全字段的最小完整报告。 */
function createReport(): CandidateExecutionReport {
  return {
    schemaVersion: 1,
    executionId,
    goal: 'create_system_template_candidate',
    apiBaseUrl: 'https://example.test',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    completedStep: 'initialized',
    stoppedStep: null,
    requiresReview: false,
    errorCode: null,
    candidate: {
      name: '测试模板', categoryId: 'category', generationModelId: 'model', templateId: null,
      versionId: null, version: null, revision: null, serverStatus: null,
    },
    assets: [{
      kind: 'effect', inputKey: null, order: 1, relativePath: 'effect.png', contentType: 'image/png',
      sizeBytes: 8, status: 'pending', errorCode: null,
    }],
  };
}

describe('candidate report', () => {
  it('原子落盘 JSON 与 Markdown，且可按 executionId 恢复', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'aipic-report-'));
    const paths = await initializeExecutionDirectory(root, executionId);
    await writeCandidateReport(paths, createReport());
    const recovered = await readCandidateReport(root, executionId);
    expect(recovered.report.executionId).toBe(executionId);
    expect(await readFile(paths.markdown, 'utf8')).toContain('测试模板');
    await expect(initializeExecutionDirectory(root, executionId)).rejects.toMatchObject({
      code: 'MCP_EXECUTION_ALREADY_EXISTS',
    });
  });

  it('报告结构不提供令牌、提示词、模型作用或对象 Key 字段', () => {
    const serialized = JSON.stringify(createReport());
    expect(serialized).not.toMatch(/adminSessionToken|executionPrompt|modelRole|objectKey|temporarySecret/i);
  });
});
