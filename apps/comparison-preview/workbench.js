/** 逐例评审台：按用例渲染三幅结果并维护同步缩放、平移状态。 */
const preview = window.COMPARISON_PREVIEW;
const caseList = document.getElementById('caseList');
const resultGrid = document.getElementById('resultGrid');
const sourceList = document.getElementById('sourceList');
const sourceDialog = document.getElementById('sourceDialog');
let caseIndex = 0;
let zoom = 1;
let panX = 0;
let panY = 0;
let drag = null;

/** 创建只包含安全文本的页面元素。 */
function makeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

/** 计算侧栏中单个用例的可看结果数。 */
function countSucceeded(testCase) {
  return testCase.results.filter((result) => result.status === 'succeeded').length;
}

/** 重建侧栏用例入口并标记当前项。 */
function renderCaseList() {
  caseList.replaceChildren();
  preview.cases.forEach((testCase, index) => {
    const button = makeElement('button', `case-choice${index === caseIndex ? ' active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-current', index === caseIndex ? 'true' : 'false');
    const image = makeElement('img');
    image.src = testCase.inputs[0].path;
    image.alt = '';
    image.loading = 'lazy';
    const text = makeElement('span', 'case-text');
    text.append(
      makeElement('strong', '', testCase.id),
      makeElement('small', '', testCase.title),
      makeElement('span', 'case-count', `${countSucceeded(testCase)} / 3 已完成`),
    );
    button.append(image, text);
    button.addEventListener('click', () => selectCase(index));
    caseList.append(button);
  });
}

/** 根据候选状态生成图片卡或明确的无图占位。 */
function renderResult(testCase, candidate) {
  const result = testCase.results.find((item) => item.key === candidate.key);
  const card = makeElement('article', 'result-card');
  card.dataset.key = candidate.key;
  const head = makeElement('div', 'result-card-head');
  const id = makeElement('div', 'candidate-id');
  id.append(makeElement('span', 'candidate-letter', candidate.key));
  const name = makeElement('span');
  name.append(
    makeElement('strong', '', candidate.promptLabel),
    makeElement('small', '', candidate.description),
  );
  id.append(name);
  const status = makeElement('span', 'status', preview.statusLabels[result.status]);
  status.dataset.status = result.status;
  head.append(id, status);
  const viewer = makeElement('div', 'viewer');
  viewer.setAttribute(
    'aria-label',
    `${candidate.promptLabel}：${preview.statusLabels[result.status]}`,
  );
  if (result.status === 'succeeded' && result.path) {
    const image = makeElement('img', 'viewer-image');
    image.src = result.path;
    image.alt = `${testCase.id} ${candidate.promptLabel} 模拟结果`;
    image.draggable = false;
    image.style.filter = preview.demoFilters[candidate.key];
    image.addEventListener('load', updateTransforms);
    image.addEventListener('error', () => {
      viewer.replaceChildren(emptyView('图片无法读取', '请检查项目测试素材是否完整。'));
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
        preview.statusLabels[result.status],
        result.errorCode ? `错误代码：${result.errorCode}` : '该候选暂时没有可查看的图片。',
      ),
    );
    viewer.classList.add('image-error');
  }
  const foot = makeElement('div', 'result-foot');
  foot.append(
    makeElement('span', '', `候选 ${candidate.key} / ${preview.generation.aspectRatio}`),
    makeElement('strong', '', result.status === 'succeeded' ? '显示处理示意' : '无结果文件'),
  );
  card.append(head, viewer, foot);
  return card;
}

/** 生成统一的无结果提示。 */
function emptyView(title, description) {
  const content = makeElement('div', 'empty-view');
  content.append(
    makeElement('span', 'empty-icon', '◇'),
    makeElement('strong', '', title),
    makeElement('span', '', description),
  );
  return content;
}

/** 显示有序输入图，并允许单独放大查看。 */
function renderSources(testCase) {
  sourceList.replaceChildren();
  testCase.inputs.forEach((input) => {
    const button = makeElement('button', 'source-card');
    button.type = 'button';
    button.setAttribute('aria-label', `放大查看${input.label}`);
    const top = makeElement('span', 'source-top');
    top.append(
      makeElement('strong', '', `0${input.order} / ${input.label}`),
      makeElement('span', '', '点击放大 ↗'),
    );
    const image = makeElement('img');
    image.src = input.path;
    image.alt = input.label;
    image.loading = 'lazy';
    button.append(top, image);
    button.addEventListener('click', () => {
      document.getElementById('dialogTitle').textContent = `${testCase.id} · ${input.label}`;
      const dialogImage = document.getElementById('dialogImage');
      dialogImage.src = input.path;
      dialogImage.alt = input.label;
      sourceDialog.showModal();
    });
    sourceList.append(button);
  });
}

/** 在三套样式之间切换时保留当前用例编号。 */
function syncStyleLinks(testCase) {
  document.querySelectorAll('.style-picker a').forEach((link) => {
    const page = link.getAttribute('href').split('#')[0];
    link.setAttribute('href', `${page}#${testCase.id}`);
  });
}

/** 切换用例并重置三幅图片的同步视图。 */
function selectCase(index) {
  caseIndex = (index + preview.cases.length) % preview.cases.length;
  zoom = 1;
  panX = 0;
  panY = 0;
  const testCase = preview.cases[caseIndex];
  document.getElementById('crumbCase').textContent = testCase.id;
  document.getElementById('caseCounter').textContent =
    `${String(caseIndex + 1).padStart(2, '0')} / ${String(preview.cases.length).padStart(2, '0')}`;
  document.getElementById('casePosition').textContent =
    `${String(caseIndex + 1).padStart(2, '0')} / ${String(preview.cases.length).padStart(2, '0')}`;
  document.getElementById('caseTitle').textContent = testCase.title;
  document.getElementById('caseFocus').textContent = testCase.focus;
  document.getElementById('inspectorFocus').textContent = testCase.focus;
  resultGrid.replaceChildren(
    ...preview.candidates.map((candidate) => renderResult(testCase, candidate)),
  );
  renderSources(testCase);
  renderCaseList();
  syncStyleLinks(testCase);
  updateTransforms();
}

/** 把缩放限制在 100% 到 300% 并刷新所有可用图片。 */
function setZoom(value) {
  zoom = Math.max(1, Math.min(3, Math.round(value * 100) / 100));
  if (zoom === 1) {
    panX = 0;
    panY = 0;
  }
  updateTransforms();
}

/** 将同一缩放和平移应用到三幅图，同时限制拖出范围。 */
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
}

