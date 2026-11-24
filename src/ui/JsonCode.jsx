import React from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/light.js";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json.js";
import light from "react-syntax-highlighter/dist/esm/styles/hljs/github.js";
import dark from "react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js";
import { jsonTreeLimit } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";

SyntaxHighlighter.registerLanguage("json", json);

const codeStyle = {
  margin: 0,
  padding: "10px 12px",
  fontFamily: "var(--mono)",
  fontSize: "12.5px",
  lineHeight: 1.55,
  background: "transparent",
};

export default function JsonCode({ text }) {
  const preferences = usePreferences();
  if (text.length > jsonTreeLimit) return <pre className="value-block value-block-framed">{text}</pre>;
  return <div className="value-block-framed json-code-frame">
    <SyntaxHighlighter className="value-block" language="json" style={preferences.dark ? dark : light}
      customStyle={codeStyle} codeTagProps={{ style: { fontFamily: "inherit" } }} wrapLongLines>
      {text}
    </SyntaxHighlighter>
  </div>;
}
