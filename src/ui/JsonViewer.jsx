import React, { useEffect, useMemo, useRef, useState } from "react";
import { DownOutlined, FileTextOutlined, MoreOutlined, UpOutlined } from "@ant-design/icons";
import { Input, Segmented, Tree, Typography } from "antd";
import ActionMenu, { menuShortcut, useActionMenu } from "./ActionMenu.jsx";
import IconAction from "./IconAction.jsx";
import { jsonPointer, jsonTree, formatJson } from "./jsonDocument.js";
import { usePreferences } from "./preferences.js";
import useFeedback from "./useFeedback.jsx";
import JsonCode from "./JsonCode.jsx";
import SearchMatch from "./SearchMatch.jsx";

function buildTree(root) {
  const nodes = new Map();
  function visit(node) {
    const key = String(node.id);
    nodes.set(key, node);
    return { key, isLeaf: !node.children?.length, children: node.children?.map(visit) };
  }
  return { nodes, data: root ? [visit(root)] : [] };
}

function findNodes(root, query) {
  const matches = [];
  function visit(node, parents) {
    const value = !node.children && (node.value.startsWith('"') ? JSON.parse(node.value) : node.value);
    if (node.key?.toLowerCase().includes(query) || (value && value.toLowerCase().includes(query))) {
      matches.push({ node, parents });
    }
    node.children?.forEach((child) => visit(child, [...parents, String(node.id)]));
  }
  if (root && query) visit(root, []);
  return matches;
}

function valueType(value) {
  if (value.startsWith('"')) return "string";
  if (value === "null") return "null";
  if (value === "true" || value === "false") return "boolean";
  return "number";
}

