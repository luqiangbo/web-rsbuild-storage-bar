import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AppstoreOutlined, ArrowLeftOutlined, AudioOutlined, CloseOutlined, CopyOutlined, DownloadOutlined,
  FileOutlined, FileTextOutlined, FolderOutlined, LeftOutlined, PictureOutlined, PlayCircleOutlined,
  RightOutlined, SearchOutlined, UnorderedListOutlined, VideoCameraOutlined, ZoomInOutlined, ZoomOutOutlined,
} from "@ant-design/icons";
import { Alert, Breadcrumb, Button, Input, Progress, Segmented, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { runInPage } from "../api/page.js";
import IconAction from "./IconAction.jsx";
import JsonViewer from "./JsonViewer.jsx";
import { jsonError } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";
import { useRead } from "./useRecords.js";
import useFeedback from "./useFeedback.jsx";
import WideModal from "./WideModal.jsx";
import MediaDirectory, { isMediaContainer, mediaPathKey, mediaRoots, readMediaFolders } from "./MediaDirectory.jsx";
import MediaThumbnail, { createThumbnailQueue } from "./MediaThumbnail.jsx";
import { autoPreviewLimit, mediaLimit, readMediaBlob } from "./mediaTransfer.js";

const textPreviewLimit = 2 * 1024 * 1024;
const minZoom = 0.25;
const maxZoom = 5;
const clampZoom = (value) => Math.min(maxZoom, Math.max(minZoom, Math.round(value * 100) / 100));
const errorText = (error) => error?.message || String(error);
const sizeText = (bytes, t) => {
  if (bytes == null) return t("大小未知");
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
};
const mediaLabels = { audio: "音频", image: "图片", video: "视频", text: "文本" };
const mediaTagColors = { audio: "purple", image: "cyan", video: "blue", text: "green" };
const mediaIcons = { audio: AudioOutlined, image: PictureOutlined, video: VideoCameraOutlined, text: FileTextOutlined };
const mediaType = (mime) => {
  const lower = mime?.split(";")[0].trim().toLowerCase() ?? "";
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("audio/")) return "audio";
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("text/") || /^application\/((?:[\w.+-]+\+)?(?:json|xml)|(?:x-)?javascript|(?:x-)?yaml)$/.test(lower)) {
    return "text";
  }
  return "";
};
const rowKey = (row) => row.id ?? JSON.stringify([row.name, row.key, row.path]);
const firstPage = { index: 0, cursors: [null] };
const canPreview = (row) => !row.directory && !!mediaType(row.type) && !row.error && row.size !== 0 && !(row.size > mediaLimit);
const canOpen = (row, kind) => canPreview(row) || (!row.directory && kind === "opfs" && !row.error && row.size > 0 && !(row.size > mediaLimit));
const enqueueThumbnail = createThumbnailQueue();

function fileSource(row, { kind, path }) {
  if (kind === "opfs") return { ...row, kind, path };
  if (kind === "idb") return { ...row, kind, dbName: path[0], storeName: path[1] };
  return { ...row, kind, cacheName: path[0] };
}

function safeFileName(name, mime) {
  const base = (name || "media").split(/[\\/]/).pop().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "media";
  if (/\.[a-z0-9]{1,6}$/i.test(base)) return base;
  const sub = mime?.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "");
  return sub ? `${base}.${sub === "jpeg" ? "jpg" : sub === "plain" ? "txt" : sub}` : base;
}

