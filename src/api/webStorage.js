export function parseWebBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text.trim()); } catch { throw new Error("无法解析 JSON 内容"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请粘贴键值对 JSON 对象，例如 {\"key\": \"value\"}");
  }
  const entries = Object.entries(parsed).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  if (!entries.length) throw new Error("JSON 对象为空，没有可导入的键值");
  return entries;
}

export function exportWebStorage(kind, rows, format = "json") {
  if (format === "script") {
    const api = kind === "session" ? "sessionStorage" : "localStorage";
    return rows.map(({ id, value }) => `${api}.setItem(${JSON.stringify(id)}, ${JSON.stringify(value)});`).join("\n");
  }
  const map = {};
  for (const { id, value } of rows) map[id] = value;
  return JSON.stringify(map, null, 2);
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
