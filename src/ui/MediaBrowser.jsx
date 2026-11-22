import React, { useCallback, useEffect, useRef, useState } from "react";
import { EyeOutlined, FolderOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Progress, Segmented, Select, Spin, Table, Typography } from "antd";
import { runInPage } from "../api/page.js";
import { openPreviewWindow } from "./openPreviewWindow.js";
import { usePreferences } from "./preferences.js";
import { useRead } from "./useRecords.js";
import WideModal from "./WideModal.jsx";

const mediaLimit = 50 * 1024 * 1024;
const errorText = (error) => error?.message || String(error);
const sizeText = (bytes, t) => bytes == null ? t("大小未知") : bytes < 1024
  ? `${bytes} B` : `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
const options = (items, t) => items.map((value) => ({ value, label: value || t("（空名称）") }));
const mediaLabels = { audio: "音频", image: "图片", video: "视频" };
const mediaType = (mime) => mime?.split("/")[0];

export function MediaPreview({ target, source, autoRead = false }) {
  const { t } = usePreferences();
  const [state, setState] = useState({ status: "idle" });
  const transfer = useRef(null);
  const sourceKey = JSON.stringify([target.documentId, source]);
  const unavailable = source.error || (source.size === 0 ? "文件为空，无法预览"
    : source.size > mediaLimit ? "文件超过 50 MiB 的预览上限" : "");
  useEffect(() => {
    setState({ status: "idle" });
    if (autoRead && !unavailable) void play();
    return () => release();
  }, [sourceKey, autoRead, unavailable]);

  function closeTicket(job) {
    void runInPage(job.target, "mediaClose", { ticket: job.ticket }).catch(() => {});
  }
  function release() {
    const job = transfer.current;
    if (!job) return;
    transfer.current = null;
    closeTicket(job);
    if (job.url) URL.revokeObjectURL(job.url);
    job.closeWindow?.();
  }
  async function play() {
    release();
    const job = { target, ticket: crypto.randomUUID() };
    transfer.current = job;
    setState({ status: "loading", bytes: 0, total: null });
    const chunks = [];
    try {
      const { type, total } = await runInPage(target, "mediaStart", { ...source, ticket: job.ticket });
      let bytes = 0;
      while (transfer.current === job) {
        const { data, done } = await runInPage(target, "mediaChunk", { ticket: job.ticket });
        if (transfer.current !== job) return;
        if (data) {
          const chunk = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
          bytes += chunk.byteLength;
          if (bytes > mediaLimit) throw new Error("文件超过 50 MiB，已停止读取");
          chunks.push(chunk);
          setState({ status: "loading", bytes, total });
        }
        if (done) {
          if (!bytes) throw new Error("文件为空，无法预览");
          job.blob = new Blob(chunks, { type });
          job.url = URL.createObjectURL(job.blob);
          setState({ status: "ready", url: job.url, type });
          return;
        }
      }
    } catch (error) {
      if (transfer.current === job) setState({ status: "error", error: errorText(error) });
    } finally {
      closeTicket(job);
    }
  }

  function popout() {
    const job = transfer.current;
    if (!job?.blob) return;
    try {
      job.closeWindow?.();
      job.closeWindow = openPreviewWindow({ blob: job.blob, name: source.name });
      setState((current) => ({ ...current, windowError: "" }));
    } catch (error) {
      setState((current) => ({ ...current, windowError: errorText(error) }));
    }
  }

  const category = mediaType(state.type);
  const label = source.name || t(mediaLabels[category] ?? "本地媒体");
  const decodeError = () => setState((current) => current.status === "ready" && current.url === state.url
    ? { ...current, playbackError: "Chrome 无法解码此文件，或文件不完整。" } : current);
  const Player = category === "audio" ? "audio" : "video";
  return <div className="media-preview">
    {source.name && <Typography.Text strong className="dialog-wrap">{source.name}</Typography.Text>}
    {unavailable ? <Typography.Text type="secondary">{t(unavailable)}</Typography.Text>
      : state.status === "loading" ? <>
        {state.total ? <Progress percent={Math.min(99, Math.floor(state.bytes / state.total * 100))} size="small" />
          : <Typography.Text role="status">{t("已读取 {size}", { size: sizeText(state.bytes, t) })}</Typography.Text>}
        <Button onClick={() => { release(); setState({ status: "idle" }); }}>{t("取消读取")}</Button>
      </> : state.status === "ready" ? <>
        {category === "image" ? <img src={state.url} alt={label} onError={decodeError} />
          : <Player src={state.url} controls playsInline={category === "video" ? true : undefined} preload="metadata"
            aria-label={label} onError={decodeError} />}
        {(state.playbackError || state.windowError) && <Alert type="error" title={t(state.playbackError || state.windowError)} />}
        <div className="detail-actions">
          <Button onClick={popout} disabled={!!state.playbackError}>{t("在独立窗口预览")}</Button>
          <Button onClick={() => { release(); setState({ status: "idle" }); }}>{t("关闭预览")}</Button>
        </div>
      </> : <>
        {state.error && <Alert type="error" title={t(state.error)} />}
        <Button icon={<EyeOutlined />} onClick={play}>{state.error ? t("重新读取文件") : t("预览媒体")}</Button>
      </>}
  </div>;
}

const sources = [
  { value: "opfs", label: "OPFS" },
  { value: "idb", label: "IndexedDB" },
  { value: "cache", label: "Cache" },
];

export default function MediaBrowser({ target, stale, onClose }) {
  const { t, language } = usePreferences();
  const [kind, setKind] = useState("opfs");
  const [path, setPath] = useState([]);
  const [chosenDb, setDb] = useState(null);
  const [chosenStore, setStore] = useState(null);
  const [chosenCache, setCache] = useState(null);
  const [page, setPage] = useState({ index: 0, cursors: [null] });
  const [selected, setSelected] = useState(null);
  const [revision, setRevision] = useState(0);
  const readCatalog = useCallback(() => runInPage(target, kind === "idb" ? "idbDatabases" : "cacheNames"), [target, kind]);
  const catalog = useRead(!stale && kind !== "opfs" ? `${kind}-${revision}` : null, readCatalog);
  const names = kind === "idb" ? (catalog.value ?? []).filter(({ pending }) => !pending).map(({ name }) => name) : catalog.value ?? [];
  const dbName = kind === "idb" ? names.includes(chosenDb) ? chosenDb : names[0] ?? null : null;
  const cacheName = kind === "cache" ? names.includes(chosenCache) ? chosenCache : names[0] ?? null : null;
  const readStores = useCallback(() => runInPage(target, "idbStores", { dbName }), [target, dbName]);
  const stores = useRead(!stale && dbName !== null ? JSON.stringify([dbName, revision]) : null, readStores);
  const storeNames = (stores.value ?? []).map(({ name }) => name);
  const storeName = storeNames.includes(chosenStore) ? chosenStore : storeNames[0] ?? null;
  const canRead = !stale && (kind === "opfs" || cacheName !== null || storeName !== null);
  const cursor = page.cursors[page.index];
  const readRows = useCallback(() => {
    if (kind === "opfs") return runInPage(target, "opfsList", { path, offset: cursor ?? 0 });
    if (kind === "cache") return runInPage(target, "cacheMedia", { cacheName, offset: cursor ?? 0 });
    return runInPage(target, "idbMedia", { dbName, storeName, after: cursor });
  }, [target, kind, path, cursor, cacheName, dbName, storeName]);
  const listing = useRead(canRead ? JSON.stringify([kind, path, cursor, cacheName, dbName, storeName, revision]) : null, readRows);
  const error = [catalog, stores, listing].find((item) => item.status === "error")?.error;
  const loading = kind !== "opfs" && catalog.status === "loading" ||
    dbName !== null && stores.status === "loading" || canRead && listing.status === "loading";

  function reset() {
    setPage({ index: 0, cursors: [null] });
    setSelected(null);
  }
  function move(index) {
    const cursors = [...page.cursors];
    if (index > page.index) cursors[index] = listing.value.next;
    setPage({ index, cursors });
    setSelected(null);
  }
  function refresh() {
    reset();
    setRevision((value) => value + 1);
  }
  function source(row) {
    if (kind === "opfs") return { ...row, kind, path };
    if (kind === "idb") return { ...row, kind, dbName, storeName };
    return { ...row, kind, cacheName };
  }
  const columns = [
    {
      title: t("文件 / 来源"), key: "file",
      render: (_, row) => <div className="cell-lines">
        {row.error || (!row.directory && !row.type)
          ? <Typography.Text className="cell-text" type="secondary" title={row.name}>{row.name}</Typography.Text>
          : <Button className="record-open" type="text" size="small" icon={row.directory ? <FolderOutlined /> : <EyeOutlined />}
            onClick={() => {
              if (row.directory) { setPath([...path, row.name]); reset(); }
              else setSelected(source(row));
            }}>
            <span className="cell-text" title={row.name}>{row.name}</span>
          </Button>}
        <Typography.Text className="cell-text" type="secondary" title={row.error ? t(row.error) : row.record}>
          {row.error ? t(row.error) : [!row.directory && t(mediaLabels[mediaType(row.type)] ?? "此格式暂无预览"),
            row.record || (row.modified == null ? null : new Date(row.modified).toLocaleString(language))].filter(Boolean).join(" · ")}
        </Typography.Text>
      </div>,
    },
    {
      title: t("大小"), key: "size", width: 72,
      render: (_, row) => <span className="cell-text" title={row.directory ? undefined : sizeText(row.size, t)}>
        {row.directory ? t("文件夹") : sizeText(row.size, t)}
      </span>,
    },
  ];
  return <WideModal title={t("本地媒体")} onCancel={onClose}
    footer={<Button onClick={onClose}>{t("关闭")}</Button>}>
    <div className="dialog-stack">
      <Typography.Text code>{target.origin}</Typography.Text>
      {stale ? <Alert type="warning" title={t("目标已变化，请重新打开本地媒体。")} showIcon /> : <>
        <Segmented block options={sources} aria-label={t("媒体来源")} value={kind}
          onChange={(value) => { setKind(value); reset(); }} />
        <Typography.Text type="secondary">{t(kind === "opfs"
          ? "浏览网站保存的文件和文件夹。可预览 Chrome 支持的图片、音频和视频，单个文件上限 50 MiB。"
          : "查看已保存到此网站本地存储的视频。支持 Chrome 可解码的完整文件，单次预览上限 50 MiB。")}</Typography.Text>
        {kind === "opfs" && <div className="detail-actions">
          <Button disabled={!path.length} onClick={() => { setPath(path.slice(0, -1)); reset(); }}>{t("上一级")}</Button>
          <Typography.Text code className="dialog-wrap">/{path.join("/")}</Typography.Text>
        </div>}
        {kind === "idb" && <div className="scope-fields">
          <Select aria-label={t("数据库")} placeholder={t("选择数据库")} value={dbName ?? undefined}
            options={options(names, t)} onChange={(value) => { setDb(value); setStore(null); reset(); }} />
          <Select aria-label={t("对象仓库")} placeholder={t("选择对象仓库")} value={storeName ?? undefined}
            options={options(storeNames, t)} onChange={(value) => { setStore(value); reset(); }} />
        </div>}
        {kind === "cache" && <Select aria-label="Cache" placeholder={t("选择 Cache")} value={cacheName ?? undefined}
          options={options(names, t)} onChange={(value) => { setCache(value); reset(); }} />}
        {selected && <MediaPreview key={selected.id ?? JSON.stringify(selected)} target={target} source={selected} autoRead />}
        {error ? <Alert type="error" title={t(error)} action={<Button onClick={refresh}>{t("重试")}</Button>} /> :
          loading ? <Spin size="small" /> :
          listing.value?.rows.length ? <Table className="compact-table" size="small" tableLayout="fixed" pagination={false}
            columns={columns} dataSource={listing.value.rows}
            rowKey={(row) => row.id ?? JSON.stringify([row.name, row.key, row.path])} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={listing.value?.next != null
            ? t("本页没有视频，可继续查看下一页") : t(kind === "opfs" ? "此文件夹为空" : "此范围没有发现可识别的视频")} />}
        <div className="detail-actions">
          {page.index > 0 && <Button disabled={loading} onClick={() => move(page.index - 1)}>{t("上一页")}</Button>}
          {listing.value?.next != null && <Button disabled={loading} onClick={() => move(page.index + 1)}>{t("下一页")}</Button>}
          <Button type="text" onClick={refresh}>{t("刷新")}</Button>
        </div>
      </>}
    </div>
  </WideModal>;
}
