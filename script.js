const video = document.getElementById('video');
const canvas = document.getElementById('silhouette');
const ctx = canvas.getContext('2d', { alpha: false });
const maskCanvas = document.getElementById('maskCanvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

const statusEl = document.getElementById('status');
const cacheStatusEl = document.getElementById('cacheStatus');
const spacingEl = document.getElementById('spacing');
const iconSizeEl = document.getElementById('iconSize');
const thresholdEl = document.getElementById('threshold');
const toggleCamera = document.getElementById('toggleCamera');
const toggleBackground = document.getElementById('toggleBackground');
const cameraPreview = document.getElementById('cameraPreview');
const closePanel = document.getElementById('closePanel');
const panel = document.getElementById('settingsPanel');
const stage = document.querySelector('.stage');

const ICON_SRC = 'Head.svg';
const PROCESS_INTERVAL_MS = 45; // ~22 fps: responsive without overworking kiosk hardware.

const state = {
  ready: false,
  paused: false,
  stream: null,
  frameInFlight: false,
  lastProcessAt: 0,
  lastMaskData: null,
  maskVersion: 0,
  iconReady: false,
  iconImage: null,
  iconAspectRatio: 1,
  iconCache: new Map(),
  darkBackground: false,
  selectionCacheKey: '',
  selectedCells: [],
  cellSmoothing: null,
  cellSmoothingCols: 0,
  cellSmoothingRows: 0,
  selectedCentroid: null,
};

function setStatus(message) {
  statusEl.textContent = message;
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.selectionCacheKey = '';
}

function fitCover(sourceW, sourceH, targetW, targetH) {
  const scale = Math.max(targetW / sourceW, targetH / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;
  return {
    width,
    height,
    x: (targetW - width) / 2,
    y: (targetH - height) / 2,
    scale,
  };
}

function sampleMask(maskData, sampleX, sampleY) {
  const x = Math.max(0, Math.min(maskData.width - 1, sampleX | 0));
  const y = Math.max(0, Math.min(maskData.height - 1, sampleY | 0));
  const idx = (y * maskData.width + x) * 4;
  const r = maskData.data[idx];
  const a = maskData.data[idx + 3];
  return a < 250 ? a : r;
}

function sampleMaskNeighbourhood(maskData, sampleX, sampleY, radiusX, radiusY) {
  // A small max-filter helps retain thin limbs/fingers that can fall between grid samples.
  const offsets = [
    [0, 0],
    [-radiusX, 0], [radiusX, 0],
    [0, -radiusY], [0, radiusY],
    [-radiusX, -radiusY], [radiusX, -radiusY],
    [-radiusX, radiusY], [radiusX, radiusY],
  ];

  let best = 0;
  for (const [dx, dy] of offsets) {
    best = Math.max(best, sampleMask(maskData, sampleX + dx, sampleY + dy));
  }
  return best;
}

function getIconCanvas(size) {
  const cacheKey = Math.round(size);
  if (state.iconCache.has(cacheKey)) return state.iconCache.get(cacheKey);

  const maxSide = Math.max(1, cacheKey);
  const canvasEl = document.createElement('canvas');
  const offCtx = canvasEl.getContext('2d');

  let drawW = maxSide;
  let drawH = maxSide;
  if (state.iconAspectRatio >= 1) drawH = maxSide / state.iconAspectRatio;
  else drawW = maxSide * state.iconAspectRatio;

  canvasEl.width = Math.ceil(maxSide);
  canvasEl.height = Math.ceil(maxSide);
  const dx = (canvasEl.width - drawW) / 2;
  const dy = (canvasEl.height - drawH) / 2;
  offCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  offCtx.drawImage(state.iconImage, dx, dy, drawW, drawH);

  state.iconCache.set(cacheKey, canvasEl);
  return canvasEl;
}

function getBackgroundColor() {
  return state.darkBackground ? '#000000' : '#ffffff';
}

function drawEmptyState() {
  ctx.fillStyle = getBackgroundColor();
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  if (!state.iconReady) return;

  const spacing = Number(spacingEl.value) || 42;
  const iconSize = Math.max(16, Number(iconSizeEl.value) || 36);
  const iconCanvas = getIconCanvas(iconSize);

  ctx.globalAlpha = state.darkBackground ? 0.12 : 0.08;
  for (let y = 0; y < window.innerHeight; y += spacing * 2) {
    for (let x = 0; x < window.innerWidth; x += spacing * 2) {
      ctx.drawImage(iconCanvas, x - iconCanvas.width / 2, y - iconCanvas.height / 2);
    }
  }
  ctx.globalAlpha = 1;
}

/*
  Selfie Segmentation returns one foreground mask, not an identity for each person.
  To make an event kiosk favor the nearest/main participant, we sample the mask on
  the same grid used for the SVG matrix, find disconnected foreground blobs, and
  keep the largest blob that is reasonably central. A close participant generally
  occupies far more screen area than people walking behind them.
*/
function computeFrontPersonCells(maskData) {
  const spacing = Math.max(12, Number(spacingEl.value) || 42);
  const threshold = Number(thresholdEl.value) || 120;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const fit = fitCover(maskData.width, maskData.height, width, height);

  const cacheKey = [state.maskVersion, width, height, spacing, threshold].join('|');
  if (cacheKey === state.selectionCacheKey) return state.selectedCells;

  const cols = Math.floor(width / spacing) + 1;
  const rows = Math.floor(height / spacing) + 1;
  const cellCount = cols * rows;

  if (
    !state.cellSmoothing ||
    state.cellSmoothingCols !== cols ||
    state.cellSmoothingRows !== rows
  ) {
    state.cellSmoothing = new Float32Array(cellCount);
    state.cellSmoothingCols = cols;
    state.cellSmoothingRows = rows;
    state.selectedCentroid = null;
  }

  const occupied = new Uint8Array(cellCount);
  const confidence = new Uint8Array(cellCount);

  // Sample slightly around each matrix point instead of only one exact pixel.
  // This is especially useful for hands, forearms, hair, and other thin edges.
  const neighbourhoodScreenRadius = Math.max(5, spacing * 0.28);
  const neighbourhoodMaskRadiusX = neighbourhoodScreenRadius / fit.scale;
  const neighbourhoodMaskRadiusY = neighbourhoodScreenRadius / fit.scale;

  for (let row = 0; row < rows; row++) {
    const screenY = row * spacing;
    const maskY = (screenY - fit.y) / fit.scale;
    if (maskY < 0 || maskY >= maskData.height) continue;

    for (let col = 0; col < cols; col++) {
      const screenX = col * spacing;
      const mirroredScreenX = width - screenX;
      const maskX = (mirroredScreenX - fit.x) / fit.scale;
      if (maskX < 0 || maskX >= maskData.width) continue;

      const idx = row * cols + col;
      const raw = sampleMaskNeighbourhood(
        maskData,
        maskX,
        maskY,
        neighbourhoodMaskRadiusX,
        neighbourhoodMaskRadiusY
      );

      // Fast attack, slow release. New body pixels appear quickly, while brief
      // segmentation misses fade out over several frames instead of flickering.
      const previous = state.cellSmoothing[idx];
      const alpha = raw >= previous ? 0.58 : 0.13;
      const smoothed = previous + (raw - previous) * alpha;
      state.cellSmoothing[idx] = smoothed;
      confidence[idx] = Math.max(0, Math.min(255, Math.round(smoothed)));

      // A little hysteresis: once a cell belongs to the person, keep it until
      // confidence falls meaningfully below the visible threshold.
      const onThreshold = threshold;
      const holdThreshold = Math.max(8, threshold - 24);
      if (smoothed > onThreshold || (previous > onThreshold && smoothed > holdThreshold)) {
        occupied[idx] = 1;
      }
    }
  }

  // Build a connectivity mask with a tiny one-cell bridge. We use this only to
  // keep limbs attached through brief gaps; rendered cells still come from the
  // original occupied mask so the silhouette does not visibly get fatter.
  const connected = occupied.slice();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (occupied[idx]) continue;

      let horizontalBridge = false;
      let verticalBridge = false;
      if (col > 0 && col + 1 < cols) {
        horizontalBridge = occupied[idx - 1] && occupied[idx + 1];
      }
      if (row > 0 && row + 1 < rows) {
        verticalBridge = occupied[idx - cols] && occupied[idx + cols];
      }
      if (horizontalBridge || verticalBridge) connected[idx] = 1;
    }
  }

  const visited = new Uint8Array(cellCount);
  const components = [];
  const neighbours = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],            [1, 0],
    [-1, 1],  [0, 1],   [1, 1],
  ];

  for (let start = 0; start < connected.length; start++) {
    if (!connected[start] || visited[start]) continue;

    const queue = [start];
    visited[start] = 1;
    const cells = [];
    let head = 0;
    let sumX = 0;
    let sumY = 0;
    let renderCellCount = 0;
    let intersectsCenterZone = false;

    while (head < queue.length) {
      const idx = queue[head++];
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const x = col * spacing;
      const y = row * spacing;

      if (occupied[idx]) {
        cells.push({ x, y, confidence: confidence[idx] });
        sumX += x;
        sumY += y;
        renderCellCount += 1;
      }

      if (x >= width * 0.18 && x <= width * 0.82 && y >= height * 0.05 && y <= height * 0.97) {
        intersectsCenterZone = true;
      }

      for (const [dx, dy] of neighbours) {
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (connected[ni] && !visited[ni]) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    if (!renderCellCount) continue;

    const cx = sumX / renderCellCount;
    const cy = sumY / renderCellCount;
    const xDist = Math.abs(cx - width / 2) / Math.max(1, width / 2);
    const yDist = Math.abs(cy - height * 0.55) / Math.max(1, height * 0.55);
    const centrality = Math.max(0.22, 1 - xDist * 0.62 - yDist * 0.1);

    let continuity = 1;
    if (state.selectedCentroid) {
      const dx = (cx - state.selectedCentroid.x) / Math.max(1, width);
      const dy = (cy - state.selectedCentroid.y) / Math.max(1, height);
      const distance = Math.hypot(dx, dy);
      continuity += Math.max(0, 0.45 - distance) * 0.9;
    }

    components.push({
      cells,
      size: renderCellCount,
      cx,
      cy,
      intersectsCenterZone,
      score: renderCellCount * centrality * continuity,
    });
  }

  const minCells = Math.max(6, Math.round(cols * rows * 0.008));
  let candidates = components.filter((component) => component.size >= minCells);
  const centralCandidates = candidates.filter((component) => component.intersectsCenterZone);
  if (centralCandidates.length) candidates = centralCandidates;

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  if (winner) {
    state.selectedCells = winner.cells;
    state.selectedCentroid = { x: winner.cx, y: winner.cy };
  } else {
    state.selectedCells = [];
    state.selectedCentroid = null;
  }

  state.selectionCacheKey = cacheKey;
  return state.selectedCells;
}

function drawSvgMatrix() {
  ctx.fillStyle = getBackgroundColor();
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  if (!state.lastMaskData || !state.iconReady) {
    drawEmptyState();
    requestAnimationFrame(drawSvgMatrix);
    return;
  }

  const threshold = Number(thresholdEl.value) || 120;
  const iconSize = Number(iconSizeEl.value) || 36;
  const iconCanvas = getIconCanvas(iconSize);
  const selectedCells = computeFrontPersonCells(state.lastMaskData);

  for (const cell of selectedCells) {
    const normalized = Math.min(1, Math.max(0, (cell.confidence - threshold) / (255 - threshold)));
    ctx.globalAlpha = 0.68 + normalized * 0.32;
    ctx.drawImage(
      iconCanvas,
      cell.x - iconCanvas.width / 2,
      cell.y - iconCanvas.height / 2
    );
  }

  ctx.globalAlpha = 1;
  requestAnimationFrame(drawSvgMatrix);
}

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access needs HTTPS or localhost.');
  }

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  });

  video.srcObject = state.stream;
  await video.play();
}

