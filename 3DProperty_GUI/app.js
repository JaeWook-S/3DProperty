const landing = document.querySelector("#landing");
const workspace = document.querySelector("#workspace");
const enterButton = document.querySelector("#enter-app");
const homeButton = document.querySelector("#home-button");
const navButtons = [...document.querySelectorAll("[data-page]")];
const pages = [...document.querySelectorAll("[data-page-panel]")];
const mobileMenuButton = document.querySelector("#mobile-menu");
const primaryNav = document.querySelector(".primary-nav");
const toast = document.querySelector("#toast");

let toastTimer;

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function closeMobileMenu() {
  primaryNav.classList.remove("is-open");
  mobileMenuButton.setAttribute("aria-expanded", "false");
  mobileMenuButton.setAttribute("aria-label", "메뉴 열기");
}

function openWorkspace() {
  landing.hidden = true;
  workspace.hidden = false;
  document.body.classList.add("has-entered");
  showPage("a", false);
}

function showPage(pageName, updateHistory = true) {
  const nextPage = pages.find((page) => page.dataset.pagePanel === pageName);
  if (!nextPage) return;

  pages.forEach((page) => {
    const isCurrent = page === nextPage;
    page.hidden = !isCurrent;
    page.classList.toggle("is-active", isCurrent);
  });

  navButtons.forEach((button) => {
    const isCurrent = button.dataset.page === pageName;
    button.classList.toggle("is-active", isCurrent);
    if (isCurrent) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (updateHistory) {
    history.pushState({ page: pageName }, "", `#page-${pageName}`);
  }

  closeMobileMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

enterButton.addEventListener("click", () => {
  openWorkspace();
  history.pushState({ page: "a" }, "", "#page-a");
});

homeButton.addEventListener("click", () => showPage("a"));
navButtons.forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));

mobileMenuButton.addEventListener("click", () => {
  const willOpen = !primaryNav.classList.contains("is-open");
  primaryNav.classList.toggle("is-open", willOpen);
  mobileMenuButton.setAttribute("aria-expanded", String(willOpen));
  mobileMenuButton.setAttribute("aria-label", willOpen ? "메뉴 닫기" : "메뉴 열기");
});

window.addEventListener("popstate", () => {
  const match = window.location.hash.match(/^#page-([a-d])$/);
  if (match) {
    if (workspace.hidden) openWorkspace();
    showPage(match[1], false);
    return;
  }

  landing.hidden = false;
  workspace.hidden = true;
  document.body.classList.remove("has-entered");
});

function setupFileInput(inputId, feedbackId, options = {}) {
  const input = document.querySelector(`#${inputId}`);
  const feedback = document.querySelector(`#${feedbackId}`);
  if (!input || !feedback) return;

  input.addEventListener("change", () => {
    const files = [...input.files];
    if (!files.length) return;

    feedback.textContent = options.multiple && files.length > 1
      ? `${files[0].name} 외 ${files.length - 1}개`
      : files[0].name;
    showToast(options.message ?? "파일이 선택되었습니다.");
  });
}

setupFileInput("floorplan-input", "floorplan-feedback", {
  message: "도면이 선택되었습니다. 현재는 웹 UI 확인용입니다.",
});
setupFileInput("room-input", "room-feedback", {
  multiple: true,
  message: "공간 이미지가 선택되었습니다.",
});

document.querySelectorAll("[data-dropzone]").forEach((zone) => {
  const input = zone.querySelector("input[type='file']");
  if (!input) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    });
  });

  zone.addEventListener("drop", (event) => {
    if (!event.dataTransfer.files.length) return;
    input.files = event.dataTransfer.files;
    input.dispatchEvent(new Event("change"));
  });
});

const assetGrid = document.querySelector("#asset-grid");
const assetCount = document.querySelector("#asset-count");
const furnitureInput = document.querySelector("#furniture-input");
const urlForm = document.querySelector("#url-form");
const furnitureUrl = document.querySelector("#furniture-url");
const resetAssetsButton = document.querySelector("#reset-assets");
const uploadedObjectUrls = new Set();
let addedAssets = 0;

function updateAssetCount() {
  const count = assetGrid.querySelectorAll(".asset-card").length;
  assetCount.textContent = String(count).padStart(2, "0");
}

function createAssetCard({ title, imageUrl, sourceLabel = "UPLOADED", linkUrl }) {
  const article = document.createElement("article");
  article.className = "asset-card asset-card--added";

  const thumb = document.createElement("div");
  thumb.className = imageUrl ? "asset-thumb" : "asset-thumb asset-thumb--link";

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${title} 썸네일`;
    thumb.append(image);
  } else {
    thumb.textContent = "LINK";
  }

  const meta = document.createElement("div");
  meta.className = "asset-meta";
  const text = document.createElement("div");
  const small = document.createElement("small");
  small.textContent = sourceLabel;
  const heading = document.createElement("h4");
  heading.textContent = title;
  text.append(small, heading);

  const action = document.createElement(linkUrl ? "a" : "span");
  action.textContent = "↗";
  if (linkUrl) {
    action.href = linkUrl;
    action.target = "_blank";
    action.rel = "noreferrer";
    action.setAttribute("aria-label", `${title} 링크 열기`);
  }

  meta.append(text, action);
  article.append(thumb, meta);
  assetGrid.prepend(article);
  addedAssets += 1;
  updateAssetCount();
}

furnitureInput.addEventListener("change", () => {
  const files = [...furnitureInput.files];
  files.forEach((file) => {
    const objectUrl = URL.createObjectURL(file);
    uploadedObjectUrls.add(objectUrl);
    createAssetCard({ title: file.name, imageUrl: objectUrl });
  });
  if (files.length) showToast(`가구 이미지 ${files.length}개를 선반에 추가했습니다.`);
  furnitureInput.value = "";
});

urlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!furnitureUrl.reportValidity()) return;

  const url = new URL(furnitureUrl.value);
  createAssetCard({
    title: url.hostname.replace(/^www\./, ""),
    sourceLabel: "PRODUCT LINK",
    linkUrl: url.href,
  });
  furnitureUrl.value = "";
  showToast("제품 링크를 가구 선반에 추가했습니다.");
});

resetAssetsButton.addEventListener("click", () => {
  assetGrid.querySelectorAll(".asset-card--added").forEach((card) => card.remove());
  uploadedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  uploadedObjectUrls.clear();
  addedAssets = 0;
  updateAssetCount();
  showToast("추가한 항목을 초기화했습니다.");
});

const modelInput = document.querySelector("#model-input");
const modelFeedback = document.querySelector("#model-feedback");
const viewerDemoButton = document.querySelector("#viewer-demo-button");

modelInput.addEventListener("change", () => {
  const [file] = modelInput.files;
  if (!file) return;
  modelFeedback.textContent = `${file.name}이 선택되었습니다. Three.js 연결 후 이 영역에서 로드됩니다.`;
  showToast("3D 파일 선택을 확인했습니다. 아직 렌더링하지는 않습니다.");
});

viewerDemoButton.addEventListener("click", () => {
  showToast("3D 뷰어 연결 슬롯이 정상적으로 준비되어 있습니다.");
});

const initialPage = window.location.hash.match(/^#page-([a-d])$/);
if (initialPage) {
  openWorkspace();
  showPage(initialPage[1], false);
}
