import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { App as AntApp, Badge, Button, Input, Modal, Select } from "antd";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Database,
  FlaskConical,
  Layers3,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PanelLeftClose,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { useStore } from "./store";
import { initialState, roles } from "./data";
import type { Role } from "./data";
import { visibleKnowledge } from "./domain";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const KnowledgePage = lazy(() => import("./pages/Knowledge"));
const Applications = lazy(() => import("./pages/Applications"));
const KnowledgeStudio = lazy(() => import("./pages/KnowledgeStudio"));
const Chat = lazy(() => import("./pages/Chat"));
const Tasks = lazy(() =>
  import("./pages/Operations").then((m) => ({ default: m.Tasks })),
);
const Logs = lazy(() =>
  import("./pages/Operations").then((m) => ({ default: m.Logs })),
);
const Models = lazy(() =>
  import("./pages/Operations").then((m) => ({ default: m.Models })),
);
const navs = [
  { path: "/", label: "工作台", icon: LayoutDashboard, group: "工作空间" },
  { path: "/knowledge", label: "知识库", icon: Database, group: "工作空间" },
  { path: "/chat", label: "在线对话", icon: MessageSquare, group: "工作空间" },
  {
    path: "/applications",
    label: "应用中心",
    icon: Layers3,
    group: "工作空间",
  },
  { path: "/tasks", label: "任务中心", icon: Workflow, group: "管理与监测" },
  { path: "/logs", label: "日志监测", icon: FlaskConical, group: "管理与监测" },
  { path: "/models", label: "模型服务", icon: Settings2, group: "管理与监测" },
];
export default function App() {
  const { state, setState, live, connectionError, switchRole } = useStore();
  const nav = useNavigate();
  const location = useLocation();
  const prototypeView =
    !live &&
    (location.pathname.startsWith("/applications") ||
      location.pathname === "/ingestion" ||
      location.pathname.endsWith("/design"));
  const { message, modal } = AntApp.useApp();
  const [help, setHelp] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const allowed = navs.filter(
    (n) =>
      state.role === "admin" ||
      (state.role === "manager"
        ? n.path !== "/models"
        : ["/knowledge", "/chat", "/applications"].includes(n.path)),
  );
  const current =
    navs.find((n) => n.path !== "/" && location.pathname.startsWith(n.path)) ||
    (location.pathname === "/ingestion" ? navs[1] : navs[0]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const failed = state.tasks.filter(
    (t) =>
      t.status === "failed" &&
      visibleKnowledge(state.knowledge, state.role).some(
        (k) => k.id === t.kbId,
      ),
  ).length;
  const changeRole = (role: Role) => {
    if (live) switchRole(role);
    else setState((s) => ({ ...s, role }));
    setMobile(false);
    nav(role === "user" ? "/chat" : role === "manager" ? "/knowledge" : "/");
    message.info(`已切换为${roles[role]}，当前内容按角色重新加载`);
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <button
          className="mobile-nav-close icon-button"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        >
          <X size={18} />
        </button>
        <NavLink to={state.role === "user" ? "/chat" : "/"} className="brand">
          <span className="brand-symbol">
            <Layers3 size={24} />
          </span>
          <span>
            知序<small>KNOWLEDGE HUB</small>
          </span>
        </NavLink>
        <div className="workspace-switch">
          <span className="workspace-icon">企</span>
          <span>
            企业知识空间
            <small>
              {prototypeView ? "交互原型 · v1.2.3" : "通用版 · v1.2.3"}
            </small>
          </span>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="主导航">
          {["工作空间", "管理与监测"].map((group, index) => {
            const items = allowed.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <section
                className="nav-section"
                key={group}
                aria-labelledby={`nav-group-${index}`}
              >
                <h2 className="nav-group" id={`nav-group-${index}`}>
                  {group}
                </h2>
                {items.map((n) => (
                  <NavLink
                    key={n.path}
                    end={n.path === "/"}
                    to={n.path}
                    onClick={() => setMobile(false)}
                    className={({ isActive }) =>
                      `nav-item ${isActive ? "active" : ""}`
                    }
                  >
                    <n.icon size={19} strokeWidth={1.8} />
                    <span>{n.label}</span>
                    {n.path === "/tasks" && failed > 0 ? (
                      <span className="nav-badge">{failed}</span>
                    ) : null}
                    {n.path === "/knowledge" ? (
                      <span className="nav-count">
                        {visibleKnowledge(state.knowledge, state.role).length}
                      </span>
                    ) : null}
                  </NavLink>
                ))}
              </section>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="prototype-card">
            <span>
              <Sparkles size={15} />
              把知识，变成生产力
            </span>
            <p>
              从资料沉淀到可信问答
              <br />
              让每一次提问都有依据
            </p>
            <button onClick={() => setHelp(true)}>
              了解体验流程 <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            帮助与体验指引
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-profile">
            <div className="profile-avatar">
              {state.role === "admin"
                ? "管"
                : state.role === "manager"
                  ? "知"
                  : "用"}
            </div>
            <div>
              <strong>{roles[state.role]}</strong>
              <small>角色体验模式</small>
            </div>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      {mobile ? (
        <button
          className="mobile-mask"
          aria-label="关闭导航遮罩"
          onClick={() => setMobile(false)}
        />
      ) : null}
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <PanelLeftClose size={17} className="desktop-only" />
            <span>{current.group}</span>
            <span className="slash">/</span>
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-right">
            <Input
              className="global-search"
              prefix={<Search size={15} />}
              placeholder="搜索知识库…"
              aria-label="搜索知识库"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={() => {
                nav(`/knowledge?q=${encodeURIComponent(search)}`);
                setSearch("");
              }}
              suffix={<span className="search-key">↵</span>}
            />
            <span className="demo-label">
              <span />
              {prototypeView
                ? "原型预览"
                : live
                  ? connectionError
                    ? "连接中断"
                    : "服务已连接"
                  : "Web 体验版"}
            </span>
            <button
              className="icon-button"
              aria-label="体验指引"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={19} />
            </button>
            {state.role !== "user" ? (
              <Badge dot={failed > 0}>
                <button
                  className="icon-button"
                  aria-label="查看失败任务"
                  onClick={() => nav("/tasks")}
                >
                  <Bell size={19} />
                </button>
              </Badge>
            ) : null}
            <div className="topbar-divider" />
            <Select
              aria-label="选择角色"
              className="role-select"
              value={state.role}
              onChange={changeRole}
              options={Object.entries(roles).map(([value, label]) => ({
                value,
                label,
              }))}
              prefix={<ShieldCheck size={15} />}
              variant="borderless"
            />
          </div>
        </header>
        <div className="prototype-strip">
          <span>
            <span className="tiny-dot" />
            {prototypeView
              ? "交互原型 v1.2.3"
              : live
                ? "知识中台"
                : "Web 体验版 v1.1"}
          </span>
          <p role={connectionError ? "alert" : undefined}>
            {prototypeView
              ? "新增功能使用示例资料与本地草稿，确认交互后再接入真实后端。"
              : connectionError ||
                (live
                  ? "后端已连接，文件与对话保存在服务端；模型调用按服务商规则计费。"
                  : "资料、模型调用和统计均为演示；本地保存操作结果，不连接云端服务。")}
          </p>
          <button onClick={() => setHelp(true)}>
            体验说明 <ArrowUpRight size={12} />
          </button>
        </div>
        <main
          className={
            location.pathname === "/chat" ? "content chat-content" : "content"
          }
        >
          <Suspense
            fallback={
              <div className="route-loading">
                <span />
                正在整理知识空间…
              </div>
            }
          >
            <Routes>
              <Route
                path="/"
                element={
                  state.role === "user" ? (
                    <Navigate to="/chat" replace />
                  ) : (
                    <Dashboard />
                  )
                }
              />
              <Route
                path="/knowledge/:id/design"
                element={<KnowledgeStudio />}
              />
              <Route path="/ingestion" element={<KnowledgeStudio />} />
              <Route path="/applications" element={<Applications />} />
              <Route
                path="/applications/:id/:mode"
                element={<Applications />}
              />
              <Route path="/knowledge/*" element={<KnowledgePage />} />
              <Route path="/chat" element={<Chat key={state.role} />} />
              <Route
                path="/tasks"
                element={
                  state.role === "user" ? (
                    <Navigate to="/chat" replace />
                  ) : (
                    <Tasks />
                  )
                }
              />
              <Route
                path="/logs"
                element={
                  state.role === "user" ? (
                    <Navigate to="/chat" replace />
                  ) : (
                    <Logs />
                  )
                }
              />
              <Route
                path="/models"
                element={
                  state.role === "admin" ? (
                    <Models />
                  ) : (
                    <Navigate to="/knowledge" replace />
                  )
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>知序 · 让知识有序流动</span>
          <span>
            {prototypeView
              ? "原型版本 v1.2.3"
              : live
                ? "服务版本 v1.2.3"
                : "Web 体验版 v1.1"}{" "}
            <span>·</span>{" "}
            {prototypeView ? "交互示例" : live ? "业务数据" : "演示数据"}
          </span>
        </footer>
      </div>
      <Modal
        title={
          <span className="inline-icon">
            <BookOpen size={20} />
            欢迎体验知序
          </span>
        }
        open={help}
        onCancel={() => setHelp(false)}
        footer={
          <Button type="primary" onClick={() => setHelp(false)}>
            开始体验
          </Button>
        }
        width={560}
      >
        <p className="help-intro">
          {live
            ? "当前为后端连接模式。请先在模型服务中配置并测试模型，再创建知识库和导入资料。角色仍可自由切换，不代表身份认证。"
            : "这是可点击的前端原型，用于确认页面、功能与交互。你可以自由尝试，所有数据仅保存在此浏览器。"}
        </p>
        <div className="help-steps">
          {[
            "切换角色，查看不同角色的导航与知识库范围",
            "创建知识库，选择示例或本地文件并体验导入构建",
            "进入检索测试，查看模拟召回与重排结果",
            "开始在线对话，体验流式回答和引用原文",
            "查看任务、模型配置和对话日志",
          ].map((x, i) => (
            <div key={x}>
              <span>{i + 1}</span>
              {x}
            </div>
          ))}
        </div>
        <div className="soft-note">
          <CircleHelp size={18} />
          {live
            ? "真实密钥只在模型配置表单填写，服务端加密保存。原型演示入口与服务端数据相互独立。"
            : "原型不进行真实 OCR、模型推理或网络连接测试，请勿输入真实密钥。"}
        </div>
        <Button
          disabled={live}
          danger
          type="text"
          className="reset-button"
          onClick={() =>
            modal.confirm({
              title: "重置此原型的演示数据？",
              content:
                "将清除在此浏览器中新建的知识库、对话和配置，恢复初始示例。",
              okText: "重置演示数据",
              cancelText: "取消",
              onOk: () => {
                setState(initialState());
                setHelp(false);
                nav("/");
                message.success("演示数据已恢复");
              },
            })
          }
        >
          重置演示数据
        </Button>
      </Modal>
    </div>
  );
}
