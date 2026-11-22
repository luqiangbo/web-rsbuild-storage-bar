const tokenPattern = /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g;
const open = (token) => token === "{" || token === "[";
const close = (token) => token === "}" || token === "]";
export const jsonTreeLimit = 200_000;

export function jsonError(text) {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const offset = /position (\d+)/i.exec(error.message)?.[1];
    const location = /line (\d+) column (\d+)/i.exec(error.message);
    if (location) return { line: Number(location[1]), column: Number(location[2]), message: error.message };
    if (offset === undefined && !/unexpected end/i.test(error.message)) return { message: error.message };
    const prefix = text.slice(0, offset === undefined ? text.length : Number(offset));
    const lines = prefix.split("\n");
    return { line: lines.length, column: lines.at(-1).length + 1, message: error.message };
  }
}

// Keep the original tokens, including numeric lexemes and escape sequences.
export function formatJson(text) {
  const tokens = Array.from(text.matchAll(tokenPattern), ([token]) => token);
  let depth = 0;
  const indent = () => "\n" + "  ".repeat(depth);
  return tokens.map((token, index) => {
    const previous = tokens[index - 1];
    if (open(token)) {
      depth++;
      return (open(previous) ? "\n" + "  ".repeat(depth - 1) : "") + token;
    }
    if (close(token)) {
      depth--;
      return (open(previous) ? "" : indent()) + token;
    }
    if (token === ",") return "," + indent();
    if (token === ":") return ": ";
    return (open(previous) ? indent() : "") + token;
  }).join("");
}

export function jsonTree(text) {
  if (text.length > jsonTreeLimit) return null;
  const tokens = Array.from(text.matchAll(tokenPattern));
  let index = 0;
  function read(key, path, depth) {
    if (depth > 120 || index >= tokens.length || index > 25_000) throw new Error("unsupported depth or size");
    const token = tokens[index++];
    const start = token.index;
    const value = token[0];
    const node = { id: start, key, path, start, end: start + value.length, value, children: null };
    if (!open(value)) return node;
    node.children = [];
    const array = value === "[";
    const end = array ? "]" : "}";
    while (tokens[index]?.[0] !== end) {
      const childKey = array ? String(node.children.length) : JSON.parse(tokens[index++][0]);
      if (!array) index++; // colon
      node.children.push(read(childKey, [...path, childKey], depth + 1));
      if (tokens[index]?.[0] === ",") index++;
    }
    node.end = tokens[index++].index + 1;
    return node;
  }
  try { return read(null, [], 0); } catch { return null; }
}

export function jsonPointer(path) {
  return path.map((part) => "/" + part.replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

export function hasRoundedInteger(text) {
  for (const [token] of text.matchAll(tokenPattern)) {
    if (!/^-?\d/.test(token)) continue;
    const number = Number(token);
    if (!Number.isInteger(number) || Number.isSafeInteger(number)) continue;
    const [mantissa, exponent] = token.toLowerCase().split("e");
    const [whole, decimal = ""] = mantissa.split(".");
    const digits = (whole + decimal).replace(/^-/, "");
    const shift = Number(exponent ?? 0) - decimal.length;
    if (shift <= -digits.length || shift > 309) continue;
    const tail = shift < 0 ? digits.slice(shift) : "";
    if (/[1-9]/.test(tail)) continue;
    const integral = shift < 0 ? digits.slice(0, shift) : digits + "0".repeat(shift);
    if (BigInt(integral) !== BigInt(Math.abs(number))) return true;
  }
  return false;
}
