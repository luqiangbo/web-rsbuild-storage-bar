import React, { useCallback, useRef, useState } from "react";
import { Alert, Button, Empty, Input, Segmented, Spin, Table, Tag, Typography, Upload } from "antd";
import { applyCookieImport, cookieId, cookieImportLimit, exportCookies, getSiteCookies, prepareCookieImport } from "../api/cookies.js";
import { useRead } from "./useRecords.js";
import WideModal from "./WideModal.jsx";
import { usePreferences } from "./preferences.js";
import { downloadJson } from "./downloadJson.js";
import useFeedback from "./useFeedback.jsx";

const statusLabels = { success: "成功", skipped: "跳过", failed: "失败", invalid: "无效", conflict: "冲突", new: "新增" };
const statusColors = { success: "success", skipped: "default", failed: "error", invalid: "error", conflict: "warning", new: "success" };
const pagination = { pageSize: 30, simple: true, showSizeChanger: false, hideOnSinglePage: true };
const columns = (t) => [
  {
    title: t("状态"), dataIndex: "status", width: 82,
    render: (status) => <Tag color={statusColors[status]}>{t(statusLabels[status])}</Tag>,
  },
  {
    title: "Cookie", dataIndex: "name", rowScope: "row",
    render: (name, row) => <div className="cell-lines dialog-wrap">
      <span>{row.index == null ? name : t("第 {index} 条", { index: row.index })}</span>
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
  const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const [compatible, setCompatible] = useState(true);
  const running = useRef(false);
  const loadingBackup = mode === "export" && !stale;
  const load = useCallback(() => getSiteCookies(target), [target]);
  const backup = useRead(loadingBackup ? retry : null, load);
  const selected = new Set(selectedKeys);
  const exportRows = scope === "selected" ? (backup.value ?? []).filter((cookie) => selected.has(cookieId(cookie))) : backup.value ?? [];
  const importing = mode === "import";
  const conflicts = rows?.filter(({ previous }) => previous).length ?? 0;
  const invalid = rows?.filter(({ error: entryError }) => entryError).length ?? 0;
  const fresh = (rows?.length ?? 0) - conflicts - invalid;

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

  async function previewText(source) {
    if (new Blob([source]).size > cookieImportLimit) throw new Error("请选择不超过 4 MiB 的 JSON 文件");
    const preview = await prepareCookieImport(target, source);
    await verify(target);
    setRows(preview);
  }

  function choose(file) {
    if (running.current || stale) return Upload.LIST_IGNORE;
    setRows(null);
    setResults(null);
    setText("");
    setPolicy("skip");
    void perform(async () => {
      if (file.size > cookieImportLimit) throw new Error("请选择不超过 4 MiB 的 JSON 文件");
      await previewText(await file.text());
    });
    return Upload.LIST_IGNORE;
  }

  const confirm = () => perform(async () => {
    if (importing) {
      const applied = await applyCookieImport(target, rows, policy === "overwrite", () => verify(target));
      setResults(applied);
      onWrite();
    } else {
      downloadJson(exportCookies(target, exportRows, compatible), `storagebar-cookies-${target.hostname.replace(/[^a-z\d.-]/gi, "_")}.json`);
      notify(t("Cookie 备份已交给浏览器下载"));
      onClose();
    }
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
  return <WideModal title={importing ? t("导入 Cookie 备份") : t("导出 Cookie")} onCancel={onClose}
    keyboard={!working} closable={!working} footer={[
      <Button key="close" onClick={onClose} disabled={working}>{results ? t("关闭") : t("取消")}</Button>,
      !importing && <Button key="copy" disabled={working || stale || !exportRows.length} onClick={() => void perform(async () => {
        await navigator.clipboard.writeText(exportCookies(target, exportRows, compatible));
        notify(t("已复制"));
      })}>{t("复制 JSON")}</Button>,
      !results && <Button key="submit" type="primary" loading={working} onClick={confirm}
        disabled={stale || (importing ? !rows?.some((row) => !row.error) : !exportRows.length)}>
        {importing ? t("确认导入") : t("下载 JSON")}
      </Button>,
    ]}>
    <div className="dialog-stack">
      <Typography.Text code>{target.origin}</Typography.Text>
      {stale && <Alert type="warning" title={t("目标已变化，请重新打开此操作。")} showIcon />}
      {error && <Alert type="error" title={t(error)} showIcon />}
      {importing ? <>
        {!results && <>
          <Input.TextArea rows={4} className="data-input" aria-label={t("粘贴 Cookie JSON")} placeholder={t("粘贴 Cookie JSON")}
            value={text} readOnly={working || stale} onChange={(event) => { setText(event.target.value); setRows(null); }} />
          <div className="detail-actions">
            <Upload accept=".json,application/json" disabled={working || stale} showUploadList={false} beforeUpload={choose}>
              <Button disabled={working || stale}>{t("选择备份 JSON")}</Button>
            </Upload>
            <Button disabled={working || stale || !text.trim()} onClick={() => void perform(() => previewText(text))}>{t("预览导入")}</Button>
          </div>
        </>}
        {results ? <>
          <Alert type={report.failed ? "warning" : "success"} showIcon
            title={t("导入结果：成功 {success} · 跳过 {skipped} · 失败 {failed}", report)} />
        </> : rows ? <>
          <Typography.Text>{t("新增 {fresh} 项 · 冲突 {conflicts} 项 · 无效 {invalid} 项", { fresh, conflicts, invalid })}</Typography.Text>
          {conflicts > 0 && <Segmented block aria-label={t("Cookie 冲突处理")} value={policy} onChange={setPolicy} disabled={working || stale}
            options={[{ value: "skip", label: t("跳过冲突") }, { value: "overwrite", label: t("覆盖冲突") }]} />}
        </> : <Typography.Text type="secondary">{t("支持 StorageBar 备份和 Cookie-Editor JSON，确认前不会写入。")}</Typography.Text>}
        {(rows || results) && <Table key={results ? "results" : "preview"} className="compact-table" size="small"
          tableLayout="fixed" columns={columns(t)} rowKey="id" pagination={pagination} dataSource={tableRows} />}
      </> : <>
        {selectedKeys.length > 0 && <Segmented value={scope} onChange={setScope}
          options={[{ value: "all", label: t("本站全部") }, { value: "selected", label: t("仅选中项") }]} />}
        <Segmented value={compatible ? "compatible" : "backup"} onChange={(value) => setCompatible(value === "compatible")}
          options={[{ value: "compatible", label: t("兼容 JSON") }, { value: "backup", label: t("StorageBar 备份") }]} />
        <Alert type="warning" showIcon title={t("备份包含 Cookie 原值，包括可读取的 HttpOnly Cookie。")}
          description={t("JSON 将保存到本机。请只在你信任的地方保存和使用。")} />
        {backup.status === "loading" && !stale && <Spin size="small" />}
        {backup.status === "error" && <Alert type="error" title={t(backup.error)}
          action={<Button onClick={() => setRetry((value) => value + 1)}>{t("重试")}</Button>} />}
        {exportRows.length > 0 && <Typography.Text>{t("将导出当前站点的 {count} 项未分区 Cookie。", { count: exportRows.length })}</Typography.Text>}
        {backup.status === "ready" && !exportRows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有可导出的 Cookie")} />}
      </>}
    </div>
  </WideModal>;
}
