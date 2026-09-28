/**
 * Codex 可发现的系统模板 MCP 工具。
 *
 * 本文件只负责参数约束、工具元数据和协议响应转换；管理员请求、上传与报告流程由应用服务完成。
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { batchSubmissionPlanSchema } from './batch-comparison.js';
import { createCandidateService, type CandidateServiceDependencies } from './candidate-service.js';
import { toSafeError } from './errors.js';
import { createTrialService, type TrialServiceDependencies } from './trial-service.js';
import {
  createTemplateMutationService,
  type TemplateMutationServiceDependencies,
} from './template-mutation-service.js';

const uuidSchema = z.string().uuid();
const inputKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  .max(50);

const templateInputSchema = z
  .object({
    key: inputKeySchema,
    order: z.number().int().min(1).max(4),
    label: z.string().min(1).max(100),
    required: z.literal(true),
    uploadRequirement: z.string().min(1).max(500),
    modelRole: z.string().min(1).max(1_000),
  })
  .strict();

const templateSchema = z
  .object({
    generationModelId: uuidSchema,
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    categoryId: uuidSchema,
    inputs: z.array(templateInputSchema).min(1).max(4),
    allowsSupplementalDescription: z.boolean(),
    supplementalDescriptionRecommendation: z.string().min(1).max(500).optional(),
    executionPrompt: z.string().min(1).max(5_000),
  })
  .strict();

const assetSchema = z
  .object({
    kind: z.enum(['effect', 'slot_example', 'preset']),
    inputKey: inputKeySchema.optional(),
    order: z.number().int().min(1),
    localPath: z.string().min(1).max(2_048),
  })
  .strict();

const systemTemplateQuerySchema = z
  .object({ templateId: uuidSchema.optional(), versionId: uuidSchema.optional() })
  .strict()
  .refine((value) => Number(Boolean(value.templateId)) + Number(Boolean(value.versionId)) === 1, {
    message: 'templateId 与 versionId 必须且只能提供一个',
  });

const createCandidateSchema = z
  .object({
    executionId: uuidSchema.optional(),
    template: templateSchema,
    assets: z.array(assetSchema).max(85),
  })
  .strict();

const reportQuerySchema = z.object({ executionId: uuidSchema }).strict();

const trialInputSchema = z
  .object({
    slotKey: inputKeySchema,
    localPath: z.string().min(1).max(2_048),
  })
  .strict();

const trialGenerationSchema = z
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
    supplementalDescription: z.string().max(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.aspectRatio === 'auto' && value.resolution === 'auto') ||
      (value.aspectRatio !== 'auto' && value.resolution !== 'auto'),
    {
      message: 'auto 比例和 auto 分辨率必须成对使用',
      path: ['resolution'],
    },
  );

const submitTrialSchema = z
  .object({
    executionId: uuidSchema,
    sampleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/),
    candidateKey: z.enum(['A', 'B', 'C']),
    versionId: uuidSchema,
    expectedRevision: z.number().int().min(1).max(2_147_483_647),
    inputs: z.array(trialInputSchema).min(1).max(4),
    generation: trialGenerationSchema,
  })
  .strict();

const collectTrialSchema = z
  .object({
    executionId: uuidSchema,
    maxItems: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const inputModelRoleUpdateSchema = z
  .object({
    key: inputKeySchema,
    modelRole: z.string().min(1).max(1_000),
  })
  .strict();

const updatePromptSchema = z
  .object({
    executionId: uuidSchema.optional(),
    versionId: uuidSchema,
    expectedRevision: z.number().int().min(1).max(2_147_483_647),
    executionPrompt: z.string().min(1).max(5_000),
    inputModelRoles: z.array(inputModelRoleUpdateSchema).min(1).max(4).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.inputModelRoles ||
      new Set(value.inputModelRoles.map((item) => item.key)).size === value.inputModelRoles.length,
    { message: 'inputModelRoles 不能包含重复 key' },
  );

const deleteCandidateSchema = z
  .object({
    executionId: uuidSchema.optional(),
    templateId: uuidSchema,
    expectedRevision: z.number().int().min(1).max(2_147_483_647),
  })
  .strict();

export type TemplateMcpDependencies = CandidateServiceDependencies &
  TrialServiceDependencies &
  TemplateMutationServiceDependencies;

/** 将结构化结果同时放入文本与 structuredContent，兼容不同 MCP 客户端。 */
function successResult(value: unknown) {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent,
  };
}

/** 将内部异常转成不包含令牌、签名地址和供应商原始错误的 MCP 错误。 */
function errorResult(error: unknown) {
  const safe = toSafeError(error);
  const value = {
    ok: false,
    error: { code: safe.code, message: safe.message, uncertain: safe.uncertain },
  };
  return { ...successResult(value), isError: true };
}

