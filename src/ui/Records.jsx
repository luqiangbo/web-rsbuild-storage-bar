import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CopyOutlined, DatabaseOutlined, DeleteOutlined, DiffOutlined, DownloadOutlined, EditOutlined, ExportOutlined,
  FilterOutlined, LeftOutlined, MoreOutlined, PlusOutlined, PushpinOutlined, RightOutlined, SearchOutlined, UndoOutlined, UploadOutlined,
} from "@ant-design/icons";
import { Alert, Button, Checkbox, Input, Segmented, Select, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { deleteCookies, getSiteCookies } from "../api/cookies.js";
import { runInPage } from "../api/page.js";
import JsonViewer from "./JsonViewer.jsx";
import IconAction from "./IconAction.jsx";
import IdbQuery from "./IdbQuery.jsx";
import { formatJson, jsonError, jsonTree, jsonTreeLimit } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";
import { MediaPreview } from "./MediaBrowser.jsx";
import { openPreviewWindow } from "./openPreviewWindow.js";
import { PAGE_SIZE, useCatalog, useRead, useRecordList } from "./useRecords.js";
import WideModal from "./WideModal.jsx";
import WebStorageTools from "./WebStorageTools.jsx";
import SearchMatch from "./SearchMatch.jsx";
import ActionMenu, { menuShortcut, useActionMenu } from "./ActionMenu.jsx";

const nameLabel = (name, t) => name === "" ? t("（空名称）") : name;
export const storageLabel = (kind) => kind === "local" ? "LocalStorage" : "SessionStorage";

function httpStatusColor(status) {
  if (typeof status !== "number") return "default";
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "processing";
  if (status >= 400 && status < 500) return "warning";
  if (status >= 500) return "error";
  return "default";
}

export function StateMessage({ title, children, action, busy = false }) {
  const { t } = usePreferences();
  return <div className="state-message" role={busy ? "status" : undefined} aria-busy={busy}>
    {busy && <Spin size="small" />}
    <Typography.Title level={5} className="state-title">{t(title)}</Typography.Title>
    {children && <Typography.Text type="secondary">{t(children)}</Typography.Text>}
    {action}
  </div>;
}

function Selector({ label, value, names, onChange }) {
  const { t } = usePreferences();
  return <div className="scope-picker">
    <Typography.Text type="secondary" className="scope-label">{label}</Typography.Text>
    <Select size="small" aria-label={label} value={value ?? undefined} placeholder={t("无可选项")}
      options={names.map(({ name, label: text }) => ({ value: name, label: text ?? nameLabel(name, t) }))}
      onChange={onChange} disabled={!names.length} />
  </div>;
}

function Metadata({ rows }) {
  const { t } = usePreferences();
  return <div className="metadata-card">
    <Table className="compact-table metadata-table" size="small" tableLayout="fixed" showHeader={false} pagination={false}
      rowKey="label" dataSource={rows.map(([label, value]) => ({ label, value }))} columns={[
        { dataIndex: "label", width: "36%", rowScope: "row", render: (label) => <Typography.Text type="secondary">{label}</Typography.Text> },
        { dataIndex: "value", render: (value) => <span className="dialog-wrap">{value ?? t("未知")}</span> },
      ]} />
  </div>;
}

function RecordDetail({ target, scope, row, currentRow, listStatus, revision, onClose, onEdit, onDelete, copy, working, editor,
  canPin, pinned, onPin }) {
  const { t, language } = usePreferences();
  const [retry, setRetry] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const closePreview = useRef(null);
  const inspectorHeader = useRef(null);
  const detailContent = useRef(null);
  useEffect(() => () => closePreview.current?.(), []);
  useLayoutEffect(() => { if (pinned) inspectorHeader.current?.focus(); }, [pinned]);
  const { section, dbName, storeName, cacheName } = scope;
  const needsRead = section === "idb" || section === "cache";
  const load = useCallback(() => section === "idb"
    ? runInPage(target, "idbDetail", { dbName, storeName, key: row.key })
    : runInPage(target, "cacheDetail", { cacheName, id: row.id }),
  [target, section, dbName, storeName, cacheName, row]);
  const detail = useRead(needsRead ? JSON.stringify([row.id, retry, revision]) : null, load);
  const cookie = currentRow?.cookie;
  const text = section === "storage" ? currentRow?.value : section === "cookies" ? cookie?.value : detail.value?.text;
  const viewJson = useMemo(() => typeof text === "string" && (section === "storage" || section === "idb")
    && !jsonError(text), [section, text]);
  const copyValue = useMemo(() => {
    if (!viewJson || !jsonTree(text)) return text;
    const formatted = formatJson(text);
    return formatted.length <= jsonTreeLimit ? formatted : text;
  }, [viewJson, text]);
  const editing = !!editor;
  useLayoutEffect(() => {
    const scrollers = detailContent.current?.querySelectorAll(".value-block-framed, .record-editor-scroll, .record-detail-content[data-media]");
    scrollers?.forEach((node) => { node.scrollTop = 0; });
  }, [editing, row.id]);
  const allowEdit = (!!currentRow && !listStatus.refreshing) || detail.value?.editable === true;
  const detailReady = needsRead ? detail.status === "ready" : !!currentRow;
  const state = needsRead ? detail : listStatus;
  const openPreview = () => {
    const content = section === "cache" ? JSON.stringify({ url: row.title, ...detail.value }, null, 2)
      : text;
    try {
      closePreview.current?.();
      closePreview.current = openPreviewWindow({ name: nameLabel(row.title, t), text: content });
      setPreviewError("");
    } catch (error) {
      setPreviewError(error.message);
    }
  };
  const name = nameLabel(row.title, t);
  const title = editor?.title ?? <Tooltip title={t("点击复制")} placement="bottomLeft" trigger={["hover", "focus"]}>
    <Button type="text" size="small" className="record-title-copy"
      aria-label={t("复制标题 {name}", { name })} onClick={() => copy(row.title)}>
      <span className="cell-text">{name}</span>
      <CopyOutlined className="record-title-copy-icon" aria-hidden="true" />
    </Button>
  </Tooltip>;
  const close = editor?.onCancel ?? onClose;
  const canPreview = detailReady && !state.refreshing;
  const cannotDelete = working || (needsRead ? detail.status === "loading" : !currentRow || listStatus.refreshing);
  const remove = () => onDelete([currentRow ?? row]);
  const footer = editor ? <div className="detail-actions record-edit-actions">{editor.footer}</div>
    : <div className="record-detail-footer">
      <div className="action-strip record-detail-tools" role="group" aria-label={t("记录操作")}>
        <div className="action-group">
          {text !== undefined && !state.refreshing && <IconAction icon={<CopyOutlined />}
            label={t(viewJson ? "复制格式化 JSON" : section === "idb" && !detail.value?.editable ? "复制预览" : "复制值")}
            onClick={() => copy(copyValue)} />}
          {section === "cache" && <IconAction icon={<CopyOutlined />} label={t("复制 URL")} onClick={() => copy(row.title)} />}
          {canPreview && <IconAction icon={<ExportOutlined />} label={t("独立窗口查看")} onClick={openPreview} />}
          {canPin && <IconAction icon={<PushpinOutlined />} label={t(pinned ? "取消固定详情" : "固定详情")}
            aria-pressed={pinned} onClick={onPin} />}
        </div>
        <div className="action-group">
          <IconAction danger icon={<DeleteOutlined />} label={t("删除")} aria-haspopup="dialog"
            disabled={cannotDelete} onClick={remove} />
        </div>
      </div>
      <div className="detail-actions record-detail-primary">
        <Button onClick={onClose} disabled={working}>{t("关闭")}</Button>
        {allowEdit && <Button type="primary" icon={<EditOutlined />} disabled={working}
          onClick={() => onEdit({ row: currentRow ?? row, detail: detail.value })}>{t("编辑")}</Button>}
      </div>
    </div>;
  const hasMedia = (section === "cache" && !!detail.value?.video) || (section === "idb" && !!detail.value?.media?.length);
  const modalSize = editing ? (editor.size ?? (viewJson || section === "idb" ? "lg" : "md"))
    : (section === "idb" || viewJson || hasMedia) ? "lg" : "md";

  const body = editor ? <div className="record-editor-scroll">{editor.body}</div>
    : <div className="record-detail-content" data-media={hasMedia || undefined}>
      {previewError && <Alert type="error" showIcon title={t(previewError)} />}
      {(state.status === "loading" || state.refreshing) && <StateMessage title={t("正在读取详情")} busy />}
      {state.status === "error" && <StateMessage title={t("读取详情失败")}
        action={needsRead && <Button onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button>}>{state.error}</StateMessage>}
      {!needsRead && state.status === "ready" && !currentRow && <StateMessage title={t("记录已不存在")}>{t("返回列表查看当前数据。")}</StateMessage>}
      {detailReady && !state.refreshing && <>
        {section === "cookies" && <Metadata rows={[
          ["Domain", <span className="data-input">{cookie.domain}</span>],
          ["Path", <span className="data-input">{cookie.path}</span>],
          [t("到期时间"), cookie.session ? <Tag>{t("会话 Cookie")}</Tag>
            : <span className="data-input">{new Date(cookie.expirationDate * 1000).toLocaleString(language)}</span>],
          ["SameSite", <Tag>{cookie.sameSite}</Tag>],
          ["HttpOnly", <Tag color={cookie.httpOnly ? "blue" : "default"}>{cookie.httpOnly ? t("是") : t("否")}</Tag>],
          ["Secure", <Tag color={cookie.secure ? "green" : "default"}>{cookie.secure ? t("是") : t("否")}</Tag>],
        ]} />}
        {section === "idb" && !detail.value.editable && <Alert type="info" showIcon
          title={t("该值含有 JSON 无法无损表示的类型，以下为只读预览。")} />}
        {section === "cache" && <Metadata rows={[
          [t("请求方法"), <Tag>{row.preview}</Tag>],
          [t("响应状态"), detail.value.status == null ? null : <Tag color={httpStatusColor(detail.value.status)}>{detail.value.status}</Tag>],
          [t("响应类型"), <span className="data-input">{detail.value.type}</span>],
          [t("内容类型"), detail.value.contentType == null ? null : <span className="data-input">{detail.value.contentType}</span>],
          [t("内容长度"), detail.value.size === null ? null : <span className="data-input">{detail.value.size} B</span>],
        ]} />}
        {section === "cache" && detail.value.video && <MediaPreview target={target}
          source={{ kind: "cache", cacheName, id: row.id, name: row.title, ...detail.value.video }} />}
        {section === "idb" && detail.value.media?.map((item) => <MediaPreview key={JSON.stringify(item.path)}
          target={target} source={{ kind: "idb", dbName, storeName, key: row.key, ...item }} />)}
        {(viewJson || text !== undefined) && <div className="record-value-pane">
          {viewJson ? <JsonViewer key={row.id} text={text} />
            : <pre className="value-block value-block-framed">{text === "" ? <Typography.Text type="secondary">{t("（空字符串）")}</Typography.Text> : text}</pre>}
        </div>}
      </>}
    </div>;
  return pinned ? <aside className="record-inspector" aria-label={t("记录详情")}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && !working) {
        event.stopPropagation();
        close();
      }
    }}>
    <header className="inspector-header" ref={inspectorHeader} tabIndex={-1}>
      <div className="inspector-heading">{title}</div>
    </header>
    <div className="inspector-body"><div className="record-detail-shell" ref={detailContent}>{body}</div></div>
    <footer>{footer}</footer>
  </aside> : <WideModal className="record-detail-modal" size={modalSize}
    title={title} onCancel={close} footer={footer} keyboard={!working} closable={!working} maskClosable={!editing && !working}>
    <div className="record-detail-shell" ref={detailContent}>{body}</div>
  </WideModal>;
}

