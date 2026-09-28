/** 石墨蓝紫结果评审页：读取内嵌汇总快照，逐例展示真实图片与同步视图。 */
const summary = JSON.parse(document.getElementById('comparisonData').textContent);
const caseList = document.getElementById('caseList');
const resultGrid = document.getElementById('resultGrid');
const sourceList = document.getElementById('sourceList');
const sourceDialog = document.getElementById('sourceDialog');
const statusLabels = Object.freeze({
  succeeded: '已完成',
  failed: '生成失败',
  processing: '处理中',
  pending_review: '待核对',
  not_executed: '未执行',
  export_failed: '导出失败',
  missing_file: '图片缺失',
});
let caseIndex = 0;
let zoom = 1;
let panX = 0;
let panY = 0;
let drag = null;

/** 创建仅使用纯文本的页面元素。 */
function makeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

/** 只接受当前用例文件夹内的相对图片路径。 */
function imagePath(testCase, value) {
  return typeof value === 'string' &&
    value.startsWith(`${testCase.id}/`) &&
    /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(value) &&
    !value.includes('..')
    ? value
    : null;
}

/** 将已完成与异常状态映射为本轮可读文案。 */
function labelFor(status) {
  return statusLabels[status] ?? '状态未知';
}

/** 在图片未能读取时替换为明确的占位提示。 */
function emptyView(title, description) {
  const content = makeElement('div', 'empty-view');
  content.append(
    makeElement('span', 'empty-icon', '◇'),
    makeElement('strong', '', title),
    makeElement('span', '', description),
  );
  return content;
}

