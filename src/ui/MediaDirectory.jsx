import React, { useCallback, useEffect, useRef, useState } from "react";
import { FolderOutlined } from "@ant-design/icons";
import { Spin, Tree, Typography } from "antd";
import { runInPage } from "../api/page.js";
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

function folderIcons() {
  return <FolderOutlined />;
}

export default function MediaDirectory({ target, kind, path, onNavigate }) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(() => [directoryKey(kind, [])]);
  const [branches, setBranches] = useState(new Map());
  const currentBranches = useRef(new Map());
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
    const folders = [[], ...path.map((_, index) => path.slice(0, index + 1))].filter((item) => isMediaContainer(kind, item));
    setExpanded((keys) => [...new Set([...keys, ...folders.map((folder) => directoryKey(kind, folder))])]);
    for (const folder of folders) void load(kind, folder);
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
    return {
      key, title: <span className="media-tree-label" title={title}>{title}</span>, source, folder, children, icon: folderIcons,
      isLeaf: !isMediaContainer(source, folder) || !!(branch?.ready && !children.length),
    };
  }

  return <Tree.DirectoryTree className="media-dir-tree" aria-label={t("目录")} blockNode expandAction={false}
    treeData={Object.entries(mediaRoots).map(([source, title]) => node(source, [], title))}
    expandedKeys={expanded} selectedKeys={[directoryKey(kind, path)]}
    onExpand={(keys, { expanded: open, node: item }) => {
      setExpanded(keys);
      if (open) void load(item.source, item.folder);
    }}
    onSelect={(_, { node: item }) => {
      if (item.key.startsWith("more:")) void load(item.source, item.folder, item.append);
      else onNavigate(item.source, item.folder);
    }} />;
}
