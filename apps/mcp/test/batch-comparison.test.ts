/**
 * 批量试用的素材预检、横向文件夹、增量收集和路径边界测试。
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBatchComparison, parseBatchPlan, validateBatchInputs, type BatchPlan } from '../src/batch-comparison.js';
import type { TrialExecutionReport, TrialItemRecord } from '../src/trial-report.js';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

/** 为两组有序上传图和 A/B/C 候选构造真实可读的输入、报告与输出。 */
async function fixture(): Promise<{ root: string; inputRoot: string; outputRoot: string; executionDirectory: string; plan: BatchPlan; report: TrialExecutionReport }> {
  const root = await mkdtemp(path.join(tmpdir(), 'aipic-batch-comparison-'));
  const inputRoot = path.join(root, 'materials');
  const outputRoot = path.join(root, 'outputs');
  const executionId = randomUUID();
  const executionDirectory = path.join(outputRoot, executionId);
  await mkdir(inputRoot, { recursive: true });
  await mkdir(executionDirectory, { recursive: true });
  const plan = parseBatchPlan({
    schemaVersion: 1, executionId, templateTypeId: 'TPL0001', manifestRevision: 2,
    candidates: ['A', 'B', 'C'].map((key) => ({ key, promptLabel: `${key}-v1`, templateId: randomUUID(), versionId: randomUUID(), revision: 1, modelId: randomUUID() })),
    generation: { aspectRatio: '1:1', resolution: '1024x1024', quality: 'standard' },
    cases: ['T001', 'T002'].map((id, index) => ({
      id, imageSetId: `S00${index + 1}`, supplementalDescription: index === 0 ? '手持冰袋' : null,
      inputs: [1, 2].map((order) => ({ order, slotKey: order === 1 ? 'subject_image' : 'action_reference', path: `${id}/input_${order}.png` })),
    })),
  });
  const samples = [];
  for (const testCase of plan.cases) {
    const inputs = [];
    for (const input of testCase.inputs) {
      const copied = `${testCase.id}/original_${input.order}.png`;
      await mkdir(path.dirname(path.join(inputRoot, input.path)), { recursive: true });
      await mkdir(path.dirname(path.join(executionDirectory, copied)), { recursive: true });
      await writeFile(path.join(inputRoot, input.path), pixel);
      // T002 第二张报告副本故意缺失，用来验证汇总不会伪造上传图。
      if (!(testCase.id === 'T002' && input.order === 2)) await writeFile(path.join(executionDirectory, copied), pixel);
      inputs.push({ slotKey: input.slotKey, sourceRelativePath: input.path, copyRelativePath: copied, contentType: 'image/png' as const, sizeBytes: pixel.length, sha256: 'test' });
    }
    samples.push({ sampleId: testCase.id, inputs });
  }
  const items: TrialItemRecord[] = plan.cases.flatMap((testCase) => plan.candidates.map((candidate) => ({
    sampleId: testCase.id, candidateKey: candidate.key, templateId: candidate.templateId, templateName: candidate.promptLabel,
    versionId: candidate.versionId, version: 1, revision: candidate.revision,
    generation: { ...plan.generation, ...(testCase.supplementalDescription ? { supplementalDescription: testCase.supplementalDescription } : {}) } as TrialItemRecord['generation'],
    uploadIds: [], clientRequestId: randomUUID(), taskId: randomUUID(), pointsCost: 1,
    submissionStatus: 'submitted', taskStatus: 'succeeded', exportStatus: 'downloaded',
    resultRelativePath: `${testCase.id}/result_${candidate.key}.png`, errorCode: null, lastQueryErrorCode: null, lastQueriedAt: null,
  })));
  // 六格状态：已成功、明确失败、处理中、结果文件缺失、待核对、未提交。
  Object.assign(items[1]!, { taskStatus: 'failed', exportStatus: 'not_applicable', resultRelativePath: null, errorCode: 'GENERATION_FAILED' });
  Object.assign(items[2]!, { taskStatus: 'processing', exportStatus: 'pending', resultRelativePath: null });
  Object.assign(items[4]!, { submissionStatus: 'pending_review', taskStatus: 'not_submitted', exportStatus: 'not_applicable', resultRelativePath: null });
  Object.assign(items[5]!, { submissionStatus: 'not_executed', taskStatus: 'not_submitted', exportStatus: 'not_applicable', resultRelativePath: null, taskId: null });
  await writeFile(path.join(executionDirectory, items[0]!.resultRelativePath!), pixel);
  const report: TrialExecutionReport = {
    schemaVersion: 1, executionId, goal: 'run_template_trials', apiBaseUrl: 'https://example.test',
    status: 'running', phase: 'collecting', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:01:00Z',
    finishedAt: null, submissionHaltCode: null,
    summary: { total: 6, succeeded: 1, failed: 1, processing: 1, pendingReview: 1, notExecuted: 1 },
    samples, items,
  };
  await writeFile(path.join(executionDirectory, 'report.json'), JSON.stringify(report));
  return { root, inputRoot, outputRoot, executionDirectory, plan, report };
}

