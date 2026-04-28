function filenameToName(filename) {
  return filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
}

function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function setStatus(message = "", tone = "info") {
  const messageDiv = document.getElementById("message");
  if (!messageDiv) return;
  messageDiv.textContent = message;
  messageDiv.dataset.tone = message ? tone : "";
}

function hidePreview() {
  const previewBox = document.getElementById("batchPreview");
  const previewList = document.getElementById("previewList");
  if (!previewBox || !previewList) return;
  previewList.innerHTML = "";
  previewBox.style.display = "none";
}

function hideProgress() {
  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const progressFile = document.getElementById("progressFile");
  if (progressWrap) progressWrap.style.display = "none";
  if (progressFill) progressFill.style.width = "0%";
  if (progressText) progressText.textContent = "0/0";
  if (progressFile) progressFile.textContent = "";
}

function shouldUseMobileLayout() {
  const ua = navigator.userAgent || navigator.vendor || "";
  const mobileUa = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const touchNarrowScreen = window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
  return mobileUa || touchNarrowScreen;
}

function syncDeviceLayout() {
  document.body.classList.toggle("mobile-layout", shouldUseMobileLayout());
}

let currentCategory = "";
let isUploading = false;

function setCategory(category) {
  const buttons = Array.from(document.querySelectorAll(".folder-btn"));
  const fallbackCategory = buttons[0]?.dataset.category || "circle";
  currentCategory = category || fallbackCategory;

  let active = buttons.find((button) => button.dataset.category === currentCategory) || null;
  if (!active) {
    currentCategory = fallbackCategory;
    active = buttons[0] || null;
  }

  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.category === currentCategory);
  });

  const current = document.getElementById("folderCurrent");
  if (current && active) {
    current.textContent = `当前分类：${active.dataset.label || currentCategory}`;
  }
}

function createFormData(files, name) {
  const formData = new FormData();
  files.forEach((file) => formData.append("source", file));
  if (name) formData.append("name", name);
  formData.append("category", currentCategory);
  return formData;
}

function setUploadBusy(busy) {
  isUploading = busy;

  const nameInput = document.getElementById("name");
  const imageInput = document.getElementById("image");
  if (nameInput) nameInput.disabled = busy;
  if (imageInput) imageInput.disabled = busy;

  document.querySelectorAll("button[data-upload-action]").forEach((button) => {
    button.disabled = busy;
  });
}

async function uploadSingle() {
  const nameInput = document.getElementById("name");
  const imageInput = document.getElementById("image");
  const resultList = document.getElementById("resultList");

  if (!imageInput || isUploading) return;
  if (resultList) resultList.innerHTML = "";

  const file = imageInput.files[0];
  if (!file) {
    setStatus("请选择一张图片。", "warning");
    return;
  }

  const manualName = (nameInput?.value || "").trim();
  const formData = createFormData([file], manualName);

  setUploadBusy(true);
  setStatus("正在上传...", "info");

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success) {
      setStatus(`上传成功：${data.name}`, "success");
      if (resultList) {
        resultList.innerHTML = `<li>✅ <b>${data.name}</b> → <a href="${data.url}" target="_blank">${data.url}</a></li>`;
      }
      if (nameInput) nameInput.value = "";
      imageInput.value = "";
      hidePreview();
      hideProgress();
    } else {
      setStatus(`错误：${data.error || `HTTP ${response.status}`}`, "warning");
    }
  } catch (error) {
    setStatus(`上传失败：${error.message}`, "warning");
  } finally {
    setUploadBusy(false);
  }
}