export function MediaPreview({ target, source, autoRead = false, onClose, onPrev, onNext, positionText, cache }) {
  const { t, language } = usePreferences();
  const notify = useFeedback();
  const sourceCategory = mediaType(source.type);
  const rawOnly = !sourceCategory && source.kind === "opfs";
  const shouldAutoRead = autoRead && !rawOnly && !(sourceCategory === "text" && source.size > textPreviewLimit);
  const sourceKey = JSON.stringify([target.documentId, source]);
  const unavailable = source.error || (source.size === 0 ? "文件为空，无法预览"
    : source.size > mediaLimit ? "文件超过 50 MiB 的预览上限" : "");
  const embedded = !onClose;

  const [state, setState] = useState(() => {
    const cached = cache?.get(sourceKey);
    if (cached) return { status: "ready", ...cached };
    return shouldAutoRead && !unavailable ? { status: "loading", bytes: 0 } : { status: "idle" };
  });
  const [switching, setSwitching] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef(null);
  const transfer = useRef(null);
  const ownedUrls = useRef(new Set());
  const stageRef = useRef(null);

  const revokeIfOwned = useCallback((url) => {
    if (!url || !ownedUrls.current.has(url)) return;
    ownedUrls.current.delete(url);
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => () => {
    transfer.current?.controller.abort();
    transfer.current = null;
    for (const url of ownedUrls.current) URL.revokeObjectURL(url);
    ownedUrls.current.clear();
  }, []);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    const cached = cache?.get(sourceKey);
    if (cached && !unavailable) {
      transfer.current?.controller.abort();
      transfer.current = null;
      setSwitching(false);
      setState({ status: "ready", ...cached });
      return;
    }
    if (shouldAutoRead && !unavailable) {
      void play(sourceCategory === "text" ? textPreviewLimit : autoPreviewLimit, { keepPrevious: true });
    } else {
      transfer.current?.controller.abort();
      transfer.current = null;
      setSwitching(false);
      setState({ status: "idle" });
    }
  }, [sourceKey, shouldAutoRead, unavailable, sourceCategory]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || state.status !== "ready" || mediaType(state.type || source.type) !== "image") return;
    const onWheel = (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      setZoom((current) => {
        const next = clampZoom(current * factor);
        if (next <= 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [state.status, state.type, source.type]);

  function abortCurrent() {
    if (!transfer.current) return;
    transfer.current.controller.abort();
    transfer.current = null;
  }

  function triggerDownload(url, mime) {
    const link = document.createElement("a");
    link.href = url;
    link.download = safeFileName(source.name, mime);
    document.body.appendChild(link);
    link.click();
    link.remove();
    notify(t("媒体文件已交给浏览器下载"));
  }

  async function play(limit = mediaLimit, { raw = false, save = false, keepPrevious = false } = {}) {
    abortCurrent();
    const job = { controller: new AbortController(), key: sourceKey };
    transfer.current = job;
    const preserveImage = keepPrevious && !raw && !save && sourceCategory === "image" &&
      state.status === "ready" && mediaType(state.type) === "image";
    if (preserveImage) {
      setSwitching(true);
    } else {
      setSwitching(false);
      setState({ status: "loading", bytes: 0, total: null });
    }
    try {
      const requestSource = raw ? { ...source, raw: true } : source;
      const blob = await readMediaBlob(target, requestSource, {
        signal: job.controller.signal, limit,
        onProgress: (bytes, total) => {
          if (!preserveImage && transfer.current === job) setState({ status: "loading", bytes, total });
        },
      });
      if (transfer.current !== job) return;
      if (!blob) {
        setSwitching(false);
        setState({ status: "idle" });
        return;
      }
      const url = URL.createObjectURL(blob);
      const nextCategory = mediaType(blob.type || source.type);
      if (save) {
        triggerDownload(url, blob.type || source.type);
        if (raw) {
          URL.revokeObjectURL(url);
          setSwitching(false);
          setState({ status: "idle" });
          return;
        }
      }
      let entry = { url, type: blob.type || source.type };
      if (nextCategory === "text") {
        const text = await blob.text();
        if (transfer.current !== job) { URL.revokeObjectURL(url); return; }
        entry = { ...entry, text };
      } else if (nextCategory === "image") {
        const probe = new Image();
        probe.src = url;
        await probe.decode().catch(() => {});
        if (transfer.current !== job) { URL.revokeObjectURL(url); return; }
      }
      if (cache && blob.size <= autoPreviewLimit) {
        cache.set(sourceKey, entry);
      } else {
        ownedUrls.current.add(url);
      }
      setSwitching(false);
      setState((previous) => {
        if (previous.url && previous.url !== url) revokeIfOwned(previous.url);
        return { status: "ready", ...entry };
      });
    } catch (error) {
      if (transfer.current === job) {
        setSwitching(false);
        setState({ status: "error", error: errorText(error) });
      }
    }
  }

  function download() {
    if (state.status === "ready" && state.url) {
      triggerDownload(state.url, state.type || source.type);
      return;
    }
    void play(mediaLimit, { raw: rawOnly, save: true });
  }

  async function copyText() {
    if (state.text === undefined) return;
    try {
      await navigator.clipboard.writeText(state.text);
      notify(t("已复制"));
    } catch {
      notify(t("复制失败"), "error");
    }
  }

  function stepZoom(delta) {
    setZoom((current) => {
      const next = clampZoom(current + delta);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function startDrag(event) {
    if (zoom <= 1 || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    dragOrigin.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
  }

  function moveDrag(event) {
    if (!dragging || !dragOrigin.current) return;
    setPan({ x: event.clientX - dragOrigin.current.x, y: event.clientY - dragOrigin.current.y });
  }

  function endDrag() {
    if (!dragging) return;
    setDragging(false);
    dragOrigin.current = null;
  }

  const category = mediaType(state.type || source.type);
  const Icon = mediaIcons[category] ?? FileOutlined;
  const label = source.name || t(mediaLabels[category] ?? "本地媒体");
  const decodeError = () => setState((current) => current.status === "ready" && current.url === state.url
    ? { ...current, playbackError: "Chrome 无法解码此文件，或文件不完整。" } : current);
  const Player = category === "audio" ? "audio" : "video";
  const isTextReady = state.status === "ready" && category === "text" && state.text !== undefined;
  const isImageReady = state.status === "ready" && category === "image" && !state.playbackError;
  const isJsonText = useMemo(() => isTextReady && !jsonError(state.text), [isTextReady, state.text]);
  const stageClass = [
    "media-stage",
    isImageReady && "media-stage-image",
    isImageReady && zoom > 1 && "is-zoomed",
    dragging && "is-dragging",
    state.status === "ready" && category === "audio" && "media-stage-audio",
    isTextReady && "media-stage-text",
  ].filter(Boolean).join(" ");

  return <div className={`media-preview${embedded ? " media-preview-embedded" : ""}`}>
    <div ref={stageRef} className={stageClass}
      onPointerDown={isImageReady ? startDrag : undefined}
      onPointerMove={isImageReady ? moveDrag : undefined}
      onPointerUp={isImageReady ? endDrag : undefined}
      onPointerCancel={isImageReady ? endDrag : undefined}
      onDoubleClick={isImageReady ? () => {
        if (zoom !== 1) resetZoom();
        else setZoom(2);
      } : undefined}>
      {unavailable ? <div className="media-stage-placeholder">
        <Icon className="media-stage-icon" />
        <Typography.Text type="secondary">{t(unavailable)}</Typography.Text>
      </div> : state.status === "loading" ? <div className="media-stage-placeholder">
        <Spin size="small" />
        {state.total ? <Progress className="media-stage-progress" percent={Math.min(99, Math.floor(state.bytes / state.total * 100))} size="small" />
          : <Typography.Text role="status" type="secondary">{state.bytes > 0
            ? t("已读取 {size}", { size: sizeText(state.bytes, t) }) : t("正在读取…")}</Typography.Text>}
        <Button size="small" onClick={() => { abortCurrent(); setState({ status: "idle" }); }}>{t("取消读取")}</Button>
      </div> : isTextReady ? <div className="media-text-stage">
        {isJsonText ? <JsonViewer text={state.text} />
          : <pre className="value-block media-text-content">{state.text === "" ? <Typography.Text type="secondary">{t("（空字符串）")}</Typography.Text> : state.text}</pre>}
      </div> : state.status === "ready" ? <>
        {category === "image" ? <img className={`media-stage-img${switching ? " is-switching" : ""}`}
          src={state.url} alt={label} draggable={false} onError={decodeError}
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }} />
          : category === "audio" ? <div className="media-audio-stage">
            <AudioOutlined className="media-audio-glyph" aria-hidden="true" />
            <Player src={state.url} controls preload="metadata" aria-label={label} onError={decodeError} />
          </div>
            : <Player src={state.url} controls playsInline preload="metadata" aria-label={label} onError={decodeError} />}
        {switching && <span className="media-stage-busy" aria-label={t("正在读取…")}><Spin size="small" /></span>}
      </> : rawOnly ? <div className="media-stage-placeholder">
        <Icon className="media-stage-icon" />
        {state.error && <Alert type="error" showIcon title={t(state.error)} />}
        <Typography.Text type="secondary">{t("此格式暂不支持在线预览，可下载到本地查看。")}</Typography.Text>
        <Button type="primary" size="small" icon={<DownloadOutlined />} onClick={download}>{t("下载文件")}</Button>
      </div> : <div className="media-stage-placeholder">
        <Icon className="media-stage-icon" />
        {state.error && <Alert type="error" showIcon title={t(state.error)} />}
        {sourceCategory === "text" && source.size > textPreviewLimit && !state.error &&
          <Typography.Text type="secondary">{t("文本文件超过 2 MiB，可手动加载预览或直接下载。")}</Typography.Text>}
        <div className="detail-actions">
          <Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={() => void play()}>
            {state.error ? t("重新读取文件") : t("加载预览")}
          </Button>
          {source.kind === "opfs" && <Button size="small" icon={<DownloadOutlined />} onClick={download}>{t("下载文件")}</Button>}
        </div>
      </div>}
    </div>
    {state.playbackError && <Alert type="error" showIcon title={t(state.playbackError)} />}
    <div className="media-preview-bar">
      <div className="media-preview-info">
        {embedded && source.name && <Typography.Text strong className="cell-text data-input" title={source.name}>{source.name}</Typography.Text>}
        <div className="media-preview-tags">
          {mediaLabels[category] && <Tag color={mediaTagColors[category]}>{isJsonText ? "JSON" : t(mediaLabels[category])}</Tag>}
          <Typography.Text type="secondary" className="data-input">{sizeText(source.size, t)}</Typography.Text>
          {source.modified != null && <Typography.Text type="secondary" className="media-meta-time">
            {new Date(source.modified).toLocaleString(language)}
          </Typography.Text>}
        </div>
      </div>
      <div className="action-strip media-preview-actions">
        {isImageReady && <div className="action-group">
          <IconAction icon={<ZoomOutOutlined />} label={t("缩小")} disabled={zoom <= minZoom} onClick={() => stepZoom(-0.25)} />
          <Tooltip title={t("重置缩放")}>
            <Button type="text" size="small" className="media-zoom-reset" onClick={resetZoom}>
              {Math.round(zoom * 100)}%
            </Button>
          </Tooltip>
          <IconAction icon={<ZoomInOutlined />} label={t("放大")} disabled={zoom >= maxZoom} onClick={() => stepZoom(0.25)} />
        </div>}
        {(onPrev || onNext) && <div className="action-group">
          <IconAction icon={<LeftOutlined />} label={t("上一项")} disabled={!onPrev} onClick={onPrev} />
          {positionText && <Typography.Text type="secondary" className="media-position-text">{positionText}</Typography.Text>}
          <IconAction icon={<RightOutlined />} label={t("下一项")} disabled={!onNext} onClick={onNext} />
        </div>}
        {(state.status === "ready" || (rawOnly && !unavailable && state.status !== "loading")) && <div className="action-group">
          {isTextReady && <IconAction icon={<CopyOutlined />} label={t("复制值")} onClick={() => void copyText()} />}
          <IconAction icon={<DownloadOutlined />} label={t("下载文件")} onClick={download} />
          {embedded && state.status === "ready" && <IconAction icon={<CloseOutlined />} label={t("关闭预览")}
            onClick={() => {
              abortCurrent();
              revokeIfOwned(state.url);
              setState({ status: "idle" });
            }} />}
        </div>}
      </div>
    </div>
  </div>;
}

const sources = Object.entries(mediaRoots).map(([value, label]) => ({ value, label }));

function createPreviewCache(limit = 12) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return null;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      if (map.has(key)) {
        const old = map.get(key);
        if (old?.url && old.url !== value.url) URL.revokeObjectURL(old.url);
        map.delete(key);
      }
      map.set(key, value);
      while (map.size > limit) {
        const [oldestKey, oldest] = map.entries().next().value;
        map.delete(oldestKey);
        if (oldest?.url) URL.revokeObjectURL(oldest.url);
      }
    },
    clear() {
      for (const entry of map.values()) {
        if (entry?.url) URL.revokeObjectURL(entry.url);
      }
      map.clear();
    },
  };
}

export default function MediaBrowser({ target, refreshVersion, initialLocation, onLocationChange }) {
  const { t, language } = usePreferences();
  const notify = useFeedback();
  const [kind, setKind] = useState(initialLocation?.kind ?? "opfs");
  const [path, setPath] = useState(initialLocation?.path ?? []);
  const [page, setPage] = useState(firstPage);
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode, setViewMode] = useState("grid");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [revision, setRevision] = useState(0);
  const [width, setWidth] = useState(null);
  const [layout, setLayout] = useState(null);
  const scrollRef = useRef(null);
  const previewCache = useMemo(() => createPreviewCache(12), [target.key]);
  const showTree = width >= 640;
  const splitPreview = width >= 960;

  useEffect(() => () => previewCache.clear(), [previewCache]);

  useLayoutEffect(() => {
    if (!layout) return;
    setWidth(layout.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(layout);
    return () => observer.disconnect();
  }, [layout]);

  const pageScope = JSON.stringify([kind, path, showTree]);
  const activePage = page.scope === pageScope ? page : firstPage;
  const cursor = activePage.cursors[activePage.index];
  const foldersOnly = kind !== "opfs" && isMediaContainer(kind, path);
  const scope = JSON.stringify([pageScope, cursor, revision, refreshVersion]);

  const readRows = useCallback(async () => {
    let result;
    if (kind === "opfs") {
      result = await runInPage(target, "opfsList", { path, offset: cursor ?? 0, filesOnly: showTree });
    } else if (foldersOnly) {
      result = showTree ? { rows: [], next: null } : await readMediaFolders(target, kind, path);
    } else if (kind === "cache") {
      result = await runInPage(target, "cacheMedia", { cacheName: path[0], offset: cursor ?? 0 });
    } else {
      result = await runInPage(target, "idbMedia", { dbName: path[0], storeName: path[1], after: cursor });
    }
    return { ...result, path, kind };
  }, [target, kind, path, cursor, foldersOnly, showTree]);

  const listing = useRead(width === null ? null : scope, readRows, 0, target.key);
  const visibleRows = listing.value?.rows ?? [];
  const allRows = showTree ? visibleRows.filter((row) => !row.directory) : visibleRows;
  const loading = listing.status === "loading" || !!listing.refreshing;

  const term = search.trim().toLowerCase();
  const availableTypes = useMemo(() => {
    const present = new Set();
    for (const row of allRows) {
      if (!row.directory) {
        const cat = mediaType(row.type);
        if (mediaLabels[cat]) present.add(cat);
      }
    }
    return present;
  }, [allRows]);
  const activeTypeFilter = typeFilter === "all" || availableTypes.has(typeFilter) ? typeFilter : "all";

  const filteredRows = useMemo(() => allRows.filter((row) => {
    if (row.directory) return !term || (row.name || "").toLowerCase().includes(term);
    if (activeTypeFilter !== "all" && mediaType(row.type) !== activeTypeFilter) return false;
    if (!term) return true;
    return [row.name, row.record, row.type].some((value) => value?.toLowerCase().includes(term));
  }), [allRows, activeTypeFilter, term]);

  const folders = useMemo(() => filteredRows.filter((row) => row.directory), [filteredRows]);
  const files = useMemo(() => filteredRows.filter((row) => !row.directory), [filteredRows]);
  const openableFiles = useMemo(() => files.filter((row) => canOpen(row, kind)), [files, kind]);

  const selected = loading ? null : openableFiles.find((row) => rowKey(row) === selectedId) ?? null;
  const selectedIndex = selected ? openableFiles.findIndex((row) => rowKey(row) === rowKey(selected)) : -1;
  const sourcesByRow = useMemo(() => new Map(listing.value?.rows
    .filter((row) => !row.directory).map((row) => [rowKey(row), fileSource(row, listing.value)])), [listing.value]);
  const selectedSource = selected ? sourcesByRow.get(rowKey(selected)) : null;

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if (event.key === "ArrowLeft" && selectedIndex > 0) {
        event.preventDefault();
        setSelectedId(rowKey(openableFiles[selectedIndex - 1]));
      } else if (event.key === "ArrowRight" && selectedIndex >= 0 && selectedIndex < openableFiles.length - 1) {
        event.preventDefault();
        setSelectedId(rowKey(openableFiles[selectedIndex + 1]));
      } else if (event.key === "Escape" && splitPreview) {
        event.preventDefault();
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, selectedIndex, openableFiles, splitPreview]);

  function reset() {
    setPage(firstPage);
    setSelectedId(null);
    setSearch("");
    setTypeFilter("all");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }
  function navigate(nextKind, nextPath) {
    if (kind === nextKind && mediaPathKey(path) === mediaPathKey(nextPath)) return;
    setKind(nextKind);
    setPath(nextPath);
    onLocationChange({ kind: nextKind, path: nextPath });
    reset();
  }
  function move(index) {
    const cursors = [...activePage.cursors];
    if (index > activePage.index) cursors[index] = listing.value.next;
    setPage({ scope: pageScope, index, cursors });
    setSelectedId(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }
  function refresh() {
    previewCache.clear();
    reset();
    setRevision((value) => value + 1);
  }
  function selectRow(row) {
    if (row.directory) {
      navigate(kind, [...path, row.name]);
    } else if (canOpen(row, kind)) {
      const id = rowKey(row);
      setSelectedId((current) => splitPreview && current === id ? null : id);
    }
  }
  async function copyName(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify(t("已复制"));
    } catch {
      notify(t("复制失败"), "error");
    }
  }

  const labels = [mediaRoots[kind], ...path.map((name) => name || t("（空名称）"))];
  const trail = labels.map((label, index) => ({
    key: index,
    title: index === path.length ? <span aria-current="location" title={label}>{label}</span>
      : <Button type="link" size="small" title={label} onClick={() => navigate(kind, path.slice(0, index))}>{label}</Button>,
  }));
  const crumbs = !showTree && path.length > 2 ? [
    trail[0],
    { key: "more", title: t("更多路径"), menu: { items: labels.slice(1, -2).map((label, index) => ({
      key: String(index), label, onClick: () => navigate(kind, path.slice(0, index + 1)),
    })) } },
    ...trail.slice(-2),
  ] : trail;

  const isFiltered = !!term || activeTypeFilter !== "all";
  const emptyText = isFiltered ? "没有匹配的媒体文件"
    : showTree && foldersOnly ? "选择左侧目录查看文件"
      : listing.value?.next != null && kind !== "opfs" ? "本页没有视频，可继续查看下一页"
        : kind === "opfs" ? showTree ? "当前目录没有文件" : "此文件夹为空"
          : kind === "cache" && !path.length ? "没有 Cache"
            : kind === "idb" && !path.length ? "没有 IndexedDB 数据库"
              : foldersOnly ? "此数据库没有对象仓库"
                : "此范围没有发现可识别的视频";

  const showThumb = (row, category) => canPreview(row) && row.size > 0 && row.size <= autoPreviewLimit
    && (category === "video" || (listing.value?.kind === "opfs" && category === "image"));

  const fileHint = (row, category) => row.error ? t(row.error)
    : row.size > mediaLimit ? t("文件超过 50 MiB 的预览上限")
      : row.size === 0 ? t("文件为空，无法预览")
        : mediaLabels[category] ? t(mediaLabels[category])
          : kind === "opfs" ? t("可下载") : t("此格式暂无预览");

  const listColumns = [
    {
      title: t("名称"), key: "file",
      render: (_, row) => {
        const category = mediaType(row.type);
        const Icon = row.directory ? FolderOutlined : mediaIcons[category] ?? FileOutlined;
        const name = row.name || t("（空名称）");
        const openable = canOpen(row, kind);
        const sub = [row.directory ? t("文件夹") : fileHint(row, category),
          row.record || (row.modified == null ? null : new Date(row.modified).toLocaleString(language))].filter(Boolean).join(" · ");
        return <Button className="media-file-button" type="text" size="small"
          aria-label={t(row.directory ? "打开文件夹 {name}" : "查看 {name}", { name })}
          disabled={loading || (!row.directory && !openable)}
          aria-pressed={row.directory ? undefined : selected === row}
          onClick={(event) => { event.stopPropagation(); selectRow(row); }}>
          {showThumb(row, category)
            ? <MediaThumbnail key={JSON.stringify([listing.key, rowKey(row), row.modified, row.size])}
              target={target} source={sourcesByRow.get(rowKey(row))}
              enqueue={enqueueThumbnail} paused={loading} />
            : <span className="media-file-icon" aria-hidden="true"><Icon /></span>}
          <span className="cell-lines">
            <span className="cell-text" title={name}>{name}</span>
            {sub && <Typography.Text className="cell-text" type="secondary" title={sub}>{sub}</Typography.Text>}
          </span>
        </Button>;
      },
    },
    {
      title: t("大小"), key: "size", width: 84, align: "right",
      render: (_, row) => <span className="cell-text data-input" title={row.directory ? undefined : sizeText(row.size, t)}>
        {row.directory ? "–" : sizeText(row.size, t)}
      </span>,
    },
  ];

  const previewElement = selectedSource && <MediaPreview
    target={target}
    source={selectedSource}
    autoRead={selected.size > 0 && selected.size <= autoPreviewLimit}
    cache={previewCache}
    onClose={() => setSelectedId(null)}
    onPrev={selectedIndex > 0 ? () => setSelectedId(rowKey(openableFiles[selectedIndex - 1])) : undefined}
    onNext={selectedIndex >= 0 && selectedIndex < openableFiles.length - 1 ? () => setSelectedId(rowKey(openableFiles[selectedIndex + 1])) : undefined}
    positionText={openableFiles.length > 1 ? `${selectedIndex + 1} / ${openableFiles.length}` : undefined}
  />;

  const selectedName = selected ? (selected.name || t("（空名称）")) : "";
  const previewTitle = selected && <Tooltip title={t("点击复制")} placement="bottomLeft" trigger={["hover", "focus"]}>
    <Button type="text" size="small" className="record-title-copy"
      aria-label={t("复制标题 {name}", { name: selectedName })} onClick={() => void copyName(selected.name || "")}>
      <span className="cell-text">{selectedName}</span>
      <CopyOutlined className="record-title-copy-icon" aria-hidden="true" />
    </Button>
  </Tooltip>;

  const typeOptions = [
    { value: "all", label: t("全部") },
    ...["video", "image", "audio", "text"].filter((type) => availableTypes.has(type)).map((type) => ({
      value: type, label: t(mediaLabels[type]),
    })),
  ];

  const showFilterBar = allRows.length > 0 || isFiltered;

  return <div className="media-workspace" ref={setLayout}>
    <div className="media-shell" data-tree={showTree || undefined} data-split={splitPreview && !!selectedSource || undefined}>
      {showTree && <nav className="media-directory" aria-label={t("目录")}>
        <MediaDirectory key={JSON.stringify([revision, refreshVersion])} target={target} kind={kind} path={path} onNavigate={navigate} />
      </nav>}
      <div className="media-main">
        <div className="media-header">
          {!showTree && <Segmented className="media-source-switch" block size="small" options={sources}
            aria-label={t("媒体来源")} value={kind} onChange={(value) => navigate(value, [])} />}
          <div className="media-browser-path">
            {path.length > 0 && <IconAction icon={<ArrowLeftOutlined />} label={t("上一级")}
              disabled={loading} onClick={() => navigate(kind, path.slice(0, -1))} />}
            <Breadcrumb aria-label={t("路径")} items={crumbs} />
            <span className="media-browser-progress" role={loading ? "status" : undefined}
              aria-label={loading ? t("正在读取…") : undefined}>{loading && <Spin size="small" />}</span>
          </div>
          {showFilterBar && <div className="media-toolbar">
            <Input size="small" className="search" prefix={<SearchOutlined />} allowClear
              aria-label={t("筛选文件名")} placeholder={t("筛选文件名")}
              value={search} onChange={(event) => setSearch(event.target.value)} />
            {typeOptions.length > 2 && <Segmented size="small" className="media-type-filter"
              aria-label={t("媒体类型")} value={activeTypeFilter} options={typeOptions} onChange={setTypeFilter} />}
            <div className="workspace-switch media-view-switch" role="group" aria-label={t("视图模式")}>
              <IconAction icon={<AppstoreOutlined />} label={t("卡片视图")} aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")} />
              <IconAction icon={<UnorderedListOutlined />} label={t("列表视图")} aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")} />
            </div>
          </div>}
        </div>
        <div className="media-content-scroll" ref={scrollRef} aria-label={t("文件 / 来源")} aria-busy={loading}>
          {listing.status === "error" ? <div className="media-state-wrap">
            <Alert type="error" showIcon title={t(listing.error)} action={<Button size="small" onClick={refresh}>{t("重试")}</Button>} />
          </div> : loading && !allRows.length ? <div className="state-message" role="status" aria-busy="true">
            <Spin size="small" />
            <Typography.Text type="secondary">{t("正在读取…")}</Typography.Text>
          </div> : !filteredRows.length ? <div className="state-message">
            <Typography.Title level={5} className="state-title">{t(emptyText)}</Typography.Title>
            {isFiltered && <Button size="small" onClick={() => { setSearch(""); setTypeFilter("all"); }}>{t("清除筛选")}</Button>}
          </div> : viewMode === "grid" ? <div className="media-grid-stack">
            {folders.length > 0 && <div className="media-folder-grid">
              {folders.map((row) => {
                const name = row.name || t("（空名称）");
                return <button key={rowKey(row)} type="button" className="media-folder-card" disabled={loading}
                  aria-label={t("打开文件夹 {name}", { name })} onClick={() => selectRow(row)}>
                  <FolderOutlined className="media-folder-glyph" aria-hidden="true" />
                  <span className="cell-text data-input" title={name}>{name}</span>
                  <RightOutlined className="media-folder-arrow" aria-hidden="true" />
                </button>;
              })}
            </div>}
            {files.length > 0 && <div className="media-card-grid">
              {files.map((row) => {
                const category = mediaType(row.type);
                const Icon = mediaIcons[category] ?? FileOutlined;
                const name = row.name || t("（空名称）");
                const openable = canOpen(row, kind);
                const previewable = canPreview(row);
                const active = selected === row;
                const thumbVisible = showThumb(row, category);
                return <button key={rowKey(row)} type="button" className="media-card"
                  data-active={active || undefined} data-disabled={!openable || undefined}
                  disabled={loading || !openable} aria-pressed={active}
                  aria-label={t("查看 {name}", { name })} onClick={() => selectRow(row)}>
                  <div className="media-card-thumb">
                    {thumbVisible
                      ? <MediaThumbnail key={JSON.stringify([listing.key, rowKey(row), row.modified, row.size])}
                        className="media-card-thumb-inner" target={target} source={sourcesByRow.get(rowKey(row))}
                        enqueue={enqueueThumbnail} paused={loading} />
                      : <span className="media-card-thumb-inner" aria-hidden="true"><Icon /></span>}
                    {mediaLabels[category] && <span className="media-card-badge" data-kind={category}>{t(mediaLabels[category])}</span>}
                  </div>
                  <div className="media-card-body">
                    <span className="cell-text media-card-name" title={name}>{name}</span>
                    <span className="media-card-meta">
                      <span className="data-input">{sizeText(row.size, t)}</span>
                      {!previewable && <span className="cell-text media-card-hint" title={fileHint(row, category)}>{fileHint(row, category)}</span>}
                    </span>
                  </div>
                </button>;
              })}
            </div>}
          </div> : <Table className="compact-table media-file-table" size="small" tableLayout="fixed" pagination={false}
            columns={listColumns} dataSource={filteredRows} rowKey={rowKey}
            onRow={(row) => ({
              onClick: () => selectRow(row),
              "data-active": selected === row || undefined,
              "data-clickable": row.directory || canOpen(row, kind) || undefined,
            })} />}
        </div>
        <footer className="workspace-footer media-footer">
          <Typography.Text role="status" type="secondary" className="workspace-count">
            {loading ? t("正在读取…")
              : isFiltered ? t("筛选出 {shown}/{total} 项", { shown: filteredRows.length, total: allRows.length })
                : t("共 {count} 项", { count: allRows.length })}
          </Typography.Text>
          {(activePage.index > 0 || listing.value?.next != null) && <div className="page-controls">
            <IconAction icon={<LeftOutlined />} label={t("上一页")} disabled={loading || activePage.index === 0}
              onClick={() => move(activePage.index - 1)} />
            <IconAction icon={<RightOutlined />} label={t("下一页")} disabled={loading || listing.value?.next == null}
              onClick={() => move(activePage.index + 1)} />
          </div>}
        </footer>
      </div>
      {splitPreview && selectedSource && <aside className="record-inspector media-inspector" aria-label={t("预览媒体")}>
        <header className="inspector-header">
          <div className="inspector-heading">{previewTitle}</div>
          <IconAction icon={<CloseOutlined />} label={t("关闭预览")} onClick={() => setSelectedId(null)} />
        </header>
        <div className="media-inspector-body">{previewElement}</div>
      </aside>}
      {!splitPreview && selectedSource && <WideModal className="media-preview-modal" size="lg"
        title={previewTitle} footer={null} maskClosable onCancel={() => setSelectedId(null)}>
        {previewElement}
      </WideModal>}
    </div>
  </div>;
}
