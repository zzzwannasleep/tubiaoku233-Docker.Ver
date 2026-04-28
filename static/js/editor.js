let currentImageURL = null;
let currentExportURL = null;
let originalFilenameBase = "icon";
let currentStage = "empty";

let cropper = null;

const el = (id) => document.getElementById(id);

function setNotice(message = "", tone = "info") {
  const notice = el("editorNotice");
  if (!notice) return;

  if (!message) {
    notice.textContent = "";
    notice.dataset.tone = "";
    notice.classList.add("is-empty");
    return;
  }

  notice.textContent = message;
  notice.dataset.tone = tone;
  notice.classList.remove("is-empty");
}

function setMessageBox(id, message = "", tone = "info", allowHtml = false) {
  const box = el(id);
  if (!box) return;

  if (!message) {
    box.textContent = "";
    box.dataset.tone = "";
    box.classList.add("is-empty");
    return;
  }

  if (allowHtml) {
    box.innerHTML = message;
  } else {
    box.textContent = message;
  }
  box.dataset.tone = tone;
  box.classList.remove("is-empty");
}

function updateStageUI(stage) {
  currentStage = stage;

  const titleEl = el("stageTitle");
  const copyEl = el("stageCopy");
  const modeEl = el("modePill");

  if (!titleEl || !copyEl || !modeEl) return;

  if (stage === "ai") {
    titleEl.textContent = "AI 抠图结果已载入";
    copyEl.textContent = "现在可以继续微调裁剪范围，然后导出或上传到透明分类。";
    modeEl.textContent = "AI 结果";
    modeEl.classList.add("state-pill--accent");
    return;
  }

  if (stage === "crop") {
    titleEl.textContent = "调整裁剪范围";
    copyEl.textContent = "拖拽图片或使用缩放工具，让主体保持在 1:1 裁剪框内。";
    modeEl.textContent = "裁剪中";
    modeEl.classList.add("state-pill--accent");
    return;
  }

  titleEl.textContent = "请先导入一张图片";
  copyEl.textContent = "导入后可以直接裁剪、AI 抠图、导出和上传。";
  modeEl.textContent = "等待图片";
  modeEl.classList.remove("state-pill--accent");
}

function showOnly(which) {
  const emptyWrap = el("emptyWrap");
  const cropWrap = el("cropWrap");
  if (emptyWrap) emptyWrap.style.display = which === "empty" ? "flex" : "none";
  if (cropWrap) cropWrap.style.display = which === "crop" ? "flex" : "none";
  updateStageUI(which === "crop" ? currentStage === "ai" ? "ai" : "crop" : "empty");
}

function setFileState(pill, meta) {
  const filePill = el("filePill");
  const fileMeta = el("fileMeta");
  if (filePill) filePill.textContent = pill;
  if (fileMeta) fileMeta.textContent = meta;
}

function setPreviewState(label, kind = "PNG") {
  const previewPill = el("previewPill");
  const previewSizePill = el("previewSizePill");
  if (previewPill) previewPill.textContent = label;
  if (previewSizePill) previewSizePill.textContent = kind;
}

function setExportPreview(blob, kindLabel) {
  const exportImg = el("exportImg");
  const exportEmpty = el("exportEmpty");
  if (!exportImg || !exportEmpty) return;

  if (currentExportURL) {
    URL.revokeObjectURL(currentExportURL);
  }

  currentExportURL = URL.createObjectURL(blob);
  exportImg.src = currentExportURL;
  exportImg.style.display = "block";
  exportEmpty.style.display = "none";
  setPreviewState("已导出", kindLabel);
}

function clearExportPreview() {
  const exportImg = el("exportImg");
  const exportEmpty = el("exportEmpty");

  if (currentExportURL) {
    URL.revokeObjectURL(currentExportURL);
    currentExportURL = null;
  }

  if (exportImg) {
    exportImg.src = "";
    exportImg.style.display = "none";
  }
  if (exportEmpty) {
    exportEmpty.style.display = "flex";
  }
  setPreviewState("未导出", "PNG");
}

function filenameToName(filename) {
  return filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
}

function destroyCropper() {
  if (!cropper) return;
  cropper.destroy();
  cropper = null;
}

function initCropper(imgEl) {
  destroyCropper();

  cropper = new Cropper(imgEl, {
    aspectRatio: 1,
    viewMode: 1,
    autoCrop: true,
    autoCropArea: 0.82,
    background: false,
    guides: false,
    center: false,
    dragMode: "move",
    movable: true,
    cropBoxMovable: true,
    cropBoxResizable: true,
    zoomOnWheel: true,
    zoomable: true,
    responsive: true,
    checkOrientation: false,
  });
}

