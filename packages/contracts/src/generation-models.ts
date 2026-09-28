/** 模型目录的共享契约、固定参数档案和计价规则；这里只包含可公开配置，不包含服务商凭据。 */
export const modelResolutions = ['1k', '2k', '4k'] as const;
export const modelQualities = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const modelStatuses = ['disabled', 'admin_only', 'public'] as const;
export const modelSizeProfiles = [
  'gpt_1k_pixels',
  'gpt_multi_pixels',
  'gemini_ratio_size',
  'gemini_ratio_1k',
] as const;
export type ModelSizeProfile = (typeof modelSizeProfiles)[number];

/** GPT多分辨率模型使用供应商明确给出的固定像素表。 */
export const gptMultiPixelSizeTable = {
  '1:1': ['1024x1024', '2048x2048', '2880x2880'],
  '16:9': ['1280x720', '2048x1152', '3840x2160'],
  '9:16': ['720x1280', '1152x2048', '2160x3840'],
  '4:3': ['1152x864', '2304x1728', '3264x2448'],
  '3:4': ['864x1152', '1728x2304', '2448x3264'],
  '3:2': ['1536x1024', '2048x1360', '3504x2336'],
  '2:3': ['1024x1536', '1360x2048', '2336x3504'],
  '5:4': ['1120x896', '2240x1792', '3200x2560'],
  '4:5': ['896x1120', '1792x2240', '2560x3200'],
  '21:9': ['1456x624', '2912x1248', '3840x1648'],
  '9:21': ['624x1456', '1248x2912', '1648x3840'],
  '2:1': ['1536x768', '3072x1536', '3840x1920'],
  '1:2': ['768x1536', '1536x3072', '1920x3840'],
} as const;

/** GPT标准模型只接受1K像素值，同一比例不能复用多分辨率模型的1K映射。 */
export const gptOneKilopixelSizeTable = {
  '1:1': '1024x1024',
  '16:9': '1672x941',
  '9:16': '941x1672',
  '4:3': '1443x1090',
  '3:4': '1090x1443',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1408x1120',
  '4:5': '1120x1408',
  '21:9': '1920x832',
  '9:21': '832x1920',
  '2:1': '1792x896',
  '1:2': '896x1792',
} as const;
export type ModelRatio = keyof typeof gptMultiPixelSizeTable;
export type ModelResolution = (typeof modelResolutions)[number];
export type ModelQuality = (typeof modelQualities)[number];
export type ModelStatus = (typeof modelStatuses)[number];
export const modelRatios = Object.keys(gptMultiPixelSizeTable) as ModelRatio[];
export const geminiModelRatios = [
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
] as const satisfies readonly ModelRatio[];
export const registeredProviderModelIds = [
  'gpt-image-2',
  'gpt-image-2.5',
  'gpt-image-2-vip',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
  'nano-banana-pro',
  'nano-banana-2',
  'nano-banana-2-lite',
] as const;
export type RegisteredProviderModelId = (typeof registeredProviderModelIds)[number];
export const registeredModelSizeProfiles: Record<RegisteredProviderModelId, ModelSizeProfile> = {
  'gpt-image-2': 'gpt_1k_pixels',
  'gpt-image-2.5': 'gpt_1k_pixels',
  'gpt-image-2-vip': 'gpt_multi_pixels',
  'gpt-image-2.5-flare': 'gpt_multi_pixels',
  'gpt-image-2.5-sunburst': 'gpt_multi_pixels',
  'nano-banana-pro': 'gemini_ratio_size',
  'nano-banana-2': 'gemini_ratio_size',
  'nano-banana-2-lite': 'gemini_ratio_1k',
};
export const modelQualitySuggestions: Record<string, ModelQuality[]> = {
  'gpt-image-2': ['auto'],
  'gpt-image-2.5': ['auto'],
  'gpt-image-2-vip': ['medium'],
  'gpt-image-2.5-flare': ['low', 'medium', 'high'],
  'gpt-image-2.5-sunburst': ['low', 'medium', 'high', 'xhigh', 'max'],
  'nano-banana-pro': [],
  'nano-banana-2': [],
  'nano-banana-2-lite': [],
};

