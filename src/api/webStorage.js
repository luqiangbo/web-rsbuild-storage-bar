export const backupFormat = "storagebar-web-storage";

export function parseWebBackup(text, kind) {
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error("无法解析 JSON 文件"); }
  if (backup?.format !== backupFormat || backup.version !== 1 || typeof backup.origin !== "string" ||
      !Array.isArray(backup.entries)) throw new Error("请选择 StorageBar 的 Web Storage 备份");
  let origin;
  try { origin = new URL(backup.origin); } catch { throw new Error("备份来源无效"); }
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== backup.origin) throw new Error("备份来源无效");
  if (backup.kind !== kind) throw new Error("备份与当前存储类型不一致");
  const keys = new Set();
  for (const entry of backup.entries) {
    if (!entry || typeof entry.key !== "string" || typeof entry.value !== "string" || keys.has(entry.key)) {
      throw new Error("备份包含无效或重复的键值");
    }
    keys.add(entry.key);
  }
  return { origin: backup.origin, entries: backup.entries.map(({ key, value }) => ({ key, value })) };
}

export function makeWebBackup(origin, kind, rows) {
  return JSON.stringify({ format: backupFormat, version: 1, origin, kind,
    entries: rows.map(({ id, value }) => ({ key: id, value })) }, null, 2);
}

export function compareWebStorage(before, after) {
  const old = new Map(before.map(({ id, value }) => [id, value]));
  const current = new Map(after.map(({ id, value }) => [id, value]));
  return [...new Set([...old.keys(), ...current.keys()])].flatMap((key) => {
    const previous = old.get(key);
    const value = current.get(key);
    if (previous === value) return [];
    return [{ key, previous, value, status: previous === undefined ? "added" : value === undefined ? "removed" : "changed" }];
  });
}