/** 在放大状态下捕获指针，开始同步平移。 */
function startDrag(event) {
  if (zoom === 1) return;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add('dragging');
}

/** 按当前指针位移更新三图共同的平移量。 */
function moveDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  panX = drag.panX + event.clientX - drag.x;
  panY = drag.panY + event.clientY - drag.y;
  updateTransforms();
}

/** 结束同步拖动。 */
function stopDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.currentTarget.classList.remove('dragging');
  drag = null;
}

document.getElementById('templateName').textContent = preview.templateName;
document.getElementById('ratio').textContent = preview.generation.aspectRatio;
document.getElementById('resolution').textContent =
  `${preview.generation.resolution.toUpperCase()} · ${preview.generation.quality}`;
document.getElementById('executionShort').textContent = preview.executionId.slice(0, 8) + '…';
document.getElementById('prevCase').addEventListener('click', () => selectCase(caseIndex - 1));
document.getElementById('nextCase').addEventListener('click', () => selectCase(caseIndex + 1));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom - 0.25));
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom + 0.25));
document.getElementById('resetZoom').addEventListener('click', () => setZoom(1));
document.getElementById('closeDialog').addEventListener('click', () => sourceDialog.close());
window.addEventListener('resize', updateTransforms);
document.addEventListener('keydown', (event) => {
  if (sourceDialog.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))
    return;
  if (event.key === 'ArrowLeft') selectCase(caseIndex - 1);
  if (event.key === 'ArrowRight') selectCase(caseIndex + 1);
  if (event.key === '+' || event.key === '=') setZoom(zoom + 0.25);
  if (event.key === '-') setZoom(zoom - 0.25);
});
const requestedCase = preview.cases.findIndex((item) => item.id === window.location.hash.slice(1));
selectCase(requestedCase >= 0 ? requestedCase : 0);
