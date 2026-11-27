import { hostPermission } from "./page.js";

const normalizeHost = (host) => host.toLowerCase().replace(/^\./, "").replace(/^\[|\]$/g, "");
const domainHost = (cookie) => normalizeHost(cookie.domain);

function matchesHost(cookie, hostname) {
  const domain = domainHost(cookie);
  const host = normalizeHost(hostname);
  return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
}

export function cookieId(cookie) {
  return JSON.stringify([cookie.storeId, domainHost(cookie), cookie.hostOnly, cookie.path, cookie.name]);
}

export const cookieSameSite = ["unspecified", "lax", "strict", "no_restriction"];
export const cookieImportLimit = 4 * 1024 * 1024;

function validateCookie(target, input) {
  if (!input || typeof input !== "object" || input.partitionKey) throw new Error("仅支持未分区 Cookie");
  const { name, value, domain, path, hostOnly, secure, httpOnly, sameSite, expirationDate } = input;
  if ([name, value, domain, path].some((field) => typeof field !== "string") ||
    [hostOnly, secure, httpOnly].some((field) => typeof field !== "boolean") ||
    !cookieSameSite.includes(sameSite)) throw new Error("Cookie 字段格式不正确");
  if (/[\x00-\x20\x7f;=]/.test(name) || /[\x00-\x1f\x7f;]/.test(value) || (!name && !value)) {
    throw new Error("Cookie 名称或值包含无效字符，或两者均为空");
  }
  if (!path.startsWith("/") || /[\x00-\x1f\x7f;]/.test(path)) throw new Error("Cookie 路径必须以 / 开头且为有效路径");
  const host = domainHost(input);
  const sourceHost = host.includes(":") ? `[${host}]` : host;
  try {
    const url = new URL(`https://${sourceHost}/`);
    if (normalizeHost(url.hostname) !== host || !/^[a-z0-9.:[\]-]+$/i.test(sourceHost) ||
        url.username || url.password || url.port || url.pathname !== "/") throw new Error();
  } catch { throw new Error("请填写有效的 Cookie 域名"); }
  if (!matchesHost(input, target.hostname)) throw new Error("Cookie 域名不属于当前目标站点");
  if (sameSite === "no_restriction" && !secure) throw new Error("SameSite=None 需要启用 Secure");
  if (expirationDate !== undefined && (!Number.isFinite(expirationDate) || expirationDate <= Date.now() / 1000)) {
    throw new Error("请选择未来的到期时间，或留空作为会话 Cookie");
  }
  return { name, value, domain: hostOnly ? sourceHost : `.${sourceHost}`, path, hostOnly, secure, httpOnly, sameSite, expirationDate };
}

async function cookieStore(tabId) {
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find(({ tabIds }) => tabIds.includes(tabId));
  if (!store) throw new Error("无法定位该标签页的 Cookie 存储区");
  return store.id;
}

export async function getSiteCookies(target) {
  const storeId = await cookieStore(target.tabId);
  const cookies = await chrome.cookies.getAll({ storeId });
  return cookies.filter((cookie) => !cookie.partitionKey && matchesHost(cookie, target.hostname));
}

async function readExact(cookie) {
  const candidates = await chrome.cookies.getAll({
    storeId: cookie.storeId, name: cookie.name, path: cookie.path,
  });
  const matches = candidates.filter((candidate) => !candidate.partitionKey && cookieId(candidate) === cookieId(cookie));
  if (matches.length > 1) throw new Error("无法唯一定位这条 Cookie");
  return matches[0];
}

async function cookieDetails(target, cookie, storeId = null) {
  if (cookie.partitionKey || !matchesHost(cookie, target.hostname) ||
      cookie.storeId !== (storeId ?? await cookieStore(target.tabId))) {
    throw new Error("Cookie 已不属于当前目标");
  }
  const protocols = cookie.secure ? ["https:"] : [...new Set([target.protocol, "https:", "http:"])];
  const host = domainHost(cookie);
  const sourceHost = host.includes(":") ? `[${host}]` : host;
  for (const protocol of protocols) {
    const url = new URL(`${protocol}//${sourceHost}/`);
    if (await chrome.permissions.contains({ origins: [hostPermission(url)] })) {
      return {
        url: url.href, name: cookie.name, storeId: cookie.storeId, path: cookie.path,
        secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
      };
    }
  }
  throw new Error("缺少此 Cookie 域名或协议的访问权限");
}

