import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dropdown } from "antd";

export const menuShortcut = (event) => event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");

export function useActionMenu(scope) {
  const [request, setRequest] = useState(null);
  useEffect(() => { setRequest(null); }, [scope]);
  function open(event, id, anchor = event.currentTarget, position = anchor) {
    event.preventDefault();
    event.stopPropagation();
    const rect = position.getBoundingClientRect();
    const pointer = event.type === "contextmenu" && (event.clientX || event.clientY);
    setRequest({
      scope, id, anchor,
      x: pointer ? event.clientX : rect.left,
      y: pointer ? event.clientY : rect.bottom,
    });
  }
  const dismiss = useCallback(() => setRequest(null), []);
  return { request: request?.scope === scope ? request : null, open, dismiss };
}

export default function ActionMenu({ request, label, items, onDismiss, onAction }) {
  if (!request) return null;
  function dismiss(restoreFocus = false) {
    onDismiss();
    if (restoreFocus && request.anchor.isConnected) request.anchor.focus({ preventScroll: true });
  }
  return createPortal(<Dropdown open trigger={["click"]} autoFocus destroyOnHidden
    onOpenChange={(open, { source }) => { if (!open && source !== "menu") dismiss(); }}
    menu={{ items, "aria-label": label, onKeyDown: (event) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    }, onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      dismiss(true);
      onAction(key, request.id);
    } }}>
    <span aria-hidden="true" className="action-menu-anchor" style={{ left: request.x, top: request.y }} />
  </Dropdown>, document.body);
}
