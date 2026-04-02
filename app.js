const MAX_DIMENSION = 2560;
const PREVIEW_DELAY = 70;
const THEME_KEY = "noise-generator-theme";

const fileInput = document.getElementById("file");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const range = document.getElementById("noiseRange");
const noiseLabel = document.getElementById("noiseLabel");
const applyBtn = document.getElementById("apply");
const clearBtn = document.getElementById("clearNoise");
const viewBtn = document.getElementById("viewBtn");
const downloadBtn = document.getElementById("download");
const resetBtn = document.getElementById("reset");
const incBtn = document.getElementById("increaseNoise");
const decBtn = document.getElementById("decreaseNoise");
const rerollBtn = document.getElementById("rerollNoise");
const themeToggle = document.getElementById("themeToggle");
const preview = document.getElementById("preview");
const hint = document.getElementById("hint");
const statusLine = document.getElementById("status");
const fileMeta = document.getElementById("fileMeta");
const noiseModeSelect = document.getElementById("noiseMode");

const viewer = document.getElementById("viewer");
const viewerImg = document.getElementById("viewerImg");
const glass = document.getElementById("glass");
const closeViewer = document.getElementById("closeViewer");
const viewerWrap = document.getElementById("viewerWrap");

const workingCanvas = document.createElement("canvas");
const workingCtx = workingCanvas.getContext("2d", { willReadFrequently: true });

const state = {
  originalData: null,
  previewData: null,
  appliedData: null,
  seed: randomSeed(),
  noiseStrength: Number(range.value) / 100,
  noiseMode: noiseModeSelect.value,
  fileName: "",
  metaLabel: ""
};

let previewTimer = null;

function randomSeed() {
  if (window.crypto && window.crypto.getRandomValues) {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return buffer[0] || 1;
  }
  return Math.floor(Math.random() * 0xffffffff) || 1;
}

function clamp(value) {
  return value < 0 ? 0 : (value > 255 ? 255 : value);
}

