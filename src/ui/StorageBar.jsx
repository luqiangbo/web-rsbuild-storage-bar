import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DatabaseOutlined, DeleteOutlined, ExclamationCircleFilled, ExportOutlined,
  LockOutlined, ReloadOutlined, RollbackOutlined, SettingOutlined, UnlockOutlined, VideoCameraOutlined,
} from "@ant-design/icons";
import { Alert, App, Badge, Button, Checkbox, DatePicker, Input, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { cookieSameSite, deleteCookies, getSiteCookies, saveCookie } from "../api/cookies.js";
import { runInPage, verifyTarget } from "../api/page.js";
import Records, { StateMessage } from "./Records.jsx";
import { useTarget } from "./useTarget.js";
import CookieTransfer from "./CookieTransfer.jsx";
import IconAction from "./IconAction.jsx";
import JsonEditor from "./JsonEditor.jsx";
import { hasRoundedInteger, jsonError } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";
import MediaBrowser from "./MediaBrowser.jsx";
import WideModal from "./WideModal.jsx";
import useFeedback from "./useFeedback.jsx";

const sections = [
  ["cookies", "Cookies", "Cookies"],
  ["local", "LocalStorage", "Local"],
  ["session", "SessionStorage", "Session"],
  ["idb", "IndexedDB", "IDB"],
  ["cache", "Cache", "Cache"],
];
const isWebStorage = (section) => section === "local" || section === "session";
const categories = [
  ["idb", "IndexedDB"], ["cookies", "Cookies"], ["local", "LocalStorage"],
  ["session", "SessionStorage"], ["cache", "Cache Storage"],
];
const errorText = (error) => error?.message || String(error);
const editorForm = "storagebar-record-editor";
const sameSiteLabel = { unspecified: "未指定", strict: "Strict", lax: "Lax", no_restriction: "None" };

function tabOption(tab) {
  const url = new URL(tab.url);
  return { value: tab.id, label: url.host, origin: url.origin, title: tab.title || url.host };
}

const route = new URLSearchParams(location.search);
const workbench = route.get("view") === "workspace";
const sourceTab = route.get("target");
const initialTabId = workbench && /^\d+$/.test(sourceTab ?? "") && Number.isSafeInteger(Number(sourceTab)) ? Number(sourceTab) : null;
const rawRouteSection = route.get("section");
const resolvedRouteSection = rawRouteSection === "storage"
  ? (route.get("kind") === "session" ? "session" : "local")
  : rawRouteSection;
const initialSection = workbench && sections.some(([key]) => key === resolvedRouteSection) ? resolvedRouteSection : null;
const draftFields = ({ key, value, expiration, cookie }) => JSON.stringify([key, value, expiration, cookie]);

function expirationInput(cookie) {
  if (cookie?.session || cookie?.expirationDate == null) return "";
  const date = new Date(cookie.expirationDate * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

function outcomeStatus({ rows = [], error }) {
  if (error || rows.some(({ status }) => status === "failed")) {
    return rows.some(({ status }) => status === "success" || status === "pending") ? "部分失败" : "失败";
  }
  if (rows.some(({ status }) => status === "pending")) return "等待完成";
  if (rows.some(({ status }) => status === "skipped")) {
    return rows.some(({ status }) => status === "success") ? "部分完成" : "跳过";
  }
  return "已完成";
}

const outcomeColors = { 失败: "error", 部分失败: "error", 等待完成: "processing", 部分完成: "warning", 已完成: "success" };

function Outcome({ value }) {
  const { t } = usePreferences();
  const status = outcomeStatus(value);
  const details = value.rows?.filter(({ status }) => status !== "success") ?? [];
  return <div className="outcome">
    <Tag color={outcomeColors[status]}>{t(status)}</Tag>
    {value.error && <p>{t(value.error)}</p>}
    {details.map(({ name, detail, status: entryStatus }, index) => <p key={`${name}-${index}`}>
      {name || t("（空名称）")} · {t(detail ?? (entryStatus === "pending" ? "等待连接关闭" : "请刷新后检查结果"))}
    </p>)}
  </div>;
}

const outcomeColumns = (t) => [
  { title: t("范围"), dataIndex: "label", width: "42%", rowScope: "row" },
  { title: t("结果"), dataIndex: "value", render: (value) => <Outcome value={value} /> },
];

function Editor({ draft, setDraft, working, stale, savingError, save }) {
  const { t, language } = usePreferences();
  const { scope, store, row } = draft;
  const { section } = scope;
  const editing = !!row;
  const cookie = draft.cookie;
  const webStorage = isWebStorage(section);
  const needsKey = webStorage || (section === "idb" && !editing && store.keyPath === null);
  const renderKey = webStorage || section === "cookies" || needsKey;
  const set = (name, value) => setDraft((current) => ({ ...current, [name]: value }));
  const setJsonValue = useCallback((value) => setDraft((current) => ({ ...current, value })), [setDraft]);
  const setCookie = (name, value) => setDraft((current) => ({
    ...current, cookie: { ...current.cookie, [name]: value },
  }));
  const onFormKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!stale && !working) void save();
    }
  };
  const idbMeta = section === "idb" && !needsKey ? (editing
    ? t("主键 {key}", { key: row.title })
    : t(store.autoIncrement ? "键路径 {path} · 自动生成" : "键路径 {path}", { path: JSON.stringify(store.keyPath) })) : null;
  const keyLabel = section === "cookies" ? t("Cookie 名称") : section === "idb" ? t(store.autoIncrement ? "主键 (JSON)，可留空" : "主键 (JSON)") : t("键名");
  const inlineKeyInput = !cookie && renderKey ? (
    <Input size="small" className="data-input editor-key-input" aria-label={keyLabel}
      prefix={<span className="editor-key-prefix">{section === "idb" ? t("主键") : t("键名")}</span>}
      placeholder={section === "idb" ? t("字符串主键需要双引号，例如 \"user-1\"。") : t("键名")}
      value={draft.key} readOnly={stale || working} spellCheck={false}
      onChange={(event) => set("key", event.target.value)} />
  ) : null;
  const textDirty = draft.value !== draft.initialValue;
  return <form id={editorForm} className={`record-editor-form${cookie ? " is-cookie-form" : ""}`}
    onKeyDown={onFormKeyDown}
    onSubmit={(event) => { event.preventDefault(); if (!stale && !working) void save(); }}>
      {stale && <Alert className="form-alert" type="warning" title={t("目标已变化。可复制此草稿，保存已停用。")} showIcon />}
      {savingError && <Alert className="form-alert" type="error" title={t(savingError)} showIcon />}
      {cookie && renderKey && <label className="form-field">
        <span>{keyLabel}</span>
        <Input className="data-input" value={draft.key} readOnly={editing || stale || working}
          spellCheck={false} onChange={(event) => set("key", event.target.value)} />
      </label>}
      {draft.json ? <div className="form-field form-field-grow">
        <JsonEditor value={draft.value} original={draft.initialValue} readOnly={stale || working}
          onChange={setJsonValue} meta={idbMeta} leading={inlineKeyInput} />
      </div> : <>
        {!cookie && (inlineKeyInput || textDirty || idbMeta) && <div className="json-editor-bar">
          {inlineKeyInput ? <div className="json-editor-leading">{inlineKeyInput}</div>
            : <Typography.Text type="secondary" className="cell-text json-editor-meta">{idbMeta || t("值")}</Typography.Text>}
          {!stale && !working && textDirty && <div className="action-strip json-editor-actions" role="group" aria-label={t("编辑器操作")}>
            <IconAction icon={<RollbackOutlined />} label={t("还原修改")} onClick={() => set("value", draft.initialValue)} />
          </div>}
        </div>}
        <label className={`form-field${cookie ? "" : " form-field-grow"}`}>
          {cookie && <span>{t("值")}</span>}
          <Input.TextArea className={`data-input${cookie ? "" : " record-textarea"}`} aria-label={t("值")}
            rows={cookie ? 4 : 6} value={draft.value} readOnly={stale || working}
            spellCheck={false} onChange={(event) => set("value", event.target.value)} />
        </label>
      </>}
      {cookie && <>
        <div className="scope-fields">
          <label className="form-field"><span>{t("域名")}</span>
            <Input className="data-input" value={cookie.hostOnly ? draft.target.hostname : cookie.domain}
              readOnly={editing || stale || working || cookie.hostOnly}
              onChange={(event) => setCookie("domain", event.target.value)} />
          </label>
          <label className="form-field"><span>{t("路径")}</span>
            <Input className="data-input" value={cookie.path} readOnly={editing || stale || working}
              onChange={(event) => setCookie("path", event.target.value)} />
          </label>
        </div>
        <div className="form-field">
          <span>{t("属性")}</span>
          <div className="cookie-flags-row">
            <Checkbox checked={cookie.hostOnly} disabled={editing || stale || working}
              onChange={(event) => setCookie("hostOnly", event.target.checked)}>{t("仅限当前主机")}</Checkbox>
            <Checkbox checked={cookie.secure} disabled={stale || working}
              onChange={(event) => setCookie("secure", event.target.checked)}>Secure</Checkbox>
            <Checkbox checked={cookie.httpOnly} disabled={stale || working}
              onChange={(event) => setCookie("httpOnly", event.target.checked)}>HttpOnly</Checkbox>
          </div>
        </div>
        <div className="scope-fields">
          <div className="form-field"><span>SameSite</span>
            <Select aria-label="SameSite" value={cookie.sameSite} disabled={stale || working}
              options={cookieSameSite.map((value) => ({ value, label: t(sameSiteLabel[value]) }))}
              onChange={(value) => setCookie("sameSite", value)} />
          </div>
          <label className="form-field"><span>{t("到期时间（本地时间）")}</span>
            <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" disabled={stale || working} style={{ width: "100%" }}
              classNames={{ popup: { root: "cookie-expiration-popup" } }}
              value={draft.expiration ? dayjs(draft.expiration).locale(language === "zh" ? "zh-cn" : "en") : null}
              onChange={(value) => set("expiration", value?.format("YYYY-MM-DDTHH:mm:ss") ?? "")} />
            <small>{t("留空时保存为会话 Cookie。")}</small>
          </label>
        </div>
      </>}
    </form>;
}

