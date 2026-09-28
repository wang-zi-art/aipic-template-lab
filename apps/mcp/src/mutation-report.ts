/**
 * 提示词更新与候选删除共用的安全执行报告。
 *
 * 报告只保存模板标识、revision、状态、步骤和字段名，不保存完整提示词、模型作用、会话、
 * 对象 Key、签名地址或供应商错误；旧候选和试用报告继续由原格式读取。
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { McpOperationError } from './errors.js';
import { resolveExistingExecutionDirectory } from './local-files.js';
import { initializeExecutionDirectory, type ReportPaths } from './report.js';

export type TemplateMutationGoal =
  'update_system_template_prompt' | 'delete_unpublished_system_template';
export type TemplateMutationStep =
  | 'initialized'
  | 'template_read'
  | 'returned_to_draft'
  | 'form_saved'
  | 'entered_testing'
  | 'final_read'
  | 'deleted';

export interface TemplateMutationReport {
  schemaVersion: 1;
  executionId: string;
  goal: TemplateMutationGoal;
  apiBaseUrl: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  completedStep: TemplateMutationStep;
  stoppedStep: TemplateMutationStep | null;
  requiresReview: boolean;
  errorCode: string | null;
  templateId: string | null;
  versionId: string | null;
  initialRevision: number;
  currentRevision: number | null;
  serverStatus: string | null;
  changedFields: string[];
  deletedAt: string | null;
  replayed: boolean | null;
}

/** 把动态文字压成单行，避免 Markdown 列表被异常内容破坏。 */
function markdownText(value: string | null): string {
  return (value ?? '—').replace(/[\r\n]+/g, ' ');
}

/** 将安全机器记录渲染为人工可读报告。 */
export function renderTemplateMutationReport(report: TemplateMutationReport): string {
  return [
    '# Codex 系统模板变更执行报告',
    '',
    `- 执行编号：\`${report.executionId}\``,
    `- 操作：\`${report.goal}\``,
    `- 目标环境：${markdownText(report.apiBaseUrl)}`,
    `- 状态：\`${report.status}\``,
    `- 已完成／停止步骤：\`${report.completedStep}\` / ${report.stoppedStep ? `\`${report.stoppedStep}\`` : '—'}`,
    `- 模板／版本：${report.templateId ?? '—'} / ${report.versionId ?? '—'}`,
    `- 初始／当前 revision：${report.initialRevision} / ${report.currentRevision ?? '—'}`,
    `- 服务端状态：${report.serverStatus ?? '—'}`,
    `- 修改字段：${report.changedFields.length ? report.changedFields.join('、') : '—'}`,
    `- 删除时间／幂等重放：${report.deletedAt ?? '—'} / ${report.replayed === null ? '—' : report.replayed ? '是' : '否'}`,
    `- 是否需要人工核对：${report.requiresReview ? '是' : '否'}`,
    `- 错误码：${report.errorCode ?? '—'}`,
    `- 开始／更新时间／结束时间：${report.startedAt} / ${report.updatedAt} / ${report.finishedAt ?? '—'}`,
    '',
    '> PostgreSQL 中的模板状态始终是业务真相；本报告不保存提示词或模型作用正文。',
    '',
  ].join('\n');
}

/** 在同一目录写临时文件后原子替换正式报告。 */
async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

/** 返回变更报告固定文件路径。 */
function reportPaths(directory: string): ReportPaths {
  return {
    directory,
    json: path.join(directory, 'report.json'),
    markdown: path.join(directory, 'report.md'),
  };
}

/** 独占创建本次模板变更执行目录。 */
export async function initializeTemplateMutationDirectory(
  outputRoot: string,
  executionId: string,
): Promise<ReportPaths> {
  return initializeExecutionDirectory(outputRoot, executionId);
}

/** 同步原子更新 JSON 和 Markdown 变更报告。 */
export async function writeTemplateMutationReport(
  paths: ReportPaths,
  report: TemplateMutationReport,
): Promise<void> {
  try {
    await atomicWrite(paths.json, `${JSON.stringify(report, null, 2)}\n`);
    await atomicWrite(paths.markdown, renderTemplateMutationReport(report));
  } catch {
    throw new McpOperationError('MCP_REPORT_WRITE_FAILED', '本地变更报告写入失败', true);
  }
}

/** 从受控输出目录读取并校验一份模板变更报告。 */
export async function readTemplateMutationReport(
  outputRoot: string,
  executionId: string,
): Promise<{ report: TemplateMutationReport; paths: ReportPaths }> {
  const directory = await resolveExistingExecutionDirectory(outputRoot, executionId);
  const paths = reportPaths(directory);
  let report: TemplateMutationReport;
  try {
    report = JSON.parse(await readFile(paths.json, 'utf8')) as TemplateMutationReport;
  } catch {
    throw new McpOperationError('MCP_REPORT_INVALID', '模板变更报告不存在或格式不正确');
  }
  if (
    report.schemaVersion !== 1 ||
    report.executionId !== executionId ||
    !['update_system_template_prompt', 'delete_unpublished_system_template'].includes(report.goal)
  ) {
    throw new McpOperationError('MCP_REPORT_INVALID', '模板变更报告与请求编号不一致');
  }
  return { report, paths };
}