async function uploadBatch() {
  const imageInput = document.getElementById("image");
  const resultList = document.getElementById("resultList");
  const progressWrap = document.getElementById("progressWrap");
  const progressText = document.getElementById("progressText");
  const progressFile = document.getElementById("progressFile");
  const progressFill = document.getElementById("progressFill");

  if (!imageInput || isUploading) return;
  if (resultList) resultList.innerHTML = "";

  const files = Array.from(imageInput.files || []);
  if (!files.length) {
    setStatus("请选择图片（可多选）。", "warning");
    return;
  }
  if (files.length === 1) {
    setStatus("如果只上传一张图，建议直接使用“上传单张”。", "warning");
    return;
  }

  function addResult(ok, name, info) {
    if (!resultList) return;
    const li = document.createElement("li");
    li.innerHTML = ok
      ? `✅ <b>${name}</b> ${info ? `→ <a href="${info}" target="_blank">${info}</a>` : ""}`
      : `❌ <b>${name}</b> → ${info || "失败"}`;
    resultList.appendChild(li);
  }

  if (progressWrap) progressWrap.style.display = "block";
  if (progressFill) progressFill.style.width = "0%";
  if (progressText) progressText.textContent = `0/${files.length}`;
  if (progressFile) progressFile.textContent = "";
  setUploadBusy(true);

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = filenameToName(file.name);

      if (progressFile) progressFile.textContent = file.name;
      if (progressText) progressText.textContent = `${index}/${files.length}`;
      if (progressFill) progressFill.style.width = `${Math.round((index / files.length) * 100)}%`;

      setStatus(`批量上传中 ${index + 1}/${files.length}: ${file.name}`, "info");

      const formData = createFormData([file], name);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        addResult(true, data.name || name, data.url || "");
      } else {
        addResult(false, name, data.error || `HTTP ${response.status}`);
      }

      const done = index + 1;
      if (progressText) progressText.textContent = `${done}/${files.length}`;
      if (progressFill) progressFill.style.width = `${Math.round((done / files.length) * 100)}%`;
    }

    setStatus(`批量上传完成：${files.length}/${files.length}`, "success");
    imageInput.value = "";
    setTimeout(() => hideProgress(), 1000);
    hidePreview();
  } catch (error) {
    setStatus(`批量上传失败：${error.message}`, "warning");
    hideProgress();
  } finally {
    setUploadBusy(false);
  }
}

(function setupBatchPreview() {
  const imageInput = document.getElementById("image");
  const previewBox = document.getElementById("batchPreview");
  const previewList = document.getElementById("previewList");

  if (!imageInput || !previewBox || !previewList) return;

  imageInput.addEventListener("change", () => {
    const files = Array.from(imageInput.files || []);
    previewList.innerHTML = "";

    if (files.length <= 1) {
      previewBox.style.display = "none";
      return;
    }

    previewBox.style.display = "block";
    files.forEach((file) => {
      const name = filenameToName(file.name);
      const li = document.createElement("li");
      li.innerHTML = `
        <span><b>${name}</b></span>
        <span class="meta">${prettySize(file.size)}</span>
      `;
      previewList.appendChild(li);
    });
  });
})();

(function applyBackground() {
  const bgApi = (document.body.dataset.bgApi || "").trim();
  const backgrounds = [
    "radial-gradient(900px 600px at 12% 18%, rgba(255,107,214,.25), transparent 60%)",
    "radial-gradient(800px 520px at 85% 20%, rgba(57,213,255,.20), transparent 55%)",
    "radial-gradient(900px 650px at 55% 92%, rgba(124,107,255,.18), transparent 60%)",
    "linear-gradient(135deg, #ffe9f6, #e9f1ff, #eafff7)",
  ];

  if (bgApi) {
    const join = bgApi.includes("?") ? "&" : "?";
    backgrounds.unshift(`url(${bgApi}${join}t=${Date.now()})`);
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundRepeat = "no-repeat";
    document.body.style.backgroundAttachment = shouldUseMobileLayout() ? "scroll" : "fixed";
  }

  document.body.style.backgroundImage = backgrounds.join(",");
}
)();

window.addEventListener("DOMContentLoaded", () => {
  syncDeviceLayout();
  document.querySelectorAll(".folder-btn").forEach((button) => {
    button.addEventListener("click", () => setCategory(button.dataset.category));
  });
  setCategory(document.querySelector(".folder-btn")?.dataset.category || "circle");
});

window.addEventListener("resize", syncDeviceLayout);
window.addEventListener("orientationchange", syncDeviceLayout);