export default function StorageBar() {
  const { prefs, savePrefs, t } = usePreferences();
  const { modal } = App.useApp();
  const [area, setArea] = useState(workbench && route.get("area") === "media" ? "media" : "storage");
  const [section, setSection] = useState(initialSection ?? prefs.section);
  const [revision, setRevision] = useState(0);
  const [mediaRevision, setMediaRevision] = useState(0);
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [draft, setDraft] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [report, setReport] = useState(null);
  const [opError, setOpError] = useState("");
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [webBaselines, setWebBaselines] = useState({});
  const [webUndo, setWebUndo] = useState(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const busy = useRef(false);
  const focusReturn = useRef(null);
  const settingsButton = useRef(null);
  const mediaLocation = useRef(null);
  const targetControl = useTarget(workbench, initialTabId);
  const { target, assertCurrent, notice: targetNotice, dismissNotice } = targetControl;
  const notify = useFeedback();
  const isReady = target.status === "ready";
  useEffect(() => {
    if (!targetNotice) return;
    notify(t(targetNotice.text, targetNotice.params), targetNotice.type);
    dismissNotice();
  }, [targetNotice, dismissNotice, notify, t]);
  useEffect(() => {
    setWebBaselines((previous) => {
      const entries = Object.entries(previous);
      const keep = entries.filter(([, baseline]) =>
        baseline.tabId === target.tabId && (target.status === "loading"
          ? !target.origin || baseline.origin === target.origin
          : isReady && baseline.origin === target.origin));
      return keep.length === entries.length ? previous : Object.fromEntries(keep);
    });
    setWebUndo((previous) => previous && isReady && previous.targetKey === target.key ? previous : null);
  }, [target.tabId, target.origin, target.status, target.key, isReady]);
  useEffect(() => {
    if (!workbench || target.status === "loading") return;
    const url = new URL(location.href);
    if (area === "media") url.searchParams.set("area", "media");
    else url.searchParams.delete("area");
    url.searchParams.set("section", section);
    url.searchParams.delete("kind");
    if (target.tabId == null) url.searchParams.delete("target");
    else url.searchParams.set("target", String(target.tabId));
    history.replaceState(null, "", url);
  }, [target.status, target.tabId, area, section]);
  const currentPending = pending && pending.target.key === target.key ? pending : null;
  const pendingNames = new Set(currentPending?.names);
  const bump = () => setRevision((value) => value + 1);
  const rememberFocus = (fallback) => { focusReturn.current = { element: document.activeElement, fallback }; };
  const openConfirm = (action) => { rememberFocus(action.focus); setOpError(""); setConfirm(action); };
  const overlayOpen = !!(settings || (draft && !draft.fromDetail) || (draft && draft.target.key !== target.key) ||
    confirm || report || transfer);
  useEffect(() => {
    if (overlayOpen || !focusReturn.current) return;
    const { element, fallback } = focusReturn.current;
    focusReturn.current = null;
    const fallbackElement = fallback?.current?.input ?? fallback?.current;
    const anchor = element instanceof HTMLElement && element !== document.body && element.isConnected
      ? element : fallbackElement?.isConnected ? fallbackElement : settingsButton.current;
    anchor?.focus({ preventScroll: true });
  }, [overlayOpen]);
  const trackPending = useCallback((captured, names) => {
    if (!names.length) return;
    setPending((current) => {
      const previous = current && current.target.key === captured.key ? current.names : [];
      if (names.every((name) => previous.includes(name))) return current;
      return { target: captured, names: [...new Set([...previous, ...names])] };
    });
  }, []);

  useEffect(() => {
    if (!currentPending) return;
    let active = true;
    let checking = false;
    let lastFailure;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const records = await runInPage(currentPending.target, "idbDeletionStatus", { names: currentPending.names });
        if (!active) return;
        lastFailure = undefined;
        const settled = records.filter(({ status }) => status === "success" || status === "failed");
        if (!settled.length) return;
        const merged = (rows) => rows.map((row) => row.status === "pending"
          ? settled.find(({ name }) => name === row.name) ?? row : row);
        setReport((last) => {
          if (!last || last.target.key !== currentPending.target.key) return last;
          return last.categories ? {
            ...last, categories: { ...last.categories, idb: { ...last.categories.idb, rows: merged(last.categories.idb.rows) } },
          } : last.database ? { ...last, results: merged(last.results) } : last;
        });
        const failed = settled.filter(({ status }) => status === "failed");
        notify(failed.length ? failed.map(({ name, detail }) => t("{name} 删除失败：{error}", { name, error: t(detail) })).join("; ")
          : t("已完成 {count} 个 IndexedDB 数据库的删除", { count: settled.length }), failed.length ? "error" : "success");
        const remaining = records.filter(({ status }) => status === "pending").map(({ name }) => name);
        setPending(remaining.length ? { ...currentPending, names: remaining } : null);
        bump();
      } catch (error) {
        if (!active) return;
        const detail = errorText(error);
        if (lastFailure !== detail) {
          lastFailure = detail;
          notify(t("无法读取数据库删除进度：{error}", { error: t(detail) }), "error");
        }
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(check, 2000);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [currentPending, notify, t]);

  function refresh() {
    if (isReady) {
      if (area === "media") setMediaRevision((value) => value + 1);
      else {
        bump();
        void targetControl.read({ invalidate: false });
      }
    } else {
      void targetControl.read();
    }
  }
  async function openAccessSettings() {
    try {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    } catch (error) {
      notify(t(errorText(error)), "error");
    }
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify(t("已复制"));
    } catch (error) {
      notify(t("复制失败：{error}", { error: t(errorText(error)) }), "error");
    }
  }
  function showEditor(action) {
    const { scope, row, detail } = action;
    const webStorage = isWebStorage(scope.section);
    const value = scope.section === "idb" ? detail ? JSON.stringify(JSON.parse(detail.text), null, 2) : "{}"
      : row?.cookie?.value ?? row?.value ?? "";
    if (!action.fromDetail) rememberFocus(action.focus);
    setOpError("");
    const cookie = scope.section === "cookies" ? row?.cookie ?? {
      domain: action.target.hostname, path: "/", hostOnly: true, secure: action.target.protocol === "https:",
      httpOnly: false, sameSite: "unspecified",
    } : null;
    const next = { ...action, cookie, key: cookie?.name ?? (webStorage ? row?.id ?? "" : ""),
      value, expiration: expirationInput(row?.cookie) };
    setDraft({ ...next, original: draftFields(next), initialValue: value,
      json: scope.section === "idb" || (webStorage && !!row && !jsonError(value)) });
  }
  const verify = useCallback(async (captured) => {
    await targetControl.verifySelection(captured);
    return verifyTarget(captured, () => assertCurrent(captured));
  }, [targetControl.verifySelection, assertCurrent]);
  async function mutate(captured, action, finish) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setOpError("");
    try {
      await verify(captured);
      const output = await action(() => verify(captured));
      finish(output);
      bump();
    } catch (error) {
      setOpError(errorText(error));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  async function saveEditor() {
    const { target: captured, scope, row, value, key, store, detail, expiration, cookie } = draft;
    await mutate(captured, async (verify) => {
      if (isWebStorage(scope.section)) {
        await runInPage(captured, "storageSave", { kind: scope.section, key, value, ...(row ? { originalKey: row.id, original: row.value } : {}) });
      } else if (scope.section === "cookies") {
        const unchangedExpiration = row && expiration === expirationInput(row.cookie);
        const seconds = unchangedExpiration ? row.cookie.expirationDate
          : expiration ? new Date(expiration).getTime() / 1000 : undefined;
        if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= Date.now() / 1000)) {
          throw new Error("请选择未来的到期时间，或清空此字段");
        }
        const output = await saveCookie(captured, { ...cookie, name: key, value,
          domain: cookie.hostOnly ? captured.hostname : cookie.domain, expirationDate: seconds }, row?.cookie, verify);
        return output.detail ? `${t("Cookie 已保存")} · ${t(output.detail)}` : t("Cookie 已保存");
      } else {
        const error = jsonError(value);
        if (error) throw new Error(t(error.line == null ? "JSON 格式无效" : "JSON 格式错误（第 {line} 行，第 {column} 列）", error));
        if (hasRoundedInteger(value)) throw new Error(t("此整数无法无损存入 IndexedDB，请使用字符串表示。"));
        const args = { dbName: scope.dbName, storeName: scope.storeName, json: value };
        if (row) {
          args.primaryKey = row.key;
          args.original = detail.text;
        } else if (store.keyPath === null) {
          if (!key.trim() && !store.autoIncrement) throw new Error("此对象仓库需要主键");
          if (key.trim()) {
            const keyError = jsonError(key);
            if (keyError) throw new Error(t(keyError.line == null ? "JSON 格式无效" : "JSON 格式错误（第 {line} 行，第 {column} 列）", keyError));
            if (hasRoundedInteger(key)) throw new Error(t("此整数无法无损存入 IndexedDB，请使用字符串表示。"));
            args.keyJson = key;
          }
        }
        await runInPage(captured, "idbSave", args);
      }
      return t("已保存更改");
    }, (message) => {
      draft.onSaved?.(key);
      setDraft(null);
      notify(message);
    });
  }
  function clearSite() {
    openConfirm({
      target, title: t("清理当前站点的存储？"), label: t("清理站点"), focus: settingsButton,
      scope: "IndexedDB、LocalStorage、SessionStorage、Cookies 和 Cache Storage",
      details: t("SessionStorage 仅清理此标签页。Cookies 覆盖此标签页存储区中已授权的相关未分区 Cookie，可能包含共享的父域 Cookie。"),
      run: async (verify) => {
        const [page, cookies] = await Promise.allSettled([
          runInPage(target, "pageClear"),
          (async () => {
            const list = await getSiteCookies(target);
            return { rows: await deleteCookies(target, list, verify) };
          })(),
        ]);
        const outcomes = {};
        for (const [key] of categories) {
          outcomes[key] = key === "cookies"
            ? cookies.status === "fulfilled" ? cookies.value : { error: errorText(cookies.reason) }
            : page.status === "fulfilled" ? page.value[key] : { error: errorText(page.reason) };
        }
        return { categories: outcomes };
      },
    });
  }
  async function runConfirmed() {
    const action = confirm;
    await mutate(action.target, action.run, (output) => {
      setConfirm(null);
      action.after?.();
      const records = output.categories?.idb.rows ?? (output.database ? output.results : []);
      const names = records.filter(({ status }) => status === "pending").map(({ name }) => name);
      trackPending(action.target, names);
      const incomplete = output.results?.some(({ status }) => status !== "success");
      if (output.categories || incomplete) setReport({ ...output, title: output.categories ? t("站点清理结果") : action.title.replace(/[？?]$/, ""), target: action.target });
      else notify(output.message || t("已完成"));
    });
  }
  function saveSettings(event) {
    event.preventDefault();
    try {
      savePrefs(settings);
      setSettings(null);
      notify(t("设置已保存"));
    } catch (error) {
      setSettingsError(t("无法保存设置：{error}", { error: t(errorText(error)) }));
    }
  }
  const tabOptions = targetControl.tabs.map(tabOption);
  const currentTab = tabOptions.find(({ value }) => value === target.tabId);
  const targetOrigin = target.origin || currentTab?.origin;
  const draftStale = draft && (!isReady || draft.target.key !== target.key);
  const inlineDraft = draft?.fromDetail && !draftStale && draft.scope.section === section;
  const closeEditor = () => {
    if (working) return;
    if (draftFields(draft) === draft.original) { setDraft(null); return; }
    modal.confirm({
      title: t("放弃未保存的更改？"), okText: t("放弃更改"), cancelText: t("继续编辑"),
      okButtonProps: { danger: true }, onOk: () => setDraft(null),
      centered: true, mask: { blur: true }, width: "min(400px, calc(100vw - 24px))",
    });
  };
  async function openWorkbench() {
    const url = new URL(chrome.runtime.getURL("index.html"));
    url.searchParams.set("view", "workspace");
    if (area === "media") url.searchParams.set("area", "media");
    url.searchParams.set("section", section);
    if (target.tabId != null && target.origin) url.searchParams.set("target", String(target.tabId));
    try { await chrome.tabs.create({ url: url.href }); }
    catch (error) { notify(t("无法打开独立标签页：{error}", { error: errorText(error) }), "error"); }
  }
  const draftDirty = !!draft && draftFields(draft) !== draft.original;
  const editor = draft && {
    title: draft.row ? t("编辑记录") : draft.cookie ? t("新增 Cookie") : t("新增记录"),
    size: draft.json ? "lg" : "md",
    body: <Editor draft={draft} setDraft={setDraft} working={working} stale={draftStale} savingError={opError} save={saveEditor} />,
    footer: <>
      <span className="editor-footer-hint">
        {draftDirty ? <><span className="editor-dirty-dot" aria-hidden="true" /><span>{t("已修改")}</span></>
          : !draftStale && <span>Ctrl+S {t("保存")}</span>}
      </span>
      <div className="detail-actions">
        <Button key="cancel" disabled={working} onClick={closeEditor}>{t("取消")}</Button>
        {draftStale ? <Button key="copy" onClick={() => copy(draft.value)}>{t("复制草稿")}</Button>
          : <Button key="save" form={editorForm} htmlType="submit" type="primary" loading={working}>
            {working ? t("正在保存…") : t("保存更改")}
          </Button>}
      </div>
    </>,
    onCancel: closeEditor,
  };
  const confirmStale = confirm && (!isReady || confirm.target.key !== target.key);
  const targetStatus = target.status === "loading" ? targetControl.waiting
    ? <StateMessage title={t("正在等待网页导航")}
      action={<Button onClick={refresh}>{t("重试")}</Button>}>{t("网页可访问后会自动显示数据。")}</StateMessage>
    : <StateMessage title={t("正在定位标签页")} busy />
    : target.status === "permission" ? <StateMessage title={t("Chrome 未授予此站点访问权限")}
      action={<div className="detail-actions">
        <Button type="primary" onClick={() => void openAccessSettings()}>{t("打开站点访问设置")}</Button>
        <Button onClick={refresh}>{t("重试")}</Button>
      </div>}>{t("在 Chrome 扩展详情中允许访问此站点，或选择「在所有网站上」。")}</StateMessage>
    : <StateMessage title={t("无法访问目标页面")} action={target.status === "access-error" &&
      <Button onClick={refresh}>{t("重试")}</Button>}>{target.reason}</StateMessage>;
  const webKind = section === "session" ? "session" : "local";
  const workspace = <section className="workspace" aria-label={t("存储记录")}>
    {isReady ? <Records key={JSON.stringify([target.key, section])}
      target={target} section={section} revision={revision}
      automatic={prefs.automatic} density={prefs.density} workbench={workbench} working={working} refresh={refresh} copy={copy}
      showEditor={showEditor} editor={inlineDraft ? editor : null} showConfirm={openConfirm}
      openTransfer={(mode, focus, selectedKeys) => { rememberFocus(focus); setTransfer({ mode, target, selectedKeys }); }}
      baseline={webBaselines[webKind]?.tabId === target.tabId && webBaselines[webKind]?.origin === target.origin ? webBaselines[webKind] : null}
      rememberBaseline={(area, value) => setWebBaselines((old) => ({ ...old, [area]: { ...value, tabId: target.tabId, origin: target.origin } }))}
      undo={webUndo?.targetKey === target.key && webUndo?.kind === webKind ? webUndo : null}
      rememberUndo={(area, entries) => setWebUndo({ targetKey: target.key, kind: area, entries })}
      forgetUndo={() => setWebUndo(null)} verify={verify} onWebWrite={bump}
      pendingNames={pendingNames} trackPending={trackPending} /> : targetStatus}
  </section>;
  const showMedia = area === "media";
  const workspaceSwitch = <div className="workspace-switch" role="group" aria-label={t("工作区")}>
    <IconAction icon={<DatabaseOutlined />} label={t("本地存储")} aria-pressed={!showMedia}
      aria-controls="storagebar-workspace" disabled={!!draft || working} onClick={() => setArea("storage")} />
    <IconAction icon={<VideoCameraOutlined />} label={t("本地媒体")} aria-pressed={showMedia}
      aria-controls="storagebar-workspace" disabled={!!draft || working} onClick={() => setArea("media")} />
  </div>;

  return <main className="app-shell" data-surface={workbench ? "workspace" : "panel"}>
    <header className="app-header">
      {workspaceSwitch}
      <Space.Compact size="small" className="target-picker">
        <Tooltip title={targetPickerOpen ? null : targetOrigin} trigger={["hover", "focus"]}>
          <Select size="small" className="target-select" aria-label={targetOrigin ? t("目标标签页，{origin}", { origin: targetOrigin }) : t("目标标签页")}
            value={currentTab?.value}
            prefix={<Badge status={isReady ? "success" : "default"} aria-hidden="true" />}
            placeholder={target.status === "loading" ? t("正在定位标签页…") : target.tabId == null ? t("选择标签页") : t("当前页不可访问")}
            options={tabOptions} popupMatchSelectWidth={240} onOpenChange={setTargetPickerOpen}
            optionRender={({ data: option }) => <span className="cell-lines">
              <span className="cell-text" title={option.title}>{option.title}</span>
              <Typography.Text type="secondary" className="cell-text" title={option.origin}>{option.origin}</Typography.Text>
            </span>}
            onChange={targetControl.select} />
        </Tooltip>
        {workbench ? currentTab && <IconAction type="default" className="target-lock" icon={<LockOutlined />}
          label={t("工作台已锁定目标")} aria-disabled="true" />
          : <IconAction type="default" className="target-lock" aria-pressed={targetControl.locked}
          icon={targetControl.locked ? <LockOutlined /> : <UnlockOutlined />}
          label={targetControl.locked ? t("已锁定，点击恢复跟随") : t("跟随中，点击锁定当前标签页")}
          disabled={target.tabId == null} onClick={targetControl.toggle} />}
      </Space.Compact>
      <div className="action-strip" role="group" aria-label={t("侧栏操作")}>
        <div className="action-group">
          <IconAction icon={<ReloadOutlined />} label={t("刷新")} onClick={refresh} disabled={working} />
          {!workbench && <IconAction icon={<ExportOutlined />} label={t("在新标签页打开")} onClick={() => void openWorkbench()} />}
          <IconAction icon={<SettingOutlined />} label={t("设置")} aria-haspopup="dialog" ref={settingsButton}
            onClick={() => { rememberFocus(settingsButton); setSettingsError(""); setSettings({ ...prefs }); }} />
        </div>
        <div className="action-group">
          <IconAction danger icon={<DeleteOutlined />} label={t("清理当前站点")} aria-haspopup="dialog"
            disabled={!isReady || working} onClick={clearSite} />
        </div>
      </div>
    </header>
    <div className="workspace-surface" id="storagebar-workspace">
      {showMedia ? <section className="workspace workspace-media-content" aria-label={t("本地媒体")}>
        {isReady ? <MediaBrowser key={target.key} target={target} refreshVersion={mediaRevision}
          initialLocation={mediaLocation.current?.targetKey === target.key ? mediaLocation.current : null}
          onLocationChange={(location) => { mediaLocation.current = { targetKey: target.key, ...location }; }} /> : targetStatus}
      </section> : <Tabs className="storage-tabs" size="small" tabBarGutter={10} activeKey={section} onChange={setSection}
        destroyOnHidden items={sections.map(([key, label, shortLabel]) => ({
          key,
          label: <span className="tab-label" title={t(label)}>
            <span className="tab-label-full">{t(label)}</span>
            <span className="tab-label-short">{t(shortLabel)}</span>
          </span>,
          disabled: !!draft && key !== section,
          children: key === section ? workspace : null,
        }))} />}
    </div>
    {editor && !inlineDraft && <WideModal className="record-detail-modal" size={editor.size}
      title={editor.title} onCancel={editor.onCancel}
      footer={<div className="detail-actions record-edit-actions">{editor.footer}</div>}
      closable={!working} keyboard={!working}>
      <div className={`record-editor-scroll${draft?.cookie ? " is-scrollable-form" : ""}`}>{editor.body}</div>
    </WideModal>}
    {transfer && <CookieTransfer mode={transfer.mode} target={transfer.target} stale={!isReady || transfer.target.key !== target.key}
      verify={verify} onClose={() => setTransfer(null)} onWrite={bump} selectedKeys={transfer.selectedKeys} />}
    {confirm && <WideModal size="sm" className="confirm-modal"
      title={<span className="confirm-title"><ExclamationCircleFilled className="confirm-title-icon" aria-hidden="true" /><span>{confirm.title}</span></span>}
      onCancel={() => setConfirm(null)}
      closable={!working} keyboard={!working} footer={[
        <Button key="cancel" disabled={working} onClick={() => setConfirm(null)}>{t("取消")}</Button>,
        <Button key="confirm" type="primary" danger loading={working} disabled={confirmStale}
          onClick={() => void runConfirmed()}>{working ? t("正在执行…") : confirm.label}</Button>,
      ]}>
      <div className="dialog-stack">
        <div className="modal-target-card">
          <Typography.Text className="modal-target-origin">{confirm.target.origin}</Typography.Text>
          <Typography.Text type="secondary" className="modal-target-scope">{confirm.scope}</Typography.Text>
        </div>
        <Typography.Paragraph className="confirm-summary">{confirm.details}</Typography.Paragraph>
        {confirmStale && <Alert type="warning" title={t("目标已变化。请关闭确认框后重新选择操作。")} showIcon />}
        {opError && <Alert type="error" title={t(opError)} showIcon />}
      </div>
    </WideModal>}
    {report && <WideModal size="md" title={report.title} subtitle={report.target.origin} maskClosable
      onCancel={() => setReport(null)}
      footer={<Button type="primary" onClick={() => setReport(null)}>{t("关闭")}</Button>}>
      <div className="metadata-card">
        <Table className="compact-table" size="small" tableLayout="fixed" pagination={false} columns={outcomeColumns(t)}
          rowKey="label" dataSource={report.categories ? categories.map(([key, label]) => ({ label, value: report.categories[key] }))
            : [{ label: report.database ? "IndexedDB" : report.message, value: { rows: report.results } }]} />
      </div>
    </WideModal>}
    {settings && <WideModal size="sm" className="settings-modal" title={t("设置")} maskClosable
      onCancel={() => setSettings(null)} footer={[
        <Button key="cancel" onClick={() => setSettings(null)}>{t("取消")}</Button>,
        <Button key="save" type="primary" htmlType="submit" form="storagebar-settings">{t("保存")}</Button>,
      ]}>
      <form id="storagebar-settings" className="settings-form" onSubmit={saveSettings}>
        <div className="settings-section">
          <Typography.Text type="secondary" className="settings-section-title">{t("外观")}</Typography.Text>
          <div className="scope-fields">
            <div className="form-field"><span>{t("主题")}</span>
              <Select aria-label={t("主题")} value={settings.theme} options={[
                { value: "system", label: t("跟随系统") }, { value: "light", label: t("浅色") }, { value: "dark", label: t("深色") },
              ]} onChange={(value) => setSettings({ ...settings, theme: value })} />
            </div>
            <div className="form-field"><span>{t("语言")}</span>
              <Select aria-label={t("语言")} value={settings.language} options={[
                { value: "system", label: t("跟随 Chrome") }, { value: "zh", label: t("简体中文") }, { value: "en", label: t("英文") },
              ]} onChange={(value) => setSettings({ ...settings, language: value })} />
            </div>
          </div>
          <div className="scope-fields">
            <div className="form-field"><span>{t("列表密度")}</span>
              <Select aria-label={t("列表密度")} value={settings.density} options={[
                { value: "compact", label: t("紧凑") }, { value: "comfortable", label: t("舒展") },
              ]} onChange={(value) => setSettings({ ...settings, density: value })} />
            </div>
            <div className="form-field"><span>{t("数据字体")}</span>
              <Select aria-label={t("数据字体")} value={settings.font}
                options={[
                  { value: "auto", label: t("自动") }, { value: "cascadia", label: "Cascadia Mono" },
                  { value: "consolas", label: "Consolas" }, { value: "jetbrains", label: "JetBrains Mono" },
                ]} onChange={(value) => setSettings({ ...settings, font: value })} />
            </div>
          </div>
        </div>
        <div className="settings-section">
          <Typography.Text type="secondary" className="settings-section-title">{t("行为")}</Typography.Text>
          <div className="form-field"><span>{t("打开时的默认分类")}</span>
            <Select aria-label={t("打开时的默认分类")} value={settings.section}
              options={sections.map(([value, label]) => ({ value, label: t(label) }))} onChange={(value) => setSettings({ ...settings, section: value })} />
          </div>
          <label className="settings-toggle-row">
            <span className="settings-toggle-text">
              <span>{t("自动刷新 Web Storage")}</span>
            </span>
            <Switch size="small" checked={settings.automatic} aria-label={t("自动刷新 Web Storage")}
              onChange={(checked) => setSettings({ ...settings, automatic: checked })} />
          </label>
        </div>
        {settingsError && <Alert className="form-alert" type="error" title={settingsError} showIcon />}
      </form>
    </WideModal>}
  </main>;
}