export default function Records({ target, section, kind, revision, automatic, density, workbench, working,
  refresh, setKind, showEditor, editor, showConfirm, openTransfer, copy, pendingNames, trackPending,
  baseline, rememberBaseline, undo, rememberUndo, forgetUndo, verify, onWebWrite }) {
  const { t, language } = usePreferences();
  const [dbName, setDbName] = useState(null);
  const [storeName, setStoreName] = useState(null);
  const [cacheName, setCacheName] = useState(null);
  const [query, setQuery] = useState("");
  const [activeRow, setActiveRow] = useState(null);
  const [selection, setSelection] = useState(() => new Set());
  const [webMode, setWebMode] = useState(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [advanced, setAdvanced] = useState(null);
  const [width, setWidth] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [page, setPage] = useState({ key: null, index: 0, cursors: [null] });
  const scroll = useRef(null);
  const savedScroll = useRef(0);
  const returnTo = useRef(null);
  const search = useRef(null);
  const layout = useRef(null);
  const canPin = workbench && width >= 960;
  const split = canPin && pinned;
  useLayoutEffect(() => {
    if (!layout.current) return;
    const observed = layout.current;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(observed);
    return () => observer.disconnect();
  }, []);
  const { catalog, stores, databases, caches, selectedDb } = useCatalog(target, section, revision, dbName, pendingNames);
  const selectedStore = stores.value?.find(({ name }) => name === storeName) ?? stores.value?.[0] ?? null;
  const selectedCache = caches.includes(cacheName) ? cacheName : caches[0] ?? null;
  const dbPending = pendingNames.has(selectedDb) || databases.some((db) => db.name === selectedDb && db.pending);
  const scope = { section, kind, dbName: selectedDb, storeName: dbPending ? null : selectedStore?.name ?? null, cacheName: selectedCache };
  const advancedFilter = advanced?.dbName === selectedDb && advanced?.storeName === scope.storeName ? advanced : null;
  const pageKey = JSON.stringify([scope, query, advancedFilter?.query]);
  const activePage = page.key === pageKey ? page : { key: pageKey, index: 0, cursors: [null] };
  const records = useRecordList(target, scope, revision, query.trim(), activePage.cursors[activePage.index], automatic, advancedFilter?.query);
  const storeCount = useCallback(() => runInPage(target, "idbCount", { dbName: selectedDb, storeName: scope.storeName }),
    [target, selectedDb, scope.storeName]);
  const count = useRead(section === "idb" && scope.storeName !== null ? JSON.stringify([selectedDb, scope.storeName, revision]) : null, storeCount);
  const catalogError = (section === "idb" || section === "cache") && catalog.status === "error" ? catalog.error : null;
  const missingScope = (section === "idb" && scope.storeName === null) || (section === "cache" && selectedCache === null);
  const scopeTitle = section === "storage" ? storageLabel(kind) : section === "cookies" ? "Cookies"
    : section === "cache" ? nameLabel(selectedCache, t) : `${nameLabel(selectedDb, t)} / ${nameLabel(scope.storeName, t)}`;
  const allRows = records.value?.rows ?? [];
  const searchTerm = query.trim().toLowerCase();
  const filtered = section === "idb" || !searchTerm ? allRows : allRows.filter((row) => [
    row.title, row.value, row.preview, row.cookie?.value,
  ].some((value) => value?.toLowerCase().includes(searchTerm)));
  const index = section === "idb" ? activePage.index : Math.min(activePage.index, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const rows = section === "idb" ? filtered : filtered.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
  const chosen = rows.filter((row) => selection.has(row.id));
  const hasNext = section === "idb" ? !!records.value?.next : (index + 1) * PAGE_SIZE < filtered.length;
  const catalogLoading = (section === "idb" || section === "cache") && (catalog.status === "loading" || catalog.refreshing);
  const busy = catalogLoading || (section === "idb" && selectedDb !== null && !dbPending && (stores.status === "loading" || stores.refreshing))
    || (!missingScope && records.status === "loading");
  const detailRow = activeRow?.scopeKey === JSON.stringify(scope) ? activeRow.row : null;

  const resetSelection = () => setSelection(new Set());
  const resetView = () => {
    resetSelection();
    setPage({ key: null, index: 0, cursors: [null] });
    if (scroll.current) scroll.current.scrollTop = 0;
  };
  useEffect(() => { setSelection(new Set()); }, [revision]);
  useEffect(() => {
    if (section !== "idb" || !catalog.value) return;
    const names = catalog.value.filter((database) => database.pending).map(({ name }) => name);
    if (names.length) trackPending(target, names);
  }, [catalog.value, section, target, trackPending]);
  useLayoutEffect(() => {
    if (!detailRow && returnTo.current !== null && scroll.current) {
      scroll.current.scrollTop = savedScroll.current;
      const previous = Array.from(scroll.current.querySelectorAll("[data-record]"))
        .find((element) => element.dataset.record === returnTo.current);
      (previous ?? search.current)?.focus({ preventScroll: true });
      returnTo.current = null;
    }
  }, [detailRow]);

  function openRow(row) {
    savedScroll.current = scroll.current?.scrollTop ?? 0;
    returnTo.current = row.id;
    setActiveRow({ scopeKey: JSON.stringify(scope), row });
  }
  function movePage(next) {
    const cursors = [...activePage.cursors];
    if (section === "idb" && next > index) cursors[next] = records.value.next;
    setPage({ key: pageKey, index: next, cursors });
    resetSelection();
    if (scroll.current) scroll.current.scrollTop = 0;
  }
  function toggleRow(id) {
    setSelection((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteRows(list, batch = false) {
    if (section === "idb") list = [...new Map(list.map((row) => [JSON.stringify(row.key), row])).values()];
    const count = list.length;
    const details = count === 1 ? nameLabel(list[0].title, t) : t("共 {count} 项", { count });
    showConfirm({
      target, title: count === 1 ? t("删除此记录？") : t("删除选中的 {count} 项？", { count }),
      scope: scopeTitle, details, label: t("删除"), focus: search,
      run: async (verify) => {
        if (section === "cache") {
          await runInPage(target, "cacheDeleteEntry", { cacheName: selectedCache, id: list[0].id });
          return { message: t("缓存条目已删除") };
        }
        if (section === "storage" && batch) {
          const deleted = await runInPage(target, "storageDeleteBatch", { kind,
            entries: list.map(({ id, value }) => ({ key: id, value })) });
          const entries = deleted.filter(({ status }) => status === "success")
            .map(({ name, original }) => ({ key: name, value: original, expected: null }));
          if (entries.length) rememberUndo(kind, entries);
          return { message: t("已删除 {done}/{count} 项", { done: entries.length, count }),
            results: deleted.map(({ name, status, detail }) => ({ name, status, detail })) };
        }
        const results = section === "cookies" ? await deleteCookies(target, list.map((row) => row.cookie), verify)
          : section === "storage" ? await runInPage(target, "storageDelete", { kind, keys: list.map(({ id }) => id) })
          : await runInPage(target, "idbDelete", { dbName: selectedDb, storeName: selectedStore.name, keys: list.map(({ key }) => key) });
        return { message: t("已删除 {done}/{count} 项", { done: results.filter(({ status }) => status === "success").length, count }), results };
      },
      after: () => { resetSelection(); setActiveRow(null); },
    });
  }
  function clearScope(database = false) {
    if (database) {
      showConfirm({
        target, title: t("删除 IndexedDB 数据库？"), scope: nameLabel(selectedDb, t),
        details: t("会删除此数据库及其中的所有对象仓库和记录。"), label: t("删除数据库"), focus: search,
        run: async () => {
          const result = await runInPage(target, "idbDeleteDatabase", { dbName: selectedDb });
          return { message: t("数据库已删除"), results: [{ name: selectedDb, ...result }], database: true };
        },
      });
      return;
    }
    const clear = section === "storage" ? "storageClear" : section === "idb" ? "idbClear" : "cacheDelete";
    showConfirm({
      target, title: section === "cache" ? t("删除整个 Cache？") : t("清空此存储区？"), focus: search,
      scope: scopeTitle, details: section === "cookies" ? t("当前有 {count} 个可访问的未分区 Cookie，清理也可能影响父域共享 Cookie。", { count: allRows.length })
        : section === "idb" ? t("此对象仓库内的全部记录都会被删除。")
          : t("此范围内的全部记录都会被删除，当前有 {count} 条。", { count: allRows.length }), label: section === "cache" ? t("删除缓存") : t("清空"),
      run: async (verify) => {
        if (section === "cookies") {
          const results = await deleteCookies(target, await getSiteCookies(target), verify);
          return { message: t("已删除 {done}/{count} 项", { done: results.filter(({ status }) => status === "success").length, count: results.length }), results };
        }
        await runInPage(target, clear, { kind, dbName: selectedDb, storeName: scope.storeName, cacheName: selectedCache });
        return { message: t(section === "cache" ? "缓存已删除" : "存储区已清空") };
      },
      after: resetSelection,
    });
  }

  const canCreate = section === "storage" || section === "cookies" || (section === "idb" && !missingScope);
  const edit = ({ row, detail } = {}) => showEditor({
    target, scope, row, detail, store: selectedStore, label: scopeTitle, focus: search, fromDetail: !!row,
    onSaved: row && section === "storage" ? (key) => {
      if (key === row.id) return;
      returnTo.current = key;
      setActiveRow((current) => current && { ...current, row: { ...current.row, id: key, title: key } });
    } : undefined,
  });
  const canClear = section === "storage" || section === "idb" || section === "cache" || allRows.length > 0;
  const listError = catalogError || (section === "idb" && !dbPending && selectedDb !== null && stores.status === "error" ? stores.error : null) ||
    (!missingScope && records.status === "error" ? records.error : null);
  const canUseMenu = !working && !busy && !editor && !listError && !records.refreshing && (!detailRow || split);
  const rowMenu = useActionMenu(JSON.stringify([pageKey, index, revision, detailRow?.id, canUseMenu, webMode, queryOpen]));
  const menuRow = rows.find((row) => row.id === rowMenu.request?.id);
  useEffect(() => {
    if (rowMenu.request && !menuRow) rowMenu.dismiss();
  }, [menuRow, rowMenu.request, rowMenu.dismiss]);
  const copyKeyLabel = section === "cache" ? "复制 URL" : section === "cookies" ? "复制名称" : "复制键";
  function runRowAction(action, id) {
    const current = rows.find((row) => row.id === id);
    if (!canUseMenu || !current) return;
    if (action === "view") openRow(current);
    if (action === "key") void copy(current.title);
    if (action === "value" && typeof (current.cookie?.value ?? current.value) === "string") {
      void copy(current.cookie?.value ?? current.value);
    }
    if (action === "delete") deleteRows([current]);
  }
  const matchText = (text, fallback = "") => text
    ? <SearchMatch text={text} query={query.trim()} /> : fallback;
  const columns = [
    ...(section !== "cache" ? [{
      key: "selected", width: 36, align: "center", className: "select-column",
      title: <Checkbox aria-label={t("全选当前页")} checked={rows.length > 0 && chosen.length === rows.length}
        indeterminate={chosen.length > 0 && chosen.length < rows.length} disabled={working || !rows.length}
        onChange={(event) => setSelection(new Set(event.target.checked ? rows.map(({ id }) => id) : []))} />,
      onCell: () => ({ onClick: (event) => event.stopPropagation() }),
      render: (_, row) => <Checkbox aria-label={t("选择 {name}", { name: nameLabel(row.title, t) })}
        checked={selection.has(row.id)} disabled={working} onChange={() => toggleRow(row.id)} />,
    }] : []),
    {
      title: section === "cookies" ? t("名称 / 值") : section === "cache" ? t("请求 URL") : t("键"),
      key: "title", width: section === "cache" ? undefined : advancedFilter?.query.indexName != null ? "34%" : "46%",
      render: (_, row) => <Button type="text" size="small" className="record-open" data-record={row.id}
        aria-label={t("查看 {name}", { name: nameLabel(row.title, t) })}
        aria-keyshortcuts="Shift+F10 ContextMenu" onKeyDown={(event) => {
          if (canUseMenu && menuShortcut(event)) rowMenu.open(event, row.id);
        }}
        onClick={(event) => { event.stopPropagation(); openRow(row); }}>
        <span className="cell-lines">
          <span className="cell-text" title={row.title}>{matchText(row.title, nameLabel(row.title, t))}</span>
          {section === "cookies" && <Typography.Text className="cell-text" type="secondary" title={row.cookie.value}>
            {matchText(row.cookie.value, t("（空值）"))}
          </Typography.Text>}
        </span>
      </Button>,
    },
    ...(advancedFilter?.query.indexName != null ? [{
      title: t("索引键"), dataIndex: "indexTitle", width: "28%",
      render: (value) => <span className="cell-text" title={value}>{value}</span>,
    }] : []),
    ...(section === "cookies" && width >= 600 ? [
      { title: t("到期时间"), key: "expires", width: width >= 960 && !split ? 160 : 110,
        render: (_, { cookie }) => <span className="cell-text">{cookie.session ? t("会话 Cookie")
          : new Date(cookie.expirationDate * 1000).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</span> },
      ...(width >= 960 && !split ? [{ title: t("属性"), key: "flags", width: 170, render: (_, { cookie }) =>
        [cookie.secure && "Secure", cookie.httpOnly && "HttpOnly", cookie.sameSite].filter(Boolean).join(" · ") }] : []),
    ] : []),
    {
      title: section === "cookies" ? t("域名 / 路径") : section === "cache" ? t("方法") : t("值"),
      key: "value", width: section === "cache" ? 56 : undefined,
      render: (_, row) => section === "cookies" ? <span className="cell-lines">
        <span className="cell-text" title={row.cookie.domain}>{matchText(row.cookie.domain)}</span>
        <Typography.Text type="secondary" className="cell-text" title={row.cookie.path}>{matchText(row.cookie.path)}</Typography.Text>
      </span> : <span className="cell-text" title={row.value ?? row.preview}>{matchText(row.value ?? row.preview, t("（空值）"))}</span>,
    },
    {
      key: "actions", width: 34, align: "center",
      render: (_, row) => <IconAction icon={<MoreOutlined />} label={t("记录操作")}
        aria-haspopup="menu" aria-expanded={menuRow?.id === row.id}
        disabled={!canUseMenu} onClick={(event) => rowMenu.open(event, row.id)}
        onKeyDown={(event) => { if (menuShortcut(event)) rowMenu.open(event, row.id); }} />,
    },
  ];

  return <>
      {webMode && <WebStorageTools mode={webMode} target={target} kind={kind} selected={chosen.map(({ id }) => id)}
        baseline={baseline} rememberBaseline={rememberBaseline} undo={undo}
        updateUndo={(entries) => { if (entries.length) rememberUndo(kind, entries); else forgetUndo(); }}
        verify={verify} onWrite={onWebWrite} onClose={() => setWebMode(null)} />}
      {queryOpen && <IdbQuery indexes={selectedStore?.indexes ?? []} previous={advancedFilter}
        onClose={() => setQueryOpen(false)} onApply={(next) => {
          setAdvanced({ ...next, dbName: selectedDb, storeName: scope.storeName }); resetView(); setQueryOpen(false);
        }} />}
      <div className="workspace-toolbar" inert={!!editor}>
        {section === "storage" && <Segmented block size="small" aria-label={t("Web Storage 存储区")} value={kind}
          options={[{ value: "local", label: "LocalStorage" }, { value: "session", label: "SessionStorage" }]} onChange={setKind} />}
        {section === "idb" && <div className="record-scopes">
          <Selector label={t("数据库")} value={selectedDb} names={databases.map((item) => ({
            ...item, label: `${nameLabel(item.name, t)} · v${item.version}${item.pending ? ` · ${t("等待完成")}` : ""}`,
          }))} onChange={(name) => { setDbName(name); setStoreName(null); setAdvanced(null); resetView(); }} />
          <Selector label={t("对象仓库")} value={scope.storeName} names={dbPending ? [] : stores.value ?? []}
            onChange={(name) => { setStoreName(name); setAdvanced(null); resetView(); }} />
        </div>}
        {section === "cache" && <Selector label="Cache" value={selectedCache} names={caches.map((name) => ({ name }))}
          onChange={(name) => { setCacheName(name); resetView(); }} />}
        <div className="find-row">
          <Input ref={search} size="small" className="search" prefix={<SearchOutlined />} allowClear
            aria-label={section === "cookies" ? t("搜索 Cookie 名称、值、域名或路径") : t("搜索记录")}
            placeholder={section === "cookies" ? t("搜索 Cookie") : section === "cache" ? t("搜索 URL") : t("搜索键或值")}
            value={query} onChange={(event) => { setQuery(event.target.value); resetView(); }} />
          <div className="action-strip" role="group" aria-label={t("当前存储区操作")}>
            {canCreate && <div className="action-group">
              <IconAction icon={<PlusOutlined />} label={t(section === "cookies" ? "新增 Cookie" : "新增记录")}
                aria-haspopup="dialog" onClick={() => edit()} disabled={working || !!listError}>
                <span className="wide-action-label">{t("新增")}</span>
              </IconAction>
            </div>}
            {section === "cookies" && <div className="action-group">
              <IconAction icon={<UploadOutlined />} label={t("导入 Cookie 备份")} aria-haspopup="dialog"
                disabled={working} onClick={() => openTransfer("import", search)} />
              <IconAction icon={<DownloadOutlined />} label={t("导出 Cookie")} aria-haspopup="dialog"
                disabled={working} onClick={() => openTransfer("export", search, chosen.map(({ id }) => id))} />
            </div>}
            {section === "storage" && <div className="action-group">
              <IconAction icon={<DiffOutlined />} label={t("存储变化对比")} onClick={() => setWebMode("diff")} disabled={working} />
              <IconAction icon={<UploadOutlined />} label={t("导入 Web Storage")} onClick={() => setWebMode("import")} disabled={working} />
              <IconAction icon={<DownloadOutlined />} label={t("导出 Web Storage")} onClick={() => setWebMode("export")} disabled={working} />
              {undo && <IconAction icon={<UndoOutlined />} label={t("撤销删除")} onClick={() => setWebMode("undo")} disabled={working} />}
            </div>}
            {section === "idb" && <div className="action-group">
              <IconAction type={advancedFilter ? "primary" : "text"} icon={<FilterOutlined />} label={t("IndexedDB 查询")}
                aria-haspopup="dialog" onClick={() => setQueryOpen(true)} disabled={working || busy || missingScope} />
            </div>}
            <div className="action-group">
              {section === "idb" && <IconAction danger icon={<DatabaseOutlined />} label={t("删除数据库")} aria-haspopup="dialog"
                disabled={working || selectedDb === null || dbPending || catalogLoading} onClick={() => clearScope(true)} />}
              <IconAction danger icon={<DeleteOutlined />} label={section === "cache" ? t("删除此 Cache") : t("清空此存储区")}
                aria-haspopup="dialog" disabled={working || busy || missingScope || !canClear || !!catalogError}
                onClick={() => clearScope()} />
            </div>
          </div>
        </div>
        {advancedFilter && <div className="active-filter-bar">
          <Tag color="processing">{t(advancedFilter.form.mode === "index" ? "索引" : advancedFilter.form.mode === "exact" ? "精确主键" : "主键范围")}
            {advancedFilter.query.indexName != null ? ` · ${nameLabel(advancedFilter.query.indexName, t)}` : ""}</Tag>
          <Button size="small" type="link" onClick={() => { setAdvanced(null); resetView(); }}>{t("清除查询")}</Button>
        </div>}
      </div>
      <div className="records-layout" ref={layout} data-split={split && !!detailRow || undefined}>
      <div className="records-list" inert={!!editor}>
      <div className="record-scroll" ref={scroll} aria-busy={busy}>
        {listError ? <StateMessage title={t("读取失败")} action={<Button onClick={refresh}>{t("重试")}</Button>}>{listError}</StateMessage>
          : busy ? <StateMessage title={t("正在读取存储")} busy />
          : dbPending ? <StateMessage title={t("等待数据库删除")}>{t("关闭仍使用此数据库的页面连接后，Chrome 会继续删除。")}</StateMessage>
          : missingScope ? <StateMessage title={section === "cache" ? t("没有 Cache") : selectedDb === null ? t("没有 IndexedDB 数据库") : t("此数据库没有对象仓库")} />
          : !rows.length ? <StateMessage title={searchTerm || advancedFilter ? t("没有匹配的记录") : t("这里还没有记录")}
            action={searchTerm && <Button onClick={() => { setQuery(""); resetView(); search.current?.focus(); }}>{t("清除搜索")}</Button>}>
            {section === "cookies" && !searchTerm ? t("此处仅显示目标站点可访问的未分区 Cookie。") : null}
          </StateMessage>
          : <Table className={`record-table${density === "compact" ? " compact-table" : ""}`}
            aria-label={t("记录列表")} dataSource={rows} rowKey="id" pagination={false} tableLayout="fixed"
            size={density === "compact" ? "small" : "middle"} columns={columns}
            onRow={(row) => ({
              onClick: () => openRow(row), onContextMenu: (event) => {
                const anchor = event.currentTarget.querySelector("[data-record]");
                if (canUseMenu && anchor) rowMenu.open(event, row.id, anchor);
              },
              "data-selected": selection.has(row.id) || undefined,
              "data-active": detailRow?.id === row.id || undefined,
            })} />}
      </div>
      <footer className="workspace-footer" data-selecting={chosen.length > 0 || undefined}>
        <Typography.Text role="status" type="secondary" className="workspace-count">{chosen.length > 0 ? t("已选 {count} 项", { count: chosen.length })
          : busy || records.refreshing ? t("正在读取…") : listError ? t("读取失败") : section === "idb" && rows.length ? t("第 {page} 页 · {count} 条", { page: index + 1, count: rows.length })
          : t(section === "cookies" ? "{count} 个 Cookie" : "{count} 条记录", { count: filtered.length })}</Typography.Text>
        {chosen.length > 0 && <div className="action-strip">
          <Button size="small" type="text" disabled={working} onClick={resetSelection}>{t("取消选择")}</Button>
          <Button size="small" danger aria-haspopup="dialog" disabled={working || busy}
            onClick={() => deleteRows(chosen, true)}>{t("删除所选")}</Button>
        </div>}
        {typeof count.value === "number" && <Typography.Text type="secondary">{t("仓库共 {count} 条", { count: count.value })}</Typography.Text>}
        {!busy && (index > 0 || hasNext) && <div className="page-controls">
          <IconAction icon={<LeftOutlined />} label={t("上一页")} disabled={index === 0} onClick={() => movePage(index - 1)} />
          <IconAction icon={<RightOutlined />} label={t("下一页")} disabled={!hasNext} onClick={() => movePage(index + 1)} />
        </div>}
      </footer>
      </div>
      {canUseMenu && menuRow && <ActionMenu request={rowMenu.request} label={t("记录菜单")}
        onDismiss={rowMenu.dismiss} onAction={runRowAction} items={[
          { key: "view", label: t("查看详情") },
          { key: "key", label: t(copyKeyLabel) },
          ...(typeof (menuRow.cookie?.value ?? menuRow.value) === "string" ? [{ key: "value", label: t("复制值") }] : []),
          { type: "divider" }, { key: "delete", label: t("删除"), danger: true },
        ]} />}
      {detailRow && <RecordDetail target={target} row={detailRow} scope={scope} copy={copy}
        currentRow={section === "storage" || section === "cookies" ? allRows.find((row) => row.id === detailRow.id) : undefined}
        listStatus={records} revision={revision} editor={editor} canPin={canPin} pinned={split} onPin={() => setPinned(!pinned)}
        onClose={() => setActiveRow(null)} onDelete={deleteRows} onEdit={edit} working={working} />}
      </div>
  </>;
}
