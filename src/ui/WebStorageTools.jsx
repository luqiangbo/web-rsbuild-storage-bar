import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Empty, Input, Segmented, Spin, Table, Tag, Typography } from "antd";
import { runInPage } from "../api/page.js";
import { compareWebStorage, exportWebStorage, parseWebBackup } from "../api/webStorage.js";
import { usePreferences } from "./preferences.js";
import JsonCode from "./JsonCode.jsx";
import JsonViewer from "./JsonViewer.jsx";
import { formatJson, jsonError, jsonTree, jsonTreeLimit } from "./jsonDocument.js";
import LineDiff from "./LineDiff.jsx";
import { useRead } from "./useRecords.js";
import WideModal from "./WideModal.jsx";
import useFeedback from "./useFeedback.jsx";

const pages = { pageSize: 30, simple: true, hideOnSinglePage: true, showSizeChanger: false };
const labels = { added: "新增", changed: "已修改", removed: "已删除", conflict: "冲突",
  success: "已完成", skipped: "跳过", failed: "失败" };
const colors = { added: "success", changed: "processing", removed: "error", conflict: "warning",
  success: "success", skipped: "default", failed: "error" };
const badges = { added: "+", changed: "~", removed: "-" };

function prettyDiffText(value) {
  if (typeof value !== "string" || !value) return value ?? "";
  if (jsonError(value) || !jsonTree(value)) return value;
  try {
    const formatted = formatJson(value);
    return formatted.length <= jsonTreeLimit ? formatted : value;
  } catch {
    return value;
  }
}

function SingleValueView({ value, statusKey, keyLabel, titleKey }) {
  const { t } = usePreferences();
  const isJson = typeof value === "string" && value !== "" && !jsonError(value);
  return <div className="line-diff-shell">
    <div className="line-diff-header">
      <div className="line-diff-stats">
        <Typography.Text code className="cell-text diff-detail-key" title={titleKey}>{keyLabel}</Typography.Text>
      </div>
      <Tag color={colors[statusKey]} style={{ marginInlineEnd: 0 }}>{t(labels[statusKey])}</Tag>
    </div>
    <div className="storage-diff-value">
      {value === "" ? <Typography.Text type="secondary" className="storage-diff-empty-val">{t("（空字符串）")}</Typography.Text>
        : isJson ? <JsonViewer text={value} />
          : <pre className="value-block value-block-framed">{value}</pre>}
    </div>
  </div>;
}

