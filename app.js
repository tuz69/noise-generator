const MAX_DIMENSION = 2560;
const PREVIEW_DELAY = 70;
const EXPORT_DELAY = 160;
const THEME_KEY = "noise-generator-theme";
const NOISE_VALUE_KEY = "noise-generator-noise-value";

const fileInput = document.getElementById("file");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const range = document.getElementById("noiseRange");
const noiseLabel = document.getElementById("noiseLabel");
const incBtn = document.getElementById("increaseNoise");
const decBtn = document.getElementById("decreaseNoise");
const applyBtn = document.getElementById("apply");
const zoomBtn = document.getElementById("zoom");
const downloadBtn = document.getElementById("download");
const resetBtn = document.getElementById("reset");
const themeToggle = document.getElementById("themeToggle");
const preview = document.getElementById("preview");
const hint = document.getElementById("hint");
const statusLine = document.getElementById("status");
const fileMeta = document.getElementById("fileMeta");
const batchPanel = document.getElementById("batchPanel");
const batchStatus = document.getElementById("batchStatus");
const batchList = document.getElementById("batchList");
const batchProgress = document.getElementById("batchProgress");
const prevPhotoBtn = document.getElementById("prevPhoto");
const nextPhotoBtn = document.getElementById("nextPhoto");
const downloadBatchBtn = document.getElementById("downloadBatch");
const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewerImg");
const closeViewer = document.getElementById("closeViewer");
const exportFormat = document.getElementById("exportFormat");
const exportQuality = document.getElementById("exportQuality");
const qualityLabel = document.getElementById("qualityLabel");
const exportHint = document.getElementById("exportHint");
const exportMeta = document.getElementById("exportMeta");

const workingCanvas = document.createElement("canvas");
const workingCtx = workingCanvas.getContext("2d", { willReadFrequently: true });
const initialNoiseValue = readSavedNoiseValue(Number(range.value));

range.value = String(initialNoiseValue);

const state = {
  originalData: null,
  previewData: null,
  appliedData: null,
  noiseStrength: initialNoiseValue / 100,
  fileName: "",
  metaLabel: "",
  photos: [],
  activeIndex: -1,
  loadId: 0,
  exportId: 0,
  encodedResult: null,
  isProcessingBatch: false
};

let previewTimer = null;
let exportTimer = null;

function clamp(value) {
  return value < 0 ? 0 : (value > 255 ? 255 : value);
}

function cloneImageData(src) {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

function isImageFile(file) {
  return Boolean(file && (
    (file.type && file.type.startsWith("image/")) ||
    /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || "")
  ));
}

function setStatus(message) {
  statusLine.textContent = message;
}

