/**
 * 多样本管理员试用的本地执行记录与双格式报告。
 *
 * JSON 保存恢复查询所需的安全标识，Markdown 面向项目负责人；两者都不保存会话、COS票据、
 * 对象Key、签名地址、隐藏提示词或供应商原始错误。
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  GenerationAspectRatio,
  ImageUploadContentType,
  ModelQuality,
  ModelResolution,
} from '@aipic/contracts';
import type { TemplateMutationReport } from './mutation-report.js';
import { McpOperationError } from './errors.js';
import { resolveExistingExecutionDirectory } from './local-files.js';
import {
  initializeExecutionDirectory,
  type CandidateExecutionReport,
  type ReportPaths,
} from './report.js';

export type TrialExecutionStatus = 'running' | 'partial' | 'completed';
export type TrialExecutionPhase = 'submitting' | 'collecting' | 'finished';
export type TrialSubmissionStatus =
  'preparing' | 'submitted' | 'failed' | 'pending_review' | 'not_executed';
export type TrialTaskStatus = 'not_submitted' | 'queued' | 'processing' | 'succeeded' | 'failed';
export type TrialExportStatus = 'not_applicable' | 'pending' | 'downloaded' | 'failed';

export interface TrialGenerationParameters {
  aspectRatio: GenerationAspectRatio;
  /** 新提交必须明确记录分辨率；旧版 schemaVersion 1 JSON 仍按宽松读取方式兼容。 */
  resolution: ModelResolution | 'auto';
  quality?: ModelQuality;
  supplementalDescription?: string;
}

export interface TrialSampleInputRecord {
  slotKey: string;
  sourceRelativePath: string;
  copyRelativePath: string;
  contentType: ImageUploadContentType;
  sizeBytes: number;
  sha256: string;
}

export interface TrialSampleRecord {
  sampleId: string;
  inputs: TrialSampleInputRecord[];
}

export interface TrialItemRecord {
  sampleId: string;
  candidateKey: 'A' | 'B' | 'C';
  templateId: string | null;
  templateName: string | null;
  versionId: string;
  version: number | null;
  revision: number;
  generation: TrialGenerationParameters;
  uploadIds: Array<string | null>;
  clientRequestId: string;
  taskId: string | null;
  pointsCost: number | null;
  submissionStatus: TrialSubmissionStatus;
  taskStatus: TrialTaskStatus;
  exportStatus: TrialExportStatus;
  resultRelativePath: string | null;
  errorCode: string | null;
  lastQueryErrorCode: string | null;
  lastQueriedAt: string | null;
}

export interface TrialExecutionReport {
  schemaVersion: 1;
  executionId: string;
  goal: 'run_template_trials';
  apiBaseUrl: string;
  status: TrialExecutionStatus;
  phase: TrialExecutionPhase;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  submissionHaltCode: string | null;
  /** 可选统计兼容旧报告，仅记录阶段耗时而不记录私密输入。 */
  timingsMs?: { preflight: number; submission: number; collection: number; comparison: number };
  /** 轮换待查询任务，避免超过单轮上限时尾部任务一直排队。 */
  collectCursor?: number;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    processing: number;
    pendingReview: number;
    notExecuted: number;
  };
  samples: TrialSampleRecord[];
  items: TrialItemRecord[];
}

/** 将动态文字限制在一行并转义Markdown表格分隔符。 */
function markdownText(value: string | null): string {
  return (value ?? '—').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}

/** 根据明细重新计算统计和顶层状态，避免调用方维护多份真相。 */
export function aggregateTrialReport(report: TrialExecutionReport): void {
  const summary = {
    total: report.items.length,
    succeeded: 0,
    failed: 0,
    processing: 0,
    pendingReview: 0,
    notExecuted: 0,
  };
  for (const item of report.items) {
    if (item.submissionStatus === 'not_executed') summary.notExecuted += 1;
    else if (item.submissionStatus === 'pending_review' || item.exportStatus === 'failed') {
      summary.pendingReview += 1;
    } else if (item.submissionStatus === 'failed' || item.taskStatus === 'failed') {
      summary.failed += 1;
    } else if (item.taskStatus === 'succeeded' && item.exportStatus === 'downloaded') {
      summary.succeeded += 1;
    } else if (
      item.submissionStatus === 'preparing' ||
      item.taskStatus === 'queued' ||
      item.taskStatus === 'processing' ||
      (item.taskStatus === 'succeeded' && item.exportStatus === 'pending')
    ) {
      summary.processing += 1;
    }
  }
  report.summary = summary;
  if (report.phase === 'submitting' || summary.processing > 0) {
    report.status = 'running';
    report.finishedAt = null;
  } else if (summary.pendingReview > 0 || summary.notExecuted > 0) {
    report.status = 'partial';
    report.phase = 'finished';
  } else {
    report.status = 'completed';
    report.phase = 'finished';
  }
}

