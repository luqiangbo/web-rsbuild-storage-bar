import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Empty, Input, Segmented, Spin, Table, Tag, Typography } from "antd";
import { applyCookieImport, cookieId, cookieImportLimit, exportCookies, getSiteCookies, prepareCookieImport } from "../api/cookies.js";
import { useRead } from "./useRecords.js";
import JsonCode from "./JsonCode.jsx";
import WideModal from "./WideModal.jsx";
import { usePreferences } from "./preferences.js";
import useFeedback from "./useFeedback.jsx";

const statusLabels = { success: "成功", skipped: "跳过", failed: "失败", invalid: "无效", conflict: "冲突", new: "新增" };
const statusColors = { success: "success", skipped: "default", failed: "error", invalid: "error", conflict: "warning", new: "success" };
const pagination = { pageSize: 30, simple: true, showSizeChanger: false, hideOnSinglePage: true };
const columns = (t) => [
  {
    title: t("状态"), dataIndex: "status", width: 76,
    render: (status) => <Tag color={statusColors[status]}>{t(statusLabels[status])}</Tag>,
  },
  {
    title: "Cookie", dataIndex: "name", rowScope: "row",
    render: (name, row) => <div className="cell-lines dialog-wrap">
      <span className="data-input">{row.index == null ? name : t("第 {index} 条", { index: row.index })}</span>
      {row.detail && <Typography.Text type="secondary">{t(row.detail)}</Typography.Text>}
    </div>,
  },
];