function clampNoiseValue(value) {
  if (!Number.isFinite(value)) {
    return 15;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function readSavedNoiseValue(fallback) {
  try {
    const rawValue = localStorage.getItem(NOISE_VALUE_KEY);
    if (rawValue !== null && rawValue !== "") {
      const savedValue = Number(rawValue);
      if (Number.isFinite(savedValue)) {
        return clampNoiseValue(savedValue);
      }
    }
  } catch (error) {
    console.warn("Noise preference was not read", error);
  }

  return clampNoiseValue(fallback);
}

function saveNoiseValue(value) {
  try {
    localStorage.setItem(NOISE_VALUE_KEY, String(clampNoiseValue(value)));
  } catch (error) {
    console.warn("Noise preference was not saved", error);
  }
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.textContent = isDark ? "Світла тема" : "Темна тема";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn("Theme preference was not saved", error);
  }
}

function initTheme() {
  let savedTheme = "";
  try {
    savedTheme = localStorage.getItem(THEME_KEY) || "";
  } catch (error) {
    savedTheme = "";
  }

  if (savedTheme === "light" || savedTheme === "dark") {
    setTheme(savedTheme);
    return;
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
}

function updateNoiseLabel() {
  noiseLabel.textContent = Math.round(state.noiseStrength * 100) + "%";
}

function setNoiseValue(value, statusMessage) {
  if (state.isProcessingBatch) {
    return;
  }
  const nextValue = clampNoiseValue(value);
  range.value = String(nextValue);
  state.noiseStrength = nextValue / 100;
  saveNoiseValue(nextValue);
  updateNoiseLabel();
  schedulePreview(statusMessage || "Перераховую прев'ю...");
}

function updateButtons() {
  const hasImage = Boolean(state.originalData);
  const hasBatch = state.photos.length > 1;
  const busy = state.isProcessingBatch;
  applyBtn.disabled = !state.previewData || busy;
  zoomBtn.disabled = !hasImage;
  downloadBtn.disabled = !state.encodedResult || busy;
  fileInput.disabled = busy;
  range.disabled = busy;
  incBtn.disabled = busy;
  decBtn.disabled = busy;
  resetBtn.disabled = busy;
  exportFormat.disabled = busy;
  exportQuality.disabled = busy || exportFormat.value === "image/png";
  preview.setAttribute("aria-disabled", String(busy));
  prevPhotoBtn.disabled = !hasBatch || busy || state.activeIndex <= 0;
  nextPhotoBtn.disabled = !hasBatch || busy || state.activeIndex < 0 || state.activeIndex >= state.photos.length - 1;
  downloadBatchBtn.disabled = !hasBatch || busy;
}

function readExportSettings() {
  return {
    format: exportFormat.value,
    quality: Math.min(1, Math.max(0.6, Number(exportQuality.value) / 100))
  };
}

function updateExportHint() {
  qualityLabel.textContent = Math.round(readExportSettings().quality * 100) + "%";
  const hints = {
    auto: "Авто обирає менший із JPEG і WebP. Прозорість зберігається у WebP; якщо він недоступний — у PNG.",
    "image/webp": "WebP зменшує вагу зі збереженням прозорості. Якщо браузер його не підтримує, буде PNG.",
    "image/jpeg": "JPEG підходить для фото. Прозорі ділянки отримають білий фон.",
    "image/png": "PNG зберігає зображення без втрат. Шум може суттєво збільшити вагу; якість для PNG не змінюється."
  };
  exportHint.textContent = hints[exportFormat.value] || hints.auto;
  updateButtons();
}

function invalidateExport() {
  state.exportId += 1;
  state.encodedResult = null;
  window.clearTimeout(exportTimer);
  exportMeta.textContent = "";
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return bytes + " Б";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " КБ";
  }
  return (bytes / (1024 * 1024)).toFixed(2) + " МБ";
}

function sizeComparison(inputBytes, outputBytes) {
  if (!inputBytes) {
    return formatBytes(outputBytes);
  }
  const change = (outputBytes / inputBytes - 1) * 100;
  const rounded = Math.abs(change).toFixed(1);
  const changeLabel = rounded === "0.0" ? "без змін" : (change > 0 ? "+" : "−") + rounded + "%";
  return `${formatBytes(inputBytes)} → ${formatBytes(outputBytes)} (${changeLabel})`;
}

function typeLabel(type) {
  return ({ "image/jpeg": "JPEG", "image/webp": "WebP", "image/png": "PNG" })[type] || type;
}

function scheduleExport(delay = EXPORT_DELAY) {
  invalidateExport();
  updateExportHint();
  if (!state.appliedData) {
    return;
  }

  const currentExport = state.exportId;
  const data = state.appliedData;
  const settings = readExportSettings();
  const photo = state.photos[state.activeIndex];
  const inputFile = photo && photo.file;
  exportMeta.textContent = "Готую оптимізований файл...";
  setStatus("Шум застосовано. Готую файл до завантаження...");

  exportTimer = window.setTimeout(async () => {
    try {
      const result = await encodeImage(data, settings, inputFile);
      if (currentExport !== state.exportId || data !== state.appliedData) {
        return;
      }
      state.encodedResult = result;
      exportMeta.textContent = typeLabel(result.blob.type) + " · " + sizeComparison(inputFile ? inputFile.size : 0, result.blob.size);
      const fallback = result.fallback ? " Браузер не підтримує обраний формат, використано PNG." : "";
      if (!state.isProcessingBatch) {
        setStatus("Файл готовий до завантаження." + fallback);
      }
    } catch (error) {
      if (currentExport !== state.exportId) {
        return;
      }
      console.error(error);
      exportMeta.textContent = "Не вдалося підготувати файл.";
      setStatus("Помилка експорту. Спробуй інший формат або натисни «Застосувати» ще раз.");
    } finally {
      updateButtons();
    }
  }, delay);
}

function updateFileMeta(label) {
  fileMeta.textContent = label || "Ще не завантажено файл";
}

function updateBatchList() {
  batchList.innerHTML = "";
  const hasBatch = state.photos.length > 1;
  batchPanel.hidden = !hasBatch;

  if (!hasBatch) {
    batchStatus.textContent = "Можна обрати одне фото або кілька одразу.";
    updateButtons();
    return;
  }

  const activePhoto = state.photos[state.activeIndex];
  const activeName = activePhoto ? " - " + activePhoto.file.name : "";
  batchStatus.textContent = `У пакеті: ${state.photos.length} фото. Активне: ${state.activeIndex + 1}/${state.photos.length}${activeName}`;

  state.photos.forEach((photo, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "batch-item" + (index === state.activeIndex ? " active" : "");
    item.title = photo.file.name;
    item.disabled = state.isProcessingBatch;

    const number = document.createElement("span");
    number.className = "batch-index";
    number.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "batch-name";
    name.textContent = photo.file.name;

    item.append(number, name);
    item.addEventListener("click", () => selectPhoto(index));
    batchList.appendChild(item);
  });

  updateButtons();
}

function setBatchProgress(message) {
  batchProgress.textContent = message || "";
}

function fitDimensions(width, height) {
  const longestSide = Math.max(width, height);
  if (longestSide <= MAX_DIMENSION) {
    return { width, height, scaled: false };
  }
  const ratio = MAX_DIMENSION / longestSide;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    scaled: true
  };
}

