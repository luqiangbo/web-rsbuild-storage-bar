import React from "react";
import { Modal } from "antd";

export default function WideModal({ children, ...props }) {
  return <Modal open centered width="min(760px, calc(100vw - 16px))" className="wide-modal"
    classNames={{ body: "wide-modal-body" }} mask={{ closable: false }} {...props}>
    {children}
  </Modal>;
}
