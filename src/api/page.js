// Chrome serializes injected functions. All page-side helpers live in this function.
async function executePage(operation, input, expectedOrigin) {
  const message = (error) => error?.message || String(error);
  const result = (status, detail) => ({ status, ...(detail ? { detail } : {}) });
  const storage = () => input.kind === "local" ? localStorage : sessionStorage;
  const state = globalThis.__storageBarState ??= {
    storage: new Map(), caches: new Map(), deletions: new Map(),
  };
  const mediaLimit = 50 * 1024 * 1024;
  const chunkSize = 512 * 1024;

  function encodeKey(key) {
    if (key instanceof Date) return ["date", key.toISOString()];
    if (Array.isArray(key)) return ["array", key.map(encodeKey)];
    if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) {
      const bytes = key instanceof ArrayBuffer
        ? new Uint8Array(key)
        : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
      return ["binary", Array.from(bytes)];
    }
    if (typeof key === "number") return ["number", String(key)];
    return ["string", key];
  }
  function decodeKey([type, value]) {
    if (type === "array") return value.map(decodeKey);
    if (type === "date") return new Date(value);
    if (type === "binary") return Uint8Array.from(value).buffer;
    return type === "number" ? Number(value) : value;
  }
  function labelKey([type, value]) {
    if (type === "array") return `[${value.map(labelKey).join(", ")}]`;
    if (type === "binary") return `二进制 (${value.length} 字节)`;
    if (type === "date") return `日期 ${value}`;
    return type === "string" ? JSON.stringify(value) : value;
  }

  function isJsonValue(value, seen = new Set(), depth = 0) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
    if (typeof value !== "object" || depth > 100 || seen.has(value)) return false;
    seen.add(value);
    const keys = Object.keys(value);
    if (Array.isArray(value)) {
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) return false;
    } else if (Object.getPrototypeOf(value) !== Object.prototype) {
      return false;
    }
    return keys.every((key) => isJsonValue(value[key], seen, depth + 1));
  }
  function typedPreview(value, seen = new Set(), depth = 0, budget = { nodes: 1500 }) {
    if (--budget.nodes < 0 || depth > 12) return "[预览已截断]";
    if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
    if (value === undefined) return "[undefined]";
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
      return Object.is(value, -0) ? "[-0]" : `[${value}]`;
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[重复引用]";
    seen.add(value);
    const child = (item) => typedPreview(item, seen, depth + 1, budget);
    if (value instanceof Date) return { type: "Date", value: String(value) };
    if (value instanceof Map) {
      const entries = [];
      for (const [key, item] of value) {
        if (budget.nodes < 1) break;
        entries.push([child(key), child(item)]);
      }
      return { type: "Map", size: value.size, entries };
    }
    if (value instanceof Set) {
      const entries = [];
      for (const item of value) {
        if (budget.nodes < 1) break;
        entries.push(child(item));
      }
      return { type: "Set", size: value.size, entries };
    }
    if (value instanceof Blob) return {
      type: value instanceof File ? "File" : "Blob",
      ...(value instanceof File ? { name: value.name } : {}),
      mediaType: value.type, size: value.size,
    };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { type: value.constructor.name, byteLength: bytes.length, bytes: Array.from(bytes.subarray(0, 32)) };
    }
    if (value instanceof RegExp || value instanceof Error) return { type: value.constructor.name, value: String(value) };
    if (Array.isArray(value)) {
      const items = Array.from(value.slice(0, Math.max(0, budget.nodes)), child);
      return items.length === value.length ? items : { type: "Array", length: value.length, items };
    }
    const output = Object.create(null);
    for (const key of Object.keys(value)) {
      if (budget.nodes < 1) { output["[预览已截断]"] = true; break; }
      output[key] = child(value[key]);
    }
    return Object.getPrototypeOf(value) === Object.prototype ? output : { type: Object.prototype.toString.call(value), fields: output };
  }
  function matchesValue(value, query) {
    const seen = new Set();
    const stack = [value];
    const contains = (item) => String(item).toLowerCase().includes(query);
    while (stack.length) {
      const item = stack.pop();
      if (item === null || typeof item !== "object") {
        if (contains(item)) return true;
      } else if (!seen.has(item)) {
        seen.add(item);
        if (item instanceof Map) {
          for (const [key, entry] of item) stack.push(key, entry);
        } else if (item instanceof Set) {
          for (const entry of item) stack.push(entry);
        } else if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer ||
          item instanceof Date || item instanceof Blob || item instanceof RegExp || item instanceof Error) {
          if (contains(JSON.stringify(typedPreview(item)))) return true;
        } else {
          for (const key of Object.keys(item)) {
            if (contains(key)) return true;
            stack.push(item[key]);
          }
        }
      }
    }
    return false;
  }

  async function listDatabases() {
    if (typeof indexedDB.databases !== "function") throw new Error("此浏览器无法枚举 IndexedDB 数据库");
    return (await indexedDB.databases()).filter(({ name }) => typeof name === "string");
  }
  function openDb(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => request.transaction.abort();
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error?.name === "AbortError"
        ? new Error("数据库已不存在，请刷新")
        : request.error);
    });
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function withStore(mode, work) {
    const db = await openDb(input.dbName);
    try {
      if (!db.objectStoreNames.contains(input.storeName)) throw new Error("对象仓库已不存在，请刷新");
      const tx = db.transaction(input.storeName, mode);
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error || new Error("存储事务已中止"));
      });
      const data = Promise.resolve().then(() => work(tx.objectStore(input.storeName), tx));
      try {
        const [value] = await Promise.all([data, done]);
        return value;
      } catch (error) {
        try { tx.abort(); } catch { /* already settled */ }
        throw error;
      }
    } finally {
      db.close();
    }
  }
  function readRecords(store) {
    const query = input.query;
    const { indexName, range: constraint } = input.filter ?? {};
    if (indexName != null && !store.indexNames.contains(indexName)) throw new Error("索引已不存在，请刷新");
    const source = indexName == null ? store : store.index(indexName);
    const lower = constraint?.lower === undefined ? undefined : decodeKey(constraint.lower);
    const upper = constraint?.upper === undefined ? undefined : decodeKey(constraint.upper);
    const range = lower !== undefined && upper !== undefined ? IDBKeyRange.bound(lower, upper, !!constraint.lowerOpen, !!constraint.upperOpen)
      : lower !== undefined ? IDBKeyRange.lowerBound(lower, !!constraint.lowerOpen)
        : upper !== undefined ? IDBKeyRange.upperBound(upper, !!constraint.upperOpen) : undefined;
    const after = input.after ? [decodeKey(input.after.key), decodeKey(input.after.primaryKey)] : null;
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = source.openCursor(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) { resolve({ rows, next: null }); return; }
          if (after) {
            const order = indexedDB.cmp(cursor.key, after[0]);
            if (order < 0) { cursor.continue(after[0]); return; }
            if (order === 0) {
              const primaryOrder = indexedDB.cmp(cursor.primaryKey, after[1]);
              if (primaryOrder < 0 && indexName != null) { cursor.continuePrimaryKey(...after); return; }
              if (primaryOrder <= 0) { cursor.continue(); return; }
            }
          }
          const key = encodeKey(cursor.primaryKey);
          const indexKey = indexName == null ? undefined : encodeKey(cursor.key);
          const title = labelKey(key);
          const value = cursor.value;
          if (!query || title.toLowerCase().includes(query) || matchesValue(value, query)) {
            if (rows.length === input.limit) {
              const last = rows.at(-1);
              resolve({ rows, next: { key: last.indexKey ?? last.key, primaryKey: last.key } });
              return;
            }
            const preview = typeof value === "string" ? value.slice(0, 160) : JSON.stringify(typedPreview(value, new Set(), 0, { nodes: 12 })).slice(0, 160);
            rows.push({ id: JSON.stringify(indexKey ? [indexKey, key] : key), key, title, preview,
              ...(indexKey ? { indexKey, indexTitle: labelKey(indexKey) } : {}) });
          }
          cursor.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  }
  function saveRecord(store) {
    if (!input.primaryKey) {
      return requestValue(input.key === undefined ? store.add(input.value) : store.add(input.value, input.key));
    }
    const key = decodeKey(input.primaryKey);
    return new Promise((resolve, reject) => {
      const request = store.openCursor(IDBKeyRange.only(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { reject(new Error("记录已不存在，请刷新")); return; }
        if (input.original !== undefined &&
          (!isJsonValue(cursor.value) || JSON.stringify(cursor.value) !== input.original)) {
          reject(new Error("网页已更新此记录，请重新打开详情后编辑"));
          return;
        }
        try {
          requestValue(cursor.update(input.value)).then(resolve, (error) => reject(error));
        } catch (error) {
          reject(error.name === "DataError" ? new Error("编辑时须保留原主键及其类型") : error);
        }
      };
    });
  }
  async function deleteDatabase(name) {
    const previous = state.deletions.get(name);
    if (previous?.status === "pending") return previous;
    return new Promise((resolve) => {
      let request;
      try { request = indexedDB.deleteDatabase(name); }
      catch (error) { resolve(result("failed", message(error))); return; }
      const finish = (outcome) => {
        state.deletions.set(name, outcome);
        resolve(outcome);
      };
      state.deletions.set(name, result("pending"));
      request.onblocked = () => finish(result("pending", "等待其他页面关闭数据库连接"));
      request.onsuccess = () => finish(result("success"));
      request.onerror = () => finish(result("failed", message(request.error)));
    });
  }

  async function listCacheNames() {
    if (!globalThis.caches) throw new Error("此页面上下文不支持 Cache Storage");
    return caches.keys();
  }
  async function openCache(name) {
    if (!(await listCacheNames()).includes(name)) throw new Error("缓存已不存在，请刷新");
    return caches.open(name);
  }
  function requestId(request) {
    return JSON.stringify([request.url, request.method, Array.from(request.headers)]);
  }
  async function listEntries(cache, requests = null) {
    requests ??= await cache.keys();
    const old = state.caches.get(input.cacheName) ?? new Map();
    const oldIds = new Map(Array.from(old, ([id, key]) => [key, id]));
    const entries = new Map();
    const rows = requests.map((request) => {
      const key = requestId(request);
      const id = oldIds.get(key) ?? crypto.randomUUID();
      const uniqueId = entries.has(id) ? crypto.randomUUID() : id;
      entries.set(uniqueId, key);
      return { id: uniqueId, title: request.url, preview: request.method };
    });
    state.caches.set(input.cacheName, entries);
    return rows;
  }
  async function exactRequest(cache) {
    const identity = state.caches.get(input.cacheName)?.get(input.id);
    if (!identity) throw new Error("缓存条目已变化，请刷新后重试");
    const candidates = (await cache.keys()).filter((request) => requestId(request) === identity);
    if (candidates.length !== 1) throw new Error("无法唯一定位缓存条目，请刷新");
    const request = candidates[0];
    const matches = await cache.keys(request);
    if (matches.length !== 1 || requestId(matches[0]) !== identity) throw new Error("同一 URL 有无法区分的缓存变体");
    return request;
  }
  async function clearCache() {
    const names = await listCacheNames();
    return Promise.all(names.map(async (name) => {
      try {
        return { name, ...(await caches.delete(name) ? result("success") : result("failed", "缓存已变化")) };
      } catch (error) {
        return { name, ...result("failed", message(error)) };
      }
    }));
  }
  async function attempt(work) {
    try { return { rows: await work() }; }
    catch (error) { return { rows: [], error: message(error) }; }
  }

  function videoType(type = "", name = "") {
    const mime = type.split(";")[0].trim().toLowerCase();
    if (mime.startsWith("video/")) return type;
    if (mime && mime !== "application/octet-stream") return "";
    const extension = name.split(/[?#]/)[0].split(".").at(-1).toLowerCase();
    const types = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" };
    return Object.hasOwn(types, extension) ? types[extension] : "";
  }

  function opfsMediaType(file) {
    const type = file.type.split(";")[0].trim().toLowerCase();
    if (/^(video|audio|image)\//.test(type)) return type;
    if (type && type !== "application/octet-stream") return "";
    if (!file.name.includes(".")) return "";
    const extension = file.name.toLowerCase().split(".").at(-1);
    const types = {
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
      m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", weba: "audio/webm",
      png: "image/png", apng: "image/apng", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
      gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
      bmp: "image/bmp", ico: "image/x-icon",
    };
    return Object.hasOwn(types, extension) ? types[extension] : videoType("", extension);
  }

  function fileMedia(file, path) {
    const fileName = file instanceof File ? file.name : "";
    const name = fileName || String(path.at(-1)?.[1] ?? "视频 Blob");
    const type = videoType(file.type, name);
    return type ? { name, path, type, size: file.size, modified: file instanceof File ? file.lastModified : null } : null;
  }

  function recordMedia(value) {
    const items = [];
    const seen = new Set();
    let visited = 0;
    const visit = (item, path) => {
      if (++visited > 2000 || path.length > 16 || items.length >= 12 ||
        !item || typeof item !== "object" || seen.has(item)) return;
      seen.add(item);
      if (item instanceof Blob) {
        const media = fileMedia(item, path);
        if (media) items.push(media);
      } else if (item instanceof Map || item instanceof Set) {
        let index = 0;
        for (const entry of item) {
          if (visited >= 2000 || items.length >= 12) break;
          if (item instanceof Map) {
            visit(entry[0], [...path, ["mapKey", index]]);
            visit(entry[1], [...path, ["mapValue", index]]);
          } else visit(entry, [...path, ["set", index]]);
          index++;
        }
      } else if (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype) {
        for (const key of Object.keys(item)) {
          if (visited >= 2000 || items.length >= 12) break;
          visit(item[key], [...path, ["property", key]]);
        }
      }
    };
    visit(value, []);
    return items;
  }

  function entryAt(iterable, index) {
    for (const entry of iterable) {
      if (index-- === 0) return entry;
    }
    return undefined;
  }

  function readRecordMedia() {
    return withStore("readonly", async (store) => {
      const record = await requestValue(store.openCursor(IDBKeyRange.only(decodeKey(input.key))));
      if (!record) throw new Error("素材记录已不存在，请刷新");
      let value = record.value;
      for (const [kind, index] of input.path) {
        if (kind === "property" && value && Object.hasOwn(value, index)) {
          value = value[index];
        } else if (kind === "set" && value instanceof Set) {
          value = entryAt(value.values(), index);
        } else if ((kind === "mapKey" || kind === "mapValue") && value instanceof Map) {
          value = entryAt(value.entries(), index)?.[kind === "mapKey" ? 0 : 1];
        } else {
          value = undefined;
          break;
        }
      }
      const current = value instanceof Blob ? fileMedia(value, input.path) : null;
      if (!current || current.size !== input.size || current.type !== input.type || current.modified !== input.modified) {
        throw new Error("视频素材已变化，请刷新");
      }
      return value;
    });
  }

  function mediaRecords(store) {
    const range = input.after ? IDBKeyRange.lowerBound(decodeKey(input.after), true) : undefined;
    return new Promise((resolve, reject) => {
      const rows = [];
      let last;
      let scanned = 0;
      const cursor = store.openCursor(range);
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        try {
          const item = cursor.result;
          if (!item) { resolve({ rows, next: null }); return; }
          if (scanned === 50) { resolve({ rows, next: last }); return; }
          scanned++;
          last = encodeKey(item.primaryKey);
          for (const entry of recordMedia(item.value)) rows.push({ ...entry, key: last, record: labelKey(last) });
          item.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  async function opfsDirectory(path) {
    if (typeof navigator.storage?.getDirectory !== "function") throw new Error("当前上下文无法读取 OPFS");
    let directory = await navigator.storage.getDirectory();
    for (const name of path) directory = await directory.getDirectoryHandle(name);
    return directory;
  }

  async function listOpfs() {
    const directory = await opfsDirectory(input.path);
    const rows = [];
    let scanned = 0;
    for await (const entry of directory.values()) {
      if (scanned++ < input.offset) continue;
      if (scanned > input.offset + 50) return { rows, next: input.offset + 50 };
      if (entry.kind === "directory") {
        rows.push({ name: entry.name, directory: true });
      } else {
        try {
          const file = await entry.getFile();
          rows.push({ name: file.name, type: opfsMediaType(file), size: file.size, modified: file.lastModified });
        } catch (error) {
          rows.push({ name: entry.name, error: message(error) });
        }
      }
    }
    return { rows, next: null };
  }

  function cacheVideo(response, url) {
    const type = videoType(response?.headers.get("content-type") || "", url);
    if (!type) return null;
    const error = !response?.body ? "缓存响应体不可读取"
      : !response.ok || response.status === 206 || response.headers.has("content-range") ? "缓存中没有完整的视频响应"
        : undefined;
    const length = response?.headers.get("content-length");
    return { type, size: length && /^\d+$/.test(length) ? Number(length) : null, error };
  }

  async function cacheMedia() {
    const cache = await openCache(input.cacheName);
    const requests = await cache.keys();
    const records = await listEntries(cache, requests);
    const end = Math.min(input.offset + 50, requests.length);
    const rows = [];
    for (let index = input.offset; index < end; index++) {
      const request = requests[index];
      const video = cacheVideo(await cache.match(request), request.url);
      if (!video) continue;
      const equivalents = await cache.keys(request);
      const identical = equivalents.length === 1 && requestId(equivalents[0]) === requestId(request);
      rows.push({ ...video, id: records[index].id, name: request.url,
        error: identical ? video.error : "无法区分同 URL 的缓存变体" });
    }
    return { rows, next: end < requests.length ? end : null };
  }

  function closeMedia(ticket) {
    const job = state.media?.get(ticket);
    if (!job) return;
    clearTimeout(job.timeout);
    state.media.delete(ticket);
    if (job.reader) void job.reader.cancel().catch(() => {});
  }

  async function startMedia() {
    state.media ??= new Map();
    if (state.media.size >= 3) throw new Error("请先关闭其他媒体预览");
    const job = { offset: 0, timeout: setTimeout(() => closeMedia(input.ticket), 120_000) };
    state.media.set(input.ticket, job);
    try {
      if (input.kind === "cache") {
        const cache = await openCache(input.cacheName);
        const request = await exactRequest(cache);
        const response = await cache.match(request);
        const media = cacheVideo(response, request.url);
        if (!media || media.error) throw new Error(media?.error || "没有可播放的视频响应");
        Object.assign(job, { type: media.type, total: media.size, reader: response.body.getReader() });
      } else {
        let file;
        if (input.kind === "idb") {
          file = await readRecordMedia();
        } else if (input.kind === "opfs") {
          const directory = await opfsDirectory(input.path);
          const handle = await directory.getFileHandle(input.name);
          file = await handle.getFile();
          if (file.size !== input.size || file.lastModified !== input.modified || opfsMediaType(file) !== input.type) {
            throw new Error("文件已变化，请刷新");
          }
        } else {
          throw new Error("未知媒体来源");
        }
        Object.assign(job, { type: input.type, total: file.size, file });
      }
      if (!state.media.has(input.ticket)) {
        if (job.reader) void job.reader.cancel().catch(() => {});
        throw new Error("预览已取消");
      }
      if (!job.type || (job.total !== null && (job.total <= 0 || job.total > mediaLimit))) {
        throw new Error("仅支持非空且不超过 50 MiB 的媒体预览");
      }
      return { type: job.type, total: job.total };
    } catch (error) {
      closeMedia(input.ticket);
      throw error;
    }
  }

  async function mediaChunk() {
    const job = state.media?.get(input.ticket);
    if (!job) throw new Error("媒体预览已结束，请重新打开");
    let bytes;
    if (job.file) {
      bytes = new Uint8Array(await job.file.slice(job.offset, job.offset + chunkSize).arrayBuffer());
    } else {
      let remainder = job.remainder;
      while (!remainder?.length) {
        const read = await job.reader.read();
        if (read.done) return { done: true };
        remainder = read.value;
      }
      bytes = remainder.subarray(0, chunkSize);
      job.remainder = remainder.subarray(bytes.length);
    }
    if (job.offset + bytes.length > mediaLimit) throw new Error("文件超过 50 MiB，已停止读取");
    job.offset += bytes.length;
    let ascii = "";
    for (let index = 0; index < bytes.length; index += 8192) {
      ascii += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    return { data: btoa(ascii), done: job.file ? job.offset >= job.total : false };
  }

  try {
    if (expectedOrigin && location.origin !== expectedOrigin) throw new Error("目标页面已变化，请刷新");
    let data;
    switch (operation) {
      case "pageInfo":
        data = { origin: location.origin, url: location.href };
        break;
      case "storageRead": {
        const area = storage();
        const rows = [];
        for (let index = 0; index < area.length; index++) {
          const key = area.key(index);
          if (key === null) continue;
          const value = area.getItem(key);
          if (value !== null) rows.push({ id: key, title: key, value });
        }
        const previous = state.storage.get(input.kind);
        const unchanged = previous?.rows.length === rows.length &&
          previous.rows.every((row, index) => row.id === rows[index].id && row.value === rows[index].value);
        const version = unchanged ? previous.version : (previous?.version ?? 0) + 1;
        if (!unchanged) state.storage.set(input.kind, { rows, version });
        data = version === input.version ? { version } : { rows, version };
        break;
      }
      case "storageSave": {
        const area = storage();
        const { key, value, originalKey, original } = input;
        if (originalKey !== undefined && area.getItem(originalKey) !== original) {
          throw new Error("网页已更新此记录，请重新打开详情后编辑");
        }
        if (key !== originalKey && area.getItem(key) !== null) throw new Error("键名已存在，请使用其他键名");
        area.setItem(key, value);
        if (originalKey !== undefined && key !== originalKey) area.removeItem(originalKey);
        break;
      }
      case "storageDelete": {
        const area = storage();
        data = input.keys.map((key) => {
          if (area.getItem(key) === null) return { name: key, ...result("failed", "记录已不存在") };
          area.removeItem(key);
          return { name: key, ...result("success") };
        });
        break;
      }
      case "storageDeleteBatch": {
        const area = storage();
        data = input.entries.map(({ key, value }) => {
          try {
            if (area.getItem(key) !== value) return { name: key, ...result("skipped", "记录已变化，已跳过") };
            area.removeItem(key);
            return { name: key, ...result("success"), original: value };
          } catch (error) {
            return { name: key, ...result("failed", message(error)) };
          }
        });
        break;
      }
      case "storageApply": {
        const area = storage();
        data = input.entries.map(({ key, value, expected }) => {
          try {
            if (area.getItem(key) !== expected) return { name: key, ...result("skipped", "记录已变化，已跳过") };
            area.setItem(key, value);
            return { name: key, ...result("success") };
          } catch (error) {
            return { name: key, ...result("failed", message(error)) };
          }
        });
        break;
      }
      case "storageClear":
        storage().clear();
        break;
      case "idbDatabases":
        data = (await listDatabases()).map((db) => ({
          ...db, pending: state.deletions.get(db.name)?.status === "pending",
        }));
        break;
      case "idbStores": {
        if (state.deletions.get(input.dbName)?.status === "pending") {
          throw new Error("此数据库正在等待关闭连接以完成删除");
        }
        const db = await openDb(input.dbName);
        try {
          data = Array.from(db.objectStoreNames, (name) => {
            const store = db.transaction(name).objectStore(name);
            return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
              indexes: Array.from(store.indexNames, (indexName) => ({ name: indexName })) };
          });
        } finally {
          db.close();
        }
        break;
      }
      case "idbRead":
        data = await withStore("readonly", readRecords);
        break;
      case "idbCount":
        data = await withStore("readonly", (store) => requestValue(store.count()));
        break;
      case "idbDetail":
        data = await withStore("readonly", async (store) => {
          const cursor = await requestValue(store.openCursor(IDBKeyRange.only(decodeKey(input.key))));
          if (!cursor) throw new Error("记录已不存在，请刷新");
          const editable = isJsonValue(cursor.value);
          return { editable, text: JSON.stringify(editable ? cursor.value : typedPreview(cursor.value)),
            media: editable ? [] : recordMedia(cursor.value) };
        });
        break;
      case "idbMedia":
        data = await withStore("readonly", mediaRecords);
        break;
      case "idbSave": {
        input.value = JSON.parse(input.json);
        if (!isJsonValue(input.value)) throw new Error("此值包含 JSON 无法安全往返的内容");
        if (input.keyJson !== undefined) input.key = JSON.parse(input.keyJson);
        await withStore("readwrite", saveRecord);
        break;
      }
      case "idbDelete":
        data = await withStore("readwrite", async (store) => {
          const found = await Promise.all(input.keys.map((key) => requestValue(store.count(decodeKey(key)))));
          await Promise.all(input.keys.map((key, index) => found[index] && requestValue(store.delete(decodeKey(key)))));
          return input.keys.map((key, index) => ({
            name: labelKey(key), ...(found[index] ? result("success") : result("failed", "记录已不存在")),
          }));
        });
        break;
      case "idbClear":
        await withStore("readwrite", (store) => requestValue(store.clear()));
        break;
      case "idbDeleteDatabase":
        data = await deleteDatabase(input.dbName);
        break;
      case "idbDeletionStatus":
        data = input.names.map((name) => ({ name, ...state.deletions.get(name) }));
        break;
      case "cacheNames":
        data = await listCacheNames();
        break;
      case "cacheRead":
        data = await listEntries(await openCache(input.cacheName));
        break;
      case "cacheDetail": {
        const cache = await openCache(input.cacheName);
        const request = await exactRequest(cache);
        const response = await cache.match(request);
        if (!response) throw new Error("缓存响应已不存在，请刷新");
        data = {
          status: response.status || null,
          type: response.type,
          contentType: response.headers.get("content-type"),
          size: response.headers.get("content-length"),
          video: cacheVideo(response, request.url),
        };
        break;
      }
      case "cacheMedia":
        data = await cacheMedia();
        break;
      case "opfsList":
        data = await listOpfs();
        break;
      case "mediaStart":
        data = await startMedia();
        break;
      case "mediaChunk":
        data = await mediaChunk();
        break;
      case "mediaClose":
        closeMedia(input.ticket);
        break;
      case "cacheDeleteEntry": {
        const cache = await openCache(input.cacheName);
        if (!await cache.delete(await exactRequest(cache))) throw new Error("缓存条目已不存在，请刷新");
        break;
      }
      case "cacheDelete":
        if (!await caches.delete(input.cacheName)) throw new Error("缓存已不存在，请刷新");
        state.caches.delete(input.cacheName);
        break;
      case "pageClear": {
        const [local, session, cache, idb] = await Promise.all([
          attempt(() => { localStorage.clear(); return []; }),
          attempt(() => { sessionStorage.clear(); return []; }),
          attempt(clearCache),
          attempt(async () => Promise.all((await listDatabases()).map(async ({ name }) => ({
            name, ...await deleteDatabase(name),
          })))),
        ]);
        data = { local, session, cache, idb };
        break;
      }
      default:
        throw new Error(`未知操作：${operation}`);
    }
    return { ok: true, data: data ?? null };
  } catch (error) {
    return { ok: false, error: message(error), name: error?.name };
  }
}

export async function runInPage(target, action, args = {}) {
  const injectionTarget = { tabId: target.tabId };
  if (target.documentId) injectionTarget.documentIds = [target.documentId];
  const [execution] = await chrome.scripting.executeScript({
    target: injectionTarget,
    injectImmediately: true,
    args: [action, args, target.origin ?? null],
    func: executePage,
  });
  if (!execution?.result) throw new Error("目标页面未返回数据，请刷新");
  const { result } = execution;
  if (!result.ok) {
    const error = new Error(result.error);
    error.name = result.name || "Error";
    throw error;
  }
  if (action === "pageInfo") {
    if (!execution.documentId) throw new Error("浏览器无法确认目标文档");
    return { ...result.data, documentId: execution.documentId };
  }
  return result.data;
}

export function hostPermission(url) {
  return `${url.protocol}//${url.hostname}/*`;
}

export async function resolveTarget(tabId, assertCurrent) {
  if (tabId == null) return { status: "blocked", reason: "请打开一个普通 HTTP 或 HTTPS 网页。" };
  const tab = await chrome.tabs.get(tabId);
  assertCurrent();
  if (tab.pendingUrl) return { tabId, status: "loading" };
  const url = tab.url ? new URL(tab.url) : null;
  if (!url || !["http:", "https:"].includes(url.protocol)) {
    return { tabId, status: "blocked", reason: "请选择一个普通 HTTP 或 HTTPS 网页。" };
  }
  const permission = hostPermission(url);
  const base = { tabId, origin: url.origin, hostname: url.hostname, protocol: url.protocol, permission };
  if (!await chrome.permissions.contains({ origins: [permission] })) return { ...base, status: "permission" };
  assertCurrent();
  try {
    const page = await runInPage(base, "pageInfo");
    return { ...base, ...page, status: "ready" };
  } catch (error) {
    assertCurrent();
    const latest = await chrome.tabs.get(tabId);
    if (latest.pendingUrl || latest.status === "loading" || latest.url !== tab.url) {
      return { ...base, status: "loading" };
    }
    return { ...base, status: "access-error", reason: error.message };
  }
}

export async function verifyTarget(target, assertCurrent) {
  assertCurrent();
  const tab = await chrome.tabs.get(target.tabId);
  if (tab.pendingUrl) throw new Error("目标页面已变化，请重新打开操作");
  if (!await chrome.permissions.contains({ origins: [target.permission] })) {
    throw new Error("站点访问权限已撤销，请重新授权");
  }
  const page = await runInPage({ tabId: target.tabId, origin: target.origin }, "pageInfo");
  assertCurrent();
  if (page.origin !== target.origin || page.documentId !== target.documentId) {
    throw new Error("目标页面已变化，请重新打开操作");
  }
  return page;
}
