import { useCallback, useEffect, useRef, useState } from "react";
import { resolveTarget } from "../api/page.js";

const loading = { status: "loading" };
const targetTimeout = 8000;
const timeoutMessage = "等待网页响应超时，请重试或选择其他标签页。";
const available = (tab) => tab.id != null && /^https?:\/\//i.test(tab.url || "");

export function useTarget(workbench, initialTabId) {
  const [target, setTarget] = useState(loading);
  const [tabs, setTabs] = useState([]);
  const [locked, setLocked] = useState(initialTabId !== null);
  const [notice, setNotice] = useState(null);
  const [slowTab, setSlowTab] = useState(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const model = useRef({
    epoch: 0, tabListEpoch: 0, windowId: null, activeId: null, lockedId: initialTabId, current: null,
    navigatingFrom: new Map(), initialActivations: new Map(),
  });

  const assertCurrent = useCallback((captured) => {
    if (model.current.current?.key !== captured.key) throw new Error("目标标签页或文档已变化，请重新打开操作");
  }, []);
  const verifySelection = useCallback(async (captured) => {
    assertCurrent(captured);
    const { windowId, lockedId } = model.current;
    if (lockedId !== null) return;
    const [active] = await chrome.tabs.query({ active: true, windowId });
    if (active?.id !== captured.tabId) throw new Error("活动标签页已切换，请重新打开操作");
    assertCurrent(captured);
  }, [assertCurrent]);

  const read = useCallback(async ({ invalidate = true, tabId } = {}) => {
    const state = model.current;
    const epoch = ++state.epoch;
    const previous = state.current;
    if (invalidate) {
      state.current = null;
      setTarget({ ...loading, tabId: tabId ?? state.lockedId ?? state.activeId });
    }
    let timer;
    let expired = false;
    const check = () => {
      if (expired || epoch !== state.epoch) throw new Error("目标已变化");
    };
    async function locate() {
      if (!workbench && (state.windowId === null || state.activeId === null)) {
        const window = state.windowId === null ? { currentWindow: true } : { windowId: state.windowId };
        const [active] = await chrome.tabs.query({ active: true, ...window });
        check();
        state.windowId = active?.windowId ?? state.windowId;
        state.activeId = state.initialActivations.get(state.windowId) ?? active?.id ?? null;
        if (state.windowId !== null) state.initialActivations.clear();
      }
      const chosen = tabId ?? state.lockedId ?? state.activeId;
      if (chosen === null && workbench) return { status: "blocked", reason: "请从顶部选择要检查的网页。" };
      return resolveTarget(chosen, check);
    }
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error(timeoutMessage)); }, targetTimeout);
      });
      let next = await Promise.race([locate(), timeout]);
      check();
      const previousDocument = state.navigatingFrom.get(next.tabId);
      if (next.status === "ready" && previousDocument === next.documentId) {
        next = { ...loading, tabId: next.tabId, origin: next.origin };
      } else if (next.status === "ready") {
        state.navigatingFrom.delete(next.tabId);
      }
      const same = !invalidate && next.status === "ready" && next.tabId === previous?.tabId &&
        next.documentId === previous.documentId;
      const resolved = { ...next, key: same ? previous.key : epoch };
      state.current = resolved;
      setTarget(resolved);
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.current = null;
      if (workbench && state.lockedId !== null && /no tab with id/i.test(error.message)) {
        state.lockedId = null;
        setLocked(false);
        setTarget({ status: "blocked", reason: "目标标签页已关闭，请重新选择。" });
      } else setTarget({ tabId: tabId ?? state.lockedId ?? state.activeId, status: "access-error", reason: error.message });
    } finally {
      clearTimeout(timer);
    }
  }, [workbench]);

  useEffect(() => {
    if (target.status !== "loading") return;
    setSlowTab(null);
    let checking = false;
    const retry = setInterval(async () => {
      if (checking || model.current.current?.status !== "loading") return;
      checking = true;
      try { await read({ invalidate: false }); }
      finally { checking = false; }
    }, 600);
    const timer = setTimeout(() => setSlowTab({ tabId: target.tabId }), targetTimeout);
    return () => { clearInterval(retry); clearTimeout(timer); };
  }, [target.status, target.tabId, read]);

  useEffect(() => {
    const state = model.current;
    const readTabs = async () => {
      const sequence = ++state.tabListEpoch;
      try {
        const allTabs = await chrome.tabs.query({});
        if (sequence === state.tabListEpoch) setTabs(allTabs.filter(available));
      } catch (error) {
        if (sequence === state.tabListEpoch) setNotice({
          text: "无法刷新标签页列表：{error}", params: { error: error.message }, type: "error",
        });
      }
    };
    const onActivated = ({ tabId, windowId }) => {
      if (workbench) return;
      if (state.windowId === null) {
        state.initialActivations.set(windowId, tabId);
        return;
      }
      if (windowId !== state.windowId) return;
      state.activeId = tabId;
      if (state.lockedId === null) void read({ tabId });
    };
    const onUpdated = (tabId, change) => {
      if (change.url !== undefined || change.title !== undefined || change.status === "complete") void readTabs();
      if (change.status === "complete") state.navigatingFrom.delete(tabId);
      if (tabId !== (state.lockedId ?? state.activeId)) return;
      if (change.status === "loading") {
        if (state.current?.status === "ready") state.navigatingFrom.set(tabId, state.current.documentId);
        void read({ tabId });
      } else if (change.status === "complete") {
        void read({ tabId, invalidate: !state.current });
      } else if (change.url !== undefined) {
        let sameOrigin = false;
        try { sameOrigin = new URL(change.url).origin === state.current?.origin; } catch { /* restricted URL */ }
        if (!sameOrigin || state.current?.status !== "ready") void read({ tabId });
      }
    };
    const onRemoved = (tabId) => {
      state.navigatingFrom.delete(tabId);
      for (const [windowId, activeId] of state.initialActivations) {
        if (activeId === tabId) state.initialActivations.delete(windowId);
      }
      if (tabId === state.activeId) state.activeId = null;
      if (tabId === state.lockedId) {
        state.lockedId = null;
        setLocked(false);
        setNotice({
          text: workbench ? "目标标签页已关闭，请重新选择。" : "锁定的标签页已关闭，已恢复跟随。",
          type: "info",
        });
        void read();
      } else if (!workbench && state.lockedId === null && state.activeId === null) {
        void read();
      }
      void readTabs();
    };
    const onReplaced = (addedId, removedId) => {
      state.navigatingFrom.delete(removedId);
      for (const [windowId, activeId] of state.initialActivations) {
        if (activeId === removedId) state.initialActivations.set(windowId, addedId);
      }
      if (state.activeId === removedId) state.activeId = addedId;
      if (state.lockedId === removedId) state.lockedId = addedId;
      if (addedId === (state.lockedId ?? state.activeId)) void read({ tabId: addedId });
      void readTabs();
    };
    const onPermission = (change) => {
      if (change.origins?.length) void read({ invalidate: false });
    };
    const onRevoked = (change) => {
      if (change.origins?.length) void read();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onCreated.addListener(readTabs);
    chrome.tabs.onReplaced.addListener(onReplaced);
    chrome.permissions.onAdded.addListener(onPermission);
    chrome.permissions.onRemoved.addListener(onRevoked);
    void readTabs();
    void read();
    return () => {
      state.epoch++;
      state.tabListEpoch++;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onCreated.removeListener(readTabs);
      chrome.tabs.onReplaced.removeListener(onReplaced);
      chrome.permissions.onAdded.removeListener(onPermission);
      chrome.permissions.onRemoved.removeListener(onRevoked);
    };
  }, [read, workbench]);

  const select = (tabId) => {
    model.current.lockedId = tabId;
    setLocked(true);
    void read({ tabId });
  };
  const toggle = () => {
    const state = model.current;
    if (state.lockedId !== null) {
      state.lockedId = null;
      setLocked(false);
      if (state.current?.tabId !== state.activeId) void read();
    } else if (state.activeId !== null) {
      state.lockedId = state.activeId;
      setLocked(true);
    }
  };
  const waiting = target.status === "loading" && slowTab !== null && slowTab.tabId === target.tabId;
  return { target, tabs, locked, notice, waiting, dismissNotice, select, toggle, read, assertCurrent, verifySelection };
}
