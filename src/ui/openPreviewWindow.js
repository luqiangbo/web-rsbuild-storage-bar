export function openPreviewWindow(preview) {
  const token = crypto.randomUUID();
  const origin = location.origin;
  let win;
  const receive = (event) => {
    if (event.origin !== origin || event.source !== win || event.data?.type !== "storagebar-preview-ready" ||
        event.data.token !== token) return;
    win.postMessage({ type: "storagebar-preview-content", token, preview }, origin);
    dispose(false);
  };
  const dispose = (close) => {
    window.removeEventListener("message", receive);
    clearTimeout(timeout);
    if (close) win?.close();
  };
  const timeout = setTimeout(() => dispose(false), 15_000);
  window.addEventListener("message", receive);
  win = window.open(`${chrome.runtime.getURL("preview.html")}#${token}`, "_blank", "popup,width=960,height=640");
  if (!win) {
    dispose(false);
    throw new Error("浏览器拦截了独立窗口，仍可在侧栏中查看。");
  }
  return () => dispose(true);
}