function sameCookie(a, b) {
  return cookieId(a) === cookieId(b) && a.value === b.value && a.expirationDate === b.expirationDate &&
    a.secure === b.secure && a.httpOnly === b.httpOnly && a.sameSite === b.sameSite;
}

export async function saveCookie(target, input, previous, verify, skipExisting = false) {
  const validated = validateCookie(target, input);
  const { value, expirationDate } = validated;
  const cookie = { ...validated, storeId: await cookieStore(target.tabId) };
  const details = await cookieDetails(target, cookie, cookie.storeId);
  const current = await readExact(cookie);
  if (previous && (!current || !sameCookie(current, previous))) throw new Error("Cookie 已变化，请重新预览后操作");
  if (!previous && current) {
    if (skipExisting) return { status: "skipped", detail: "同名、同域且同路径的 Cookie 已存在" };
    throw new Error("此域名和路径下已存在同名 Cookie");
  }
  await verify();
  await chrome.cookies.set({ ...details, value, ...(expirationDate === undefined ? {} : { expirationDate }) });
  const saved = await readExact(cookie);
  if (!saved || saved.value !== value || saved.session !== (expirationDate === undefined) ||
      saved.secure !== cookie.secure || saved.httpOnly !== cookie.httpOnly || saved.sameSite !== cookie.sameSite) {
    throw new Error("未能确认 Cookie 已保存，请刷新后检查");
  }
  return { status: "success", detail: expirationDate !== undefined && Math.abs(saved.expirationDate - expirationDate) > 1
    ? "浏览器调整了到期时间" : undefined };
}

function exportFields({ name, value, domain, path, hostOnly, secure, httpOnly, sameSite, expirationDate }) {
  return { name, value, domain, path, hostOnly, secure, httpOnly, sameSite, expirationDate };
}

