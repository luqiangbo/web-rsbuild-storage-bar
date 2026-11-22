import { dataFont } from "./data-fonts.js";

const title = document.getElementById("title");
const status = document.getElementById("status");
const media = {
  video: document.getElementById("video"),
  audio: document.getElementById("audio"),
  image: document.getElementById("image"),
};
const text = document.getElementById("text");
const token = location.hash.slice(1);
let url;
let received = false;
let contentName = "";
let statusKind = "waiting";
const colorQuery = matchMedia("(prefers-color-scheme: dark)");
const strings = {
  zh: { title: "预览", video: "本地视频", audio: "本地音频", image: "本地图片", waiting: "正在等待内容…",
    timeout: "未收到内容，请从侧栏重新打开此窗口。", error: "Chrome 无法解码此文件，或文件不完整。" },
  en: { title: "Preview", video: "Local video", audio: "Local audio", image: "Local image", waiting: "Waiting for content…",
    timeout: "No content received. Reopen this preview from StorageBar.", error: "Chrome could not decode this file, or the file is incomplete." },
};
function renderPreferences() {
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem("storagebar.preferences") || "{}") ?? {}; } catch { /* invalid saved value */ }
  const language = settings.language === "zh" || settings.language === "en" ? settings.language
    : chrome.i18n.getUILanguage().toLowerCase().startsWith("zh") ? "zh" : "en";
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.documentElement.style.colorScheme = settings.theme === "dark" || settings.theme === "light"
    ? settings.theme : colorQuery.matches ? "dark" : "light";
  document.documentElement.style.setProperty("--mono", dataFont(settings.font));
  document.title = `StorageBar · ${strings[language].title}`;
  title.textContent = contentName || strings[language].title;
  media.video.setAttribute("aria-label", contentName || strings[language].video);
  media.audio.setAttribute("aria-label", contentName || strings[language].audio);
  media.image.alt = contentName || strings[language].image;
  status.textContent = strings[language][statusKind];
}
renderPreferences();
window.addEventListener("storage", renderPreferences);
colorQuery.addEventListener("change", renderPreferences);
const receive = (event) => {
  if (event.origin !== location.origin || event.source !== window.opener ||
      event.data?.type !== "storagebar-preview-content" || event.data.token !== token) return;
  const { preview } = event.data;
  if (!(preview?.blob instanceof Blob) && typeof preview?.text !== "string") return;
  window.removeEventListener("message", receive);
  received = true;
  contentName = preview.name || "";
  renderPreferences();
  if (preview.blob instanceof Blob) {
    const category = preview.blob.type.split("/")[0];
    if (!Object.hasOwn(media, category)) {
      statusKind = "error";
      renderPreferences();
      return;
    }
    const viewer = media[category];
    url = URL.createObjectURL(preview.blob);
    viewer.src = url;
    viewer.hidden = false;
  } else {
    text.textContent = preview.text;
    text.hidden = false;
  }
  status.hidden = true;
};

window.addEventListener("message", receive);
window.opener?.postMessage({ type: "storagebar-preview-ready", token }, location.origin);
setTimeout(() => {
  if (!received) { statusKind = "timeout"; renderPreferences(); }
}, 15_000);
for (const viewer of Object.values(media)) {
  viewer.addEventListener("error", () => {
    status.hidden = false;
    statusKind = "error";
    renderPreferences();
  });
}
window.addEventListener("pagehide", () => {
  if (url) URL.revokeObjectURL(url);
});
