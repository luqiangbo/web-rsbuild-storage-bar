import React, { useCallback, useEffect, useRef, useState } from "react";
import { Spin, Tree, Typography } from "antd";
import { runInPage } from "../api/page.js";
import { IconBucket, IconCache, IconDatabase, IconFolder, IconFolderOpen, IconTable, IconTreeChevron } from "./Icons.jsx";
import { usePreferences } from "./preferences.js";

export const mediaRoots = { opfs: "OPFS", idb: "IndexedDB", cache: "Cache" };
export const mediaPathKey = (path) => JSON.stringify(path);
export const isMediaContainer = (kind, path) => kind === "opfs" || path.length < (kind === "idb" ? 2 : 1);
const directoryKey = (source, path) => JSON.stringify([source, ...path]);

export async function readMediaFolders(target, kind, path, offset = 0) {
  if (kind === "opfs") return runInPage(target, "opfsList", { path, offset, directoriesOnly: true });
  const names = kind === "cache" ? await runInPage(target, "cacheNames")
    : path.length === 0 ? (await runInPage(target, "idbDatabases")).filter(({ pending }) => !pending).map(({ name }) => name)
      : (await runInPage(target, "idbStores", { dbName: path[0] })).map(({ name }) => name);
  return { rows: names.map((name) => ({ name, directory: true })), next: null };
}

function nodeIcon({ expanded, data }) {
  const depth = data.folder.length;
  if (data.source === "idb") {
    if (depth === 0) return <IconDatabase className="media-tree-root-icon" />;
    if (depth === 1) return <IconDatabase className="media-tree-folder-icon" />;
    return <IconTable className="media-tree-leaf-icon" />;
  }
  if (data.source === "cache") {
    if (depth === 0) return <IconCache className="media-tree-root-icon" />;
    return <IconBucket className="media-tree-leaf-icon" />;
  }
  const cls = depth === 0 ? "media-tree-root-icon" : "media-tree-folder-icon";
  return expanded ? <IconFolderOpen className={cls} /> : <IconFolder className={cls} />;
}

function switcherIcon({ expanded }) {
  return <IconTreeChevron className={expanded ? "media-tree-arrow is-open" : "media-tree-arrow"} />;
}

export default function MediaDirectory({ target, kind, path, onNavigate }) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(() => [directoryKey(kind, [])]);
  const [branches, setBranches] = useState(new Map());
  const currentBranches = useRef(new Map());
  const collapsedByUser = useRef(null);
  const enabled = useRef(false);
  useEffect(() => {
    enabled.current = true;
    return () => { enabled.current = false; };
  }, []);
  const load = useCallback(async (source, folder, append = false) => {
    if (!isMediaContainer(source, folder)) return;
    const key = directoryKey(source, folder);
    const last = currentBranches.current.get(key);
    if (last?.loading || (last?.ready && !append)) return;
    const offset = append ? last?.next : 0;
    if (offset == null) return;
    const rows = append ? last.rows : [];
    function update(branch) {
      if (!enabled.current) return;
      currentBranches.current = new Map(currentBranches.current).set(key, branch);
      setBranches(currentBranches.current);
    }
    update({ rows, next: append ? offset : null, loading: true });
    try {
      const result = await readMediaFolders(target, source, folder, offset);
      update({ rows: [...rows, ...result.rows], next: result.next, ready: true });
    } catch (failure) {
      update({ rows, next: append ? offset : null, error: failure.message || String(failure) });
    }
  }, [target]);

  useEffect(() => {
    const skipped = collapsedByUser.current;
    collapsedByUser.current = null;
    const folders = [[], ...path.map((_, index) => path.slice(0, index + 1))].filter((item) => isMediaContainer(kind, item));
    const keysToExpand = folders.map((folder) => directoryKey(kind, folder)).filter((key) => key !== skipped);
    if (keysToExpand.length) {
      setExpanded((keys) => [...new Set([...keys, ...keysToExpand])]);
    }
    for (const folder of folders) {
      if (directoryKey(kind, folder) !== skipped) void load(kind, folder);
    }
  }, [path, kind, load]);

  function node(source, folder, title) {
    const key = directoryKey(source, folder);
    const branch = branches.get(key);
    const names = new Set(branch?.rows.map(({ name }) => name));
    if (source === kind && folder.length < path.length && folder.every((part, index) => path[index] === part)) names.add(path[folder.length]);
    const children = [...names].map((name) => node(source, [...folder, name], name || t("（空名称）")));
    if (branch?.loading) children.push({ key: `loading:${key}`, title: <Spin size="small" />, disabled: true, isLeaf: true });
    if (branch?.error || (branch?.next != null && !branch.loading)) {
      children.push({
        key: `more:${key}`, source, folder, append: branch.next != null, isLeaf: true,
        title: <Typography.Text type={branch.error ? "danger" : "secondary"} title={t(branch.error)}>
          {t(branch.error ? "重试读取目录" : "加载更多文件夹")}
        </Typography.Text>,
      });
    }
    const isRoot = folder.length === 0;
    return {
      key,
      title: <span className={`media-tree-label${isRoot ? " is-root" : ""}`} title={title}>{title}</span>,
      source,
      folder,
      children,
      icon: nodeIcon,
      isLeaf: !isMediaContainer(source, folder) || !!(branch?.ready && !children.length),
    };
  }

  const activeKey = directoryKey(kind, path);

  return <div className="media-tree-groups">
    {Object.entries(mediaRoots).map(([source, title]) => {
      const prefix = `["${source}"`;
      const groupExpanded = expanded.filter((key) => key.startsWith(prefix));
      const groupSelected = source === kind ? [activeKey] : [];
      return <section key={source} className="media-tree-group" data-source={source} aria-label={title}>
        <Tree.DirectoryTree className="media-dir-tree" aria-label={title} blockNode expandAction="click"
          switcherIcon={switcherIcon}
          treeData={[node(source, [], title)]}
          expandedKeys={groupExpanded}
          selectedKeys={groupSelected}
          onExpand={(keys, { expanded: open, node: item }) => {
            collapsedByUser.current = open ? null : item.key;
            setExpanded((all) => [...all.filter((key) => !key.startsWith(prefix)), ...keys]);
            if (open) void load(item.source, item.folder);
          }}
          onSelect={(_, { node: item }) => {
            if (item.key.startsWith("more:")) void load(item.source, item.folder, item.append);
            else onNavigate(item.source, item.folder);
          }} />
      </section>;
    })}
  </div>;
}