/** Nano Banana当前登记的型号不接受质量参数，空数组表示请求中必须省略quality。 */
export function isNanoBananaModel(providerModelId: string): boolean {
  return (
    Object.hasOwn(registeredModelSizeProfiles, providerModelId) &&
    registeredModelSizeProfiles[providerModelId as RegisteredProviderModelId].startsWith('gemini_')
  );
}
export interface ModelSizeOption {
  ratio: ModelRatio;
  resolution: ModelResolution;
}
export interface GenerationModelWrite {
  provider: 'grsai';
  displayName: string;
  providerModelId: string;
  basePoints: number;
  supportsAuto: boolean;
  sizes: ModelSizeOption[];
  qualities: ModelQuality[];
  defaultRatio: ModelRatio | 'auto';
  defaultResolution: ModelResolution | 'auto';
  defaultQuality: ModelQuality | null;
}
export interface GenerationModelRecord extends GenerationModelWrite {
  modelId: string;
  sizeProfile: ModelSizeProfile;
  status: ModelStatus;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
}
const qualityExtras = { auto: 0, low: 0, medium: 5, high: 10, xhigh: 15, max: 20 };
const resolutionExtras = { auto: 0, '1k': 0, '2k': 10, '4k': 20 };
// 上限为数据库Int及最多4张的总价预留空间，拒绝溢出而不截断金额。
export const maximumModelBasePoints = 536870871;

/** 将供应商模型ID映射到唯一参数档案；未知型号必须在写入或执行前失败。 */
export function findModelSizeProfile(providerModelId: string): ModelSizeProfile | null {
  return Object.hasOwn(registeredModelSizeProfiles, providerModelId)
    ? registeredModelSizeProfiles[providerModelId as RegisteredProviderModelId]
    : null;
}

/** 返回档案固定开放的完整手动能力，后台只能展示，不能增删。 */
export function modelSizesForProfile(profile: ModelSizeProfile): ModelSizeOption[] {
  const ratios = profile.startsWith('gemini_') ? geminiModelRatios : modelRatios;
  const resolutions =
    profile === 'gpt_1k_pixels' || profile === 'gemini_ratio_1k'
      ? (['1k'] as const)
      : modelResolutions;
  return ratios.flatMap((ratio) => resolutions.map((resolution) => ({ ratio, resolution })));
}

/** 比较管理员提交能力与注册表，忽略数组顺序但不允许缺失或额外组合。 */
export function matchesModelSizeProfile(
  profile: ModelSizeProfile,
  supportsAuto: boolean,
  sizes: readonly ModelSizeOption[],
): boolean {
  if (!supportsAuto) return false;
  const expected = modelSizesForProfile(profile).map((size) => `${size.ratio}/${size.resolution}`);
  const actual = sizes.map((size) => `${size.ratio}/${size.resolution}`);
  return (
    expected.length === actual.length &&
    new Set(expected).size === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((key) => actual.includes(key))
  );
}

export interface ModelImageParameters {
  aspectRatio: string;
  imageSize?: '1K' | '2K' | '4K';
}

/** 将统一的页面选择转换为供应商字段；auto始终原样发送且不附带imageSize。 */
export function resolveModelImageParameters(
  profile: ModelSizeProfile,
  ratio: ModelRatio | 'auto',
  resolution: ModelResolution | 'auto',
): ModelImageParameters {
  if (ratio === 'auto' && resolution === 'auto') return { aspectRatio: 'auto' };
  if (ratio === 'auto' || resolution === 'auto') throw new TypeError('尺寸组合不正确');
  if (
    !modelSizesForProfile(profile).some(
      (size) => size.ratio === ratio && size.resolution === resolution,
    )
  )
    throw new TypeError('模型不支持该尺寸组合');
  if (profile === 'gemini_ratio_size') {
    return { aspectRatio: ratio, imageSize: resolution.toUpperCase() as '1K' | '2K' | '4K' };
  }
  if (profile === 'gemini_ratio_1k') {
    return { aspectRatio: ratio };
  }
  if (profile === 'gpt_1k_pixels') {
    return { aspectRatio: gptOneKilopixelSizeTable[ratio] };
  }
  const aspectRatio = gptMultiPixelSizeTable[ratio][modelResolutions.indexOf(resolution)];
  if (!aspectRatio) throw new TypeError('模型不支持该分辨率');
  return { aspectRatio };
}

/** 返回页面用于核对的规格文本；Gemini只展示抽象档位，不伪造具体像素。 */
export function describeModelImageParameters(
  profile: ModelSizeProfile,
  ratio: ModelRatio | 'auto',
  resolution: ModelResolution | 'auto',
): string {
  const parameters = resolveModelImageParameters(profile, ratio, resolution);
  if (parameters.aspectRatio === 'auto')
    return profile === 'gemini_ratio_1k' ? 'auto · 1K' : 'auto';
  if (profile === 'gemini_ratio_1k') return `${parameters.aspectRatio} · 1K`;
  return parameters.imageSize
    ? `${parameters.aspectRatio} · ${parameters.imageSize}`
    : parameters.aspectRatio;
}