function drawData(data) {
  canvas.width = data.width;
  canvas.height = data.height;
  ctx.putImageData(data, 0, 0);
  canvas.hidden = false;
  hint.hidden = true;
}

function resetPreviewSurface() {
  canvas.hidden = true;
  canvas.width = 0;
  canvas.height = 0;
  hint.hidden = false;
  preview.classList.remove("drop-active");
}

function applyNoise(source, strength) {
  if (!strength) {
    return cloneImageData(source);
  }

  const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = output.data;
  const amplitude = 80 * strength;

  for (let index = 0; index < data.length; index += 4) {
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    const randomValue = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const noise = randomValue * amplitude;

    data[index] = clamp(data[index] + noise);
    data[index + 1] = clamp(data[index + 1] + noise);
    data[index + 2] = clamp(data[index + 2] + noise);
  }

  return output;
}

function schedulePreview(statusMessage) {
  if (!state.originalData) {
    return;
  }

  state.appliedData = null;
  state.previewData = null;
  invalidateExport();
  updateButtons();
  setStatus(statusMessage || "Оновлюю прев'ю...");

  if (previewTimer) {
    window.clearTimeout(previewTimer);
  }

  const currentLoad = state.loadId;
  previewTimer = window.setTimeout(() => {
    if (currentLoad !== state.loadId || !state.originalData) {
      return;
    }
    state.previewData = applyNoise(state.originalData, state.noiseStrength);
    drawData(state.previewData);
    updateButtons();
    setStatus("Прев'ю оновлено. Якщо результат підходить, натисни «Застосувати».");
  }, PREVIEW_DELAY);
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

function loadImageToCanvas(image, fileName) {
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const fitted = fitDimensions(originalWidth, originalHeight);

  workingCanvas.width = fitted.width;
  workingCanvas.height = fitted.height;
  workingCtx.clearRect(0, 0, fitted.width, fitted.height);
  workingCtx.drawImage(image, 0, 0, fitted.width, fitted.height);

  state.originalData = workingCtx.getImageData(0, 0, fitted.width, fitted.height);
  state.previewData = null;
  state.appliedData = null;
  state.fileName = fileName || "noise-generator";
  state.metaLabel = fitted.scaled
    ? fileName + " · " + originalWidth + "×" + originalHeight + " -> " + fitted.width + "×" + fitted.height
    : fileName + " · " + fitted.width + "×" + fitted.height;
  updateFileMeta(state.metaLabel);
  schedulePreview(
    fitted.scaled
      ? "Фото оптимізовано для швидшої обробки, готую прев'ю..."
      : "Готую прев'ю..."
  );
}

async function selectPhoto(index) {
  if (index < 0 || index >= state.photos.length || state.isProcessingBatch) {
    return;
  }

  state.activeIndex = index;
  state.loadId += 1;
  const currentLoad = state.loadId;

  if (previewTimer) {
    window.clearTimeout(previewTimer);
  }

  state.originalData = null;
  state.previewData = null;
  state.appliedData = null;
  invalidateExport();
  resetPreviewSurface();
  updateButtons();
  updateBatchList();

  const photo = state.photos[index];
  updateFileMeta(photo.file.name);
  setStatus("Завантажую фото...");

  try {
    const image = await loadImageFromFile(photo.file);
    if (currentLoad !== state.loadId) {
      return;
    }
    loadImageToCanvas(image, photo.file.name);
  } catch (error) {
    if (currentLoad !== state.loadId) {
      return;
    }
    console.error(error);
    setStatus("Не вдалося завантажити це зображення.");
    updateFileMeta("");
  } finally {
    updateBatchList();
    updateButtons();
  }
}

function handleFiles(fileList) {
  if (state.isProcessingBatch) {
    return;
  }
  const imageFiles = Array.from(fileList || []).filter(isImageFile);
  if (!imageFiles.length) {
    setStatus("Оберіть файли зображень у форматі JPG, PNG або WEBP.");
    return;
  }

  state.photos = imageFiles.map((file) => ({ file }));
  state.activeIndex = 0;
  setBatchProgress("");
  fileInput.value = "";
  updateBatchList();
  selectPhoto(0);
}

function resetAll() {
  if (state.isProcessingBatch) {
    return;
  }
  state.originalData = null;
  state.previewData = null;
  state.appliedData = null;
  invalidateExport();
  state.fileName = "";
  state.metaLabel = "";
  state.photos = [];
  state.activeIndex = -1;
  state.loadId += 1;
  range.value = "15";
  state.noiseStrength = Number(range.value) / 100;
  saveNoiseValue(Number(range.value));
  updateNoiseLabel();
  updateFileMeta("");
  setBatchProgress("");
  fileInput.value = "";
  if (previewTimer) {
    window.clearTimeout(previewTimer);
  }
  resetPreviewSurface();
  updateBatchList();
  updateButtons();
  setStatus("Полотно очищено. Завантаж нове фото.");
}

function getBaseName(name) {
  return (name || "noise-generator").replace(/\.[^.]+$/, "");
}

function sanitizeFilePart(name) {
  const clean = (name || "photo")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 80);
  return clean || "photo";
}

