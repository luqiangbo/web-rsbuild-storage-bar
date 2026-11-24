import React, { useCallback, useRef, useState } from "react";
import { Alert, Button, Checkbox, Empty, Segmented, Spin, Table, Tag, Typography, Upload } from "antd";
import { runInPage } from "../api/page.js";
import { compareWebStorage, makeWebBackup, parseWebBackup } from "../api/webStorage.js";
import { usePreferences } from "./preferences.js";
import JsonViewer from "./JsonViewer.jsx";
import { jsonError } from "./jsonDocument.js";
import { downloadJson } from "./downloadJson.js";
import { useRead } from "./useRecords.js";
import WideModal from "./WideModal.jsx";
import useFeedback from "./useFeedback.jsx";

const pages = { pageSize: 20, simple: true, hideOnSinglePage: true, showSizeChanger: false };
const labels = { added: "新增", changed: "已修改", removed: "已删除", conflict: "冲突",
  success: "已完成", skipped: "跳过", failed: "失败" };
const colors = { added: "success", changed: "processing", removed: "error", conflict: "warning",
  success: "success", skipped: "default", failed: "error" };

function ComparedValue({ value, label }) {
  const { t } = usePreferences();
  return <div className="dialog-stack diff-pane">
    <Typography.Text strong className="diff-pane-label">{t(label)}</Typography.Text>
    <div className="diff-value-box">
      {value === undefined ? <Typography.Text type="secondary">{t("不存在")}</Typography.Text>
        : value === "" ? <Typography.Text type="secondary">{t("（空字符串）")}</Typography.Text>
          : jsonError(value) ? <pre className="value-block value-block-framed">{value}</pre> : <JsonViewer text={value} />}
    </div>
  </div>;
}

