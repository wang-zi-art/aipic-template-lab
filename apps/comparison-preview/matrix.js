/** 批次联系表：筛选整批用例，并按需展开单行大图。 */
const preview = window.COMPARISON_PREVIEW;
const matrixRows = document.getElementById('matrixRows');
const detailDialog = document.getElementById('detailDialog');
const dialogResults = document.getElementById('dialogResults');
let filter = 'all';
let query = '';

/** 创建只以文本填充的页面元素。 */
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/** 判断用例是否同时满足当前搜索词与状态筛选。 */
function matches(testCase) {
  if (query && !`${testCase.id} ${testCase.title} ${testCase.focus}`.toLowerCase().includes(query))
    return false;
  const statuses = testCase.results.map((result) => result.status);
  if (filter === 'ready') return statuses.every((status) => status === 'succeeded');
  if (filter === 'processing') return statuses.includes('processing');
  if (filter === 'attention')
    return statuses.some((status) =>
      ['failed', 'missing_file', 'export_failed', 'pending_review', 'not_executed'].includes(
        status,
      ),
    );
  return true;
}

/** 为矩阵建立候选缩略图或状态占位。 */
function createResultCell(result) {
  const cell = element('div', 'result-cell');
  if (result.status === 'succeeded' && result.path) {
    const image = element('img');
    image.src = result.path;
    image.alt = '';
    image.loading = 'lazy';
    image.dataset.key = result.key;
    image.addEventListener('error', () =>
      image.replaceWith(element('div', 'result-placeholder', '◇')),
    );
    cell.append(image);
  } else {
    cell.append(element('div', 'result-placeholder', '◇'));
  }
  const copy = element('div', 'result-copy');
  copy.append(element('strong', '', result.promptLabel));
  const status = element('span', 'status', preview.statusLabels[result.status]);
  status.dataset.status = result.status;
  copy.append(
    status,
    element(
      'small',
      '',
      result.status === 'succeeded' ? '模拟图片' : (result.errorCode ?? '暂无可看图片'),
    ),
  );
  cell.append(copy);
  return cell;
}

/** 生成可点击和可用键盘打开的用例行。 */
function createRow(testCase) {
  const row = element('div', 'matrix-row');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `查看${testCase.id} ${testCase.title}的详细结果`);
  const caseCell = element('div', 'case-cell');
  const portrait = element('img');
  portrait.src = testCase.inputs[0].path;
  portrait.alt = '';
  portrait.loading = 'lazy';
  const caseCopy = element('div', 'case-copy');
  caseCopy.append(
    element('strong', '', testCase.id),
    element('p', '', testCase.title),
    element('small', '', `原图 ${testCase.inputs.length} 张 · 点击展开 ↗`),
  );
  caseCell.append(portrait, caseCopy);
  row.append(caseCell, ...testCase.results.map(createResultCell));
  row.addEventListener('click', () => openCase(testCase));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCase(testCase);
    }
  });
  return row;
}

/** 只渲染当前筛选下的用例行。 */
function renderRows() {
  const visible = preview.cases.filter(matches);
  matrixRows.replaceChildren(...visible.map(createRow));
  document.getElementById('emptyFilter').hidden = visible.length > 0;
}

/** 为展开层生成单个候选的大图卡。 */
function createDialogCard(result) {
  const card = element('section', 'dialog-card');
  const head = element('div', 'dialog-card-head');
  head.append(element('strong', '', `${result.promptLabel} / 候选 ${result.key}`));
  const status = element('span', 'status', preview.statusLabels[result.status]);
  status.dataset.status = result.status;
  head.append(status);
  const picture = element('div', 'dialog-picture');
  if (result.status === 'succeeded' && result.path) {
    const image = element('img');
    image.src = result.path;
    image.alt = `${result.promptLabel} 模拟结果`;
    image.dataset.key = result.key;
    image.addEventListener('error', () => image.replaceWith(createDialogEmpty('图片无法读取')));
    picture.append(image);
  } else picture.append(createDialogEmpty(preview.statusLabels[result.status]));
  card.append(
    head,
    picture,
    element(
      'div',
      'dialog-card-foot',
      result.status === 'succeeded'
        ? '项目测试素材的视觉模拟'
        : (result.errorCode ?? '当前没有结果文件'),
    ),
  );
  return card;
}

/** 为没有结果图片的候选生成明确提示。 */
function createDialogEmpty(label) {
  const empty = element('div', 'dialog-empty');
  empty.append(element('span', '', '◇'), element('strong', '', label));
  return empty;
}

/** 打开当前用例的大图详情和原图缩略图。 */
function openCase(testCase) {
  document.getElementById('dialogCaseId').textContent = testCase.id;
  document.getElementById('dialogHeading').textContent = testCase.title;
  document.getElementById('dialogFocus').textContent = testCase.focus;
  const sources = document.getElementById('dialogSources');
  sources.replaceChildren(
    ...testCase.inputs.map((input) => {
      const label = element('span');
      const image = element('img');
      image.src = input.path;
      image.alt = '';
      label.append(image, document.createTextNode(input.label));
      return label;
    }),
  );
  dialogResults.replaceChildren(...testCase.results.map(createDialogCard));
  document.getElementById('dialogZoom').value = '100';
  applyDialogZoom();
  detailDialog.showModal();
}

/** 让详情层的所有可用结果一起放大。 */
function applyDialogZoom() {
  const scale = Number(document.getElementById('dialogZoom').value) / 100;
  dialogResults.querySelectorAll('img').forEach((image) => {
    image.style.transform = `scale(${scale})`;
  });
  document.getElementById('dialogZoomValue').textContent = `${Math.round(scale * 100)}%`;
}

const statuses = preview.cases.flatMap((testCase) =>
  testCase.results.map((result) => result.status),
);
document.getElementById('executionId').textContent = preview.executionId.slice(0, 18) + '…';
document.getElementById('caseTotal').textContent = String(preview.cases.length).padStart(2, '0');
document.getElementById('allCount').textContent = preview.cases.length;
document.getElementById('successTotal').textContent = String(
  statuses.filter((status) => status === 'succeeded').length,
).padStart(2, '0');
document.getElementById('attentionTotal').textContent = String(
  statuses.filter((status) =>
    ['failed', 'missing_file', 'pending_review', 'export_failed', 'not_executed'].includes(status),
  ).length,
).padStart(2, '0');
document.getElementById('processingTotal').textContent = String(
  statuses.filter((status) => status === 'processing').length,
).padStart(2, '0');
document.getElementById('templateName').textContent =
  `${preview.templateTypeId} · ${preview.templateName}`;
document.getElementById('generationMeta').textContent =
  `${preview.generation.aspectRatio} · ${preview.generation.resolution.toUpperCase()}`;
document.querySelectorAll('[data-filter]').forEach((button) =>
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document
      .querySelectorAll('[data-filter]')
      .forEach((item) => item.classList.toggle('selected', item === button));
    renderRows();
  }),
);
document.getElementById('caseSearch').addEventListener('input', (event) => {
  query = event.target.value.trim().toLowerCase();
  renderRows();
});
document.getElementById('dialogZoom').addEventListener('input', applyDialogZoom);
document.getElementById('closeDialog').addEventListener('click', () => detailDialog.close());
renderRows();
