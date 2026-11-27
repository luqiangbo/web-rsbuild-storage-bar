import React, { useEffect, useRef, useState } from "react";
import { IconImage, IconVideo } from "./Icons.jsx";
import { runInPage } from "../api/page.js";
import { autoPreviewLimit, readMediaBlob } from "./mediaTransfer.js";

export function createThumbnailQueue() {
  const pending = new Set();
  let running = 0;
  function process() {
    while (running < 2 && pending.size) {
      const task = pending.values().next().value;
      pending.delete(task);
      running++;
      void task().finally(() => { running--; process(); });
    }
  }
  return (task) => {
    pending.add(task);
    process();
    return () => pending.delete(task);
  };
}

async function videoFrame(target, source, signal) {
  const blob = await readMediaBlob(target, source, { signal, limit: autoPreviewLimit });
  if (!blob?.type.startsWith("video/")) return null;
  signal.throwIfAborted();
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    function finish(frame = null) {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(frame);
    }
    const abort = () => finish();
    const timeout = setTimeout(abort, 4500);
    signal.addEventListener("abort", abort, { once: true });
    video.muted = true;
    video.preload = "auto";
    video.onerror = abort;
    video.onloadeddata = () => {
      try {
        const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/webp", 0.82));
      } catch {
        finish();
      }
    };
    video.src = url;
  });
}

export default function MediaThumbnail({ target, source, enqueue, paused, className = "media-file-icon" }) {
  const [thumbnail, setThumbnail] = useState(null);
  const element = useRef(null);
  const video = source.type.toLowerCase().startsWith("video/");
  const Icon = video ? IconVideo : IconImage;
  useEffect(() => {
    if (paused || thumbnail !== null) return;
    const controller = new AbortController();
    let cancel;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        cancel?.();
        cancel = null;
        return;
      }
      if (cancel) return;
      cancel = enqueue(async () => {
        observer.disconnect();
        try {
          const image = video ? await videoFrame(target, source, controller.signal)
            : await runInPage(target, "opfsThumbnail", source);
          if (!controller.signal.aborted) setThumbnail(image ?? "");
        } catch {
          if (!controller.signal.aborted) setThumbnail("");
        }
      });
    });
    observer.observe(element.current);
    return () => { controller.abort(); observer.disconnect(); cancel?.(); };
  }, [target, source, enqueue, paused, thumbnail, video]);
  return <span ref={element} className={className} data-loaded={thumbnail ? "true" : undefined} aria-hidden="true">
    {thumbnail ? <img src={thumbnail} alt="" onError={() => setThumbnail("")} /> : <Icon />}
  </span>;
}
