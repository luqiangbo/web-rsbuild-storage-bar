import React from "react";
import { createRoot } from "react-dom/client";
import StorageBar from "./ui/StorageBar.jsx";
import { App, Button, ConfigProvider, Result, theme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { Preferences, usePreferenceState } from "./ui/preferences.js";
import { dataFont } from "../public/data-fonts.js";
import "antd/dist/reset.css";
import "./ui/styles.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("StorageBar render error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <Result status="error" title={this.props.t("界面发生异常")}
          subTitle={this.state.error?.message || this.props.t("未知渲染错误")}
          extra={<Button type="primary" onClick={() => this.setState({ hasError: false, error: null })}>{this.props.t("重试")}</Button>} />
      );
    }
    return this.props.children;
  }
}

function Extension() {
  const preferences = usePreferenceState();
  const { dark, language, t, prefs } = preferences;
  React.useLayoutEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.setProperty("--mono", dataFont(prefs.font));
  }, [dark, language, prefs.font]);
  return <Preferences.Provider value={preferences}>
    <ConfigProvider locale={language === "zh" ? zhCN : enUS}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        cssVar: true,
        token: {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif',
          borderRadius: 6,
          borderRadiusLG: 12,
          borderRadiusSM: 4,
          motionDurationMid: "0.18s",
          motionDurationSlow: "0.22s",
        },
        components: {
          Modal: {
            titleFontSize: 15,
            titleLineHeight: 1.4,
          },
          Table: {
            headerBorderRadius: 6,
          },
        },
      }}>
      <App className="extension-app">
        <ErrorBoundary t={t}><StorageBar /></ErrorBoundary>
      </App>
    </ConfigProvider>
  </Preferences.Provider>;
}

createRoot(document.getElementById("root")).render(<Extension />);
