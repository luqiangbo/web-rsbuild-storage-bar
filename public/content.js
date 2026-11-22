if (!window.__storageBarBridgeInstalled) {
  window.__storageBarBridgeInstalled = true;
  window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== "STORAGEBAR_PAGE_STORAGE_CHANGED") return;
  chrome.runtime.sendMessage({ type: event.data.type }).catch(() => {});
  });
}
