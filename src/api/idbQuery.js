import { hasRoundedInteger } from "../ui/jsonDocument.js";

export function parseIdbQueryKey(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("请输入有效的 JSON 键"); }
  if (hasRoundedInteger(text)) throw new Error("此整数无法无损存入 IndexedDB，请使用字符串表示。");
  function encode(value) {
    if (typeof value === "string") return ["string", value];
    if (typeof value === "number") return ["number", String(value)];
    if (Array.isArray(value)) return ["array", value.map(encode)];
    if (value && typeof value === "object" && Object.keys(value).length === 1) {
      if (typeof value.date === "string") {
        const date = new Date(value.date);
        if (/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value.date) &&
            !Number.isNaN(date.valueOf())) return ["date", date.toISOString()];
      }
      if (typeof value.binary === "string" && /^(?:[\da-f]{2})*$/i.test(value.binary)) {
        return ["binary", (value.binary.match(/../g) ?? []).map((byte) => parseInt(byte, 16))];
      }
    }
    throw new Error("键必须是字符串、数字、数组、日期或二进制");
  }
  return encode(raw);
}