/** 计算单张价格；能力是否支持由目录校验负责，空质量表示不发送quality。 */
export function calculateModelPoints(
  basePoints: number,
  resolution: ModelResolution | 'auto',
  quality: ModelQuality | null,
): number {
  if (
    !Number.isInteger(basePoints) ||
    basePoints < 1 ||
    basePoints > maximumModelBasePoints ||
    !Object.hasOwn(resolutionExtras, resolution) ||
    (quality !== null && !Object.hasOwn(qualityExtras, quality))
  ) {
    throw new TypeError('模型积分参数不正确');
  }
  return (
    basePoints + resolutionExtras[resolution] + (quality === null ? 0 : qualityExtras[quality])
  );
}

/** 返回最终传给Grsai aspectRatio的快照值，保留旧调用面的字段命名。 */
export function resolveModelOutputSize(
  profile: ModelSizeProfile,
  ratio: ModelRatio | 'auto',
  resolution: ModelResolution | 'auto',
): string {
  return resolveModelImageParameters(profile, ratio, resolution).aspectRatio;
}

/** 检查默认值、能力组合与积分边界，返回可直接用于表单的安全错误。 */
export function validateGenerationModel(input: GenerationModelWrite): string | null {
  if (
    input.provider !== 'grsai' ||
    !input.displayName?.trim() ||
    input.displayName.trim().length > 100
  )
    return '请输入1至100字的模型名称';
  const profile = findModelSizeProfile(input.providerModelId);
  if (!profile) return '请选择已登记的图片模型ID';
  if (
    !Number.isInteger(input.basePoints) ||
    input.basePoints < 1 ||
    input.basePoints > maximumModelBasePoints
  )
    return '基准积分必须为有效的正整数';
  if (
    typeof input.supportsAuto !== 'boolean' ||
    !Array.isArray(input.sizes) ||
    input.sizes.length > 39
  )
    return '尺寸配置不正确';
  const keys = new Set<string>();
  for (const size of input.sizes) {
    if (
      !size ||
      !Object.hasOwn(gptMultiPixelSizeTable, size.ratio) ||
      !modelResolutions.includes(size.resolution)
    )
      return '包含不支持的尺寸';
    const key = `${size.ratio}/${size.resolution}`;
    if (keys.has(key)) return '尺寸不能重复';
    keys.add(key);
  }
  if (!matchesModelSizeProfile(profile, input.supportsAuto, input.sizes))
    return '模型尺寸能力必须与固定档案一致';
  if (
    !Array.isArray(input.qualities) ||
    input.qualities.some((q) => !modelQualities.includes(q)) ||
    new Set(input.qualities).size !== input.qualities.length
  )
    return '质量选项不正确或重复';
  if (isNanoBananaModel(input.providerModelId) && input.qualities.length)
    return 'Nano Banana模型不支持质量参数';
  if (input.defaultRatio === 'auto' || input.defaultResolution === 'auto') {
    if (!input.supportsAuto || input.defaultRatio !== 'auto' || input.defaultResolution !== 'auto')
      return '默认自动尺寸必须同时选择auto';
  } else if (!keys.has(`${input.defaultRatio}/${input.defaultResolution}`))
    return '默认尺寸必须在支持范围内';
  if (
    input.qualities.length
      ? !input.qualities.includes(input.defaultQuality as ModelQuality)
      : input.defaultQuality !== null
  )
    return '默认质量必须在支持范围内；不支持质量时应为空';
  return null;
}

/** 按模型真实能力计算起价，避免仅支持medium或4K时仍展示基准积分。 */
export function minimumModelPoints(
  input: Omit<GenerationModelWrite, 'provider' | 'providerModelId'>,
): number {
  if (
    !Number.isInteger(input.basePoints) ||
    input.basePoints < 1 ||
    input.basePoints > maximumModelBasePoints ||
    !Array.isArray(input.sizes) ||
    !Array.isArray(input.qualities) ||
    (!input.supportsAuto && !input.sizes.length)
  )
    throw new TypeError('模型积分参数不正确');
  const resolutions: Array<ModelResolution | 'auto'> = input.sizes.map((s) => s.resolution);
  if (input.supportsAuto) resolutions.push('auto');
  const qualities: Array<ModelQuality | null> = input.qualities.length ? input.qualities : [null];
  return Math.min(
    ...resolutions.flatMap((r) =>
      qualities.map((q) => calculateModelPoints(input.basePoints, r, q)),
    ),
  );
}