export function exportCookies(target, cookies, format = "json") {
  if (format === "header") {
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
  if (format === "netscape") {
    const lines = [
      "# Netscape HTTP Cookie File",
      `# Exported from ${target.origin} by StorageBar`,
      "",
    ];
    for (const cookie of cookies) {
      const hostPrefix = cookie.httpOnly ? "#HttpOnly_" : "";
      const domain = cookie.hostOnly ? cookie.domain.replace(/^\./, "") : (cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}`);
      const includeSubdomains = cookie.hostOnly ? "FALSE" : "TRUE";
      const secure = cookie.secure ? "TRUE" : "FALSE";
      const expiry = cookie.session || cookie.expirationDate == null ? "0" : String(Math.floor(cookie.expirationDate));
      lines.push([`${hostPrefix}${domain}`, includeSubdomains, cookie.path, secure, expiry, cookie.name, cookie.value].join("\t"));
    }
    return lines.join("\n");
  }
  return JSON.stringify(cookies.map((cookie) => ({
    ...exportFields(cookie), session: cookie.session ?? cookie.expirationDate === undefined,
  })), null, 2);
}

function parseNetscapeCookies(text) {
  const entries = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#")) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 7) throw new Error("Netscape Cookie 格式不正确，每行需要 7 列制表符字段");
    const [rawDomain, includeSub, path, rawSecure, rawExpiry, name, ...rest] = parts;
    const value = rest.join("\t");
    const hostOnly = includeSub.toUpperCase() !== "TRUE" && !rawDomain.startsWith(".");
    const expiryNum = Number(rawExpiry);
    const expirationDate = Number.isFinite(expiryNum) && expiryNum > 0 ? expiryNum : undefined;
    entries.push({
      name, value, domain: rawDomain, path: path || "/", hostOnly,
      secure: rawSecure.toUpperCase() === "TRUE", httpOnly, sameSite: "unspecified",
      session: expirationDate === undefined, expirationDate,
    });
  }
  return entries;
}

function parseHeaderCookies(target, text) {
  const cleaned = text.trim().replace(/^cookie\s*:\s*/i, "");
  const entries = [];
  for (const part of cleaned.split(/;+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) throw new Error("Header Cookie 格式不正确，应为 name=value; name2=value2");
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    entries.push({
      name, value, domain: target.hostname, path: "/", hostOnly: true,
      secure: target.protocol === "https:", httpOnly: false, sameSite: "unspecified",
      session: true, expirationDate: undefined,
    });
  }
  return entries;
}

export async function prepareCookieImport(target, fileText) {
  const trimmed = fileText.trim();
  if (!trimmed) throw new Error("请粘贴 Cookie 内容");
  let entries;
  const looksNetscape = /^#\s*(?:Netscape|HTTP Cookie)/im.test(trimmed) ||
    trimmed.split(/\r?\n/).some((line) => (line.startsWith("#HttpOnly_") || !line.trim().startsWith("#")) && line.split("\t").length >= 7);

  if (trimmed.startsWith("[")) {
    try { entries = JSON.parse(trimmed); } catch { throw new Error("无法解析 JSON 内容"); }
    if (!Array.isArray(entries)) throw new Error("支持 JSON 数组、Header 字符串或 Netscape 格式");
  } else if (looksNetscape) {
    entries = parseNetscapeCookies(trimmed);
  } else if (trimmed.includes("=")) {
    entries = parseHeaderCookies(target, trimmed);
  } else {
    throw new Error("支持 JSON 数组、Header 字符串或 Netscape 格式");
  }

  if (!entries.length || entries.length > 5000) throw new Error("导入内容应包含 1–5000 条 Cookie");
  const storeId = await cookieStore(target.tabId);
  const existing = new Map((await getSiteCookies(target)).map((item) => [cookieId(item), item]));
  const seen = new Set();
  const allowedDomains = new Map();
  const preview = [];
  for (const [index, raw] of entries.entries()) {
    try {
      const input = raw && typeof raw === "object" ? {
        ...raw,
        hostOnly: raw.hostOnly ?? (typeof raw.domain === "string" && !raw.domain.startsWith(".")),
        sameSite: raw.sameSite ?? "unspecified",
        expirationDate: raw.session === true ? undefined : raw.expirationDate ?? undefined,
      } : raw;
      const entry = validateCookie(target, input);
      const id = cookieId({ ...entry, storeId });
      if (seen.has(id)) throw new Error("备份中存在重复项，保留第一条");
      seen.add(id);
      const permissionKey = JSON.stringify([entry.domain, entry.secure]);
      if (!allowedDomains.has(permissionKey)) {
        allowedDomains.set(permissionKey, cookieDetails(target, { ...entry, storeId }, storeId));
      }
      await allowedDomains.get(permissionKey);
      preview.push({ entry, name: cookieLabel(entry), previous: existing.get(id) });
    } catch (error) {
      preview.push({ index: index + 1, error: error.message });
    }
  }
  return preview;
}

export async function applyCookieImport(target, rows, overwrite, verify) {
  const results = [];
  for (const { name, index, entry, previous, error } of rows) {
    if (error || (previous && !overwrite)) {
      results.push({ name, index, status: "skipped", detail: error || "已存在，按所选规则跳过" });
      continue;
    }
    try {
      results.push({ name, ...await saveCookie(target, entry, previous, verify, true) });
    } catch (failure) {
      results.push({ name, status: "failed", detail: failure.message });
    }
  }
  return results;
}

const cookieLabel = (cookie) => `${cookie.name || "（空名称）"} · ${cookie.domain}${cookie.path}`;

export async function deleteCookies(target, cookies, verify) {
  const rows = [];
  for (const cookie of cookies) {
    const name = cookieLabel(cookie);
    try {
      const details = await cookieDetails(target, cookie);
      const existing = await readExact(cookie);
      if (!existing) throw new Error("Cookie 已不存在，请刷新");
      await verify();
      // A URL/name removal can also match other cookies. Expire this exact domain/path tuple instead.
      let writeError;
      try {
        await chrome.cookies.set({ ...details, value: "", expirationDate: 1 });
      } catch (error) {
        writeError = error;
      }
      if (await readExact(cookie)) throw writeError || new Error("Cookie 仍存在，请检查站点权限");
      if (!await chrome.permissions.contains({ origins: [hostPermission(new URL(details.url))] })) {
        throw new Error("站点访问权限已撤销，无法确认删除结果");
      }
      rows.push({ name, status: "success" });
    } catch (error) {
      rows.push({ name, status: "failed", detail: error.message || String(error) });
    }
  }
  return rows;
}
