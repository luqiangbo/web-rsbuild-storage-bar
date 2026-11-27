import React, { useMemo, useState } from "react";
import { Button, Tag } from "antd";
import { usePreferences } from "./preferences.js";

export function computeLineDiff(beforeText, afterText) {
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

export default function LineDiff({ before, after, defaultChangesOnly = false, headerExtra = null }) {
  const { t } = usePreferences();
  const [changesOnly, setChangesOnly] = useState(defaultChangesOnly);
  const diffRows = useMemo(() => computeLineDiff(before, after), [before, after]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const row of diffRows) {
      if (row.type === "add") added++;
      else if (row.type === "del") removed++;
    }
    return { added, removed };
  }, [diffRows]);

  const visibleRows = useMemo(() => {
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

  return <div className="line-diff-shell">
    <div className="line-diff-header">
      <div className="line-diff-stats">
        {headerExtra}
        <Tag color="success">+{stats.added}</Tag>
        <Tag color="error">-{stats.removed}</Tag>
      </div>
      <Button type="text" size="small" onClick={() => setChangesOnly(!changesOnly)}>
        {t(changesOnly ? "显示全部" : "仅看变更")}
      </Button>
    </div>
    <div className="line-diff-scroll">
      {visibleRows.map((row, idx) => row.type === "gap" ? (
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
  </div>;
}
