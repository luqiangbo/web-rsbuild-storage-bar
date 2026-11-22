import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DeleteOutlined, ExportOutlined, LockOutlined, ReloadOutlined, SettingOutlined, UnlockOutlined, VideoCameraOutlined,
} from "@ant-design/icons";
import { Alert, App, Badge, Button, Checkbox, DatePicker, Input, Select, Table, Tabs, Tag, Tooltip, Typography } from "antd";
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
  ["idb", "IndexedDB"], ["cookies", "Cookies"], ["storage", "Storage"], ["cache", "Cache"],
];
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
const initialSection = workbench && sections.some(([key]) => key === route.get("section")) ? route.get("section") : null;
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
  const needsKey = section === "storage" || (section === "idb" && !editing && store.keyPath === null);
  const renderKey = section === "storage" || section === "cookies" || needsKey;
  const set = (name, value) => setDraft((current) => ({ ...current, [name]: value }));
  const setJsonValue = useCallback((value) => setDraft((current) => ({ ...current, value })), [setDraft]);
  const setCookie = (name, value) => setDraft((current) => ({
    ...current, cookie: { ...current.cookie, [name]: value },
  }));
  return <form id={editorForm} onSubmit={(event) => { event.preventDefault(); if (!stale && !working) void save(); }}>
      <p className="modal-origin">{draft.target.origin}<br />{draft.label}</p>
      {stale && <Alert className="form-alert" type="warning" title={t("目标已变化。可复制此草稿，保存已停用。")} showIcon />}
      {savingError && <Alert className="form-alert" type="error" title={t(savingError)} showIcon />}
      {renderKey && <label className="form-field">
        <span>{section === "cookies" ? t("Cookie 名称") : section === "idb" ? t(store.autoIncrement ? "主键 (JSON)，可留空" : "主键 (JSON)") : t("键名")}</span>
        <Input className="data-input" value={draft.key} readOnly={(section === "cookies" && editing) || stale || working}
          spellCheck={false} onChange={(event) => set("key", event.target.value)} />
        {section === "idb" && <small>{t("字符串主键需要双引号，例如 \"user-1\"。")}</small>}
      </label>}
      {section === "idb" && !needsKey && <p className="form-hint">{editing
        ? t("主键 {key} · 编辑时保留原主键", { key: row.title })
        : t(store.autoIncrement ? "键路径 {path} · 支持自动生成" : "键路径 {path}", { path: JSON.stringify(store.keyPath) })}</p>}
      {draft.json ? <div className="form-field"><span>{t("值 (JSON)")}</span>
        <JsonEditor value={draft.value} original={draft.initialValue} readOnly={stale || working} onChange={setJsonValue} />
      </div> : <label className="form-field"><span>{t("值")}</span>
        <Input.TextArea className="data-input" rows={5} value={draft.value} readOnly={stale || working}
          spellCheck={false} onChange={(event) => set("value", event.target.value)} />
      </label>}
      {cookie && <>
        <div className="scope-fields">
          <label className="form-field"><span>{t("域名")}</span>
            <Input value={cookie.hostOnly ? draft.target.hostname : cookie.domain}
              readOnly={editing || stale || working || cookie.hostOnly}
              onChange={(event) => setCookie("domain", event.target.value)} />
          </label>
          <label className="form-field"><span>{t("路径")}</span>
            <Input value={cookie.path} readOnly={editing || stale || working}
              onChange={(event) => setCookie("path", event.target.value)} />
          </label>
        </div>
        <div className="form-field">
          <Checkbox checked={cookie.hostOnly} disabled={editing || stale || working}
            onChange={(event) => setCookie("hostOnly", event.target.checked)}>{t("仅限当前主机")}</Checkbox>
          <Checkbox checked={cookie.secure} disabled={stale || working}
            onChange={(event) => setCookie("secure", event.target.checked)}>Secure</Checkbox>
          <Checkbox checked={cookie.httpOnly} disabled={stale || working}
            onChange={(event) => setCookie("httpOnly", event.target.checked)}>HttpOnly</Checkbox>
        </div>
        <div className="form-field"><span>SameSite</span>
          <Select aria-label="SameSite" value={cookie.sameSite} disabled={stale || working}
            options={cookieSameSite.map((value) => ({ value, label: t(sameSiteLabel[value]) }))}
            onChange={(value) => setCookie("sameSite", value)} />
        </div>
        <label className="form-field"><span>{t("到期时间（本地时间）")}</span>
          <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" disabled={stale || working}
            classNames={{ popup: { root: "cookie-expiration-popup" } }}
            value={draft.expiration ? dayjs(draft.expiration).locale(language === "zh" ? "zh-cn" : "en") : null}
            onChange={(value) => set("expiration", value?.format("YYYY-MM-DDTHH:mm:ss") ?? "")} />
          <small>{t("留空时保存为会话 Cookie。")}</small>
        </label>
      </>}
    </form>;
}