function updateMaskCanvasSize(results) {
  const width = results.image?.width || video.videoWidth || 640;
  const height = results.image?.height || video.videoHeight || 480;
  if (maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas.width = width;
    maskCanvas.height = height;
  }
}

function onSegmentationResults(results) {
  updateMaskCanvasSize(results);
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskCtx.drawImage(results.segmentationMask, 0, 0, maskCanvas.width, maskCanvas.height);
  state.lastMaskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  state.maskVersion += 1;

  if (!state.ready) {
    state.ready = true;
    setStatus('Move in front of the camera to paint your silhouette.');
  }
}

async function processFrames(segmenter, timestamp = performance.now()) {
  if (
    !state.paused &&
    video.readyState >= 2 &&
    !state.frameInFlight &&
    timestamp - state.lastProcessAt >= PROCESS_INTERVAL_MS
  ) {
    state.frameInFlight = true;
    state.lastProcessAt = timestamp;
    try {
      await segmenter.send({ image: video });
    } catch (err) {
      console.error(err);
      setStatus('Segmentation paused after an error. Refresh to retry.');
    } finally {
      state.frameInFlight = false;
    }
  }

  requestAnimationFrame((nextTimestamp) => processFrames(segmenter, nextTimestamp));
}

function stopCamera() {
  state.paused = true;
  state.stream?.getTracks().forEach((track) => track.stop());
  toggleCamera.textContent = 'Resume camera';
  setStatus('Camera paused. The last silhouette remains on screen.');
}

