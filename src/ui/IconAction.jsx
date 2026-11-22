import React from "react";
import { Button, Tooltip } from "antd";

export default function IconAction({ label, ...props }) {
  return <Tooltip title={label} trigger={["hover", "focus"]}>
    <Button type="text" size="small" aria-label={label} {...props} />
  </Tooltip>;
}