const uuidSchema = {
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
};
const writeProperties = {
  provider: { const: 'grsai' },
  displayName: { type: 'string', minLength: 1, maxLength: 100 },
  providerModelId: { enum: registeredProviderModelIds },
  basePoints: { type: 'integer', minimum: 1, maximum: maximumModelBasePoints },
  supportsAuto: { type: 'boolean' },
  sizes: {
    type: 'array',
    maxItems: 39,
    uniqueItems: true,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['ratio', 'resolution'],
      properties: { ratio: { enum: modelRatios }, resolution: { enum: modelResolutions } },
    },
  },
  qualities: { type: 'array', maxItems: 6, uniqueItems: true, items: { enum: modelQualities } },
  defaultRatio: { enum: ['auto', ...modelRatios] },
  defaultResolution: { enum: ['auto', ...modelResolutions] },
  defaultQuality: { enum: [null, ...modelQualities] },
};
export const generationModelWriteSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(writeProperties),
  properties: writeProperties,
} as const;
export const generationModelStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { enum: modelStatuses } },
} as const;
export const generationModelParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['modelId'],
  properties: { modelId: uuidSchema },
} as const;
export const generationModelRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...Object.keys(writeProperties),
    'modelId',
    'sizeProfile',
    'status',
    'referenceCount',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    ...writeProperties,
    modelId: uuidSchema,
    sizeProfile: { enum: modelSizeProfiles },
    status: { enum: modelStatuses },
    referenceCount: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;
export const generationModelResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: { item: generationModelRecordSchema },
} as const;
export const generationModelListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: generationModelRecordSchema } },
} as const;
export const generationModelDeleteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deleted'],
  properties: { deleted: { const: true } },
} as const;

/** 模板每次读取的实时模型摘要；不暴露供应商ID、审计或凭据。 */
export type TemplateModel = Omit<GenerationModelWrite, 'provider' | 'providerModelId'> & {
  modelId: string;
  sizeProfile: ModelSizeProfile;
  status: ModelStatus;
};
const {
  provider: _provider,
  providerModelId: _providerModelId,
  ...templateModelProperties
} = writeProperties;
export const templateModelSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(templateModelProperties), 'modelId', 'sizeProfile', 'status'],
  properties: {
    ...templateModelProperties,
    modelId: uuidSchema,
    sizeProfile: { enum: modelSizeProfiles },
    status: { enum: modelStatuses },
  },
} as const;
export const templateModelListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: templateModelSchema } },
} as const;

/** 再次显式投影安全摘要，防止服务替身或后续内部字段扩展穿透HTTP边界。 */
export function copyTemplateModel(value: unknown): TemplateModel | null {
  if (!value || typeof value !== 'object') return null;
  const model = value as TemplateModel;
  if (
    typeof model.modelId !== 'string' ||
    !modelSizeProfiles.includes(model.sizeProfile) ||
    !modelStatuses.includes(model.status) ||
    typeof model.displayName !== 'string' ||
    !model.displayName.trim() ||
    model.displayName.trim().length > 100 ||
    !Number.isInteger(model.basePoints) ||
    model.basePoints < 1 ||
    model.basePoints > maximumModelBasePoints ||
    !Array.isArray(model.sizes) ||
    !Array.isArray(model.qualities) ||
    model.qualities.some((quality) => !modelQualities.includes(quality)) ||
    new Set(model.qualities).size !== model.qualities.length ||
    !matchesModelSizeProfile(model.sizeProfile, model.supportsAuto, model.sizes) ||
    (model.defaultRatio === 'auto'
      ? model.defaultResolution !== 'auto'
      : model.defaultResolution === 'auto' ||
        !model.sizes.some(
          (size) =>
            size.ratio === model.defaultRatio && size.resolution === model.defaultResolution,
        )) ||
    (model.qualities.length
      ? !model.qualities.includes(model.defaultQuality as ModelQuality)
      : model.defaultQuality !== null)
  )
    return null;
  return {
    modelId: model.modelId,
    sizeProfile: model.sizeProfile,
    displayName: model.displayName,
    basePoints: model.basePoints,
    supportsAuto: model.supportsAuto,
    sizes: model.sizes.map(({ ratio, resolution }) => ({ ratio, resolution })),
    qualities: [...model.qualities],
    defaultRatio: model.defaultRatio,
    defaultResolution: model.defaultResolution,
    defaultQuality: model.defaultQuality,
    status: model.status,
  };
}
