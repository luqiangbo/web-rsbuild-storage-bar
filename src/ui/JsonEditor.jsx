import React, { useMemo, useState } from "react";
import CodeMirror, { EditorState, EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { Alert, Button, Typography } from "antd";
import JsonCode from "./JsonCode.jsx";
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

export default function JsonEditor({ value, original, onChange, readOnly, meta }) {
  const { t, dark, language } = usePreferences();
  const [preview, setPreview] = useState(false);
  const error = jsonError(value);
  const invalid = !!error;
  const extensions = useMemo(() => [...editorExtensions, language === "zh" ? chinesePhrases : [], EditorView.contentAttributes.of({
    "aria-label": t("值 (JSON)"), "aria-invalid": String(invalid), spellcheck: "false",
  })], [invalid, language, t]);
  const limit = 4000;

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
      <Typography.Text type={invalid ? "danger" : "secondary"} className="cell-text json-editor-meta" title={meta || "JSON"}>
        {meta || "JSON"}
      </Typography.Text>
      {!readOnly && <div className="action-strip">
        {value !== original && <Button type="text" size="small" onClick={() => setPreview(!preview)}>
          {t(preview ? "收起预览" : "预览更改")}
        </Button>}
        <Button type="text" size="small" disabled={invalid} onClick={() => reformat(2)}>{t("格式化")}</Button>
        <Button type="text" size="small" disabled={invalid} onClick={() => reformat(0)}>{t("压缩")}</Button>
      </div>}
    </div>
    <CodeMirror className="json-editor" data-invalid={invalid || undefined}
      height="100%" value={value} readOnly={readOnly} editable={!readOnly} theme={dark ? "dark" : "light"}
      basicSetup={editorSetup} indentWithTab={false} extensions={extensions} onChange={onChange} />
    {error && <Alert type="error" showIcon title={t(error.line == null ? "JSON 格式无效" : "JSON 格式错误（第 {line} 行，第 {column} 列）", error)}
      description={error.line == null ? error.message : undefined} />}
    {preview && value !== original && <div className="json-diff json-editor-diff">
      {[[t("修改前"), original], [t("修改后"), value]].map(([label, text]) => <div key={label} className="diff-pane">
        <Typography.Text strong className="diff-pane-label">{label}</Typography.Text>
        <div className="diff-value-box">
          <JsonCode text={text.slice(0, limit)} />
        </div>
        {text.length > limit && <Typography.Text type="secondary">{t("预览已截断")}</Typography.Text>}
      </div>)}
    </div>}
  </div>;
}