/** 在用例列表中显示当前用例、输入缩略图和成功数量。 */
function renderCaseList() {
  caseList.replaceChildren();
  summary.cases.forEach((testCase, index) => {
    const button = makeElement('button', `case-choice${index === caseIndex ? ' active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-current', index === caseIndex ? 'true' : 'false');
    const firstInput = testCase.inputs.find((input) => imagePath(testCase, input.path));
    if (firstInput) {
      const image = makeElement('img');
      image.src = imagePath(testCase, firstInput.path);
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () =>
        image.replaceWith(makeElement('span', 'thumbnail-empty', '缺图')),
      );
      button.append(image);
    } else {
      button.append(makeElement('span', 'thumbnail-empty', '缺图'));
    }
    const text = makeElement('span', 'case-text');
    const succeeded = testCase.results.filter((result) => result.status === 'succeeded').length;
    text.append(
      makeElement('strong', '', testCase.id),
      makeElement('small', '', testCase.imageSetId ?? '未标记图片组'),
      makeElement('span', 'case-count', `${succeeded} / ${summary.candidates.length} 已完成`),
    );
    button.append(text);
    button.addEventListener('click', () => selectCase(index));
    caseList.append(button);
  });
}

/** 为单个候选建立真实结果卡，或显示无图状态和错误代码。 */
function renderResult(testCase, candidate) {
  const result = testCase.results.find((item) => item.key === candidate.key);
  const status = result?.status ?? 'not_executed';
  const path = imagePath(testCase, result?.path);
  const card = makeElement('article', 'result-card');
  card.dataset.key = candidate.key;
  const head = makeElement('div', 'result-card-head');
  const id = makeElement('div', 'candidate-id');
  id.append(makeElement('span', 'candidate-letter', candidate.key));
  const name = makeElement('span');
  name.append(
    makeElement('strong', '', candidate.promptLabel),
    makeElement('small', '', `修订 ${candidate.revision}`),
  );
  id.append(name);
  const badge = makeElement('span', 'status', labelFor(status));
  badge.dataset.status = status;
  head.append(id, badge);
  const viewer = makeElement('div', 'viewer');
  viewer.setAttribute('aria-label', `${candidate.promptLabel}：${labelFor(status)}`);
  if (status === 'succeeded' && path) {
    const image = makeElement('img', 'viewer-image');
    image.src = path;
    image.alt = `${testCase.id} ${candidate.promptLabel} 生成结果`;
    image.draggable = false;
    image.addEventListener('load', updateTransforms);
    image.addEventListener('error', () => {
      viewer.replaceChildren(emptyView('图片无法读取', '请检查本轮结果文件是否完整。'));
      viewer.classList.add('image-error');
    });
    viewer.append(image);
    viewer.addEventListener('pointerdown', startDrag);
    viewer.addEventListener('pointermove', moveDrag);
    viewer.addEventListener('pointerup', stopDrag);
    viewer.addEventListener('pointercancel', stopDrag);
    viewer.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        setZoom(zoom + (event.deltaY < 0 ? 0.2 : -0.2));
      },
      { passive: false },
    );
  } else {
    viewer.append(
      emptyView(
        labelFor(status),
        result?.errorCode ? `错误代码：${result.errorCode}` : '该候选暂时没有可查看的图片。',
      ),
    );
    viewer.classList.add('image-error');
  }
  const foot = makeElement('div', 'result-foot');
  foot.append(
    makeElement('span', '', `候选 ${candidate.key} / ${summary.generation.aspectRatio}`),
    makeElement('strong', '', path && status === 'succeeded' ? '真实生成结果' : '无结果文件'),
  );
  card.append(head, viewer, foot);
  return card;
}

/** 展示有序上传图；缺图不提供放大操作。 */
function renderSources(testCase) {
  sourceList.replaceChildren();
  testCase.inputs.forEach((input) => {
    const path = imagePath(testCase, input.path);
    const button = makeElement('button', `source-card${path ? '' : ' missing'}`);
    button.type = 'button';
    button.disabled = !path;
    button.setAttribute('aria-label', `查看第 ${input.order} 张输入图：${input.slotKey}`);
    const top = makeElement('span', 'source-top');
    top.append(
      makeElement('strong', '', `${String(input.order).padStart(2, '0')} / ${input.slotKey}`),
      makeElement('span', '', path ? '点击放大 ↗' : '图片缺失'),
    );
    button.append(top);
    if (path) {
      const image = makeElement('img');
      image.src = path;
      image.alt = `${input.slotKey} 输入图`;
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        image.replaceWith(makeElement('span', 'thumbnail-empty', '图片无法读取'));
        button.disabled = true;
        button.classList.add('missing');
      });
      button.append(image);
      button.addEventListener('click', () => {
        document.getElementById('dialogTitle').textContent = `${testCase.id} · ${input.slotKey}`;
        const dialogImage = document.getElementById('dialogImage');
        dialogImage.src = path;
        dialogImage.alt = `${input.slotKey} 输入图`;
        sourceDialog.showModal();
      });
    } else {
      button.append(makeElement('span', 'thumbnail-empty', '图片缺失'));
    }
    sourceList.append(button);
  });
}

/** 切换用例并把三幅候选图的视图恢复为完整显示。 */
function selectCase(index) {
  caseIndex = (index + summary.cases.length) % summary.cases.length;
  zoom = 1;
  panX = 0;
  panY = 0;
  drag = null;
  const testCase = summary.cases[caseIndex];
  const position = `${String(caseIndex + 1).padStart(2, '0')} / ${String(summary.cases.length).padStart(2, '0')}`;
  document.getElementById('crumbCase').textContent = testCase.id;
  document.getElementById('caseCounter').textContent = position;
  document.getElementById('casePosition').textContent = position;
  document.getElementById('caseTitle').textContent =
    `${testCase.id} · ${testCase.imageSetId ?? '测试用例'}`;
  document.getElementById('caseFocus').textContent =
    testCase.supplementalDescription ?? '无补充描述';
  document.getElementById('inspectorFocus').textContent =
    testCase.supplementalDescription ?? '本用例无补充描述';
  resultGrid.dataset.count = String(summary.candidates.length);
  resultGrid.replaceChildren(
    ...summary.candidates.map((candidate) => renderResult(testCase, candidate)),
  );
  renderSources(testCase);
  renderCaseList();
  updateTransforms();
}

/** 限制同步缩放范围，并在回到完整视图时清除位移。 */
function setZoom(value) {
  zoom = Math.max(1, Math.min(3, Math.round(value * 100) / 100));
  if (zoom === 1) {
    panX = 0;
    panY = 0;
  }
  updateTransforms();
}

/** 按所有已加载图片的共同可移动范围同步位移和缩放。 */
function updateTransforms() {
  const images = [...resultGrid.querySelectorAll('.viewer-image')];
  const limits = images
    .filter((image) => image.naturalWidth && image.naturalHeight)
    .map((image) => {
      const viewer = image.parentElement;
      const fit = Math.min(
        viewer.clientWidth / image.naturalWidth,
        viewer.clientHeight / image.naturalHeight,
      );
      return {
        x: Math.max(0, (image.naturalWidth * fit * zoom - viewer.clientWidth) / 2),
        y: Math.max(0, (image.naturalHeight * fit * zoom - viewer.clientHeight) / 2),
      };
    });
  if (limits.length) {
    const maxX = Math.min(...limits.map((limit) => limit.x));
    const maxY = Math.min(...limits.map((limit) => limit.y));
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }
  images.forEach((image) => {
    image.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  });
  document.getElementById('zoomValue').textContent = `${Math.round(zoom * 100)}%`;
  document.getElementById('zoomOut').disabled = zoom === 1;
  document.getElementById('zoomIn').disabled = zoom === 3;
}

/** 在放大状态下捕获指针并记录拖动起点。 */
function startDrag(event) {
  if (zoom === 1) return;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add('dragging');
}

/** 把任意候选图上的拖动同步应用于所有结果图。 */
function moveDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  panX = drag.panX + event.clientX - drag.x;
  panY = drag.panY + event.clientY - drag.y;
  updateTransforms();
}

/** 指针抬起或取消时退出拖动。 */
function stopDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.currentTarget.classList.remove('dragging');
  drag = null;
}

/** 初始化静态元数据、工具栏和键盘操作。 */
function startReview() {
  if (summary.schemaVersion !== 1 || !summary.cases?.length || !summary.candidates?.length) {
    throw new Error('结果汇总结构无效');
  }
  document.getElementById('crumbTemplate').textContent = summary.templateTypeId;
  document.getElementById('templateName').textContent = summary.templateTypeId;
  document.getElementById('ratio').textContent = summary.generation.aspectRatio;
  document.getElementById('resolution').textContent = [
    summary.generation.resolution,
    summary.generation.quality,
  ]
    .filter(Boolean)
    .join(' · ');
  document.getElementById('candidateVersions').textContent = summary.candidates
    .map((item) => item.promptLabel)
    .join(' / ');
  document.getElementById('executionShort').textContent = summary.executionId;
  document.getElementById('sidebarCount').textContent =
    `${summary.cases.length} 个用例 · ${summary.candidates.length} 个候选`;
  const reportStates = { running: '收集中', partial: '部分完成', completed: '已完成' };
  document.getElementById('reportState').textContent =
    reportStates[summary.reportStatus] ?? '本轮结果';
  document.getElementById('sidebarStatus').textContent =
    reportStates[summary.reportStatus] ?? '本轮汇总';
  const updated = new Date(summary.reportUpdatedAt);
  document.getElementById('snapshotTime').textContent = Number.isNaN(updated.getTime())
    ? '更新时间未知'
    : `更新于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(updated)}`;
  document.getElementById('prevCase').addEventListener('click', () => selectCase(caseIndex - 1));
  document.getElementById('nextCase').addEventListener('click', () => selectCase(caseIndex + 1));
  document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom - 0.25));
  document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom + 0.25));
  document.getElementById('resetZoom').addEventListener('click', () => setZoom(1));
  document.getElementById('closeDialog').addEventListener('click', () => sourceDialog.close());
  window.addEventListener('resize', updateTransforms);
  document.addEventListener('keydown', (event) => {
    if (
      sourceDialog.open ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    )
      return;
    if (!['ArrowLeft', 'ArrowRight', '+', '=', '-', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') selectCase(caseIndex - 1);
    if (event.key === 'ArrowRight') selectCase(caseIndex + 1);
    if (event.key === '+' || event.key === '=') setZoom(zoom + 0.25);
    if (event.key === '-') setZoom(zoom - 0.25);
    if (event.key === 'Home') setZoom(1);
  });
  const requestedCase = summary.cases.findIndex(
    (item) => item.id === window.location.hash.slice(1),
  );
  selectCase(requestedCase >= 0 ? requestedCase : 0);
}

startReview();
