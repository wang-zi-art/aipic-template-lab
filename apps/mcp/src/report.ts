/**
 * 单候选执行记录与双格式报告。
 *
 * JSON 保存后续核对所需的安全机器字段，Markdown 面向项目负责人；两者均不保存令牌、对象 Key、
 * 签名地址、完整提示词或图片栏模型作用。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AdminSystemTemplateAssetContentType,
  AdminSystemTemplateAssetKind,
} from '@aipic/contracts';
import { McpOperationError } from './errors.js';
import { prepareOutputRoot, resolveExistingExecutionDirectory } from './local-files.js';

export type CandidateExecutionStatus = 'running' | 'completed' | 'partial' | 'failed';
export type CandidateExecutionStep =
  | 'initialized'
  | 'admin_context'
  | 'template_created'
  | 'asset_ticket'
  | 'asset_upload'
  | 'asset_complete'
  | 'enter_testing'
  | 'final_read';

export interface CandidateReportAsset {
  kind: AdminSystemTemplateAssetKind;
  inputKey: string | null;
  order: number;
  relativePath: string;
  contentType: AdminSystemTemplateAssetContentType;
  sizeBytes: number;
  status: 'pending' | 'uploaded' | 'registered' | 'failed' | 'uncertain';
  errorCode: string | null;
}

export interface CandidateExecutionReport {
  schemaVersion: 1;
  executionId: string;
  goal: 'create_system_template_candidate';
  apiBaseUrl: string;
  status: CandidateExecutionStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  completedStep: CandidateExecutionStep;
  stoppedStep: CandidateExecutionStep | null;
  requiresReview: boolean;
  errorCode: string | null;
  candidate: {
    name: string;
    categoryId: string;
    generationModelId: string;
    templateId: string | null;
    versionId: string | null;
    version: number | null;
    revision: number | null;
    serverStatus: string | null;
  };
  assets: CandidateReportAsset[];
}

export interface ReportPaths {
  directory: string;
  json: string;
  markdown: string;
}

/** 把动态文字压成单行并转义表格分隔符，避免报告结构被用户输入破坏。 */
function markdownText(value: string | null): string {
  return (value ?? '—').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
}

/** 将安全执行记录渲染为便于人工审核的 Markdown。 */
export function renderCandidateReportMarkdown(report: CandidateExecutionReport): string {
  const lines = [
    '# Codex 系统模板候选执行报告',
    '',
    `- 执行编号：\`${report.executionId}\``,
    `- 目标环境：${markdownText(report.apiBaseUrl)}`,
    `- 执行状态：\`${report.status}\``,
    `- 已完成步骤：\`${report.completedStep}\``,
    `- 停止步骤：${report.stoppedStep ? `\`${report.stoppedStep}\`` : '—'}`,
    `- 开始时间：${report.startedAt}`,
    `- 更新时间：${report.updatedAt}`,
    `- 结束时间：${report.finishedAt ?? '—'}`,
    '',
    '## 候选模板',
    '',
    `- 名称：${markdownText(report.candidate.name)}`,
    `- 模板 ID：${report.candidate.templateId ?? '—'}`,
    `- 版本 ID：${report.candidate.versionId ?? '—'}`,
    `- 版本／revision：${report.candidate.version ?? '—'} / ${report.candidate.revision ?? '—'}`,
    `- 服务端状态：${report.candidate.serverStatus ?? '—'}`,
    '',
    '## 素材',
    '',
    '| 类型 | 图片栏 | 顺序 | 本地相对路径 | 格式 | 大小 | 状态 | 错误码 |',
    '| --- | --- | ---: | --- | --- | ---: | --- | --- |',
    ...report.assets.map(
      (asset) =>
        `| ${asset.kind} | ${markdownText(asset.inputKey)} | ${asset.order} | ${markdownText(asset.relativePath)} | ${asset.contentType} | ${asset.sizeBytes} | ${asset.status} | ${asset.errorCode ?? '—'} |`,
    ),
    '',
    '## 结果',
    '',
    `- 是否需要人工核对：${report.requiresReview ? '是' : '否'}`,
    `- 错误码：${report.errorCode ?? '—'}`,
    '',
    '> PostgreSQL 中的模板状态始终是业务真相；本报告只用于恢复查询和人工核对。',
    '',
  ];
  return lines.join('\n');
}

/** 在同一目录写临时文件后原子替换正式报告。 */
async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

/** 返回固定的报告文件位置。 */
function createReportPaths(directory: string): ReportPaths {
  return {
    directory,
    json: path.join(directory, 'report.json'),
    markdown: path.join(directory, 'report.md'),
  };
}

/** 独占创建一次执行目录；同名 executionId 绝不复用。 */
export async function initializeExecutionDirectory(
  outputRoot: string,
  executionId: string,
): Promise<ReportPaths> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(executionId)) {
    throw new McpOperationError('MCP_EXECUTION_ID_INVALID', 'executionId 必须是 UUID v4');
  }
  const root = await prepareOutputRoot(outputRoot);
  const directory = path.join(root, executionId);
  try {
    await mkdir(directory);
  } catch {
    throw new McpOperationError('MCP_EXECUTION_ALREADY_EXISTS', '执行编号已存在，不能覆盖或复用');
  }
  return createReportPaths(directory);
}

/** 同步更新 JSON 和 Markdown；任一失败都阻止编排继续执行。 */
export async function writeCandidateReport(
  paths: ReportPaths,
  report: CandidateExecutionReport,
): Promise<void> {
  try {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const markdown = renderCandidateReportMarkdown(report);
    await atomicWrite(paths.json, json);
    await atomicWrite(paths.markdown, markdown);
  } catch {
    throw new McpOperationError('MCP_REPORT_WRITE_FAILED', '本地执行报告写入失败', true);
  }
}

/** 从受控输出目录读取并基础校验一个执行报告。 */
export async function readCandidateReport(
  outputRoot: string,
  executionId: string,
): Promise<{ report: CandidateExecutionReport; paths: ReportPaths }> {
  const directory = await resolveExistingExecutionDirectory(outputRoot, executionId);
  const paths = createReportPaths(directory);
  let report: CandidateExecutionReport;
  try {
    report = JSON.parse(await readFile(paths.json, 'utf8')) as CandidateExecutionReport;
  } catch {
    throw new McpOperationError('MCP_REPORT_INVALID', '执行报告不存在或格式不正确');
  }
  if (report.schemaVersion !== 1 || report.executionId !== executionId) {
    throw new McpOperationError('MCP_REPORT_INVALID', '执行报告与请求编号不一致');
  }
  return { report, paths };
}
