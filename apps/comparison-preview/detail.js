/** 局部差异台：维护归一化选区，并把同一局部绘制到三个放大窗。 */
const preview = window.COMPARISON_PREVIEW;
const overviewGrid = document.getElementById('overviewGrid');
const magnifierGrid = document.getElementById('magnifierGrid');
const caseChips = document.getElementById('caseChips');
const roiSize = document.getElementById('roiSize');
let caseIndex = 0;
let roi = { cx: 0.5, cy: 0.42, w: 0.42, h: 0.26 };
let activePointer = null;

/** 创建只包含文本内容的节点。 */
function node(tag, className, content) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (content !== undefined) value.textContent = content;
  return value;
}

/** 把数值限制在给定区间。 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** 计算完整显示图片后在容器中的实际边界，排除留白。 */
function imageBounds(image, stage) {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const imageWidth = image.naturalWidth * fit;
  const imageHeight = image.naturalHeight * fit;
  return {
    x: (width - imageWidth) / 2,
    y: (height - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
  };
}

/** 用结果状态生成文本标签。 */
function statusElement(statusName) {
  const label = node('span', 'status', preview.statusLabels[statusName]);
  label.dataset.status = statusName;
  return label;
}

/** 为失败、处理中或缺失图片显示无图状态。 */
function emptyState(statusName) {
  const content = node('div', 'stage-empty');
  content.append(
    node('span', '', '◇'),
    node('strong', '', preview.statusLabels[statusName]),
    node('span', '', '当前无可查看的图片'),
  );
  return content;
}

/** 生成带选区的全图卡；仅成功结果可移动选区。 */
function overviewCard(result) {
  const card = node('article', 'overview-card');
  card.dataset.key = result.key;
  const top = node('div', 'overview-card-top');
  const label = node('div', 'label-group');
  label.append(node('span', 'candidate-badge', result.key), node('strong', '', result.promptLabel));
  top.append(label, statusElement(result.status));
  const stage = node('div', 'stage');
  if (result.status === 'succeeded' && result.path) {
    const image = node('img');
    image.src = result.path;
    image.alt = `${result.promptLabel} 模拟结果`;
    image.dataset.key = result.key;
    image.draggable = false;
    const box = node('div', 'roi-overlay');
    stage.append(image, box);
    image.addEventListener('load', () => {
      positionOverlays();
      drawMagnifiers();
    });
    image.addEventListener('error', () => {
      stage.replaceChildren(emptyState('missing_file'));
      drawMagnifiers();
    });
    stage.addEventListener('pointerdown', startSelection);
    stage.addEventListener('pointermove', moveSelection);
    stage.addEventListener('pointerup', stopSelection);
    stage.addEventListener('pointercancel', stopSelection);
  } else stage.append(emptyState(result.status));
  card.append(
    top,
    stage,
    node(
      'div',
      'overview-card-foot',
      result.status === 'succeeded'
        ? '拖动图片上的选区 · 模拟结果'
        : (result.errorCode ?? '当前结果不可用'),
    ),
  );
  return card;
}

/** 为成功结果创建局部画布，为其他状态创建占位。 */
function magnifierCard(result) {
  const card = node('article', 'magnifier-card');
  card.dataset.key = result.key;
  const top = node('div', 'magnifier-card-top');
  const label = node('div', 'label-group');
  label.append(node('span', 'candidate-badge', result.key), node('strong', '', result.promptLabel));
  top.append(
    label,
    node(
      'small',
      '',
      result.status === 'succeeded' ? '同步局部' : preview.statusLabels[result.status],
    ),
  );
  const wrap = node('div', 'canvas-wrap');
  if (result.status === 'succeeded' && result.path) {
    const canvas = node('canvas');
    canvas.dataset.key = result.key;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${result.promptLabel} 相同位置的局部放大图`);
    wrap.append(canvas);
  } else wrap.append(emptyState(result.status));
  card.append(
    top,
    wrap,
    node(
      'div',
      'magnifier-foot',
      result.status === 'succeeded' ? '选区坐标按原图比例映射' : '无图像可放大',
    ),
  );
  return card;
}

/** 将归一化选区映射到每幅图片真实显示区域。 */
function positionOverlays() {
  overviewGrid.querySelectorAll('.stage').forEach((stage) => {
    const image = stage.querySelector('img');
    const overlay = stage.querySelector('.roi-overlay');
    if (!image || !overlay) return;
    const rect = imageBounds(image, stage);
    if (!rect) {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'block';
    overlay.style.left = `${rect.x + (roi.cx - roi.w / 2) * rect.width}px`;
    overlay.style.top = `${rect.y + (roi.cy - roi.h / 2) * rect.height}px`;
    overlay.style.width = `${roi.w * rect.width}px`;
    overlay.style.height = `${roi.h * rect.height}px`;
  });
}

/** 从三幅源图裁取同一比例坐标，并保持局部图片比例。 */
function drawMagnifiers() {
  magnifierGrid.querySelectorAll('canvas').forEach((canvas) => {
    const image = overviewGrid.querySelector(`img[data-key="${canvas.dataset.key}"]`);
    if (!image || !image.complete || !image.naturalWidth) return;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (!displayWidth || !displayHeight) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(displayWidth * pixelRatio);
    const height = Math.round(displayHeight * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b1821';
    context.fillRect(0, 0, width, height);
    const sx = (roi.cx - roi.w / 2) * image.naturalWidth;
    const sy = (roi.cy - roi.h / 2) * image.naturalHeight;
    const sourceWidth = roi.w * image.naturalWidth;
    const sourceHeight = roi.h * image.naturalHeight;
    const fit = Math.min(width / sourceWidth, height / sourceHeight);
    const targetWidth = sourceWidth * fit;
    const targetHeight = sourceHeight * fit;
    context.filter = preview.demoFilters[canvas.dataset.key];
    context.drawImage(
      image,
      sx,
      sy,
      sourceWidth,
      sourceHeight,
      (width - targetWidth) / 2,
      (height - targetHeight) / 2,
      targetWidth,
      targetHeight,
    );
    context.filter = 'none';
  });
}

/** 从指针坐标更新共享选区的中心。 */
function updateSelection(event) {
  const stage = event.currentTarget;
  const bounds = imageBounds(stage.querySelector('img'), stage);
  if (!bounds) return;
  const stageRect = stage.getBoundingClientRect();
  const x = (event.clientX - stageRect.left - bounds.x) / bounds.width;
  const y = (event.clientY - stageRect.top - bounds.y) / bounds.height;
  roi.cx = clamp(x, roi.w / 2, 1 - roi.w / 2);
  roi.cy = clamp(y, roi.h / 2, 1 - roi.h / 2);
  positionOverlays();
  drawMagnifiers();
}

/** 捕获指针以开始拖动局部选区。 */
function startSelection(event) {
  activePointer = event.pointerId;
  event.currentTarget.setPointerCapture(event.pointerId);
  updateSelection(event);
}

/** 指针移动时连续更新三个放大窗。 */
function moveSelection(event) {
  if (activePointer === event.pointerId) updateSelection(event);
}

/** 指针释放后结束选区拖动。 */
function stopSelection(event) {
  if (activePointer === event.pointerId) activePointer = null;
}

/** 按上传顺序显示原图缩略图和栏位。 */
function renderSourceImages(testCase) {
  const list = document.getElementById('sourceImages');
  list.replaceChildren(
    ...testCase.inputs.map((input) => {
      const item = node('div', 'source-item');
      const image = node('img');
      image.src = input.path;
      image.alt = input.label;
      image.loading = 'lazy';
      const copy = node('div');
      copy.append(
        node('strong', '', `0${input.order} / ${input.label}`),
        node('span', '', input.slotKey),
      );
      item.append(image, copy);
      return item;
    }),
  );
}

/** 建立可切换的用例标签。 */
function renderCaseChips() {
  caseChips.replaceChildren(
    ...preview.cases.map((testCase, index) => {
      const button = node('button', index === caseIndex ? 'active' : '');
      button.type = 'button';
      button.setAttribute('aria-pressed', index === caseIndex ? 'true' : 'false');
      button.append(
        node('span', '', String(index + 1).padStart(2, '0')),
        document.createTextNode(testCase.id),
      );
      button.addEventListener('click', () => selectCase(index));
      return button;
    }),
  );
}

/** 切换用例并使用当前选区尺寸重建三组图片。 */
function selectCase(index) {
  caseIndex = (index + preview.cases.length) % preview.cases.length;
  const testCase = preview.cases[caseIndex];
  roi = {
    cx: 0.5,
    cy: 0.42,
    w: Number(roiSize.value) / 100,
    h: (Number(roiSize.value) / 100) * 0.62,
  };
  document.getElementById('currentCaseId').textContent = `${testCase.id} / ${testCase.imageSetId}`;
  document.getElementById('caseTitle').textContent = testCase.title;
  document.getElementById('caseFocus').textContent = testCase.focus;
  overviewGrid.replaceChildren(...testCase.results.map(overviewCard));
  magnifierGrid.replaceChildren(...testCase.results.map(magnifierCard));
  renderCaseChips();
  renderSourceImages(testCase);
  requestAnimationFrame(() => {
    positionOverlays();
    drawMagnifiers();
  });
}

/** 将选区恢复到默认中心与大小。 */
function resetRoi() {
  roi.cx = 0.5;
  roi.cy = 0.42;
  roiSize.value = '42';
  roi.w = 0.42;
  roi.h = 0.26;
  document.getElementById('roiSizeValue').textContent = '42%';
  positionOverlays();
  drawMagnifiers();
}

document.getElementById('templateName').textContent =
  `${preview.templateTypeId} · ${preview.templateName}`;
document.getElementById('generationMeta').textContent =
  `${preview.generation.aspectRatio} / ${preview.generation.resolution.toUpperCase()} / ${preview.generation.quality}`;
document.getElementById('prevCase').addEventListener('click', () => selectCase(caseIndex - 1));
document.getElementById('nextCase').addEventListener('click', () => selectCase(caseIndex + 1));
document.getElementById('resetRoi').addEventListener('click', resetRoi);
roiSize.addEventListener('input', () => {
  roi.w = Number(roiSize.value) / 100;
  roi.h = roi.w * 0.62;
  roi.cx = clamp(roi.cx, roi.w / 2, 1 - roi.w / 2);
  roi.cy = clamp(roi.cy, roi.h / 2, 1 - roi.h / 2);
  document.getElementById('roiSizeValue').textContent = `${roiSize.value}%`;
  positionOverlays();
  drawMagnifiers();
});
window.addEventListener('resize', () => {
  positionOverlays();
  drawMagnifiers();
});
document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.key === 'ArrowLeft') selectCase(caseIndex - 1);
  if (event.key === 'ArrowRight') selectCase(caseIndex + 1);
  if (event.key.toLowerCase() === 'r') resetRoi();
});
selectCase(0);
