function filenameToName(filename) {
  return filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
}

function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
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

let currentCategory = "";

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

async function uploadSingle() {
  const nameInput = document.getElementById("name");
  const imageInput = document.getElementById("image");
  const messageDiv = document.getElementById("message");
  const resultList = document.getElementById("resultList");

  if (!imageInput || !messageDiv) return;
  if (resultList) resultList.innerHTML = "";

  const file = imageInput.files[0];
  if (!file) {
    messageDiv.textContent = "请选择一张图片。";
    return;
  }

  const manualName = (nameInput?.value || "").trim();
  const formData = createFormData([file], manualName);

  messageDiv.textContent = "正在上传...";
  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success) {
      messageDiv.textContent = `上传成功：${data.name}`;
      if (resultList) {
        resultList.innerHTML = `<li>✅ <b>${data.name}</b> → <a href="${data.url}" target="_blank">${data.url}</a></li>`;
      }
      if (nameInput) nameInput.value = "";
      imageInput.value = "";
      hidePreview();
      hideProgress();
    } else {
      messageDiv.textContent = `错误：${data.error || `HTTP ${response.status}`}`;
    }
  } catch (error) {
    messageDiv.textContent = `上传失败：${error.message}`;
  }
}

async function uploadBatch() {
  const imageInput = document.getElementById("image");
  const messageDiv = document.getElementById("message");
  const resultList = document.getElementById("resultList");
  const progressWrap = document.getElementById("progressWrap");
  const progressText = document.getElementById("progressText");
  const progressFile = document.getElementById("progressFile");
  const progressFill = document.getElementById("progressFill");

  if (!imageInput || !messageDiv) return;
  if (resultList) resultList.innerHTML = "";

  const files = Array.from(imageInput.files || []);
  if (!files.length) {
    messageDiv.textContent = "请选择图片（可多选）。";
    return;
  }
  if (files.length === 1) {
    messageDiv.textContent = "如果只上传一张图，建议直接使用“上传单张”。";
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

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = filenameToName(file.name);

      if (progressFile) progressFile.textContent = file.name;
      if (progressText) progressText.textContent = `${index}/${files.length}`;
      if (progressFill) progressFill.style.width = `${Math.round((index / files.length) * 100)}%`;

      messageDiv.textContent = `批量上传中 ${index + 1}/${files.length}: ${file.name}`;

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

    messageDiv.textContent = `批量上传完成：${files.length}/${files.length}`;
    imageInput.value = "";
    setTimeout(() => hideProgress(), 1000);
    hidePreview();
  } catch (error) {
    messageDiv.textContent = `批量上传失败：${error.message}`;
    hideProgress();
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
    document.body.style.backgroundAttachment = "fixed";
  }

  document.body.style.backgroundImage = backgrounds.join(",");
})();

window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".folder-btn").forEach((button) => {
    button.addEventListener("click", () => setCategory(button.dataset.category));
  });
  setCategory(document.querySelector(".folder-btn")?.dataset.category || "circle");
});