/** 渲染不含本地绝对路径和短期地址的人工评审报告。 */
export function renderTrialReportMarkdown(report: TrialExecutionReport): string {
  return [
    '# Codex 系统模板试用执行报告',
    '',
    `- 执行编号：\`${report.executionId}\``,
    `- 目标环境：${markdownText(report.apiBaseUrl)}`,
    `- 阶段／状态：\`${report.phase}\` / \`${report.status}\``,
    `- 开始／更新时间：${report.startedAt} / ${report.updatedAt}`,
    `- 停止新提交原因：${report.submissionHaltCode ?? '—'}`,
    '',
    '## 汇总',
    '',
    `- 总数：${report.summary.total}`,
    `- 成功／失败／处理中：${report.summary.succeeded} / ${report.summary.failed} / ${report.summary.processing}`,
    `- 待核对／未执行：${report.summary.pendingReview} / ${report.summary.notExecuted}`,
    '',
    '## 组合明细',
    '',
    '| 样本 | 候选 | 模板版本 | revision | 任务 | 提交 | 任务状态 | 导出 | 错误码 |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
    ...report.items.map(
      (item) =>
        `| ${markdownText(item.sampleId)} | ${item.candidateKey} | ${markdownText(item.templateName)} v${item.version ?? '—'} | ${item.revision} | ${item.taskId ?? '—'} | ${item.submissionStatus} | ${item.taskStatus} | ${item.exportStatus} | ${item.errorCode ?? item.lastQueryErrorCode ?? '—'} |`,
    ),
    '',
    '## 本地文件',
    '',
    ...report.samples.flatMap((sample) => [
      `- ${markdownText(sample.sampleId)}：${sample.inputs.map((input) => markdownText(input.copyRelativePath)).join('、')}`,
      ...report.items
        .filter((item) => item.sampleId === sample.sampleId && item.resultRelativePath)
        .map((item) => `  - ${item.candidateKey}：${markdownText(item.resultRelativePath)}`),
    ]),
    '',
    '> PostgreSQL中的任务与积分状态始终是业务真相；本报告只负责恢复查询和整理本地文件。',
    '',
  ].join('\n');
}

/** 在同一目录写临时文件后原子替换，避免中断留下半份JSON。 */
async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

/** 返回固定报告文件路径。 */
function reportPaths(directory: string): ReportPaths {
  return {
    directory,
    json: path.join(directory, 'report.json'),
    markdown: path.join(directory, 'report.md'),
  };
}

/** 独占创建新的试用执行目录。 */
export async function initializeTrialReportDirectory(
  outputRoot: string,
  executionId: string,
): Promise<ReportPaths> {
  return initializeExecutionDirectory(outputRoot, executionId);
}

/** 同步更新机器记录和人工报告；任一写入失败都阻止后续远程操作。 */
export async function writeTrialReport(
  paths: ReportPaths,
  report: TrialExecutionReport,
): Promise<void> {
  try {
    aggregateTrialReport(report);
    await atomicWrite(paths.json, `${JSON.stringify(report, null, 2)}\n`);
    await atomicWrite(paths.markdown, renderTrialReportMarkdown(report));
  } catch {
    throw new McpOperationError('MCP_REPORT_WRITE_FAILED', '本地试用报告写入失败', true);
  }
}

/** 从受控目录恢复试用报告并检查执行身份。 */
export async function readTrialReport(
  outputRoot: string,
  executionId: string,
): Promise<{ report: TrialExecutionReport; paths: ReportPaths }> {
  const directory = await resolveExistingExecutionDirectory(outputRoot, executionId);
  const paths = reportPaths(directory);
  let report: TrialExecutionReport;
  try {
    report = JSON.parse(await readFile(paths.json, 'utf8')) as TrialExecutionReport;
  } catch {
    throw new McpOperationError('MCP_REPORT_INVALID', '试用执行报告不存在或格式不正确');
  }
  if (
    report.schemaVersion !== 1 ||
    report.executionId !== executionId ||
    report.goal !== 'run_template_trials' ||
    !Array.isArray(report.samples) ||
    !Array.isArray(report.items)
  ) {
    throw new McpOperationError('MCP_REPORT_INVALID', '试用执行报告与请求编号不一致');
  }
  return { report, paths };
}

/** 统一读取候选创建、批量试用或模板变更报告。 */
export async function readAnyExecutionReport(
  outputRoot: string,
  executionId: string,
): Promise<{
  report: CandidateExecutionReport | TrialExecutionReport | TemplateMutationReport;
  paths: ReportPaths;
}> {
  const directory = await resolveExistingExecutionDirectory(outputRoot, executionId);
  const paths = reportPaths(directory);
  let report: CandidateExecutionReport | TrialExecutionReport | TemplateMutationReport;
  try {
    report = JSON.parse(await readFile(paths.json, 'utf8')) as
      CandidateExecutionReport | TrialExecutionReport | TemplateMutationReport;
  } catch {
    throw new McpOperationError('MCP_REPORT_INVALID', '执行报告不存在或格式不正确');
  }
  if (
    report.schemaVersion !== 1 ||
    report.executionId !== executionId ||
    ![
      'create_system_template_candidate',
      'run_template_trials',
      'update_system_template_prompt',
      'delete_unpublished_system_template',
    ].includes(report.goal)
  ) {
    throw new McpOperationError('MCP_REPORT_INVALID', '执行报告与请求编号不一致');
  }
  return { report, paths };
}