export default function StorageBar() {
  const { prefs, savePrefs, t } = usePreferences();
  const { modal } = App.useApp();
  const [section, setSection] = useState(initialSection ?? prefs.section);
  const [kind, setKind] = useState(workbench && route.get("kind") === "session" ? "session" : "local");
  const [revision, setRevision] = useState(0);
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
  const [mediaTarget, setMediaTarget] = useState(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const busy = useRef(false);
  const focusReturn = useRef(null);
  const settingsButton = useRef(null);
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
    url.searchParams.set("section", section);
    if (section === "storage") url.searchParams.set("kind", kind);
    else url.searchParams.delete("kind");
    if (target.tabId == null) url.searchParams.delete("target");
    else url.searchParams.set("target", String(target.tabId));
    history.replaceState(null, "", url);
  }, [target.status, target.tabId, section, kind]);
  const currentPending = pending && pending.target.key === target.key ? pending : null;
  const pendingNames = new Set(currentPending?.names);
  const bump = () => setRevision((value) => value + 1);
  const rememberFocus = (fallback) => { focusReturn.current = { element: document.activeElement, fallback }; };
  const openConfirm = (action) => { rememberFocus(action.focus); setOpError(""); setConfirm(action); };
  const overlayOpen = !!(settings || (draft && !draft.fromDetail) || (draft && draft.target.key !== target.key) ||
    confirm || report || transfer || mediaTarget);
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
      bump();
      void targetControl.read({ invalidate: false });
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
    const value = scope.section === "idb" ? detail ? JSON.stringify(JSON.parse(detail.text), null, 2) : "{}"
      : row?.cookie?.value ?? row?.value ?? "";
    if (!action.fromDetail) rememberFocus(action.focus);
    setOpError("");
    const cookie = scope.section === "cookies" ? row?.cookie ?? {
      domain: action.target.hostname, path: "/", hostOnly: true, secure: action.target.protocol === "https:",
      httpOnly: false, sameSite: "unspecified",
    } : null;
    const next = { ...action, cookie, key: cookie?.name ?? (scope.section === "storage" ? row?.id ?? "" : ""),
      value, expiration: expirationInput(row?.cookie) };
    setDraft({ ...next, original: draftFields(next), initialValue: value,
      json: scope.section === "idb" || (scope.section === "storage" && !!row && !jsonError(value)) });
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
      if (scope.section === "storage") {
        await runInPage(captured, "storageSave", { kind: scope.kind, key, value, ...(row ? { originalKey: row.id, original: row.value } : {}) });
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
  const inlineDraft = draft?.fromDetail && !draftStale && draft.scope.section === section &&
    (section !== "storage" || draft.scope.kind === kind);
  const closeEditor = () => {
    if (working) return;
    if (draftFields(draft) === draft.original) { setDraft(null); return; }
    modal.confirm({
      title: t("放弃未保存的更改？"), okText: t("放弃更改"), cancelText: t("继续编辑"),
      okButtonProps: { danger: true }, onOk: () => setDraft(null), width: "min(480px, calc(100vw - 16px))",
    });
  };
  async function openWorkbench() {
    const url = new URL(chrome.runtime.getURL("index.html"));
    url.searchParams.set("view", "workspace");
    url.searchParams.set("section", section);
    if (section === "storage") url.searchParams.set("kind", kind);
    if (target.tabId != null && target.origin) url.searchParams.set("target", String(target.tabId));
    try { await chrome.tabs.create({ url: url.href }); }
    catch (error) { notify(t("无法打开独立标签页：{error}", { error: errorText(error) }), "error"); }
  }
  const editor = draft && {
    title: draft.row ? t("编辑记录") : draft.cookie ? t("新增 Cookie") : t("新增记录"),
    body: <Editor draft={draft} setDraft={setDraft} working={working} stale={draftStale} savingError={opError} save={saveEditor} />,
    footer: [
      <Button key="cancel" disabled={working} onClick={closeEditor}>{t("取消")}</Button>,
      draftStale ? <Button key="copy" onClick={() => copy(draft.value)}>{t("复制草稿")}</Button>
        : <Button key="save" form={editorForm} htmlType="submit" type="primary" loading={working}>
          {working ? t("正在保存…") : t("保存更改")}
        </Button>,
    ],
    onCancel: closeEditor,
  };
  const confirmStale = confirm && (!isReady || confirm.target.key !== target.key);
  const workspace = <section className="workspace" aria-label={t("存储记录")}>
    {isReady ? <Records key={JSON.stringify([target.key, section, section === "storage" ? kind : null])}
      target={target} section={section} kind={kind} setKind={setKind} revision={revision}
      automatic={prefs.automatic} density={prefs.density} workbench={workbench} working={working} refresh={refresh} copy={copy}
      showEditor={showEditor} editor={inlineDraft ? editor : null} showConfirm={openConfirm}
      openTransfer={(mode, focus, selectedKeys) => { rememberFocus(focus); setTransfer({ mode, target, selectedKeys }); }}
      baseline={webBaselines[kind]?.tabId === target.tabId && webBaselines[kind]?.origin === target.origin ? webBaselines[kind] : null}
      rememberBaseline={(area, value) => setWebBaselines((old) => ({ ...old, [area]: { ...value, tabId: target.tabId, origin: target.origin } }))}
      undo={webUndo?.targetKey === target.key && webUndo?.kind === kind ? webUndo : null}
      rememberUndo={(area, entries) => setWebUndo({ targetKey: target.key, kind: area, entries })}
      forgetUndo={() => setWebUndo(null)} verify={verify} onWebWrite={bump}
      pendingNames={pendingNames} trackPending={trackPending} />
      : target.status === "loading" ? targetControl.waiting
        ? <StateMessage title={t("正在等待网页导航")}
          action={<Button onClick={refresh}>{t("重试")}</Button>}>{t("网页可访问后会自动显示数据。")}</StateMessage>
        : <StateMessage title={t("正在定位标签页")} busy />
      : target.status === "permission" ? <StateMessage title={t("Chrome 未授予此站点访问权限")}
        action={<div className="detail-actions">
          <Button type="primary" onClick={() => void openAccessSettings()}>{t("打开站点访问设置")}</Button>
          <Button onClick={refresh}>{t("重试")}</Button>
        </div>}>{t("在 Chrome 扩展详情中允许访问此站点，或选择「在所有网站上」。")}</StateMessage>
      : <StateMessage title={t("无法访问目标页面")} action={target.status === "access-error" &&
        <Button onClick={refresh}>{t("重试")}</Button>}>{target.reason}</StateMessage>}
  </section>;

  return <main className="app-shell" data-surface={workbench ? "workspace" : "panel"}>
    <header className="app-header">
      <div className="target-picker">
        <Badge status={isReady ? "success" : "default"} aria-hidden="true" />
        <Tooltip title={targetPickerOpen ? null : targetOrigin} trigger={["hover", "focus"]}>
          <Select size="small" className="target-select" aria-label={targetOrigin ? t("目标标签页，{origin}", { origin: targetOrigin }) : t("目标标签页")}
            value={currentTab?.value}
            placeholder={target.status === "loading" ? t("正在定位标签页…") : target.tabId == null ? t("选择标签页") : t("当前页不可访问")}
            options={tabOptions} popupMatchSelectWidth={240} onOpenChange={setTargetPickerOpen}
            optionRender={({ data: option }) => <span className="cell-lines">
              <span className="cell-text" title={option.title}>{option.title}</span>
              <Typography.Text type="secondary" className="cell-text" title={option.origin}>{option.origin}</Typography.Text>
            </span>}
            onChange={targetControl.select} />
        </Tooltip>
        {workbench && currentTab && <Tooltip title={t("工作台已锁定目标")}>
          <LockOutlined aria-label={t("工作台已锁定目标")} />
        </Tooltip>}
        {!workbench && <IconAction type={targetControl.locked ? "primary" : "text"} aria-pressed={targetControl.locked}
          icon={targetControl.locked ? <LockOutlined /> : <UnlockOutlined />}
          label={targetControl.locked ? t("已锁定，点击恢复跟随") : t("跟随中，点击锁定当前标签页")}
          disabled={target.tabId == null} onClick={targetControl.toggle} />}
      </div>
      <div className="action-strip" role="group" aria-label={t("侧栏操作")}>
        <div className="action-group">
          <IconAction icon={<ReloadOutlined />} label={t("刷新")} onClick={refresh} disabled={working}>
            <span className="wide-action-label">{t("刷新")}</span>
          </IconAction>
          <IconAction icon={<VideoCameraOutlined />} label={t("本地媒体")} aria-haspopup="dialog" disabled={!isReady || working}
            onClick={() => { rememberFocus(settingsButton); setMediaTarget(target); }}>
            <span className="wide-action-label">{t("本地媒体")}</span>
          </IconAction>
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
    <Tabs className="storage-tabs" size="small" tabBarGutter={16} activeKey={section} onChange={setSection}
      destroyOnHidden items={sections.map(([key, label]) => ({ key, label: t(label),
        disabled: !!draft && key !== section, children: key === section ? workspace : null }))} />
    {editor && !inlineDraft && <WideModal title={editor.title} onCancel={editor.onCancel} footer={editor.footer}
      closable={!working} keyboard={!working}>{editor.body}</WideModal>}
    {transfer && <CookieTransfer mode={transfer.mode} target={transfer.target} stale={!isReady || transfer.target.key !== target.key}
      verify={verify} onClose={() => setTransfer(null)} onWrite={bump} selectedKeys={transfer.selectedKeys} />}
    {mediaTarget && <MediaBrowser target={mediaTarget} stale={!isReady || mediaTarget.key !== target.key}
      onClose={() => setMediaTarget(null)} />}
    {confirm && <WideModal title={confirm.title} onCancel={() => setConfirm(null)}
      closable={!working} keyboard={!working} footer={[
        <Button key="cancel" disabled={working} onClick={() => setConfirm(null)}>{t("取消")}</Button>,
        <Button key="confirm" type="primary" danger loading={working} disabled={confirmStale}
          onClick={() => void runConfirmed()}>{working ? t("正在执行…") : confirm.label}</Button>,
      ]}>
      <p className="modal-origin">{confirm.target.origin}</p>
      <p className="confirm-scope">{confirm.scope}</p>
      <p className="confirm-summary">{confirm.details}</p>
      {confirmStale && <Alert className="form-alert" type="warning" title={t("目标已变化。请关闭确认框后重新选择操作。")} showIcon />}
      {opError && <Alert className="form-alert" type="error" title={t(opError)} showIcon />}
    </WideModal>}
    {report && <WideModal title={report.title} onCancel={() => setReport(null)}
      footer={<Button type="primary" onClick={() => setReport(null)}>{t("关闭")}</Button>}>
      <p className="modal-origin">{report.target.origin}</p>
      <Table className="compact-table" size="small" tableLayout="fixed" pagination={false} columns={outcomeColumns(t)}
        rowKey="label" dataSource={report.categories ? categories.map(([key, label]) => ({ label, value: report.categories[key] }))
          : [{ label: report.database ? "IndexedDB" : report.message, value: { rows: report.results } }]} />
    </WideModal>}
    {settings && <WideModal title={t("设置")} onCancel={() => setSettings(null)} footer={[
      <Button key="cancel" onClick={() => setSettings(null)}>{t("取消")}</Button>,
      <Button key="save" type="primary" htmlType="submit" form="storagebar-settings">{t("保存")}</Button>,
    ]}>
      <form id="storagebar-settings" onSubmit={saveSettings}>
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
        <div className="form-field"><span>{t("打开时的默认分类")}</span>
          <Select aria-label={t("打开时的默认分类")} value={settings.section}
            options={sections.map(([value, label]) => ({ value, label }))} onChange={(value) => setSettings({ ...settings, section: value })} />
        </div>
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
        <Checkbox checked={settings.automatic}
          onChange={(event) => setSettings({ ...settings, automatic: event.target.checked })}>{t("自动刷新 Web Storage")}</Checkbox>
        {settingsError && <Alert className="form-alert" type="error" title={settingsError} showIcon />}
      </form>
    </WideModal>}
  </main>;
}
