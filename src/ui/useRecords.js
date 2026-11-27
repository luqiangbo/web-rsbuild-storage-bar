import { useCallback, useEffect, useRef, useState } from "react";
import { cookieId, getSiteCookies } from "../api/cookies.js";
import { runInPage } from "../api/page.js";

export const PAGE_SIZES = [50, 100];
export const PAGE_SIZE = PAGE_SIZES[0];
const empty = { status: "loading", rows: [], next: null };

export function useRead(key, load, delay = 0, retainKey = null) {
  const [state, setState] = useState(() => ({ ...empty, key }));
  useEffect(() => {
    if (key === null) return;
    let active = true;
    let timer;
    const read = async () => {
      try {
        const value = await load();
        if (active) setState({ key, retainKey, status: "ready", value });
      } catch (error) {
        if (active) setState({ key, retainKey, status: "error", error: error.message || String(error) });
      }
    };
    if (delay) timer = setTimeout(read, delay);
    else void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, load, delay, retainKey]);
  if (key === state.key) return state;
  if (key !== null && retainKey !== null && state.retainKey === retainKey && state.status === "ready") {
    return { ...state, refreshing: true };
  }
  return empty;
}

export function useWebStorage(target, kind, revision, automatic, enabled) {
  const [state, setState] = useState(empty);
  const latest = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let busy = false;
    let readAgain = false;
    const read = async (manual = false) => {
      if (busy) {
        readAgain ||= manual;
        return;
      }
      busy = true;
      if (manual) setState((old) => old.status === "ready" ? { ...old, refreshing: true } : old);
      try {
        const data = await runInPage(target, "storageRead", { kind, version: latest.current?.version ?? null });
        if (!active) return;
        if (data.rows) latest.current = data;
        setState((previous) => previous.status === "ready" && !previous.refreshing && previous.value === latest.current
          ? previous
          : { status: "ready", value: latest.current });
      } catch (error) {
        if (!active) return;
        setState((previous) => previous.status === "error" && previous.error === error.message
          ? previous
          : { status: "error", error: error.message || String(error) });
      } finally {
        busy = false;
        if (active && readAgain) { readAgain = false; void read(true); }
      }
    };
    const tick = () => {
      if (document.visibilityState === "visible") void read();
    };
    void read(true);
    if (!automatic) return () => { active = false; };
    const interval = setInterval(tick, 2000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [target, kind, revision, automatic, enabled]);
  return state;
}

export function useCatalog(target, section, revision, dbName, pendingNames) {
  const metadataKey = section === "idb" || section === "cache"
    ? JSON.stringify([section, revision])
    : null;
  const loadCatalog = useCallback(() => runInPage(target, section === "idb" ? "idbDatabases" : "cacheNames"), [target, section]);
  const catalog = useRead(metadataKey, loadCatalog, 0, section);
  const databases = section === "idb" ? catalog.value ?? [] : [];
  const caches = section === "cache" ? catalog.value ?? [] : [];
  const selectedDb = databases.find(({ name }) => name === dbName)?.name ?? databases[0]?.name ?? null;
  const pending = pendingNames.has(selectedDb) || databases.some((database) => database.name === selectedDb && database.pending);
  const storesKey = selectedDb === null || pending ? null : JSON.stringify([selectedDb, revision]);
  const loadStores = useCallback(() => runInPage(target, "idbStores", { dbName: selectedDb }), [target, selectedDb]);
  const stores = useRead(storesKey, loadStores, 0, selectedDb);
  return { catalog, stores, databases, caches, selectedDb };
}

export function useRecordList(target, scope, revision, query, cursor, automatic, pageSize = PAGE_SIZE) {
  const isStorage = scope.section === "local" || scope.section === "session";
  const web = useWebStorage(target, scope.section === "session" ? "session" : "local", revision, automatic, isStorage);
  const queryKey = scope.section === "idb" ? query.toLowerCase() : "";
  const canRead = scope.section === "cookies" || (scope.section === "cache" && scope.cacheName !== null) ||
    (scope.section === "idb" && scope.dbName !== null && scope.storeName !== null);
  const group = canRead ? JSON.stringify([scope, queryKey, cursor, pageSize]) : null;
  const key = canRead ? JSON.stringify([group, revision]) : null;
  const { section, dbName, storeName, cacheName } = scope;
  const load = useCallback(async () => {
    if (section === "idb") {
      return runInPage(target, "idbRead", { dbName, storeName, query: queryKey, after: cursor, limit: pageSize });
    }
    if (section === "cache") return { rows: await runInPage(target, "cacheRead", { cacheName }) };
    return {
      rows: (await getSiteCookies(target)).map((cookie) => ({
        id: cookieId(cookie), title: cookie.name, preview: `${cookie.domain}${cookie.path}`, cookie,
      })),
    };
  }, [target, section, dbName, storeName, cacheName, queryKey, cursor, pageSize]);
  const remote = useRead(key, load, queryKey ? 180 : 0, group);
  return isStorage ? web : remote;
}
