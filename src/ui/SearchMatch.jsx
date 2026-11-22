import React from "react";
import Highlighter from "react-highlight-words";

export default function SearchMatch({ text, query }) {
  return query && text ? <Highlighter textToHighlight={text} searchWords={[query]} autoEscape
    highlightClassName="search-match" /> : text;
}
