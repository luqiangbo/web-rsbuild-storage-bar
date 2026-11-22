import React, { useCallback } from "react";
import { App } from "antd";

export default function useFeedback() {
  const { message } = App.useApp();
  return useCallback((text, type = "success") => {
    message.open({
      key: JSON.stringify([type, text]),
      type,
      content: <span className="message-content">{text}</span>,
    });
  }, [message]);
}