function outputNameFor(file, index, type) {
  const fallback = "photo-" + (index + 1);
  const base = sanitizeFilePart(getBaseName(file ? file.name : fallback));
  const extension = ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" })[type];
  if (!extension) {
    throw new Error("Unexpected export format: " + type);
  }
  return base + "-noise." + extension;
}

function uniqueName(name, used) {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let counter = 2;
  let candidate = base + "-" + counter + ext;
  while (used.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = base + "-" + counter + ext;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function canvasToBlob(targetCanvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    targetCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Canvas export failed"));
    }, type, quality);
  });
}

function hasTransparency(data) {
  for (let index = 3; index < data.data.length; index += 4) {
    if (data.data[index] !== 255) {
      return true;
    }
  }
  return false;
}

// Single exports and ZIP entries use the same encoder and actual MIME type.
async function encodeImage(data, settings, inputFile) {
  const target = document.createElement("canvas");
  target.width = data.width;
  target.height = data.height;
  const targetCtx = target.getContext("2d");
  targetCtx.putImageData(data, 0, 0);
  const transparent = hasTransparency(data);
  const format = settings.format;

  if (format === "image/jpeg" && transparent) {
    targetCtx.globalCompositeOperation = "destination-over";
    targetCtx.fillStyle = "#fff";
    targetCtx.fillRect(0, 0, target.width, target.height);
    targetCtx.globalCompositeOperation = "source-over";
  }

  try {
    if (format !== "auto") {
      const blob = await canvasToBlob(target, format, settings.quality);
      if (blob.type !== format && blob.type !== "image/png") {
        throw new Error("Unexpected browser export format");
      }
      return { blob, fallback: blob.type !== format };
    }

    // Browsers fall back to PNG for unsupported formats: compare only actual types.
    const candidates = [];
    let pngFallback = null;
    const types = transparent ? ["image/webp"] : ["image/webp", "image/jpeg"];
    for (const type of types) {
      try {
        const blob = await canvasToBlob(target, type, settings.quality);
        if (blob.type === type) {
          candidates.push(blob);
        } else if (blob.type === "image/png") {
          pngFallback = blob;
        }
      } catch (error) {
        console.warn("Export format unavailable", type, error);
      }
    }

    if (!candidates.length) {
      const blob = pngFallback || await canvasToBlob(target);
      return { blob, fallback: true };
    }

    // Small transparent PNG artwork can remain smaller without lossy conversion.
    // No extra PNG encoding is needed for ordinary opaque photographs.
    if (transparent && inputFile && inputFile.type === "image/png" && inputFile.size < candidates[0].size) {
      candidates.push(pngFallback || await canvasToBlob(target));
    }
    const blob = candidates.reduce((smallest, candidate) => candidate.size < smallest.size ? candidate : smallest);
    return { blob, fallback: false };
  } finally {
    target.width = 0;
    target.height = 0;
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function downloadCurrentImage() {
  if (!state.encodedResult || state.isProcessingBatch) {
    return;
  }
  const blob = state.encodedResult.blob;
  const activePhoto = state.photos[state.activeIndex];
  downloadBlob(blob, outputNameFor(activePhoto && activePhoto.file, state.activeIndex, blob.type));
}

async function renderFileToBlob(file, strength, settings) {
  const image = await loadImageFromFile(file);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const fitted = fitDimensions(originalWidth, originalHeight);
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

  tempCanvas.width = fitted.width;
  tempCanvas.height = fitted.height;
  tempCtx.drawImage(image, 0, 0, fitted.width, fitted.height);

  const source = tempCtx.getImageData(0, 0, fitted.width, fitted.height);
  const result = applyNoise(source, strength);
  tempCanvas.width = 0;
  tempCanvas.height = 0;
  return encodeImage(result, settings, file);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function push16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function push32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosDateTime(date) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(safeDate.getFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate(),
    time: (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2)
  };
}

async function createZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(data);
    const size = data.length;
    const stamp = dosDateTime(entry.date);
    const utf8Flag = 0x0800;

    const localHeader = [];
    push32(localHeader, 0x04034b50);
    push16(localHeader, 20);
    push16(localHeader, utf8Flag);
    push16(localHeader, 0);
    push16(localHeader, stamp.time);
    push16(localHeader, stamp.date);
    push32(localHeader, crc);
    push32(localHeader, size);
    push32(localHeader, size);
    push16(localHeader, nameBytes.length);
    push16(localHeader, 0);

    const centralHeader = [];
    push32(centralHeader, 0x02014b50);
    push16(centralHeader, 20);
    push16(centralHeader, 20);
    push16(centralHeader, utf8Flag);
    push16(centralHeader, 0);
    push16(centralHeader, stamp.time);
    push16(centralHeader, stamp.date);
    push32(centralHeader, crc);
    push32(centralHeader, size);
    push32(centralHeader, size);
    push16(centralHeader, nameBytes.length);
    push16(centralHeader, 0);
    push16(centralHeader, 0);
    push16(centralHeader, 0);
    push16(centralHeader, 0);
    push32(centralHeader, 0);
    push32(centralHeader, offset);

    const localHeaderBytes = new Uint8Array(localHeader);
    const centralHeaderBytes = new Uint8Array(centralHeader);
    localParts.push(localHeaderBytes, nameBytes, data);
    centralParts.push(centralHeaderBytes, nameBytes);
    offset += localHeaderBytes.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = [];
  push32(endRecord, 0x06054b50);
  push16(endRecord, 0);
  push16(endRecord, 0);
  push16(endRecord, entries.length);
  push16(endRecord, entries.length);
  push32(endRecord, centralSize);
  push32(endRecord, centralOffset);
  push16(endRecord, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(endRecord)], { type: "application/zip" });
}

function dateStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "-" + pad(date.getHours()) + pad(date.getMinutes());
}

async function downloadBatch() {
  if (state.photos.length <= 1 || state.isProcessingBatch) {
    return;
  }

  const photos = state.photos.slice();
  const strength = state.noiseStrength;
  const settings = readExportSettings();
  state.isProcessingBatch = true;
  downloadBatchBtn.textContent = "Готуємо пак...";
  updateBatchList();
  updateButtons();

  const usedNames = new Set();
  const entries = [];
  let failed = 0;
  let totalInputBytes = 0;
  let totalOutputBytes = 0;
  let fallbacks = 0;

  try {
    for (let i = 0; i < photos.length; i += 1) {
      const photo = photos[i];
      setBatchProgress(`Обробка ${i + 1}/${photos.length}: ${photo.file.name}`);

      try {
        const result = await renderFileToBlob(photo.file, strength, settings);
        const blob = result.blob;
        totalInputBytes += photo.file.size;
        totalOutputBytes += blob.size;
        fallbacks += result.fallback ? 1 : 0;
        entries.push({
          name: uniqueName(outputNameFor(photo.file, i, blob.type), usedNames),
          blob,
          date: photo.file.lastModified ? new Date(photo.file.lastModified) : new Date()
        });
      } catch (error) {
        failed += 1;
        console.error("Batch image failed", photo.file.name, error);
      }
    }

    if (!entries.length) {
      setBatchProgress("Не вдалося обробити жодне фото.");
      setStatus("Не вдалося обробити жодне фото з пакета.");
      return;
    }

    setBatchProgress("Створення ZIP...");
    const zip = await createZip(entries);
    downloadBlob(zip, "noise-pack-" + dateStamp(new Date()) + ".zip");

    let message = failed
      ? `Готово: ${entries.length} фото, не вдалося: ${failed}.`
      : `Готово: ${entries.length} фото.`;
    message += ` Файли: ${sizeComparison(totalInputBytes, totalOutputBytes)}. ZIP: ${formatBytes(zip.size)}.`;
    if (fallbacks) {
      message += ` PNG через обмеження браузера: ${fallbacks}.`;
    }
    setBatchProgress(message);
    setStatus("Пак оброблено та підготовлено до завантаження.");
  } catch (error) {
    console.error("Batch export failed", error);
    setBatchProgress("Не вдалося створити ZIP. Спробуй менший пакет.");
    setStatus("Не вдалося підготувати пакет до завантаження.");
  } finally {
    state.isProcessingBatch = false;
    downloadBatchBtn.textContent = "Завантажити пак";
    updateBatchList();
    updateButtons();
  }
}

