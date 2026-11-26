import React from "react";
import { Modal } from "antd";

const widths = {
  sm: "min(440px, calc(100vw - 20px))",
  md: "min(580px, calc(100vw - 20px))",
  lg: "min(860px, calc(100vw - 24px))",
};

export default function WideModal({
  children,
  className,
  size = "lg",
  subtitle,
  title,
  closable = true,
  maskClosable = false,
  ...props
}) {
  const modalTitle = subtitle ? (
    <div className="wide-modal-heading">
      <div className="wide-modal-title-row">{title}</div>
      <div className="wide-modal-subtitle">{subtitle}</div>
    </div>
  ) : title;

  const mergedClassName = [
    "wide-modal",
    `wide-modal-${size}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <Modal
      open
      centered
      width={widths[size] ?? widths.lg}
      title={modalTitle}
      closable={closable}
      className={mergedClassName}
      classNames={{
        wrapper: "wide-modal-wrap",
        container: "wide-modal-container",
        header: "wide-modal-header",
        body: "wide-modal-body",
        footer: "wide-modal-footer",
      }}
      mask={{ closable: maskClosable && closable !== false, blur: true }}
      {...props}
    >
      {children}
    </Modal>
  );
}