/** 包装只读工具，统一安全错误边界。 */
async function runReadTool<T>(operation: () => Promise<T>) {
  try {
    return successResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

/** 创建并注册项目级 MCP Server，测试可注入应用服务依赖。 */
export function createTemplateMcpServer(dependencies: TemplateMcpDependencies = {}): McpServer {
  const service = createCandidateService(dependencies);
  const trials = createTrialService(dependencies);
  const mutations = createTemplateMutationService(dependencies);
  const server = new McpServer(
    { name: 'aipic-template-testing', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        '先调用 get_admin_context 核对正式管理员、分类和模型，再查询或写入。禁止自动发布。候选创建和删除逐项执行；批量试用可一次调用并由服务内部串行提交，全部提交后才开始结果收集。提示词更新只替换明确提供的字段。写入结果不明确时先用 executionId 核对报告，绝不可自动重发。报告不保存令牌、对象Key、签名地址、完整提示词或模型作用。',
    },
  );

  server.registerTool(
    'get_admin_context',
    {
      description: '读取正式管理员摘要、模板分类和可用于系统模板的安全模型配置。',
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => runReadTool(() => service.getAdminContext()),
  );

  server.registerTool(
    'get_system_template',
    {
      description: '按稳定模板 ID 或版本 ID 读取完整版本；模板查询优先工作版本。',
      inputSchema: systemTemplateQuerySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) =>
      runReadTool(() =>
        service.getSystemTemplate({
          ...(input.templateId ? { templateId: input.templateId } : {}),
          ...(input.versionId ? { versionId: input.versionId } : {}),
        }),
      ),
  );

  server.registerTool(
    'create_system_template_candidate',
    {
      description:
        '创建一个系统模板候选；素材可为空，有素材时顺序上传，随后进入 testing。不会发布或自动重试。',
      inputSchema: createCandidateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { supplementalDescriptionRecommendation, ...requiredTemplate } = input.template;
      const result = await service.createCandidate({
        ...(input.executionId ? { executionId: input.executionId } : {}),
        template: {
          ...requiredTemplate,
          ...(supplementalDescriptionRecommendation
            ? { supplementalDescriptionRecommendation }
            : {}),
        },
        assets: input.assets.map(({ inputKey, ...requiredAsset }) =>
          inputKey ? { ...requiredAsset, inputKey } : requiredAsset,
        ),
      });
      return { ...successResult(result), ...(result.ok ? {} : { isError: true }) };
    },
  );

  server.registerTool(
    'submit_template_trial',
    {
      description:
        '提交一个样本与候选版本组合；比例和分辨率必须使用实时模型支持的同一尺寸组合，auto 必须成对出现且不是默认分辨率。每张输入独立上传，一次只创建一个付费单图任务。',
      inputSchema: submitTrialSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { quality, supplementalDescription, ...requiredGeneration } = input.generation;
      const result = await trials.submit({
        executionId: input.executionId,
        sampleId: input.sampleId,
        candidateKey: input.candidateKey,
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        inputs: input.inputs.map((item) => ({ ...item })),
        generation: {
          ...requiredGeneration,
          ...(quality ? { quality } : {}),
          ...(supplementalDescription ? { supplementalDescription } : {}),
        },
      });
      return { ...successResult(result), ...(result.ok ? {} : { isError: true }) };
    },
  );

  server.registerTool(
    'submit_template_trial_batch',
    {
      description:
        '整批预检后按用例及 A/B/C 顺序逐项提交付费试用；保留每项报告、全局停机与原执行编号，不自动重试已有执行。',
      inputSchema: z.object({ plan: batchSubmissionPlanSchema }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const result = await trials.submitBatch(input.plan);
        return { ...successResult(result), ...(result.ok ? {} : { isError: true }) };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'collect_template_trial_results',
    {
      description:
        '关闭该执行的提交阶段，单轮查询最多十个任务并导出成功图片；不会等待、轮询或重提生图。',
      inputSchema: collectTrialSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) =>
      runReadTool(() =>
        trials.collect({
          executionId: input.executionId,
          ...(input.maxItems ? { maxItems: input.maxItems } : {}),
        }),
      ),
  );

  server.registerTool(
    'update_system_template_prompt',
    {
      description:
        '读取权威完整表单，必要时退回 draft，仅更新基础提示词和指定栏位模型作用，再进入 testing。',
      inputSchema: updatePromptSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await mutations.updatePrompt({
        ...(input.executionId ? { executionId: input.executionId } : {}),
        versionId: input.versionId,
        expectedRevision: input.expectedRevision,
        executionPrompt: input.executionPrompt,
        ...(input.inputModelRoles
          ? { inputModelRoles: input.inputModelRoles.map((item) => ({ ...item })) }
          : {}),
      });
      return { ...successResult(result), ...(result.ok ? {} : { isError: true }) };
    },
  );

  server.registerTool(
    'delete_unpublished_system_template',
    {
      description: '软删除一个从未发布且没有活跃试用的系统候选；保留版本、素材、任务、积分和结果。',
      inputSchema: deleteCandidateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await mutations.deleteCandidate({
        ...(input.executionId ? { executionId: input.executionId } : {}),
        templateId: input.templateId,
        expectedRevision: input.expectedRevision,
      });
      return { ...successResult(result), ...(result.ok ? {} : { isError: true }) };
    },
  );

  server.registerTool(
    'get_template_trial_report',
    {
      description: '按 executionId 读取候选创建、批量试用或模板变更的安全摘要与报告路径。',
      inputSchema: reportQuerySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => runReadTool(() => service.getReport(input.executionId)),
  );

  return server;
}