export default function JsonViewer({ text, rawDefault }) {
  const { t } = usePreferences();
  const notify = useFeedback();
  const [mode, setMode] = useState(rawDefault ? "raw" : "tree");
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [selection, setSelection] = useState(null);
  const [expansion, setExpansion] = useState(null);
  const [revealMatch, setRevealMatch] = useState(false);
  const tree = useRef(null);
  const treeArea = useRef(null);
  const activeKey = useRef(null);
  const root = useMemo(() => jsonTree(text), [text]);
  const { nodes, data } = useMemo(() => buildTree(root), [root]);
  const currentMode = root ? mode : "raw";
  const menu = useActionMenu(root && currentMode === "tree" ? root : null);
  const formatted = useMemo(() => currentMode === "formatted" ? formatJson(text) : null, [currentMode, text]);
  const term = query.trim();
  const matches = useMemo(() => findNodes(root, term.toLowerCase()), [root, term]);
  const match = matches[Math.min(matchIndex, matches.length - 1)];
  const matchKey = match ? String(match.node.id) : null;
  const selected = (selection?.root === root ? nodes.get(selection.key) : null) ?? match?.node ?? root;
  const selectedKey = selected ? String(selected.id) : undefined;
  const expanded = expansion?.root === root ? expansion.keys : root?.children?.length ? [String(root.id)] : [];
  const expandedKeys = revealMatch && match ? [...new Set([...expanded, ...match.parents])] : expanded;
  const menuNode = nodes.get(menu.request?.id);

  useEffect(() => {
    if (currentMode !== "tree" || !revealMatch || matchKey === null) return;
    const frame = requestAnimationFrame(() => tree.current?.scrollTo({ key: matchKey }));
    return () => cancelAnimationFrame(frame);
  }, [currentMode, revealMatch, matchKey, match]);

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      notify(t("已复制"));
    } catch {
      notify(t("复制失败"), "error");
    }
  }

  function search(value) {
    menu.dismiss();
    setQuery(value);
    setMatchIndex(0);
    setSelection(null);
    setRevealMatch(true);
  }

  function moveMatch(step) {
    setMatchIndex((index) => (Math.min(index, matches.length - 1) + step + matches.length) % matches.length);
    setSelection(null);
    setRevealMatch(true);
  }

  function openNodeMenu(event, key, anchor, position) {
    if (!nodes.has(key)) return;
    setSelection({ root, key });
    menu.open(event, key, anchor, position);
  }

  function actOnNode(action, key) {
    const node = nodes.get(key);
    if (!node) return;
    if (action === "key" && node.key !== null) void copy(node.key);
    if (action === "value") void copy(text.slice(node.start, node.end));
    if (action === "path") void copy(jsonPointer(node.path));
  }

  return <div className="json-viewer dialog-stack">
    <div className="json-viewer-toolbar">
      <Segmented block size="small" aria-label={t("值的显示方式")} value={currentMode}
        options={[
          { value: "tree", label: t("结构树"), disabled: !root },
          { value: "formatted", label: t("格式化"), disabled: !root },
          { value: "raw", label: t("原文") },
        ]} onChange={(value) => { menu.dismiss(); setMode(value); }} />
      <div className="action-strip" role="group" aria-label={t("复制")}>
        <IconAction icon={<FileTextOutlined />} label={t(currentMode === "formatted" ? "复制格式化 JSON" : "复制原文")}
          onClick={() => copy(currentMode === "formatted" ? formatted : text)} />
      </div>
    </div>
    {!root && <Typography.Text type="secondary">{t("内容过大或嵌套过深，显示原文。")}</Typography.Text>}
    {currentMode === "tree" ? <>
      <div className="find-row">
        <Input size="small" className="search" allowClear aria-label={t("搜索 JSON 键或值")} placeholder={t("搜索 JSON 键或值")}
          value={query} onChange={(event) => search(event.target.value)}
          onPressEnter={(event) => { if (matches.length > 1) moveMatch(event.shiftKey ? -1 : 1); }} />
        {term && <Typography.Text className="json-search-count" type="secondary" role="status">
          {matches.length ? `${Math.min(matchIndex + 1, matches.length)}/${matches.length}` : t("无匹配")}
        </Typography.Text>}
        {term && <>
          <IconAction icon={<UpOutlined />} label={t("上一个")} disabled={matches.length < 2} onClick={() => moveMatch(-1)} />
          <IconAction icon={<DownOutlined />} label={t("下一个")} disabled={matches.length < 2} onClick={() => moveMatch(1)} />
        </>}
      </div>
      <div className="json-tree-frame" ref={treeArea}>
        <Tree ref={tree} className="json-tree" aria-label={t("JSON 树")} aria-keyshortcuts="Shift+F10 ContextMenu"
          blockNode height={Math.min(360, Math.max(160, Math.round(window.innerHeight * 0.42)))} virtual
          treeData={data} expandedKeys={expandedKeys} selectedKeys={[selectedKey]}
          onSelect={(_, { node }) => setSelection({ root, key: node.key })}
          onExpand={(keys) => { setExpansion({ root, keys }); setRevealMatch(false); menu.dismiss(); }}
          onActiveChange={(key) => { activeKey.current = key; }}
          onKeyDown={(event) => {
            if (!menuShortcut(event)) return;
            const key = nodes.has(activeKey.current) ? activeKey.current : selectedKey;
            const row = treeArea.current?.querySelector(`[data-json-node="${key}"]`);
            openNodeMenu(event, key, event.target, row ?? treeArea.current);
          }}
          onRightClick={({ event, node }) => {
            const anchor = event.currentTarget.querySelector("[data-json-actions]");
            if (anchor) openNodeMenu(event, node.key, anchor);
          }}
          titleRender={({ key }) => {
            const node = nodes.get(key);
            const label = node.key ?? t("根节点");
            const array = node.value === "[";
            return <span className="json-tree-entry" data-json-node={key}>
              <span className="cell-text json-tree-label" title={label}>
                <SearchMatch text={label} query={node.key === null ? "" : term} />
              </span>
              {node.children ? <Typography.Text type="secondary" className="cell-text json-tree-value">
                {array ? "[ ]" : "{ }"} · {t("{count} 个子项", { count: node.children.length })}
              </Typography.Text> : <span className="cell-text json-tree-value" data-type={valueType(node.value)}>
                <SearchMatch text={node.value} query={term} />
              </span>}
              <IconAction tabIndex={-1} data-json-actions="" icon={<MoreOutlined />} label={t("节点操作")}
                aria-haspopup="menu" aria-expanded={menu.request?.id === key}
                onClick={(event) => openNodeMenu(event, key)}
                onKeyDown={(event) => {
                  if (menuShortcut(event)) openNodeMenu(event, key);
                  else if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                }} />
            </span>;
          }} />
      </div>
      {selected && <div className="json-selection">
        <Typography.Text code className="dialog-wrap">{jsonPointer(selected.path) || t("根节点")}</Typography.Text>
        {!selected.children && <pre className="value-block json-selection-value" data-type={valueType(selected.value)}>{selected.value}</pre>}
      </div>}
      {menuNode && <ActionMenu request={menu.request} label={t("节点操作")} onDismiss={menu.dismiss} onAction={actOnNode}
        items={[
          { key: "key", label: t("复制键"), disabled: menuNode.key === null },
          { key: "value", label: t("复制值") }, { key: "path", label: t("复制路径") },
        ]} />}
    </> : currentMode === "formatted" ? <JsonCode text={formatted} /> : <pre className="value-block">{text}</pre>}
  </div>;
}
