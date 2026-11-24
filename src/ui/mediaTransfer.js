import { runInPage } from "../api/page.js";

export const mediaLimit = 50 * 1024 * 1024;
export const autoPreviewLimit = 8 * 1024 * 1024;

export async function readMediaBlob(target, source, { signal, limit, onProgress }) {
  signal.throwIfAborted();
  const ticket = crypto.randomUUID();
  const close = () => { void runInPage(target, "mediaClose", { ticket }).catch(() => {}); };
  signal.addEventListener("abort", close, { once: true });
  try {
    const { type, total } = await runInPage(target, "mediaStart", { ...source, ticket });
    signal.throwIfAborted();
    if (total > limit) return null;
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { data, done } = await runInPage(target, "mediaChunk", { ticket });
      signal.throwIfAborted();
      if (data) {
        const chunk = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
        bytes += chunk.byteLength;
        if (bytes > limit) {
          if (limit === mediaLimit) throw new Error("文件超过 50 MiB，已停止读取");
          return null;
        }
        chunks.push(chunk);
        onProgress?.(bytes, total);
      }
      if (done) {
        if (!bytes) throw new Error("文件为空，无法预览");
        return new Blob(chunks, { type });
      }
    }
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}
