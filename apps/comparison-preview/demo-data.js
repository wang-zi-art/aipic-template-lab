/* Local demonstration data. It mirrors the useful fields of comparison/summary.json.
 * All candidate pictures reuse source portraits with visual treatments; none is a generated result.
 */
const base = '../../mcp-test/materials/TPL0019-eyelid/test-inputs';
const reference = `${base}/S001/input_02_eye_shape_reference.jpg`;

const caseDefinitions = [
  {
    id: 'T001',
    imageSetId: 'S001',
    title: '正面半身 · 身份保持',
    focus: '人物身份与眼形适配是否自然',
    portrait: `${base}/S001/input_01_subject_portrait.jpg`,
    statuses: ['succeeded', 'succeeded', 'succeeded'],
  },
  {
    id: 'T002',
    imageSetId: 'S002',
    title: '中景人物 · 细节可见度',
    focus: '脸部较小时，眼形变化是否仍然清晰',
    portrait: `${base}/S002/input_01_subject_portrait.jpg`,
    statuses: ['succeeded', 'succeeded', 'processing'],
  },
  {
    id: 'T003',
    imageSetId: 'S003',
    title: '正面近景 · 眼周衔接',
    focus: '近景眼周细节与整体面部是否协调',
    portrait: `${base}/S003/input_01_subject_portrait.jpg`,
    statuses: ['succeeded', 'failed', 'succeeded'],
  },
  {
    id: 'T004',
    imageSetId: 'S004',
    title: '不同人物 · 泛化观察',
    focus: '保留非眼部外观，并观察不同人物上的效果',
    portrait: `${base}/S004/input_01_subject_portrait.jpg`,
    statuses: ['missing_file', 'succeeded', 'pending_review'],
  },
];

const candidates = [
  { key: 'A', promptLabel: 'A-v1', description: '基础版本' },
  { key: 'B', promptLabel: 'B-v1', description: '细节版本' },
  { key: 'C', promptLabel: 'C-v1', description: '自然版本' },
];

window.COMPARISON_PREVIEW = Object.freeze({
  isDemo: true,
  schemaVersion: 1,
  executionId: '6f142f93-f8db-4fe4-94d0-b9e8e649e817',
  templateTypeId: 'TPL0019',
  templateName: '正面眼形替换',
  manifestRevision: 3,
  reportStatus: 'partial',
  reportPhase: 'collecting',
  reportUpdatedAt: '2026-09-28T10:20:00+08:00',
  generation: { aspectRatio: '3:4', resolution: '2k', quality: 'high' },
  candidates,
  statusLabels: {
    succeeded: '已完成',
    failed: '生成失败',
    processing: '处理中',
    pending_review: '待核对',
    not_executed: '未执行',
    export_failed: '导出失败',
    missing_file: '图片缺失',
  },
  /* These CSS filters exist only to make the shared demo portrait visibly different. */
  demoFilters: {
    A: 'contrast(1.08) saturate(.86) brightness(1.02)',
    B: 'contrast(1.04) saturate(1.13) brightness(1.04)',
    C: 'contrast(1.12) saturate(.96) sepia(.07)',
  },
  cases: caseDefinitions.map((item) => ({
    id: item.id,
    imageSetId: item.imageSetId,
    title: item.title,
    focus: item.focus,
    supplementalDescription: null,
    inputs: [
      {
        order: 1,
        slotKey: 'subject_portrait',
        label: '原图人物',
        path: item.portrait,
        status: 'available',
      },
      {
        order: 2,
        slotKey: 'eye_shape_reference',
        label: '眼形参考',
        path: reference,
        status: 'available',
      },
    ],
    results: candidates.map((candidate, index) => ({
      key: candidate.key,
      promptLabel: candidate.promptLabel,
      status: item.statuses[index],
      path: item.statuses[index] === 'succeeded' ? item.portrait : null,
      errorCode: item.statuses[index] === 'failed' ? 'GENERATION_FAILED' : null,
    })),
  })),
});