async function resumeCamera() {
  state.paused = false;
  await setupCamera();
  toggleCamera.textContent = 'Pause camera';
  setStatus('Camera running.');
}

async function loadIcon() {
  const img = new Image();
  img.src = ICON_SRC;
  await img.decode();
  state.iconImage = img;
  state.iconAspectRatio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
  state.iconReady = true;
}

function showPanel() {
  stage.classList.remove('ui-hidden');
}

function hidePanel() {
  stage.classList.add('ui-hidden');
}

function togglePanel() {
  stage.classList.toggle('ui-hidden');
}

function setupUiControls() {
  closePanel.addEventListener('click', hidePanel);

  toggleBackground.addEventListener('click', () => {
    state.darkBackground = !state.darkBackground;
    toggleBackground.textContent = state.darkBackground ? 'Background: Black' : 'Background: White';
  });

  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  stage.addEventListener('pointerup', (event) => {
    if (event.target.closest('.panel') || event.target.closest('.camera-preview')) return;

    const now = performance.now();
    const dt = now - lastTapAt;
    const distance = Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY);

    if (dt > 0 && dt < 360 && distance < 56) {
      event.preventDefault();
      togglePanel();
      lastTapAt = 0;
      return;
    }

    lastTapAt = now;
    lastTapX = event.clientX;
    lastTapY = event.clientY;
  });

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();

    if (key === 'h') {
      event.preventDefault();
      togglePanel();
    } else if (key === 'd') {
      event.preventDefault();
      state.darkBackground = !state.darkBackground;
      toggleBackground.textContent = state.darkBackground ? 'Background: Black' : 'Background: White';
    }
  }, { capture: true });
}

