import React from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/light.js";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json.js";
import light from "react-syntax-highlighter/dist/esm/styles/hljs/github.js";
import dark from "react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark.js";
import { jsonTreeLimit } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";

SyntaxHighlighter.registerLanguage("json", json);

export default function JsonCode({ text }) {
  const preferences = usePreferences();
  if (text.length > jsonTreeLimit) return <pre className="value-block">{text}</pre>;
  return <SyntaxHighlighter className="value-block" language="json" style={preferences.dark ? dark : light}
    customStyle={{ margin: 0, fontFamily: "var(--mono)" }} codeTagProps={{ style: { fontFamily: "inherit" } }} wrapLongLines>
    {text}
  </SyntaxHighlighter>;
}