export default function WebStorageTools({ mode, target, kind, selected, baseline, rememberBaseline,
  undo, updateUndo, verify, onWrite, onClose }) {
  const { t, language } = usePreferences();
  const notify = useFeedback();
  const [working, setWorking] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState(null);
  const [diffFilter, setDiffFilter] = useState("all");
  const [focusedKey, setFocusedKey] = useState(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [exportScope, setExportScope] = useState(selected.length ? "selected" : "all");
  const [exportFormat, setExportFormat] = useState("json");
  const [retry, setRetry] = useState(0);
  const running = useRef(false);
  const parseEpoch = useRef(0);
  const autoCompared = useRef(false);
  const label = kind === "local" ? "LocalStorage" : "SessionStorage";
  const isTransfer = mode === "import" || mode === "export";
  const isFixedModal = isTransfer || mode === "diff";

  const readFresh = useCallback(async () => {
    await verify(target);
    const { rows } = await runInPage(target, "storageRead", { kind });
    await verify(target);
    return rows;
  }, [target, kind, verify]);

  const exported = useRead(mode === "export" ? retry : null, readFresh);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const exportRows = useMemo(() => (
    (exported.value ?? []).filter(({ id }) => exportScope === "all" || selectedSet.has(id))
  ), [exported.value, exportScope, selectedSet]);
  const exportedText = useMemo(() => (
    mode === "export" && exportRows.length ? exportWebStorage(kind, exportRows, exportFormat) : ""
  ), [mode, kind, exportRows, exportFormat]);

  const conflicts = preview?.filter(({ expected }) => expected !== null).length ?? 0;
  const fresh = (preview?.length ?? 0) - conflicts;
  const writableCount = fresh + (overwrite ? conflicts : 0);

  const diffCounts = useMemo(() => {
    const sum = { added: 0, changed: 0, removed: 0 };
    for (const row of diff ?? []) sum[row.status]++;
    return sum;
  }, [diff]);

  const diffFilterOptions = useMemo(() => {
    if (!diff?.length) return [];
    const options = [{ value: "all", label: `${t("全部")} ${diff.length}` }];
    if (diffCounts.added) options.push({ value: "added", label: `+${diffCounts.added}` });
    if (diffCounts.changed) options.push({ value: "changed", label: `~${diffCounts.changed}` });
    if (diffCounts.removed) options.push({ value: "removed", label: `-${diffCounts.removed}` });
    return options;
  }, [diff, diffCounts, t]);

  const activeFilter = diffFilter !== "all" && !diffCounts[diffFilter] ? "all" : diffFilter;
  const filteredDiff = useMemo(() => (
    activeFilter === "all" ? (diff ?? []) : (diff ?? []).filter((row) => row.status === activeFilter)
  ), [diff, activeFilter]);
  const activeDiff = useMemo(() => (
    filteredDiff.find((row) => row.key === focusedKey) ?? filteredDiff[0] ?? null
  ), [filteredDiff, focusedKey]);

  const perform = useCallback(async (work) => {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setError("");
    try { await work(); }
    catch (failure) { setError(failure.message || String(failure)); }
    finally { running.current = false; setWorking(false); }
  }, []);

  const compare = useCallback(() => {
    if (!baseline) return;
    return perform(async () => {
      const rows = await readFresh();
      const next = compareWebStorage(baseline.rows, rows);
      setDiff(next);
      setFocusedKey((prev) => (next.some((row) => row.key === prev) ? prev : next[0]?.key ?? null));
    });
  }, [baseline, perform, readFresh]);

  const capture = useCallback(() => perform(async () => {
    const rows = await readFresh();
    autoCompared.current = true;
    rememberBaseline(kind, { rows, time: Date.now() });
    setDiff([]);
    setDiffFilter("all");
    setFocusedKey(null);
  }), [kind, perform, readFresh, rememberBaseline]);

  useEffect(() => {
    if (mode !== "diff" || !baseline || autoCompared.current) return;
    autoCompared.current = true;
    compare();
  }, [mode, baseline, compare]);

  useEffect(() => {
    if (mode !== "import" || report) return;
    const trimmed = text.trim();
    const epoch = ++parseEpoch.current;
    if (!trimmed) {
      setParsing(false);
      setPreview(null);
      setError("");
      return;
    }
    setParsing(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const entries = parseWebBackup(trimmed);
        const current = new Map((await readFresh()).map(({ id, value }) => [id, value]));
        if (parseEpoch.current !== epoch) return;
        setPreview(entries.map((row) => ({ ...row, expected: current.get(row.key) ?? null })));
        setError("");
      } catch (failure) {
        if (parseEpoch.current !== epoch) return;
        setPreview(null);
        setError(failure.message || String(failure));
      } finally {
        if (parseEpoch.current === epoch) setParsing(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [mode, report, text, readFresh]);

  function restore(entries) {
    return perform(async () => {
      const results = [];
      const writable = [];
      for (const row of entries) {
        if (mode === "import" && row.expected !== null && !overwrite) {
          results.push({ name: row.key, status: "skipped", detail: "已存在，按所选规则跳过" });
        } else writable.push(row);
      }
      for (let i = 0; i < writable.length; i += 40) {
        try {
          await verify(target);
          results.push(...await runInPage(target, "storageApply", { kind, entries: writable.slice(i, i + 40) }));
        } catch (failure) {
          results.push(...writable.slice(i).map(({ key }) => ({ name: key, status: "failed", detail: failure.message })));
          break;
        }
      }
      if (mode === "undo") {
        const failed = new Set(results.filter(({ status }) => status === "failed").map(({ name }) => name));
        updateUndo(entries.filter(({ key }) => failed.has(key)));
      }
      setReport(results);
      onWrite();
    });
  }

  const copyExport = () => perform(async () => {
    await verify(target);
    await navigator.clipboard.writeText(exportedText);
    notify(t("已复制"));
  });

  const formatKey = (key) => key === "" ? t("（空名称）") : key;
  const status = (value) => <Tag color={colors[value]}>{t(labels[value])}</Tag>;
  const counts = report?.reduce((sum, row) => ({ ...sum, [row.status]: sum[row.status] + 1 }), { success: 0, skipped: 0, failed: 0 });
  const title = mode === "import" ? t("导入 {name}", { name: label })
    : mode === "export" ? t("导出 {name}", { name: label })
      : mode === "diff" ? t("存储变化对比") : t("撤销删除");
  const modalSize = mode === "undo" && !report ? "sm" : "lg";
  const canBackdropClose = !working && (mode === "export" || mode === "diff" || (mode === "undo" && !report) ||
    (mode === "import" && !text.trim() && !preview && !report));

  const fixedFooter = <div className="cookie-transfer-footer">
    <span className="editor-footer-hint">
      {mode === "import" ? (!report && preview && !parsing && t("将写入 {count} 项", { count: writableCount }))
        : mode === "export" ? t("共 {count} 项", { count: exportRows.length })
          : diff?.length > 0 ? t("共 {count} 项变化", { count: diff.length })
            : diff?.length === 0 ? t("与基线一致") : ""}
    </span>
    <div className="detail-actions">
      <Button disabled={working} onClick={onClose}>{report || mode !== "import" ? t("关闭") : t("取消")}</Button>
      {mode === "import" ? !report && <Button type="primary" loading={working}
        disabled={parsing || !preview?.length}
        onClick={() => restore(preview)}>{t("确认导入")}</Button>
        : mode === "export" ? <Button type="primary" loading={working} disabled={!exportRows.length} onClick={copyExport}>{t("复制")}</Button>
          : baseline ? <Button type="primary" loading={working} onClick={compare}>{t("重新对比")}</Button>
            : <Button type="primary" loading={working} onClick={capture}>{t("记为基线")}</Button>}
    </div>
  </div>;

  const undoFooter = [
    <Button key="close" disabled={working} onClick={onClose}>{t("关闭")}</Button>,
    !report && <Button key="undo" type="primary" loading={working}
      disabled={!undo?.entries.length} onClick={() => restore(undo.entries)}>{t("撤销删除")}</Button>,
  ];

  return <WideModal className={isFixedModal ? "cookie-transfer-modal" : undefined} size={modalSize} title={title}
    maskClosable={canBackdropClose} onCancel={onClose} closable={!working} keyboard={!working}
    footer={isFixedModal ? fixedFooter : undoFooter}>
    {isFixedModal ? <div className="cookie-transfer-body">
      {mode === "export" && <>
        <div className="cookie-transfer-bar">
          <Segmented size="small" aria-label={t("导出格式")} value={exportFormat} onChange={setExportFormat} options={[
            { value: "json", label: "JSON" },
            { value: "script", label: "JS" },
          ]} />
          <div className="cookie-export-controls">
            {selected.length > 0 && <Segmented size="small" aria-label={t("导出范围")}
              value={exportScope} onChange={setExportScope}
              options={[{ value: "all", label: t("整个存储区") }, { value: "selected", label: t("仅选中项") }]} />}
            {exported.status === "ready" && <Tag className="cookie-count-tag">{t("{count} 条记录", { count: exportRows.length })}</Tag>}
          </div>
        </div>
        {error && <Alert type="error" showIcon title={t(error)} />}
        <div className="cookie-export-preview">
          {exported.status === "loading" ? <div className="cookie-transfer-empty"><Spin size="small" /></div>
            : exported.status === "error" ? <div className="cookie-transfer-empty">
              <Alert type="error" showIcon title={t(exported.error)}
                action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button>} />
            </div>
              : !exportRows.length ? <div className="cookie-transfer-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("这里还没有记录")} />
              </div>
                : exportFormat === "json" ? <JsonCode text={exportedText} />
                  : <pre className="value-block value-block-framed">{exportedText}</pre>}
        </div>
      </>}
      {mode === "import" && <>
        {!report && <Input.TextArea className="data-input cookie-import-input"
          aria-label={t("粘贴 JSON 内容")}
          placeholder={t("粘贴键值对 JSON（如 {\"key\": \"value\"}），粘贴后自动预览")}
          value={text} readOnly={working} spellCheck={false}
          onChange={(event) => { setText(event.target.value); setPreview(null); }} />}
        <div className="cookie-transfer-bar">
          {report ? <Alert className="cookie-import-result" type={counts.failed ? "warning" : "success"} showIcon
            title={t("处理结果：成功 {success} · 跳过 {skipped} · 失败 {failed}", counts)} />
            : parsing ? <div className="cookie-parse-status"><Spin size="small" /><Typography.Text type="secondary">{t("正在解析…")}</Typography.Text></div>
              : preview ? <>
                <div className="summary-strip">
                  <Tag color="success">{t("新增")} {fresh}</Tag>
                  <Tag color={conflicts ? "warning" : "default"}>{t("冲突")} {conflicts}</Tag>
                </div>
                {conflicts > 0 && <Segmented size="small" disabled={working} value={overwrite ? "overwrite" : "skip"}
                  onChange={(value) => setOverwrite(value === "overwrite")}
                  options={[{ value: "skip", label: t("跳过冲突") }, { value: "overwrite", label: t("覆盖冲突") }]} />}
              </> : <Typography.Text type="secondary" className="cookie-transfer-hint">
                {t("支持键值对 JSON 对象，确认前不会写入。")}
              </Typography.Text>}
        </div>
        {error && <Alert type="error" showIcon title={t(error)} />}
        <div className="cookie-transfer-list">
          {report ? <div className="metadata-card cookie-transfer-table-wrap">
            <Table className="compact-table" size="small" tableLayout="fixed" rowKey="name" pagination={pages} dataSource={report} columns={[
              { title: t("状态"), width: 76, dataIndex: "status", render: status },
              { title: t("键"), dataIndex: "name", render: (name, row) => <div className="dialog-wrap">
                <span className="data-input">{formatKey(name)}</span>
                {row.detail && <div><Typography.Text type="secondary">{t(row.detail)}</Typography.Text></div>}
              </div> },
            ]} />
          </div> : preview ? <div className="metadata-card cookie-transfer-table-wrap">
            <Table className="compact-table" size="small" tableLayout="fixed" rowKey="key" pagination={pages} dataSource={preview} columns={[
              { title: t("状态"), width: 76, render: (_, row) => status(row.expected === null ? "added" : "conflict") },
              { title: t("键"), dataIndex: "key", ellipsis: true, render: (key) => <span className="data-input">{formatKey(key)}</span> },
            ]} />
          </div> : !error && <div className="cookie-transfer-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("粘贴 JSON 内容后将在此自动预览")} />
          </div>}
        </div>
      </>}
      {mode === "diff" && <>
        <div className="cookie-transfer-bar">
          <div className="storage-diff-bar-left">
            {baseline && <Button size="small" disabled={working} onClick={capture}>{t("更新基线")}</Button>}
            {baseline ? <Typography.Text type="secondary" className="storage-diff-time">{t("基线时间：{time}", {
              time: new Date(baseline.time).toLocaleString(language === "zh" ? "zh-CN" : "en"),
            })}</Typography.Text>
              : <Typography.Text type="secondary" className="cookie-transfer-hint">
                {t("在网页操作前记下基线，再回来对比变化。")}
              </Typography.Text>}
          </div>
          {diffFilterOptions.length > 2 ? (
            <Segmented size="small" aria-label={t("变更筛选")} value={activeFilter}
              onChange={setDiffFilter} options={diffFilterOptions} />
          ) : diff?.length > 0 && <div className="summary-strip">
            {diffCounts.added > 0 && <Tag color="success">+{diffCounts.added}</Tag>}
            {diffCounts.changed > 0 && <Tag color="processing">~{diffCounts.changed}</Tag>}
            {diffCounts.removed > 0 && <Tag color="error">-{diffCounts.removed}</Tag>}
          </div>}
        </div>
        {error && <Alert type="error" showIcon title={t(error)} />}
        {!baseline ? <div className="cookie-transfer-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("尚未记录基线，点击下方「记为基线」开始对比")} />
        </div> : working && diff === null ? <div className="cookie-transfer-empty">
          <Spin size="small" />
        </div> : diff?.length === 0 ? <div className="cookie-transfer-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有变化")} />
        </div> : diff?.length > 0 && <div className="storage-diff-layout">
          <div className="storage-diff-list" role="listbox" aria-label={t("变更键列表")}>
            {filteredDiff.map((row) => {
              const active = activeDiff?.key === row.key;
              return <button key={row.key} type="button" role="option" aria-selected={active}
                className="storage-diff-item" data-active={active || undefined}
                title={row.key} onClick={() => setFocusedKey(row.key)}>
                <span className={`storage-diff-badge is-${row.status}`} aria-hidden="true">{badges[row.status]}</span>
                <span className="cell-text">{formatKey(row.key)}</span>
              </button>;
            })}
          </div>
          <div className="storage-diff-detail">
            {activeDiff?.status === "changed" ? (
              <LineDiff key={activeDiff.key}
                before={prettyDiffText(activeDiff.previous)}
                after={prettyDiffText(activeDiff.value)}
                headerExtra={<Typography.Text code className="cell-text diff-detail-key" title={activeDiff.key}>
                  {formatKey(activeDiff.key)}
                </Typography.Text>} />
            ) : activeDiff && (
              <SingleValueView key={activeDiff.key}
                statusKey={activeDiff.status}
                keyLabel={formatKey(activeDiff.key)}
                titleKey={activeDiff.key}
                value={activeDiff.status === "added" ? activeDiff.value : activeDiff.previous} />
            )}
          </div>
        </div>}
      </>}
    </div> : <div className="dialog-stack">
      {error && <Alert type="error" showIcon title={t(error)} />}
      {mode === "undo" && !report && <>
        <Typography.Text type="secondary">{t("恢复已删除的记录。网页重新写入的键会跳过。")}</Typography.Text>
        {undo?.entries?.length > 0 && <div className="modal-stat-card undo-preview-card">
          <Typography.Text strong>{t("共 {count} 项", { count: undo.entries.length })}</Typography.Text>
          <div className="summary-strip">
            {undo.entries.slice(0, 8).map(({ key }) => <Tag key={key} className="data-input">{formatKey(key)}</Tag>)}
            {undo.entries.length > 8 && <Tag>+{undo.entries.length - 8}</Tag>}
          </div>
        </div>}
      </>}
      {mode === "undo" && report && <>
        <Alert type={counts.failed ? "warning" : "success"} showIcon title={t("处理结果：成功 {success} · 跳过 {skipped} · 失败 {failed}", counts)} />
        <div className="metadata-card">
          <Table className="compact-table" size="small" tableLayout="fixed" rowKey="name" pagination={pages} dataSource={report} columns={[
            { title: t("键"), dataIndex: "name", render: (name, row) => <div className="dialog-wrap">
              <span className="data-input">{formatKey(name)}</span>
              {row.detail && <div><Typography.Text type="secondary">{t(row.detail)}</Typography.Text></div>}
            </div> },
            { title: t("状态"), width: 95, dataIndex: "status", render: status },
          ]} />
        </div>
      </>}
    </div>}
  </WideModal>;
}
