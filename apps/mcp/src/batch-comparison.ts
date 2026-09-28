/**
 * 批量模板试用的计划校验与文件夹汇总。
 *
 * MCP 报告仍是执行事实来源；这里仅把已导出的图片整理成便于人工横向查看的副本索引，
 * 同时产出可直接打开的石墨蓝紫评审页及安全摘要，不修改报告或原图。
 */
import { constants } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prepareGenerationInput, resolveExistingExecutionDirectory } from './local-files.js';
import type { TrialExecutionReport, TrialItemRecord } from './trial-report.js';

const executionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const candidateKeySchema = z.enum(['A', 'B', 'C']);
const generationSchema = z
  .object({
    aspectRatio: z.string().min(1),
    resolution: z.string().min(1),
    quality: z.string().min(1).optional(),
  })
  .strict();
export const batchPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    executionId: executionIdSchema,
    templateTypeId: z.string().regex(/^TPL\d{4}$/),
    manifestRevision: z.number().int().min(1),
    candidates: z
      .array(
        z
          .object({
            key: candidateKeySchema,
            promptLabel: z.string().regex(/^[ABC]-v[1-9]\d*$/),
            templateId: z.string().uuid(),
            versionId: z.string().uuid(),
            revision: z.number().int().min(1),
            modelId: z.string().uuid().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    generation: generationSchema,
    cases: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/),
            imageSetId: z.string().min(1).nullable(),
            supplementalDescription: z.string().max(500).nullable(),
            inputs: z
              .array(
                z
                  .object({
                    order: z.number().int().min(1).max(4),
                    slotKey: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
                    path: z.string().min(1).max(2_048),
                  })
                  .strict(),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type BatchPlan = z.infer<typeof batchPlanSchema>;
/** 新付费提交只接受当前模型契约值；历史汇总仍可读取旧计划。 */
export const batchSubmissionPlanSchema = batchPlanSchema.safeExtend({
  generation: z
    .object({
      aspectRatio: z.enum([
        'auto',
        '1:1',
        '16:9',
        '9:16',
        '4:3',
        '3:4',
        '3:2',
        '2:3',
        '5:4',
        '4:5',
        '21:9',
        '9:21',
        '2:1',
        '1:2',
      ]),
      resolution: z.enum(['auto', '1k', '2k', '4k']),
      quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
    })
    .strict(),
});
export type BatchSubmissionPlan = z.infer<typeof batchSubmissionPlanSchema>;
type ResultStatus =
  | 'succeeded'
  | 'failed'
  | 'processing'
  | 'pending_review'
  | 'not_executed'
  | 'export_failed'
  | 'missing_file';

/** 拒绝重复编号、错误栏位顺序和不一致的生成参数。 */
export function parseBatchPlan(value: unknown): BatchPlan {
  const plan = batchPlanSchema.parse(value);
  if (new Set(plan.candidates.map((item) => item.key)).size !== plan.candidates.length) {
    throw new Error('候选标识重复');
  }
  if (plan.candidates.some((item, index, all) => index > 0 && item.key <= all[index - 1]!.key)) {
    throw new Error('候选必须按 A、B、C 顺序排列');
  }
  if (new Set(plan.candidates.map((item) => item.versionId)).size !== plan.candidates.length) {
    throw new Error('候选版本 ID 重复');
  }
  if (plan.candidates.some((item) => !item.promptLabel.startsWith(`${item.key}-`))) {
    throw new Error('候选标识与提示词版本不匹配');
  }
  if (new Set(plan.cases.map((item) => item.id)).size !== plan.cases.length) {
    throw new Error('测试用例编号重复');
  }
  if ((plan.generation.aspectRatio === 'auto') !== (plan.generation.resolution === 'auto')) {
    throw new Error('auto 比例和分辨率必须成对使用');
  }
  for (const testCase of plan.cases) {
    if (new Set(testCase.inputs.map((item) => item.slotKey)).size !== testCase.inputs.length) {
      throw new Error(`${testCase.id} 的图片栏重复`);
    }
    if (testCase.inputs.some((item, index) => item.order !== index + 1)) {
      throw new Error(`${testCase.id} 的图片栏顺序不连续`);
    }
  }
  return plan;
}

/** 读取调用者准备的安全批次快照。 */
export async function readBatchPlan(planPath: string): Promise<BatchPlan> {
  return parseBatchPlan(JSON.parse(await readFile(planPath, 'utf8')));
}

/** 在付费提交前，按 MCP 相同规则检查整批素材的路径、大小和真实格式。 */
export async function validateBatchInputs(plan: BatchPlan, inputRoot: string): Promise<void> {
  const checked = new Set<string>();
  for (const testCase of plan.cases) {
    for (const input of testCase.inputs) {
      if (checked.has(input.path)) continue;
      await prepareGenerationInput(inputRoot, input.path);
      checked.add(input.path);
    }
  }
}

/** 检查报告是否属于本轮计划，并阻止错配版本、图片或补充描述进入汇总。 */
function assertMatchingReport(plan: BatchPlan, report: TrialExecutionReport): void {
  if (
    report.schemaVersion !== 1 ||
    report.goal !== 'run_template_trials' ||
    report.executionId !== plan.executionId
  ) {
    throw new Error('执行报告与批次计划不匹配');
  }
  const cases = new Map(plan.cases.map((item) => [item.id, item]));
  const candidates = new Map(plan.candidates.map((item) => [item.key, item]));
  const seen = new Set<string>();
  const seenSamples = new Set<string>();
  for (const sample of report.samples) {
    const testCase = cases.get(sample.sampleId);
    if (
      !testCase ||
      seenSamples.has(sample.sampleId) ||
      sample.inputs.length !== testCase.inputs.length
    ) {
      throw new Error('执行报告包含未知、重复或错配的样本');
    }
    seenSamples.add(sample.sampleId);
    sample.inputs.forEach((input, index) => {
      const expected = testCase.inputs[index]!;
      if (input.slotKey !== expected.slotKey || input.sourceRelativePath !== expected.path) {
        throw new Error(`${sample.sampleId} 的图片顺序或路径与计划不一致`);
      }
    });
  }
  for (const item of report.items) {
    const testCase = cases.get(item.sampleId);
    const candidate = candidates.get(item.candidateKey);
    const identity = `${item.sampleId}/${item.candidateKey}`;
    if (!testCase || !candidate || seen.has(identity))
      throw new Error('执行报告包含未知或重复的试用组合');
    seen.add(identity);
    if (
      item.versionId !== candidate.versionId ||
      item.revision !== candidate.revision ||
      (item.templateId && item.templateId !== candidate.templateId) ||
      item.generation.aspectRatio !== plan.generation.aspectRatio ||
      item.generation.resolution !== plan.generation.resolution ||
      (item.generation.quality ?? null) !== (plan.generation.quality ?? null) ||
      (item.generation.supplementalDescription ?? null) !== testCase.supplementalDescription
    ) {
      throw new Error(`${identity} 的版本或生成参数与计划不一致`);
    }
  }
}

/** 只允许报告的相对路径读取执行目录内的真实文件。 */
async function sourceInsideExecution(
  executionDirectory: string,
  relativePath: string | null,
): Promise<string | null> {
  if (!relativePath) return null;
  if (path.isAbsolute(relativePath)) throw new Error('报告文件路径超出执行目录');
  const candidate = path.resolve(executionDirectory, relativePath);
  const relative = path.relative(executionDirectory, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('报告文件路径超出执行目录');
  }
  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const actualRelative = path.relative(executionDirectory, actual);
  if (
    !actualRelative ||
    actualRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(actualRelative)
  ) {
    throw new Error('报告文件的真实路径超出执行目录');
  }
  return (await stat(actual)).isFile() ? actual : null;
}

/** 创建可直接浏览的短文件名；已有文件须与原图完全一致，不覆盖。 */
async function addReviewImage(source: string, target: string): Promise<void> {
  try {
    await link(source, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code !== 'EXDEV' &&
      code !== 'EPERM' &&
      code !== 'ENOTSUP' &&
      code !== 'EMLINK' &&
      code !== 'EEXIST'
    )
      throw error;
    if (code !== 'EEXIST') {
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
        return;
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError;
      }
    }
  }
  const existing = await lstat(target);
  if (!existing.isFile() || existing.isSymbolicLink())
    throw new Error(`已有汇总路径不是普通图片：${path.basename(target)}`);
  const original = await stat(source);
  if (
    original.size !== existing.size ||
    ((original.dev !== existing.dev || original.ino !== existing.ino) &&
      !(await readFile(source)).equals(await readFile(target)))
  ) {
    throw new Error(`已有汇总图片与原图不同：${path.basename(target)}`);
  }
}

/** 原子替换派生清单，防止中途退出后出现半份 JSON 或 Markdown。 */
async function writeDerivedFile(target: string, value: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

/** 将可信模板和本轮摘要写入同一汇总目录，支持 file:// 直接打开。 */
async function writeReviewPage(
  comparisonDirectory: string,
  summary: Record<string, unknown>,
): Promise<void> {
  const assetDirectory = new URL('../../comparison-preview/', import.meta.url);
  const [template, theme, style, script] = await Promise.all([
    readFile(new URL('review.html', assetDirectory), 'utf8'),
    readFile(new URL('workbench-theme.css', assetDirectory), 'utf8'),
    readFile(new URL('review.css', assetDirectory), 'utf8'),
    readFile(new URL('review.js', assetDirectory), 'utf8'),
  ]);
  // 防止补充描述等动态文本关闭 JSON script 标签，页面脚本始终只按数据解析。
  const embedded = JSON.stringify(summary).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  await writeDerivedFile(path.join(comparisonDirectory, 'workbench-theme.css'), theme);
  await writeDerivedFile(path.join(comparisonDirectory, 'review.css'), style);
  await writeDerivedFile(path.join(comparisonDirectory, 'review.js'), script);
  await writeDerivedFile(
    path.join(comparisonDirectory, 'index.html'),
    template.replace('__COMPARISON_SUMMARY__', embedded),
  );
}

/** 首次整理时固化计划；再次整理只接受内容相同的计划。 */
async function preservePlan(executionDirectory: string, plan: BatchPlan): Promise<void> {
  const target = path.join(executionDirectory, 'batch-plan.json');
  const canonical = `${JSON.stringify(plan, null, 2)}\n`;
  try {
    await writeFile(target, canonical, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = parseBatchPlan(JSON.parse(await readFile(target, 'utf8')));
    if (JSON.stringify(existing) !== JSON.stringify(plan))
      throw new Error('已有批次计划与当前计划不一致', { cause: error });
  }
}

/** 将 MCP 状态转换为文件夹汇总使用的互斥状态。 */
function itemStatus(item: TrialItemRecord | undefined): ResultStatus {
  if (!item || item.submissionStatus === 'not_executed') return 'not_executed';
  if (item.submissionStatus === 'pending_review') return 'pending_review';
  if (item.submissionStatus === 'failed' || item.taskStatus === 'failed') return 'failed';
  if (item.exportStatus === 'failed') return 'export_failed';
  if (item.taskStatus === 'succeeded' && item.exportStatus === 'downloaded') return 'succeeded';
  return 'processing';
}

/** 避免报告动态文案打断 Markdown 表格。 */
function markdown(value: string | null): string {
  return (value ?? '—').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}

/** 根据原始报告增量生成可浏览目录、安全 JSON 和人工总览。 */
export async function buildBatchComparison(
  plan: BatchPlan,
  outputRoot: string,
): Promise<{ directory: string; summary: Record<string, unknown> }> {
  const executionDirectory = await resolveExistingExecutionDirectory(outputRoot, plan.executionId);
  const report = JSON.parse(
    await readFile(path.join(executionDirectory, 'report.json'), 'utf8'),
  ) as TrialExecutionReport;
  assertMatchingReport(plan, report);
  await preservePlan(executionDirectory, plan);
  const comparisonDirectory = path.join(executionDirectory, 'comparison');
  await mkdir(comparisonDirectory, { recursive: true });
  if ((await realpath(comparisonDirectory)) !== comparisonDirectory)
    throw new Error('汇总目录不是执行目录内的普通目录');
  const samples = new Map(report.samples.map((item) => [item.sampleId, item]));
  const items = new Map(
    report.items.map((item) => [`${item.sampleId}/${item.candidateKey}`, item]),
  );
  const totals: Record<ResultStatus, number> = {
    succeeded: 0,
    failed: 0,
    processing: 0,
    pending_review: 0,
    not_executed: 0,
    export_failed: 0,
    missing_file: 0,
  };
  const cases = [];
  const anomalies: string[] = [];
  const lines = [
    '# 模板批量试用横向汇总',
    '',
    '- [打开逐例评审台](index.html)（石墨蓝紫，本地离线）',
    `- 模板类型：${plan.templateTypeId}`,
    `- 执行编号：${plan.executionId}`,
    `- MCP 报告状态：${report.status} / ${report.phase}`,
    `- 测试用例：${plan.cases.length}；候选：${plan.candidates.map((item) => item.promptLabel).join('、')}`,
    '',
    '| 用例 | 上传图 | ' + plan.candidates.map((item) => item.promptLabel).join(' | ') + ' |',
    '| --- | --- | ' + plan.candidates.map(() => '---').join(' | ') + ' |',
  ];
  for (const testCase of plan.cases) {
    const caseDirectory = path.join(comparisonDirectory, testCase.id);
    await mkdir(caseDirectory, { recursive: true });
    if ((await realpath(caseDirectory)) !== caseDirectory)
      throw new Error('用例目录不是汇总目录内的普通目录');
    const sample = samples.get(testCase.id);
    const inputs = [];
    for (const [index, expected] of testCase.inputs.entries()) {
      const source = await sourceInsideExecution(
        executionDirectory,
        sample?.inputs[index]?.copyRelativePath ?? null,
      );
      const alias = source
        ? `00-input_${String(index + 1).padStart(2, '0')}${path.extname(source).toLowerCase()}`
        : null;
      if (source && alias) await addReviewImage(source, path.join(caseDirectory, alias));
      inputs.push({
        order: expected.order,
        slotKey: expected.slotKey,
        path: alias ? `${testCase.id}/${alias}` : null,
        status: source ? 'available' : 'missing',
      });
      if (!source) anomalies.push(`${testCase.id}：上传图 ${expected.order} 的报告副本缺失`);
    }
    const results = [];
    for (const candidate of plan.candidates) {
      const item = items.get(`${testCase.id}/${candidate.key}`);
      let status = itemStatus(item);
      const source =
        status === 'succeeded'
          ? await sourceInsideExecution(executionDirectory, item?.resultRelativePath ?? null)
          : null;
      if (status === 'succeeded' && !source) status = 'missing_file';
      const alias = source
        ? `${{ A: '10', B: '20', C: '30' }[candidate.key]}-${candidate.promptLabel}${path.extname(source).toLowerCase()}`
        : null;
      if (source && alias) await addReviewImage(source, path.join(caseDirectory, alias));
      totals[status] += 1;
      results.push({
        key: candidate.key,
        promptLabel: candidate.promptLabel,
        templateId: candidate.templateId,
        versionId: candidate.versionId,
        revision: candidate.revision,
        taskId: item?.taskId ?? null,
        status,
        path: alias ? `${testCase.id}/${alias}` : null,
        errorCode: item?.errorCode ?? item?.lastQueryErrorCode ?? null,
        pointsCost: item?.pointsCost ?? null,
      });
      if (status !== 'succeeded')
        anomalies.push(
          `${testCase.id} / ${candidate.promptLabel}：${status}${item?.errorCode || item?.lastQueryErrorCode ? `（${markdown(item.errorCode ?? item.lastQueryErrorCode)}）` : ''}`,
        );
    }
    cases.push({
      id: testCase.id,
      imageSetId: testCase.imageSetId,
      supplementalDescription: testCase.supplementalDescription,
      inputs,
      results,
    });
    const inputLinks = inputs
      .map((input) => (input.path ? `[图${input.order}](${input.path})` : `图${input.order}缺失`))
      .join('、');
    const resultLinks = results.map((result) =>
      result.path ? `[${result.status}](${result.path})` : markdown(result.status),
    );
    lines.push(`| ${testCase.id} | ${inputLinks} | ${resultLinks.join(' | ')} |`);
  }
  const summary = {
    schemaVersion: 1,
    executionId: plan.executionId,
    templateTypeId: plan.templateTypeId,
    manifestRevision: plan.manifestRevision,
    reportStatus: report.status,
    reportPhase: report.phase,
    reportUpdatedAt: report.updatedAt,
    submissionHaltCode: report.submissionHaltCode,
    generation: plan.generation,
    candidates: plan.candidates,
    totals,
    cases,
  };
  lines.splice(
    7,
    0,
    `- 结果：成功 ${totals.succeeded}／失败 ${totals.failed}／处理中 ${totals.processing}／待核对 ${totals.pending_review}／未执行 ${totals.not_executed}／导出失败 ${totals.export_failed}／文件缺失 ${totals.missing_file}`,
  );
  if (report.submissionHaltCode)
    anomalies.unshift(`本轮停止继续提交：${markdown(report.submissionHaltCode)}`);
  if (anomalies.length > 0)
    lines.push('', '## 异常与待处理', '', ...anomalies.map((value) => `- ${value}`));
  lines.push('', '> 这里是 MCP 报告的派生视图；任务和积分以后台及原始 report.json 为准。', '');
  await writeDerivedFile(
    path.join(comparisonDirectory, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeDerivedFile(path.join(comparisonDirectory, 'README.md'), lines.join('\n'));
  await writeReviewPage(comparisonDirectory, summary);
  return { directory: comparisonDirectory, summary };
}