function cropBoxCenter() {
  if (!cropper) {
    setNotice("请先导入图片后再调整裁剪框。", "warning");
    return;
  }

  const data = cropper.getData(true);
  const imageData = cropper.getImageData();
  const newX = (imageData.naturalWidth - data.width) / 2;
  const newY = (imageData.naturalHeight - data.height) / 2;
  cropper.setData({ x: newX, y: newY, width: data.width, height: data.height });
}

function cropBoxMax() {
  if (!cropper) {
    setNotice("请先导入图片后再调整裁剪框。", "warning");
    return;
  }

  cropper.reset();
  cropper.setAspectRatio(1);
  const containerData = cropper.getContainerData();
  const size = Math.max(220, Math.min(containerData.width, containerData.height) - 40);
  cropper.setCropBoxData({ width: size, height: size });
  cropBoxCenter();
}

function zoomIn() {
  if (!cropper) {
    setNotice("请先导入图片后再缩放画面。", "warning");
    return;
  }
  cropper.zoom(0.08);
}

function zoomOut() {
  if (!cropper) {
    setNotice("请先导入图片后再缩放画面。", "warning");
    return;
  }
  cropper.zoom(-0.08);
}

function viewReset() {
  if (!cropper) {
    setNotice("请先导入图片后再重置视图。", "warning");
    return;
  }
  cropper.reset();
}

function loadFile(file) {
  clearExportPreview();
  setMessageBox("uploadMsg");
  setMessageBox("aiMsg");

  originalFilenameBase = filenameToName(file.name) || "icon";

  if (currentImageURL) {
    URL.revokeObjectURL(currentImageURL);
  }
  currentImageURL = URL.createObjectURL(file);
  currentStage = "crop";

  const cropImg = el("cropImage");
  if (!cropImg) return;

  cropImg.onload = () => {
    initCropper(cropImg);
    showOnly("crop");
  };
  cropImg.src = currentImageURL;

  setFileState("已载入", file.name);
  setNotice("图片已导入，现在可以直接裁剪或执行 AI 抠图。", "success");
}

function getCropCanvas512() {
  if (!cropper) return null;
  return cropper.getCroppedCanvas({
    width: 512,
    height: 512,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  });
}