function openViewer() {
  if (!state.originalData) {
    return;
  }
  viewerImg.src = canvas.toDataURL("image/png");
  viewer.style.display = "flex";
  viewer.setAttribute("aria-hidden", "false");
}

function closeViewerModal() {
  viewer.style.display = "none";
  viewer.setAttribute("aria-hidden", "true");
}

fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
});

preview.addEventListener("click", () => {
  if (!state.isProcessingBatch) {
    fileInput.click();
  }
});

preview.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!state.isProcessingBatch) {
      fileInput.click();
    }
  }
});

preview.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!state.isProcessingBatch) {
    preview.classList.add("drop-active");
  }
});

preview.addEventListener("dragleave", () => {
  preview.classList.remove("drop-active");
});

preview.addEventListener("drop", (event) => {
  event.preventDefault();
  preview.classList.remove("drop-active");
  handleFiles(event.dataTransfer.files);
});

range.addEventListener("input", () => {
  setNoiseValue(Number(range.value), "Перераховую прев'ю...");
});

decBtn.addEventListener("click", () => {
  setNoiseValue(Number(range.value) - 1, "Перераховую прев'ю...");
});

incBtn.addEventListener("click", () => {
  setNoiseValue(Number(range.value) + 1, "Перераховую прев'ю...");
});

applyBtn.addEventListener("click", () => {
  if (!state.previewData || state.isProcessingBatch) {
    return;
  }
  state.appliedData = cloneImageData(state.previewData);
  drawData(state.appliedData);
  scheduleExport(0);
});

exportFormat.addEventListener("change", () => {
  if (!state.isProcessingBatch) {
    scheduleExport();
  }
});
exportQuality.addEventListener("input", () => {
  if (!state.isProcessingBatch) {
    scheduleExport();
  }
});

downloadBtn.addEventListener("click", downloadCurrentImage);
downloadBatchBtn.addEventListener("click", downloadBatch);
zoomBtn.addEventListener("click", openViewer);
resetBtn.addEventListener("click", resetAll);
prevPhotoBtn.addEventListener("click", () => selectPhoto(state.activeIndex - 1));
nextPhotoBtn.addEventListener("click", () => selectPhoto(state.activeIndex + 1));
closeViewer.addEventListener("click", closeViewerModal);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) {
    closeViewerModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && viewer.style.display === "flex") {
    closeViewerModal();
  }
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
});

initTheme();
updateExportHint();
updateNoiseLabel();
updateFileMeta("");
updateBatchList();
updateButtons();
