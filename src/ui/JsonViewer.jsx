import React, { useMemo } from "react";
import { Typography } from "antd";
import { formatJson, jsonTree, jsonTreeLimit } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";
import JsonCode from "./JsonCode.jsx";

export default function JsonViewer({ text }) {
  const { t } = usePreferences();
  const formatted = useMemo(() => {
    if (!jsonTree(text)) return null;
    const result = formatJson(text);
    return result.length <= jsonTreeLimit ? result : null;
  }, [text]);

  if (formatted !== null) {
    return <JsonCode text={formatted} />;
  }

  return <div className="json-fallback-view">
    <Typography.Text type="secondary" className="json-fallback-hint">
      {t("内容过大或嵌套过深，显示原文。")}
    </Typography.Text>
    <pre className="value-block value-block-framed">{text}</pre>
  </div>;
}