function cloneImageData(src) {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

function setStatus(message) {
  statusLine.textContent = message;
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.textContent = isDark ? "Світла тема" : "Темна тема";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
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

function updateButtons() {
  const hasImage = Boolean(state.originalData);
  applyBtn.disabled = !state.previewData;
  clearBtn.disabled = !hasImage;
  viewBtn.disabled = !hasImage;
  downloadBtn.disabled = !state.appliedData;
}

function updateFileMeta(label) {
  fileMeta.textContent = label || "Ще не завантажено файл";
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

function hashNoise(x, y, seed, salt) {
  let h = Math.imul(x + 1 + salt, 374761393);
  h = (h + Math.imul(y + 1 + salt, 668265263)) >>> 0;
  h ^= seed >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function randomUnit(x, y, seed, salt) {
  return hashNoise(x, y, seed, salt) / 4294967295;
}

function grainValue(x, y, seed, salt) {
  const a = randomUnit(x, y, seed, salt);
  const b = randomUnit(x, y, seed, salt + 11);
  const c = randomUnit(x, y, seed, salt + 23);
  return ((a + b + c) / 1.5) - 1;
}

function applyNoise(source, strength, seed, mode) {
  if (!strength) {
    return cloneImageData(source);
  }

  const output = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = output.data;
  const amplitude = 76 * strength;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;

      if (mode === "rgb") {
        const rNoise = grainValue(x, y, seed, 3) * amplitude;
        const gNoise = grainValue(x, y, seed, 17) * amplitude;
        const bNoise = grainValue(x, y, seed, 29) * amplitude;
        data[index] = clamp(data[index] + rNoise);
        data[index + 1] = clamp(data[index + 1] + gNoise);
        data[index + 2] = clamp(data[index + 2] + bNoise);
        continue;
      }

      const monoNoise = grainValue(x, y, seed, 5) * amplitude;

      if (mode === "film") {
        const warmth = amplitude * 0.05;
        data[index] = clamp(data[index] + monoNoise + warmth);
        data[index + 1] = clamp(data[index + 1] + monoNoise * 0.92);
        data[index + 2] = clamp(data[index + 2] + monoNoise * 0.84 - warmth * 0.7);
        continue;
      }

      data[index] = clamp(data[index] + monoNoise);
      data[index + 1] = clamp(data[index + 1] + monoNoise);
      data[index + 2] = clamp(data[index + 2] + monoNoise);
    }
  }

  return output;
}

function schedulePreview(statusMessage) {
  if (!state.originalData) {
    return;
  }

  state.appliedData = null;
  updateButtons();
  setStatus(statusMessage || "Оновлюю прев'ю...");

  if (previewTimer) {
    window.clearTimeout(previewTimer);
  }

  previewTimer = window.setTimeout(() => {
    state.previewData = applyNoise(state.originalData, state.noiseStrength, state.seed, state.noiseMode);
    drawData(state.previewData);
    updateButtons();
    setStatus("Прев'ю оновлено. Якщо результат підходить, натисни «Застосувати».");
  }, PREVIEW_DELAY);
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
  state.seed = randomSeed();

  updateFileMeta(state.metaLabel);
  schedulePreview(
    fitted.scaled
      ? "Фото оптимізовано для швидшої обробки, готую прев'ю..."
      : "Готую прев'ю..."
  );
}

function handleFile(file) {
  if (!file) {
    return;
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    loadImageToCanvas(image, file.name);
    URL.revokeObjectURL(url);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus("Не вдалося завантажити це зображення.");
  };
  image.src = url;
}

function resetAll() {
  state.originalData = null;
  state.previewData = null;
  state.appliedData = null;
  state.seed = randomSeed();
  state.fileName = "";
  state.metaLabel = "";
  range.value = "28";
  state.noiseStrength = Number(range.value) / 100;
  noiseModeSelect.value = "mono";
  state.noiseMode = noiseModeSelect.value;
  updateNoiseLabel();
  updateFileMeta("");
  fileInput.value = "";
  if (previewTimer) {
    window.clearTimeout(previewTimer);
  }
  resetPreviewSurface();
  updateButtons();
  setStatus("Полотно очищено. Завантаж нове фото.");
}

function downloadCurrentImage() {
  if (!state.appliedData) {
    return;
  }

  const baseName = state.fileName.replace(/\.[^.]+$/, "") || "noise-generator";
  canvas.toBlob((blob) => {
    if (!blob) {
      setStatus("Не вдалося підготувати файл до завантаження.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = baseName + "-noise.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function openViewer() {
  if (!state.originalData) {
    return;
  }
  viewerImg.src = canvas.toDataURL("image/png");
  viewer.style.display = "flex";
  viewer.setAttribute("aria-hidden", "false");
  glass.style.display = "none";
}

function closeViewerModal() {
  viewer.style.display = "none";
  viewer.setAttribute("aria-hidden", "true");
  glass.style.display = "none";
}

function updateGlass(event) {
  const wrapRect = viewerWrap.getBoundingClientRect();
  const imgRect = viewerImg.getBoundingClientRect();
  const radius = 85;
  const zoom = 2.6;
  const pointer = event.touches ? event.touches[0] : event;
  const x = pointer.clientX - imgRect.left;
  const y = pointer.clientY - imgRect.top;

  if (x < 0 || y < 0 || x > imgRect.width || y > imgRect.height) {
    glass.style.display = "none";
    return;
  }

  const left = imgRect.left - wrapRect.left + x - radius;
  const top = imgRect.top - wrapRect.top + y - radius;
  const px = (x / imgRect.width) * viewerImg.naturalWidth;
  const py = (y / imgRect.height) * viewerImg.naturalHeight;

  glass.style.display = "block";
  glass.style.left = left + "px";
  glass.style.top = top + "px";
  glass.style.backgroundImage = "url(" + viewerImg.src + ")";
  glass.style.backgroundSize = (viewerImg.naturalWidth * zoom) + "px " + (viewerImg.naturalHeight * zoom) + "px";
  glass.style.backgroundPosition = (-(px * zoom - radius)) + "px " + (-(py * zoom - radius)) + "px";
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  handleFile(file);
});

preview.addEventListener("click", () => {
  fileInput.click();
});

preview.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

preview.addEventListener("dragover", (event) => {
  event.preventDefault();
  preview.classList.add("drop-active");
});

preview.addEventListener("dragleave", () => {
  preview.classList.remove("drop-active");
});

preview.addEventListener("drop", (event) => {
  event.preventDefault();
  preview.classList.remove("drop-active");
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) {
    handleFile(file);
  }
});

range.addEventListener("input", () => {
  state.noiseStrength = Number(range.value) / 100;
  updateNoiseLabel();
  schedulePreview("Перераховую прев'ю...");
});

noiseModeSelect.addEventListener("change", () => {
  state.noiseMode = noiseModeSelect.value;
  schedulePreview("Змінюю характер зерна...");
});

incBtn.addEventListener("click", () => {
  const nextValue = Math.min(100, Number(range.value) + 2);
  range.value = String(nextValue);
  state.noiseStrength = nextValue / 100;
  updateNoiseLabel();
  schedulePreview("Збільшую шум...");
});

decBtn.addEventListener("click", () => {
  const nextValue = Math.max(0, Number(range.value) - 2);
  range.value = String(nextValue);
  state.noiseStrength = nextValue / 100;
  updateNoiseLabel();
  schedulePreview("Зменшую шум...");
});

rerollBtn.addEventListener("click", () => {
  if (!state.originalData) {
    return;
  }
  state.seed = randomSeed();
  schedulePreview("Генерую новий малюнок зерна...");
});

applyBtn.addEventListener("click", () => {
  if (!state.previewData) {
    return;
  }
  state.appliedData = cloneImageData(state.previewData);
  drawData(state.appliedData);
  updateButtons();
  setStatus("Шум застосовано. Файл готовий до завантаження.");
});

clearBtn.addEventListener("click", () => {
  if (!state.originalData) {
    return;
  }
  state.previewData = null;
  state.appliedData = null;
  drawData(state.originalData);
  updateButtons();
  setStatus("Шум очищено. Зміни параметри, щоб побачити нове прев'ю.");
});

downloadBtn.addEventListener("click", downloadCurrentImage);
resetBtn.addEventListener("click", resetAll);
viewBtn.addEventListener("click", openViewer);
closeViewer.addEventListener("click", closeViewerModal);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) {
    closeViewerModal();
  }
});

viewerImg.addEventListener("mousemove", updateGlass);
viewerImg.addEventListener("touchmove", updateGlass, { passive: true });
viewerImg.addEventListener("mouseleave", () => {
  glass.style.display = "none";
});
viewerImg.addEventListener("touchend", () => {
  glass.style.display = "none";
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
updateNoiseLabel();
updateButtons();