export default function WebStorageTools({ mode, target, kind, selected, baseline, rememberBaseline,
  undo, updateUndo, verify, onWrite, onClose }) {
  const { t, language } = usePreferences();
  const notify = useFeedback();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState(null);
  const [focused, setFocused] = useState(null);
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [crossConfirmed, setCrossConfirmed] = useState(false);
  const [exportScope, setExportScope] = useState(selected.length ? "selected" : "all");
  const [retry, setRetry] = useState(0);
  const running = useRef(false);
  const label = kind === "local" ? "LocalStorage" : "SessionStorage";
  const crossSite = !!preview && preview.origin !== target.origin;
  const readFresh = useCallback(async () => {
    await verify(target);
    const { rows } = await runInPage(target, "storageRead", { kind });
    await verify(target);
    return rows;
  }, [target, kind, verify]);
  const exported = useRead(mode === "export" ? retry : null, readFresh);
  const selectedSet = new Set(selected);
  const exportRows = (exported.value ?? []).filter(({ id }) => exportScope === "all" || selectedSet.has(id));

  async function perform(work) {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setError("");
    try { await work(); }
    catch (failure) { setError(failure.message || String(failure)); }
    finally { running.current = false; setWorking(false); }
  }

  function capture() {
    return perform(async () => {
      const rows = await readFresh();
      rememberBaseline(kind, { rows, time: Date.now() });
      setDiff(null);
      setFocused(null);
    });
  }

  function compare() {
    return perform(async () => {
      const rows = await readFresh();
      setDiff(compareWebStorage(baseline.rows, rows));
      setFocused(null);
    });
  }

  function choose(file) {
    if (running.current) return Upload.LIST_IGNORE;
    setPreview(null);
    setOverwrite(false);
    setCrossConfirmed(false);
    void perform(async () => {
      const backup = parseWebBackup(await file.text(), kind);
      const current = new Map((await readFresh()).map(({ id, value }) => [id, value]));
      setPreview({ ...backup, entries: backup.entries.map((row) => ({
        ...row, expected: current.get(row.key) ?? null,
      })) });
    });
    return Upload.LIST_IGNORE;
  }

  function restore(entries) {
    return perform(async () => {
      if (mode === "import" && crossSite && !crossConfirmed) return;
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

  const formatKey = (key) => key === "" ? t("（空名称）") : key;
  const status = (value) => <Tag color={colors[value]}>{t(labels[value])}</Tag>;
  const counts = report?.reduce((sum, row) => ({ ...sum, [row.status]: sum[row.status] + 1 }), { success: 0, skipped: 0, failed: 0 });
  const titles = { diff: "存储变化对比", import: "导入 Web Storage", export: "导出 Web Storage", undo: "撤销删除" };
  const modalSize = mode === "export" || (mode === "undo" && !report) ? "sm" : "lg";
  const canBackdropClose = !working && (mode === "export" || (mode === "undo" && !report) || (mode === "diff" && !diff) || (mode === "import" && !preview && !report));

  return <WideModal size={modalSize} title={t(titles[mode])}
    maskClosable={canBackdropClose} onCancel={onClose} closable={!working} keyboard={!working} footer={[
      <Button key="close" disabled={working} onClick={onClose}>{t("关闭")}</Button>,
      mode === "diff" && <Button key="compare" type="primary" disabled={!baseline} loading={working} onClick={compare}>{t("对比当前")}</Button>,
      mode === "import" && !report && <Button key="import" type="primary" loading={working}
        disabled={!preview?.entries.length || (crossSite && !crossConfirmed)} onClick={() => restore(preview.entries)}>{t("确认导入")}</Button>,
      mode === "export" && <Button key="download" type="primary" disabled={!exportRows.length} loading={working}
        onClick={() => perform(async () => {
          await verify(target);
          downloadJson(makeWebBackup(target.origin, kind, exportRows), `storagebar-${kind}-${target.hostname.replace(/[^a-z\d.-]/gi, "_")}.json`);
          notify(t("Web Storage 备份已交给浏览器下载"));
          onClose();
        })}>{t("下载 JSON")}</Button>,
      mode === "undo" && !report && <Button key="undo" type="primary" loading={working}
        disabled={!undo?.entries.length} onClick={() => restore(undo.entries)}>{t("撤销删除")}</Button>,
    ]}>
    <div className="dialog-stack">
      {error && <Alert type="error" showIcon title={t(error)} />}
      {mode === "diff" && <>
        <div className="modal-toolbar-card">
          <Button size="small" disabled={working} onClick={capture}>{t(baseline ? "更新基线" : "记为基线")}</Button>
          {baseline ? <Typography.Text type="secondary">{t("基线时间：{time}", {
            time: new Date(baseline.time).toLocaleString(language === "zh" ? "zh-CN" : "en"),
          })}</Typography.Text>
            : <Typography.Text type="secondary">{t("在网页操作前记下基线，再回来对比变化。")}</Typography.Text>}
        </div>
        {diff?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有变化")} />}
        {diff?.length > 0 && <div className="metadata-card">
          <Table className="compact-table diff-table" size="small" tableLayout="fixed" rowKey="key" pagination={pages} dataSource={diff}
            onRow={(row) => ({
              onClick: () => setFocused(row),
              "data-active": focused?.key === row.key || undefined,
            })}
            columns={[
              { title: t("键"), dataIndex: "key", render: (key, row) =>
                <Button type="link" size="small" className="cell-text data-input diff-key-btn" title={key} onClick={() => setFocused(row)}>{formatKey(key)}</Button> },
              { title: t("状态"), dataIndex: "status", width: 95, render: status },
            ]} />
        </div>}
        {focused && <>
          <Typography.Text code className="dialog-wrap">{formatKey(focused.key)}</Typography.Text>
          <div className="json-diff"><ComparedValue key={`before-${focused.key}`} label="修改前" value={focused.previous} />
            <ComparedValue key={`after-${focused.key}`} label="修改后" value={focused.value} /></div>
        </>}
      </>}
      {mode === "export" && <>
        {selected.length > 0 && <div className="form-field">
          <span>{t("导出范围")}</span>
          <Segmented block value={exportScope} onChange={setExportScope}
            options={[{ value: "selected", label: t("仅选中项") }, { value: "all", label: t("整个存储区") }]} />
        </div>}
        {exported.status === "loading" && <div className="modal-stat-card"><Spin size="small" /><Typography.Text role="status">{t("正在读取…")}</Typography.Text></div>}
        {exported.status === "error" && <Alert type="error" showIcon title={t(exported.error)}
          action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button>} />}
        {exported.status === "ready" && <div className="modal-stat-card">
          <Typography.Text>{t("{count} 条记录", { count: exportRows.length })}</Typography.Text>
        </div>}
      </>}
      {mode === "import" && !report && <>
        <div>
          <Upload accept=".json,application/json" disabled={working} showUploadList={false} beforeUpload={choose}>
            <Button disabled={working}>{t("选择备份 JSON")}</Button>
          </Upload>
        </div>
        {preview && <>
          <Typography.Text code className="dialog-wrap">{t("来源：{origin}", { origin: preview.origin })}</Typography.Text>
          {crossSite && <Alert type="warning" showIcon title={t("此备份来自其他 Origin。")}
            description={<Checkbox checked={crossConfirmed} disabled={working}
              onChange={(event) => setCrossConfirmed(event.target.checked)}>{t("确认跨站导入到当前目标")}</Checkbox>} />}
          {preview.entries.some(({ expected }) => expected !== null) && <Segmented block disabled={working} value={overwrite ? "overwrite" : "skip"}
            onChange={(value) => setOverwrite(value === "overwrite")}
            options={[{ value: "skip", label: t("跳过冲突") }, { value: "overwrite", label: t("覆盖冲突") }]} />}
          <div className="metadata-card">
            <Table className="compact-table" size="small" tableLayout="fixed" rowKey="key" pagination={pages} dataSource={preview.entries} columns={[
              { title: t("键"), dataIndex: "key", ellipsis: true, render: (key) => <span className="data-input">{formatKey(key)}</span> },
              { title: t("状态"), width: 95, render: (_, row) => status(row.expected === null ? "added" : "conflict") },
            ]} />
          </div>
        </>}
      </>}
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
      {report && <>
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
    </div>
  </WideModal>;
}