async function setupOfflineCache() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) {
    cacheStatusEl.textContent = 'Offline cache: unavailable in this launch mode.';
    return;
  }

  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    cacheStatusEl.textContent = 'Offline cache: ready.';
  } catch (err) {
    console.warn('Service worker registration failed:', err);
    cacheStatusEl.textContent = 'Offline cache: could not be prepared.';
  }
}

async function boot() {
  resizeCanvas();
  setupUiControls();
  setupOfflineCache();
  drawEmptyState();
  drawSvgMatrix();

  try {
    await loadIcon();
    drawEmptyState();
    await setupCamera();

    const segmenter = new SelfieSegmentation({
      locateFile: (file) => `mediapipe/${file}`,
    });

    segmenter.setOptions({
      modelSelection: 0,
      selfieMode: false,
    });

    segmenter.onResults(onSegmentationResults);
    setStatus('Camera active. Starting silhouette tracking…');
    processFrames(segmenter);

    toggleCamera.addEventListener('click', async () => {
      if (state.paused) {
        try {
          await resumeCamera();
        } catch (err) {
          console.error(err);
          setStatus('Could not restart the camera. Check browser permissions.');
        }
      } else {
        stopCamera();
      }
    });
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Could not access webcam. Check browser permissions.');
  }
}

window.addEventListener('resize', resizeCanvas);
boot();
