import React, { useMemo, useState } from "react";
import CodeMirror, { EditorState, EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { Alert, Typography } from "antd";
import IconAction from "./IconAction.jsx";
import { IconDiff, IconFormat, IconMinify, IconRevert } from "./Icons.jsx";
import { jsonError } from "./jsonDocument.js";
import LineDiff from "./LineDiff.jsx";
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

export default function JsonEditor({ value, original, onChange, readOnly, meta, leading }) {
  const { t, dark, language } = usePreferences();
  const [preview, setPreview] = useState(false);
  const error = jsonError(value);
  const invalid = !!error;
  const dirty = value !== original;
  const showingDiff = preview && dirty;
  const extensions = useMemo(() => [...editorExtensions, language === "zh" ? chinesePhrases : [], EditorView.contentAttributes.of({
    "aria-label": t("值 (JSON)"), "aria-invalid": String(invalid), spellcheck: "false",
  })], [invalid, language, t]);

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
          <IconAction icon={<IconDiff />} label={t(showingDiff ? "返回编辑" : "对比更改")}
            aria-pressed={showingDiff} className={showingDiff ? "is-active-tool" : undefined}
            onClick={() => setPreview(!preview)} />
          <IconAction icon={<IconRevert />} label={t("还原修改")}
            onClick={() => { setPreview(false); onChange(original); }} />
        </div>}
        <div className="action-group">
          <IconAction icon={<IconFormat />} label={t("格式化")} disabled={invalid || showingDiff} onClick={() => reformat(2)} />
          <IconAction icon={<IconMinify />} label={t("压缩")} disabled={invalid || showingDiff} onClick={() => reformat(0)} />
        </div>
      </div>}
    </div>
    {showingDiff ? <LineDiff before={original} after={value} />
      : <CodeMirror className="json-editor" data-invalid={invalid || undefined}
        height="100%" value={value} readOnly={readOnly} editable={!readOnly} theme={dark ? "dark" : "light"}
        basicSetup={editorSetup} indentWithTab={false} extensions={extensions} onChange={onChange} />}
    {error && !showingDiff && <Alert type="error" showIcon title={t(error.line == null ? "JSON 格式无效" : "JSON 格式错误（第 {line} 行，第 {column} 列）", error)}
      description={error.line == null ? error.message : undefined} />}
  </div>;
}