/** 仅清理测试自己创建、真实路径仍位于系统临时目录下的文件夹。 */
async function cleanup(root: string): Promise<void> {
  const actual = await realpath(root);
  const relative = path.relative(await realpath(tmpdir()), actual);
  if (!relative.startsWith('aipic-batch-comparison-') || relative.includes(path.sep)) throw new Error('测试清理目录不安全');
  await rm(actual, { recursive: true, force: true });
}

describe('batch comparison', () => {
  it('预检两组输入，并将六种状态和有序图片汇总为可重复生成的文件夹', async () => {
    const data = await fixture();
    try {
      await validateBatchInputs(data.plan, data.inputRoot);
      const reportBefore = await readFile(path.join(data.executionDirectory, 'report.json'));
      const resultBefore = await readFile(path.join(data.executionDirectory, 'T001/result_A.png'));
      const first = await buildBatchComparison(data.plan, data.outputRoot);
      const summary = JSON.parse(await readFile(path.join(first.directory, 'summary.json'), 'utf8'));
      expect(summary.totals).toEqual({ succeeded: 1, failed: 1, processing: 1, pending_review: 1, not_executed: 1, export_failed: 0, missing_file: 1 });
      expect(summary.cases[0].inputs.map((input: { path: string }) => input.path)).toEqual(['T001/00-input_01.png', 'T001/00-input_02.png']);
      expect(summary.cases[0].results.map((result: { status: string }) => result.status)).toEqual(['succeeded', 'failed', 'processing']);
      expect(summary.cases[1].results.map((result: { status: string }) => result.status)).toEqual(['missing_file', 'pending_review', 'not_executed']);
      expect(summary.cases[1].inputs[1].status).toBe('missing');
      expect(await readFile(path.join(first.directory, 'README.md'), 'utf8')).toContain('GENERATION_FAILED');
      expect(await readFile(path.join(first.directory, 'T001/10-A-v1.png'))).toEqual(pixel);
      expect(await readFile(path.join(first.directory, 'T001/00-input_01.png'))).toEqual(pixel);
      const reviewPage = await readFile(path.join(first.directory, 'index.html'), 'utf8');
      const embedded = reviewPage.match(/<script id="comparisonData" type="application\/json">([^<]*)<\/script>/)?.[1];
      expect(embedded).toBeDefined();
      expect(JSON.parse(embedded!)).toEqual(summary);
      expect(reviewPage).toContain('data-theme="midnight"');
      expect(reviewPage).not.toContain('演示数据');
      expect(await readFile(path.join(first.directory, 'review.js'), 'utf8')).toContain('startReview();');
      expect(await readFile(path.join(first.directory, 'review.css'), 'utf8')).toContain('.review-ribbon');
      expect(await readFile(path.join(first.directory, 'workbench-theme.css'), 'utf8')).toContain("body[data-theme='midnight']");
      expect(await readFile(path.join(data.executionDirectory, 'report.json'))).toEqual(reportBefore);
      expect(await readFile(path.join(data.executionDirectory, 'T001/result_A.png'))).toEqual(resultBefore);
      await buildBatchComparison(data.plan, data.outputRoot);
      expect(JSON.parse(await readFile(path.join(first.directory, 'summary.json'), 'utf8'))).toEqual(summary);
    } finally {
      await cleanup(data.root);
    }
  });

  it('处理中任务完成后，按原执行编号更新汇总而不重新提交', async () => {
    const data = await fixture();
    try {
      await buildBatchComparison(data.plan, data.outputRoot);
      Object.assign(data.report.items[2]!, { taskStatus: 'succeeded', exportStatus: 'downloaded', resultRelativePath: 'T001/result_C.png' });
      await writeFile(path.join(data.executionDirectory, 'T001/result_C.png'), pixel);
      await writeFile(path.join(data.executionDirectory, 'report.json'), JSON.stringify(data.report));
      const result = await buildBatchComparison(data.plan, data.outputRoot);
      const summary = JSON.parse(await readFile(path.join(result.directory, 'summary.json'), 'utf8'));
      expect(summary.cases[0].results[2]).toMatchObject({ status: 'succeeded', path: 'T001/30-C-v1.png' });
      expect(await readFile(path.join(result.directory, 'T001/30-C-v1.png'))).toEqual(pixel);
      expect(summary.totals.succeeded).toBe(2);
      expect(await readFile(path.join(result.directory, 'index.html'), 'utf8')).toContain('30-C-v1.png');
    } finally {
      await cleanup(data.root);
    }
  });

  it('把补充描述作为安全 JSON 写入离线页面', async () => {
    const data = await fixture();
    try {
      const description = '</script><script>alert(1)</script>';
      data.plan.cases[0]!.supplementalDescription = description;
      for (const item of data.report.items.filter((value) => value.sampleId === 'T001')) {
        item.generation.supplementalDescription = description;
      }
      await writeFile(path.join(data.executionDirectory, 'report.json'), JSON.stringify(data.report));
      const result = await buildBatchComparison(data.plan, data.outputRoot);
      const page = await readFile(path.join(result.directory, 'index.html'), 'utf8');
      const embedded = page.match(/<script id="comparisonData" type="application\/json">([^<]*)<\/script>/)?.[1];
      expect(page).not.toContain(description);
      expect(JSON.parse(embedded!).cases[0].supplementalDescription).toBe(description);
    } finally {
      await cleanup(data.root);
    }
  });

  it('拒绝报告结果越出执行目录及已存在的同名错误图片', async () => {
    const data = await fixture();
    try {
      data.report.items[0]!.resultRelativePath = '../outside.png';
      await writeFile(path.join(data.executionDirectory, 'report.json'), JSON.stringify(data.report));
      await expect(buildBatchComparison(data.plan, data.outputRoot)).rejects.toThrow('超出执行目录');
      data.report.items[0]!.resultRelativePath = path.join(data.root, 'outside.png');
      await writeFile(path.join(data.executionDirectory, 'report.json'), JSON.stringify(data.report));
      await expect(buildBatchComparison(data.plan, data.outputRoot)).rejects.toThrow('超出执行目录');
      data.report.items[0]!.resultRelativePath = 'T001/result_A.png';
      await writeFile(path.join(data.executionDirectory, 'report.json'), JSON.stringify(data.report));
      const first = await buildBatchComparison(data.plan, data.outputRoot);
      await unlink(path.join(first.directory, 'T001/10-A-v1.png'));
      await writeFile(path.join(first.directory, 'T001/10-A-v1.png'), Buffer.from('wrong'));
      await expect(buildBatchComparison(data.plan, data.outputRoot)).rejects.toThrow('已有汇总图片与原图不同');
    } finally {
      await cleanup(data.root);
    }
  });

  it('付费提交前拒绝缺失的正式素材', async () => {
    const data = await fixture();
    try {
      await unlink(path.join(data.inputRoot, data.plan.cases[1]!.inputs[1]!.path));
      await expect(validateBatchInputs(data.plan, data.inputRoot)).rejects.toMatchObject({ code: 'MCP_INPUT_FILE_UNAVAILABLE' });
    } finally {
      await cleanup(data.root);
    }
  });
});