export default function CookieTransfer({ mode, target, stale, verify, onClose, onWrite, selectedKeys = [] }) {
  const { t } = usePreferences();
  const notify = useFeedback();
  const [rows, setRows] = useState(null);
  const [results, setResults] = useState(null);
  const [policy, setPolicy] = useState("skip");
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0);
  const [text, setText] = useState("");
  const [scope, setScope] = useState(selectedKeys.length ? "selected" : "all");
  const [format, setFormat] = useState("json");
  const running = useRef(false);
  const parseEpoch = useRef(0);
  const importing = mode === "import";
  const loadingBackup = !importing && !stale;
  const load = useCallback(() => getSiteCookies(target), [target]);
  const backup = useRead(loadingBackup ? retry : null, load);
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const exportRows = useMemo(() => (
    scope === "selected" ? (backup.value ?? []).filter((cookie) => selected.has(cookieId(cookie))) : backup.value ?? []
  ), [backup.value, scope, selected]);
  const exportedText = useMemo(() => (
    !importing && exportRows.length ? exportCookies(target, exportRows, format) : ""
  ), [importing, target, exportRows, format]);

  const conflicts = rows?.filter(({ previous }) => previous).length ?? 0;
  const invalid = rows?.filter(({ error: entryError }) => entryError).length ?? 0;
  const fresh = (rows?.length ?? 0) - conflicts - invalid;
  const writableCount = fresh + (policy === "overwrite" ? conflicts : 0);

  useEffect(() => {
    if (!importing || results || stale) return;
    const trimmed = text.trim();
    const epoch = ++parseEpoch.current;
    if (!trimmed) {
      setParsing(false);
      setRows(null);
      setError("");
      return;
    }
    setParsing(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        if (new Blob([trimmed]).size > cookieImportLimit) throw new Error("内容超过 4 MiB 上限");
        await verify(target);
        const preview = await prepareCookieImport(target, trimmed);
        await verify(target);
        if (parseEpoch.current !== epoch) return;
        setRows(preview);
        setError("");
      } catch (failure) {
        if (parseEpoch.current !== epoch) return;
        setRows(null);
        setError(failure.message || String(failure));
      } finally {
        if (parseEpoch.current === epoch) setParsing(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [importing, results, stale, text, target, verify]);

  async function perform(work) {
    if (running.current || stale) return;
    running.current = true;
    setWorking(true);
    setError("");
    try {
      await verify(target);
      await work();
    } catch (failure) {
      setError(failure.message || String(failure));
    } finally {
      running.current = false;
      setWorking(false);
    }
  }

  const confirmImport = () => perform(async () => {
    if (!rows?.length) return;
    const applied = await applyCookieImport(target, rows, policy === "overwrite", () => verify(target));
    setResults(applied);
    onWrite();
  });

  const copyExport = () => perform(async () => {
    await navigator.clipboard.writeText(exportedText);
    notify(t("已复制"));
  });

  const report = results?.reduce((counts, row) => ({ ...counts, [row.status]: counts[row.status] + 1 }),
    { success: 0, skipped: 0, failed: 0 });
  const tableRows = (results ?? rows ?? []).map((row, index) => ({
    id: index,
    name: row.name,
    index: row.index,
    status: row.status ?? (row.error ? "invalid" : row.previous ? "conflict" : "new"),
    detail: row.detail ?? row.error,
  }));
  const canBackdropClose = !working && (!importing || (!text.trim() && !rows && !results));

  const footer = <div className="cookie-transfer-footer">
    <span className="editor-footer-hint">
      {importing ? (!results && rows && !parsing && t("将写入 {count} 项", { count: writableCount }))
        : t("包含可读取的 HttpOnly Cookie")}
    </span>
    <div className="detail-actions">
      <Button onClick={onClose} disabled={working}>{results || !importing ? t("关闭") : t("取消")}</Button>
      {importing ? !results && <Button type="primary" loading={working} onClick={confirmImport}
        disabled={stale || parsing || !rows?.some((row) => !row.error)}>
        {t("确认导入")}
      </Button> : <Button type="primary" loading={working} onClick={copyExport}
        disabled={stale || !exportRows.length}>
        {t("复制")}
      </Button>}
    </div>
  </div>;

  return <WideModal className="cookie-transfer-modal" size="lg"
    title={importing ? t("导入 Cookie") : t("导出 Cookie")}
    maskClosable={canBackdropClose} onCancel={onClose}
    keyboard={!working} closable={!working} footer={footer}>
    <div className="cookie-transfer-body">
      {stale && <Alert type="warning" title={t("目标已变化，请重新打开此操作。")} showIcon />}
      {importing ? <>
        {!results && <Input.TextArea className="data-input cookie-import-input"
          aria-label={t("粘贴 Cookie 内容")}
          placeholder={t("粘贴 Cookie（支持 JSON 数组、Header 字符串或 Netscape 格式），粘贴后自动预览")}
          value={text} readOnly={working || stale} spellCheck={false}
          onChange={(event) => { setText(event.target.value); setRows(null); }} />}
        <div className="cookie-transfer-bar">
          {results ? <Alert className="cookie-import-result" type={report.failed ? "warning" : "success"} showIcon
            title={t("导入结果：成功 {success} · 跳过 {skipped} · 失败 {failed}", report)} />
            : parsing ? <div className="cookie-parse-status"><Spin size="small" /><Typography.Text type="secondary">{t("正在解析…")}</Typography.Text></div>
              : rows ? <>
                <div className="summary-strip">
                  <Tag color="success">{t("新增")} {fresh}</Tag>
                  <Tag color={conflicts ? "warning" : "default"}>{t("冲突")} {conflicts}</Tag>
                  <Tag color={invalid ? "error" : "default"}>{t("无效")} {invalid}</Tag>
                </div>
                {conflicts > 0 && <Segmented size="small" aria-label={t("Cookie 冲突处理")}
                  value={policy} onChange={setPolicy} disabled={working || stale}
                  options={[{ value: "skip", label: t("跳过冲突") }, { value: "overwrite", label: t("覆盖冲突") }]} />}
              </> : <Typography.Text type="secondary" className="cookie-transfer-hint">
                {t("支持 JSON 数组、Header 字符串与 Netscape 格式，确认前不会写入。")}
              </Typography.Text>}
        </div>
        {error && <Alert type="error" title={t(error)} showIcon />}
        <div className="cookie-transfer-list">
          {(rows || results) ? <div className="metadata-card cookie-transfer-table-wrap">
            <Table key={results ? "results" : "preview"} className="compact-table" size="small"
              tableLayout="fixed" columns={columns(t)} rowKey="id" pagination={pagination} dataSource={tableRows} />
          </div> : !error && <div className="cookie-transfer-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("粘贴 Cookie 内容后将在此自动预览")} />
          </div>}
        </div>
      </> : <>
        <div className="cookie-transfer-bar">
          <Segmented size="small" aria-label={t("导出格式")} value={format} onChange={setFormat} options={[
            { value: "json", label: "JSON" },
            { value: "header", label: "Header" },
            { value: "netscape", label: "Netscape" },
          ]} />
          <div className="cookie-export-controls">
            {selectedKeys.length > 0 && <Segmented size="small" aria-label={t("导出范围")}
              value={scope} onChange={setScope}
              options={[{ value: "all", label: t("本站全部") }, { value: "selected", label: t("仅选中项") }]} />}
            {backup.status === "ready" && <Tag className="cookie-count-tag">{t("{count} 个 Cookie", { count: exportRows.length })}</Tag>}
          </div>
        </div>
        {error && <Alert type="error" title={t(error)} showIcon />}
        <div className="cookie-export-preview">
          {backup.status === "loading" && !stale ? <div className="cookie-transfer-empty"><Spin size="small" /></div>
            : backup.status === "error" ? <div className="cookie-transfer-empty">
              <Alert type="error" showIcon title={t(backup.error)}
                action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button>} />
            </div>
              : !exportRows.length ? <div className="cookie-transfer-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有可导出的 Cookie")} />
              </div>
                : format === "json" ? <JsonCode text={exportedText} />
                  : <pre className="value-block value-block-framed">{exportedText}</pre>}
        </div>
      </>}
    </div>
  </WideModal>;
}
