import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StoreProvider } from "./store";
import App from "./App";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#2563eb",
          colorInfo: "#2563eb",
          colorPrimaryHover: "#1d4ed8",
          colorBgLayout: "#f4f6f9",
          colorBgContainer: "#ffffff",
          borderRadius: 8,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          colorText: "#172333",
          colorTextSecondary: "#526174",
          colorBorder: "#e4e9ef",
          controlHeight: 38,
        },
        components: {
          Button: { primaryShadow: "0 2px 4px rgba(37,99,235,.12)" },
          Table: {
            headerBg: "#fafbfc",
            headerColor: "#64748b",
            rowHoverBg: "#f4f7fc",
          },
          Tabs: { horizontalItemGutter: 30 },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <StoreProvider>
            <App />
          </StoreProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