function squareCanvasToCircleBlob(squareCanvas) {
  return new Promise((resolve) => {
    const size = squareCanvas.width;
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;

    const ctx = out.getContext("2d");
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(squareCanvas, 0, 0);
    ctx.restore();

    out.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function getSquareBlobFromCurrentStage() {
  const canvas = getCropCanvas512();
  if (!canvas) return null;
  return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

async function getCircleBlobFromCurrentStage() {
  const squareBlob = await getSquareBlobFromCurrentStage();
  if (!squareBlob) return null;

  const img = new Image();
  const url = URL.createObjectURL(squareBlob);

  return await new Promise((resolve) => {
    img.onload = async () => {
      const size = 512;
      const square = document.createElement("canvas");
      square.width = size;
      square.height = size;
      const ctx = square.getContext("2d");
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);

      const circleBlob = await squareCanvasToCircleBlob(square);
      URL.revokeObjectURL(url);
      resolve(circleBlob);
    };
    img.src = url;
  });
}

async function exportSquare() {
  const blob = await getSquareBlobFromCurrentStage();
  if (!blob) {
    setNotice("请先导入图片并完成裁剪后再导出。", "warning");
    return;
  }

  setExportPreview(blob, "方形 PNG");
  setNotice("方形预览已生成，可以直接保存或上传到方形分类。", "success");
}

async function exportCircle() {
  const blob = await getCircleBlobFromCurrentStage();
  if (!blob) {
    setNotice("请先导入图片并完成裁剪后再导出。", "warning");
    return;
  }

  setExportPreview(blob, "圆形 PNG");
  setNotice("圆形预览已生成，可以直接保存或上传到圆形分类。", "success");
}

function getUploadName() {
  const manual = (el("uploadName")?.value || "").trim();
  return manual || originalFilenameBase || "icon";
}

async function uploadBlobToLibrary(blob, nameBase, suffix, category) {
  setMessageBox("uploadMsg", "正在上传到图标库...", "info");

  const filename = `${nameBase}${suffix}.png`;
  const file = new File([blob], filename, { type: "image/png" });

  const fd = new FormData();
  fd.append("source", file);
  fd.append("name", nameBase);
  if (category) fd.append("category", category);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      setMessageBox(
        "uploadMsg",
        `上传成功：<b>${data.name}</b>${data.url ? `，<a href="${data.url}" target="_blank">打开文件</a>` : ""}`,
        "success",
        true,
      );
      setNotice("图片已经上传到图标库。", "success");
      return;
    }

    setMessageBox("uploadMsg", `上传失败：${data.error || `HTTP ${res.status}`}`, "warning");
  } catch (error) {
    setMessageBox("uploadMsg", `上传失败：${error.message}`, "warning");
  }
}

async function uploadSquareToLibrary() {
  const blob = await getSquareBlobFromCurrentStage();
  if (!blob) {
    setNotice("请先导入图片并完成裁剪后再上传。", "warning");
    return;
  }

  await uploadBlobToLibrary(blob, getUploadName(), "", "square");
}

async function uploadCircleToLibrary() {
  const blob = await getCircleBlobFromCurrentStage();
  if (!blob) {
    setNotice("请先导入图片并完成裁剪后再上传。", "warning");
    return;
  }

  await uploadBlobToLibrary(blob, getUploadName(), "_circle", "circle");
}

async function uploadTransparentToLibrary() {
  const blob = await getSquareBlobFromCurrentStage();
  if (!blob) {
    setNotice("请先导入图片并完成裁剪后再上传。", "warning");
    return;
  }

  await uploadBlobToLibrary(blob, getUploadName(), "_transparent", "transparent");
}

async function aiCutout(endpoint) {
  const squareBlob = await getSquareBlobFromCurrentStage();
  if (!squareBlob) {
    setNotice("请先导入图片并完成裁剪后再执行 AI 抠图。", "warning");
    return;
  }

  setMessageBox("aiMsg", "AI 抠图处理中...", "info");

  const fd = new FormData();
  fd.append("image", new File([squareBlob], "icon.png", { type: "image/png" }));

  try {
    const res = await fetch(endpoint, { method: "POST", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessageBox("aiMsg", `AI 抠图失败：${data.error || `HTTP ${res.status}`}`, "warning");
      return;
    }

    const outBlob = await res.blob();
    const outURL = URL.createObjectURL(outBlob);

    if (currentImageURL) {
      URL.revokeObjectURL(currentImageURL);
    }
    currentImageURL = outURL;
    currentStage = "ai";
    clearExportPreview();
    setMessageBox("uploadMsg");

    const cropImg = el("cropImage");
    if (!cropImg) return;

    cropImg.onload = () => {
      initCropper(cropImg);
      showOnly("crop");
    };
    cropImg.src = currentImageURL;

    setFileState("AI 结果", `${originalFilenameBase}.png`);
    setMessageBox("aiMsg", "AI 抠图完成，结果已载入裁剪画布。", "success");
    setNotice("AI 抠图完成，现在可以继续微调并上传透明图。", "success");
  } catch (error) {
    setMessageBox("aiMsg", `AI 抠图失败：${error.message}`, "warning");
  }
}

function resetAll() {
  clearExportPreview();
  setNotice();
  setMessageBox("uploadMsg");
  setMessageBox("aiMsg");

  destroyCropper();

  if (currentImageURL) {
    URL.revokeObjectURL(currentImageURL);
    currentImageURL = null;
  }

  const cropImg = el("cropImage");
  if (cropImg) cropImg.src = "";
  const uploadName = el("uploadName");
  if (uploadName) uploadName.value = "";
  const fileInput = el("fileInput");
  if (fileInput) fileInput.value = "";

  originalFilenameBase = "icon";
  currentStage = "empty";
  setFileState("未导入", "建议使用主体清晰、边缘完整的原图");
  showOnly("empty");
}

window.addEventListener("DOMContentLoaded", () => {
  showOnly("empty");
  setFileState("未导入", "建议使用主体清晰、边缘完整的原图");
  setPreviewState("未导出", "PNG");

  el("fileInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadFile(file);
  });

  el("btnCropCenter")?.addEventListener("click", cropBoxCenter);
  el("btnCropMax")?.addEventListener("click", cropBoxMax);
  el("btnZoomIn")?.addEventListener("click", zoomIn);
  el("btnZoomOut")?.addEventListener("click", zoomOut);
  el("btnViewReset")?.addEventListener("click", viewReset);

  el("btnExportSquare")?.addEventListener("click", exportSquare);
  el("btnExportCircle")?.addEventListener("click", exportCircle);

  el("btnUploadSquare")?.addEventListener("click", uploadSquareToLibrary);
  el("btnUploadCircle")?.addEventListener("click", uploadCircleToLibrary);
  el("btnUploadTransparent")?.addEventListener("click", uploadTransparentToLibrary);

  el("btnAICutoutDefault")?.addEventListener("click", () => aiCutout("/api/ai_cutout"));
  el("btnReset")?.addEventListener("click", resetAll);
});
