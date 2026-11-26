import React, { useMemo, useState } from "react";
import { AlignLeftOutlined, CompressOutlined, DiffOutlined, RollbackOutlined } from "@ant-design/icons";
import CodeMirror, { EditorState, EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { Alert, Button, Tag, Typography } from "antd";
import IconAction from "./IconAction.jsx";
import { jsonError } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";

const editorExtensions = [
  json(),
  // Split only on LF so an untouched CRLF or mixed line ending stays in the source text.
  EditorState.lineSeparator.of("\n"),
];
const editorSetup = { autocompletion: false, foldGutter: true, lineNumbers: true };
const chinesePhrases = EditorState.phrases.of({
  Find: "查找", Replace: "替换", next: "下一个", previous: "上一个", all: "全选",
  "match case": "区分大小写", regexp: "正则表达式", "by word": "全词匹配",
  replace: "替换", "replace all": "全部替换", close: "关闭",
  "Go to line": "跳转到行", go: "跳转", "Fold line": "折叠此行", "Unfold line": "展开此行",
  "folded code": "已折叠的代码", unfold: "展开",
});

function computeLineDiff(beforeText, afterText) {
  const a = beforeText.replace(/\r\n/g, "\n").split("\n");
  const b = afterText.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

  const rows = [];
  for (let i = 0; i < start; i++) rows.push({ type: "same", oldNo: i + 1, newNo: i + 1, text: a[i] });

  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  if (midA.length * midB.length > 250_000) {
    midA.forEach((line, idx) => rows.push({ type: "del", oldNo: start + idx + 1, newNo: null, text: line }));
    midB.forEach((line, idx) => rows.push({ type: "add", oldNo: null, newNo: start + idx + 1, text: line }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        rows.push({ type: "same", oldNo: start + i + 1, newNo: start + j + 1, text: midA[i] });
        i++;
        j++;
      } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
        rows.push({ type: "add", oldNo: null, newNo: start + j + 1, text: midB[j] });
        j++;
      } else {
        rows.push({ type: "del", oldNo: start + i + 1, newNo: null, text: midA[i] });
        i++;
      }
    }
  }

  for (let i = endA + 1, j = endB + 1; i < a.length; i++, j++) {
    rows.push({ type: "same", oldNo: i + 1, newNo: j + 1, text: a[i] });
  }
  return rows;
}

export default function JsonEditor({ value, original, onChange, readOnly, meta, leading }) {
  const { t, dark, language } = usePreferences();
  const [preview, setPreview] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);
  const error = jsonError(value);
  const invalid = !!error;
  const dirty = value !== original;
  const showingDiff = preview && dirty;
  const extensions = useMemo(() => [...editorExtensions, language === "zh" ? chinesePhrases : [], EditorView.contentAttributes.of({
    "aria-label": t("值 (JSON)"), "aria-invalid": String(invalid), spellcheck: "false",
  })], [invalid, language, t]);

  const diffRows = useMemo(() => (showingDiff ? computeLineDiff(original, value) : []), [showingDiff, original, value]);
  const diffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const row of diffRows) {
      if (row.type === "add") added++;
      else if (row.type === "del") removed++;
    }
    return { added, removed };
  }, [diffRows]);

  const visibleDiffRows = useMemo(() => {
    if (!changesOnly) return diffRows;
    const context = 2;
    const keep = new Uint8Array(diffRows.length);
    for (let i = 0; i < diffRows.length; i++) {
      if (diffRows[i].type !== "same") {
        for (let k = Math.max(0, i - context); k <= Math.min(diffRows.length - 1, i + context); k++) keep[k] = 1;
      }
    }
    const result = [];
    let skipped = 0;
    for (let i = 0; i < diffRows.length; i++) {
      if (keep[i]) {
        if (skipped > 0) {
          result.push({ type: "gap", count: skipped, key: `gap-${i}` });
          skipped = 0;
        }
        result.push({ ...diffRows[i], key: `line-${i}` });
      } else {
        skipped++;
      }
    }
    if (skipped > 0) result.push({ type: "gap", count: skipped, key: "gap-end" });
    return result;
  }, [diffRows, changesOnly]);

  function reformat(spaces) {
    if (invalid || readOnly) return;
    try {
      const next = JSON.stringify(JSON.parse(value), null, spaces);
      if (next !== value) onChange(next);
    } catch {
      // Ignore if value cannot be parsed cleanly
    }
  }

  return <div className="json-editor-wrap">
    <div className="json-editor-bar">
      {leading ? <div className="json-editor-leading">{leading}</div>
        : <Typography.Text type={invalid ? "danger" : "secondary"} className="cell-text json-editor-meta" title={meta || "JSON"}>
          {meta || "JSON"}
        </Typography.Text>}
      {!readOnly && <div className="action-strip json-editor-actions" role="group" aria-label={t("编辑器操作")}>
        {dirty && <div className="action-group">
          <IconAction icon={<DiffOutlined />} label={t(showingDiff ? "返回编辑" : "对比更改")}
            aria-pressed={showingDiff} className={showingDiff ? "is-active-tool" : undefined}
            onClick={() => setPreview(!preview)} />
          <IconAction icon={<RollbackOutlined />} label={t("还原修改")}
            onClick={() => { setPreview(false); onChange(original); }} />
        </div>}
        <div className="action-group">
          <IconAction icon={<AlignLeftOutlined />} label={t("格式化")} disabled={invalid || showingDiff} onClick={() => reformat(2)} />
          <IconAction icon={<CompressOutlined />} label={t("压缩")} disabled={invalid || showingDiff} onClick={() => reformat(0)} />
        </div>
      </div>}
    </div>
    {showingDiff ? <div className="line-diff-shell">
      <div className="line-diff-header">
        <div className="line-diff-stats">
          <Tag color="success">+{diffStats.added}</Tag>
          <Tag color="error">-{diffStats.removed}</Tag>
        </div>
        <Button type="text" size="small" onClick={() => setChangesOnly(!changesOnly)}>
          {t(changesOnly ? "显示全部" : "仅看变更")}
        </Button>
      </div>
      <div className="line-diff-scroll">
        {visibleDiffRows.map((row, idx) => row.type === "gap" ? (
          <div key={row.key} className="line-diff-gap">
            {t("已折叠 {count} 行未变更内容", { count: row.count })}
          </div>
        ) : (
          <div key={row.key ?? idx} className={`line-diff-row is-${row.type}`}>
            <span className="line-diff-no">{row.oldNo ?? ""}</span>
            <span className="line-diff-no">{row.newNo ?? ""}</span>
            <span className="line-diff-sign">{row.type === "add" ? "+" : row.type === "del" ? "-" : " "}</span>
            <span className="line-diff-code">{row.text || " "}</span>
          </div>
        ))}
      </div>
    </div> : <CodeMirror className="json-editor" data-invalid={invalid || undefined}
      height="100%" value={value} readOnly={readOnly} editable={!readOnly} theme={dark ? "dark" : "light"}
      basicSetup={editorSetup} indentWithTab={false} extensions={extensions} onChange={onChange} />}
    {error && !showingDiff && <Alert type="error" showIcon title={t(error.line == null ? "JSON 格式无效" : "JSON 格式错误（第 {line} 行，第 {column} 列）", error)}
      description={error.line == null ? error.message : undefined} />}
  </div>;
}
