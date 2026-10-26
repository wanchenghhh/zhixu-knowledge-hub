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
          colorPrimary: "#6654dc",
          colorInfo: "#6654dc",
          borderRadius: 8,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          colorText: "#25283d",
          colorTextSecondary: "#82869a",
          colorBorder: "#e6e8f0",
          controlHeight: 38,
        },
        components: {
          Button: { primaryShadow: "0 3px 7px rgba(102,84,220,.13)" },
          Table: {
            headerBg: "#fafbfe",
            headerColor: "#85899b",
            rowHoverBg: "#faf9ff",
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
