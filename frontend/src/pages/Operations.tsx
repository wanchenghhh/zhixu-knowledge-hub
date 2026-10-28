import { api, write } from "../api";
import ModelPresetSetup from "../ModelPresetSetup";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import ReactMarkdown from "react-markdown";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  FileText,
  FlaskConical,
  KeyRound,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { useStore } from "../store";
import type { LogEntry, ModelConfig, Source, Task } from "../data";
import { roles } from "../data";
import { accessibleLogs, uid, visibleKnowledge } from "../domain";
import {
  EmptyPanel,
  PageHeading,
  SourceButtons,
  SourceDrawer,
  Status,
  downloadText,
} from "../components";
export function Tasks() {
  const { state, setState, live, refresh } = useStore();
  const nav = useNavigate();
  const { message } = App.useApp();
  const [filter, setFilter] = useState("all");
  const [detailItem, setDetail] = useState<Task | null>(null);
  const detail = live
    ? state.tasks.find((t) => t.id === detailItem?.id) || detailItem
    : detailItem;
  const ids = new Set(
    visibleKnowledge(state.knowledge, state.role).map((k) => k.id),
  );
  const all = state.tasks.filter((t) => ids.has(t.kbId));
  const tasks = all.filter((t) => filter === "all" || t.status === filter);
  const retry = (id: string) => {
    if (live) {
      void write(
        state.tasks.find((t) => t.id === id)?.kind === "report"
          ? `/application-runs/${id}/retry`
          : `/tasks/${id}/retry`,
        {},
      )
        .then(() => refresh())
        .then(() => message.success("重试任务已提交"))
        .catch((error) => message.error(String(error)));
      setDetail(null);
      return;
    }
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status: "running", error: undefined } : t,
      ),
    }));
    setDetail(null);
    message.info("已开始模拟重试");
  };
  return (
    <div className="page">
      <PageHeading
        title="任务中心"
        description="查看文档处理、索引构建和应用报告的执行进度。"
        actions={
          <Button
            icon={<ArrowRight size={16} />}
            onClick={() => nav("/knowledge")}
          >
            前往知识库
          </Button>
        }
      />
      <div className="task-summary">
        {[
          { status: "all", label: "全部任务", icon: Workflow, color: "blue" },
          {
            status: "running",
            label: "构建中",
            icon: LoaderCircle,
            color: "blue",
          },
          {
            status: "success",
            label: "已完成",
            icon: CheckCircle2,
            color: "teal",
          },
          {
            status: "failed",
            label: "需要关注",
            icon: CircleHelp,
            color: "amber",
          },
        ].map((s) => (
          <button
            key={s.status}
            className={filter === s.status ? "active" : ""}
            onClick={() => setFilter(s.status)}
          >
            <span className={`icon-square ${s.color}`}>
              <s.icon size={21} />
            </span>
            <div>
              <span>{s.label}</span>
              <strong>
                {
                  all.filter((t) => s.status === "all" || t.status === s.status)
                    .length
                }
              </strong>
            </div>
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <h3>知识与应用任务</h3>
          <span className="text-muted">
            {live ? "持久化任务 · 支持失败重试" : "演示任务 · 支持失败重试"}
          </span>
        </div>
        <Table<Task>
          rowKey="id"
          dataSource={tasks}
          scroll={{ x: 880 }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <EmptyPanel
                title="这里还没有任务"
                description="导入文件后，可在这里查看构建进度。"
              />
            ),
          }}
          columns={[
            {
              title: "任务名称",
              render: (_, t) => (
                <button className="file-name" onClick={() => setDetail(t)}>
                  <span className="icon-square purple">
                    <Workflow size={18} />
                  </span>
                  <span>
                    {t.name}
                    <small>
                      {state.knowledge.find((k) => k.id === t.kbId)?.name}
                    </small>
                  </span>
                </button>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 120,
              render: (v) => <Status status={v} />,
            },
            {
              title: "处理进度",
              width: 190,
              render: (_, t) => (
                <div className="task-progress">
                  <Progress
                    percent={Math.round((t.finished / t.total) * 100)}
                    size="small"
                    showInfo={false}
                    status={
                      t.status === "failed"
                        ? "exception"
                        : t.status === "running"
                          ? "active"
                          : "success"
                    }
                  />
                  <span>
                    {t.finished} / {t.total}
                  </span>
                </div>
              ),
            },
            { title: "创建时间", dataIndex: "date", width: 168 },
            {
              title: "操作",
              width: 160,
              render: (_, t) => (
                <div className="table-actions">
                  <Button type="link" size="small" onClick={() => setDetail(t)}>
                    详情
                  </Button>
                  {t.status === "failed" ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => retry(t.id)}
                    >
                      重试失败文件
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </section>
      <Drawer
        title="任务详情"
        size={520}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <>
            <div className="drawer-kicker">BUILD TASK</div>
            <h2>{detail.name}</h2>
            <div className="detail-meta">
              <Status status={detail.status} />
              <span>{detail.date}</span>
            </div>
            {live ? (
              <div className="soft-note">
                <Workflow size={18} />
                <div>
                  <strong>{detail.stage || "等待处理"}</strong>
                  <p>
                    已完成 {detail.finished} / {detail.total} 份文件
                  </p>
                  <p>
                    {detail.kind === "parse"
                      ? "解析完成后请预览内容，再确认构建。"
                      : "向量化完成后文件即可参与检索与问答。"}
                  </p>
                  {detail.usage?.calls?.length ? (
                    <p>
                      调用记录 {detail.usage.calls.length} 次 · 已返回模型用量{" "}
                      {detail.usage.calls.reduce(
                        (n, c) => n + (c.usage?.total_tokens || 0),
                        0,
                      )}{" "}
                      Tokens（未返回的用量不计入）
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="task-timeline">
                {["接收文件", "文档解析 / OCR", "知识分块", "向量化与索引"].map(
                  (x, i) => (
                    <div key={x}>
                      <span
                        className={
                          detail.status === "failed" && i === 1 ? "warning" : ""
                        }
                      >
                        {detail.status === "failed" && i === 1 ? (
                          "!"
                        ) : (
                          <CheckCircle2 size={18} />
                        )}
                      </span>
                      <div>
                        <strong>{x}</strong>
                        <p>
                          {detail.status === "failed" && i === 1
                            ? "部分文件超时，其他文件已继续处理"
                            : "演示步骤已完成"}
                        </p>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
            {detail.error ? (
              <div className="soft-note warning">{detail.error}</div>
            ) : null}
            <div className="drawer-file-list">
              {detail.fileIds
                .map((id) => state.files.find((f) => f.id === id))
                .filter((f) => !!f)
                .map((f) => (
                  <div key={f.id}>
                    <FileText size={16} />
                    <span>{f.name}</span>
                    <Status status={f.status} />
                  </div>
                ))}
            </div>
            {detail.status === "failed" ? (
              <Button
                type="primary"
                icon={<RefreshCw size={15} />}
                block
                onClick={() => retry(detail.id)}
              >
                {live ? "重试失败文件" : "重试失败文件（模拟）"}
              </Button>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
export function Logs() {
  const nav = useNavigate();
  const { state, live } = useStore();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const weekStart = new Date(Date.now() - 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [kbId, setKbId] = useState("all");
  const [applicationId, setApplicationId] = useState("all");
  const [applications, setApplications] = useState<
    { id: string; draft: { name: string } }[]
  >([]);
  useEffect(() => {
    if (live)
      api<{ id: string; draft: { name: string } }[]>("/applications")
        .then(setApplications)
        .catch(() => {});
  }, [live, state.role]);
  const [period, setPeriod] = useState("all");
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const all = accessibleLogs(state.logs, state.knowledge, state.role);
  const logs = all.filter(
    (l) =>
      (status === "all" || l.status === status) &&
      (applicationId === "all" ||
        (applicationId === "direct"
          ? !l.applicationId
          : l.applicationId === applicationId)) &&
      (kbId === "all" || l.kbIds.includes(kbId)) &&
      l.question.includes(search) &&
      (period === "all" ||
        (period === "today" &&
          l.date.startsWith(live ? today : "2026-10-26")) ||
        (period === "week" && l.date >= (live ? weekStart : "2026-10-20"))),
  );
  const known = logs.filter((l) => l.tokens !== null);
  const totalTokens = known.reduce((n, l) => n + (l.tokens || 0), 0);
  const success = logs.filter((l) => l.status === "success").length;
  const metrics = [
    {
      label: "对话请求",
      value: logs.length,
      unit: "次",
      icon: MessageIcon,
      color: "blue",
    },
    {
      label: live ? "LLM Token 消耗" : "模拟 Token 消耗",
      value: totalTokens.toLocaleString(),
      unit: "Tokens",
      icon: Zap,
      color: "blue",
    },
    {
      label: "平均响应时长",
      value: logs.length
        ? (logs.reduce((n, l) => n + l.duration, 0) / logs.length).toFixed(2)
        : "—",
      unit: "秒",
      icon: Clock3,
      color: "teal",
    },
    {
      label: "有依据回答占比",
      value: logs.length
        ? `${Math.round((success / logs.length) * 100)}%`
        : "—",
      unit: "",
      icon: CheckCircle2,
      color: "amber",
    },
  ];
  const exportLogs = () => {
    const escape = (v: unknown) =>
      `"${String(v ?? "未知")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    downloadText(
      live ? "对话日志.csv" : "对话日志-演示.csv",
      "\uFEFF" +
        [
          [
            "时间",
            "问题",
            "角色",
            "状态",
            live ? "LLMTokens" : "模拟Token",
            "耗时秒",
            "模型",
          ],
          ...logs.map((l) => [
            l.date,
            l.question,
            roles[l.role],
            l.status,
            l.tokens,
            l.duration,
            l.model,
          ]),
        ]
          .map((row) => row.map(escape).join(","))
          .join("\n"),
    );
  };
  return (
    <div className="page">
      <Button
        onClick={() => nav("/observability?view=chat")}
        style={{ marginBottom: 16 }}
      >
        返回可观测中心 · 原型
      </Button>
      <PageHeading
        title="对话日志"
        description="看见每一次检索与回答，持续优化知识服务质量。"
        actions={
          <Button
            icon={<ArrowDownToLine size={16} />}
            onClick={exportLogs}
            disabled={!logs.length}
          >
            导出当前结果
          </Button>
        }
      />
      <div className="stats-grid log-stats">
        {metrics.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={18} />
              </span>
            </div>
            <div className="stat-value">
              {s.value}
              <small>{s.unit}</small>
            </div>
            <p>
              {live ? "当前筛选范围 · 服务端记录" : "当前筛选范围 · 演示统计"}
            </p>
          </div>
        ))}
      </div>
      <div className="log-info">
        <ShieldCheck size={15} />
        {state.role === "manager"
          ? "仅展示管理范围内的日志；跨越不可见知识库的记录不展示。"
          : "未知用量不按 0 汇总；最多展示最近 1,000 条授权范围内的日志。"}
        <span>{logs.length - known.length} 条用量未知</span>
      </div>
      <section className="panel">
        <div className="table-toolbar logs-toolbar">
          <Input
            prefix={<Search size={15} />}
            placeholder="搜索提问内容"
            aria-label="搜索提问内容"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <div>
            {live ? (
              <Select
                aria-label="日志所属应用"
                value={applicationId}
                onChange={setApplicationId}
                style={{ minWidth: 170 }}
                options={[
                  { value: "all", label: "全部应用与直接问答" },
                  { value: "direct", label: "直接知识库问答" },
                  ...applications.map((a) => ({
                    value: a.id,
                    label: a.draft.name,
                  })),
                ]}
              />
            ) : null}
            <Select
              aria-label="日志知识库"
              value={kbId}
              onChange={setKbId}
              options={[
                { value: "all", label: "全部知识库" },
                ...visibleKnowledge(state.knowledge, state.role).map((k) => ({
                  value: k.id,
                  label: k.name,
                })),
              ]}
            />
            <Select
              aria-label="日志状态"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "全部结果" },
                ...["success", "empty", "failed", "cancelled"].map((value) => ({
                  value,
                  label: {
                    success: "有依据回答",
                    empty: "无依据",
                    failed: "失败",
                    cancelled: "已停止",
                  }[value],
                })),
              ]}
            />
            <Select
              aria-label="日志时间范围"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "all", label: "全部时间" },
                { value: "today", label: live ? "今天" : "10/26 演示日" },
                { value: "week", label: live ? "近 7 天" : "10/20–10/26" },
              ]}
            />
          </div>
        </div>
        <Table<LogEntry>
          rowKey="id"
          dataSource={logs}
          scroll={{ x: 1000 }}
          pagination={{
            pageSize: 8,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条记录`,
          }}
          columns={[
            {
              title: "提问内容",
              width: 290,
              render: (_, l) => (
                <button className="log-question" onClick={() => setDetail(l)}>
                  {l.question}
                  {l.applicationId ? (
                    <Tag color="blue">
                      {applications.find((a) => a.id === l.applicationId)?.draft
                        .name || "应用记录"}
                    </Tag>
                  ) : null}
                  <small>
                    {l.kbIds
                      .map(
                        (id) => state.knowledge.find((k) => k.id === id)?.name,
                      )
                      .join(" · ")}
                  </small>
                </button>
              ),
            },
            {
              title: "角色",
              dataIndex: "role",
              width: 120,
              render: (v: keyof typeof roles) => roles[v],
            },
            {
              title: "结果",
              dataIndex: "status",
              width: 100,
              render: (v) => <Status status={v} />,
            },
            {
              title: live ? "LLM Tokens" : "模拟 Tokens",
              dataIndex: "tokens",
              width: 120,
              render: (v) =>
                v === null ? (
                  <Tooltip title="服务商未返回用量，或生成被取消">
                    <span className="unknown-usage">未知</span>
                  </Tooltip>
                ) : (
                  v.toLocaleString()
                ),
            },
            {
              title: "耗时",
              dataIndex: "duration",
              width: 95,
              render: (v) => `${v.toFixed(2)} s`,
            },
            { title: "时间", dataIndex: "date", width: 165 },
            {
              title: "",
              width: 65,
              render: (_, l) => (
                <Button type="link" onClick={() => setDetail(l)}>
                  详情
                </Button>
              ),
            },
          ]}
        />
      </section>
      <Drawer
        title="对话调用详情"
        size={640}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <>
            <div className="drawer-kicker">
              {live ? "REQUEST TRACE · 实际调用" : "REQUEST TRACE · 演示链路"}
            </div>
            <h2 className="log-detail-question">{detail.question}</h2>
            <div className="detail-meta">
              <Status status={detail.status} />
              <span>{roles[detail.role]}</span>
              <span>{detail.date}</span>
            </div>
            <div className="trace-stats">
              <div>
                <small>{live ? "LLM Tokens" : "模拟 Token"}</small>
                <strong>{detail.tokens ?? "未知"}</strong>
              </div>
              <div>
                <small>端到端耗时</small>
                <strong>{detail.duration.toFixed(2)} s</strong>
              </div>
              <div>
                <small>对话模型</small>
                <strong>{detail.model}</strong>
              </div>
            </div>
            <h4>{live ? "处理阶段（真实耗时）" : "处理阶段（演示分配）"}</h4>
            <div className="trace-stages">
              {[
                {
                  label: "问题与向量化",
                  share: live
                    ? (detail.details?.stages?.embedding || 0) /
                      Math.max(0.001, detail.duration)
                    : 0.12,
                },
                {
                  label: "混合检索",
                  share: live
                    ? (detail.details?.stages?.retrieval || 0) /
                      Math.max(0.001, detail.duration)
                    : 0.08,
                },
                {
                  label: "结果重排",
                  share: live
                    ? (detail.details?.stages?.rerank || 0) /
                      Math.max(0.001, detail.duration)
                    : 0.15,
                },
                {
                  label: "答案生成",
                  share: live
                    ? (detail.details?.stages?.generation || 0) /
                      Math.max(0.001, detail.duration)
                    : 0.65,
                },
              ].map((s) => (
                <div key={s.label}>
                  <span>{s.label}</span>
                  <Progress
                    size="small"
                    percent={s.share * 100}
                    showInfo={false}
                  />
                  <strong>{(detail.duration * s.share).toFixed(2)} s</strong>
                </div>
              ))}
            </div>
            {detail.error ? (
              <div className="soft-note warning">{detail.error}</div>
            ) : null}
            {live && detail.details?.calls?.length ? (
              <>
                <h4>模型、Skill 与工具调用</h4>
                <div className="drawer-file-list">
                  {detail.details.calls.map((call, index) => (
                    <div key={index}>
                      <span>
                        {call.type} · {call.name || call.model || "未标注"}
                      </span>
                      <span>
                        {call.status ||
                          (call.usage
                            ? `${call.usage.total_tokens ?? "未知"} Tokens`
                            : "用量未知")}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <h4>回答内容</h4>
            <div className="log-answer">
              <ReactMarkdown>{detail.answer}</ReactMarkdown>
            </div>
            <h4>引用资料</h4>
            {detail.sources.length ? (
              <SourceButtons sources={detail.sources} onSelect={setSource} />
            ) : (
              <p className="text-muted">本次请求没有可用引用</p>
            )}
            <div className="trace-id">请求编号 · {detail.id}</div>
          </>
        ) : null}
      </Drawer>
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
function MessageIcon({ size = 18 }: { size?: number }) {
  return <Activity size={size} />;
}
const providers = [
  {
    name: "通义百炼",
    short: "通",
    className: "purple",
    description: "通义千问 · 阿里云模型服务",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    name: "OpenRouter",
    short: "OR",
    className: "slate",
    description: "统一访问多家大语言模型",
    url: "https://openrouter.ai/api/v1",
  },
  {
    name: "AIHubMix",
    short: "AI",
    className: "blue",
    description: "多模型聚合 · 灵活调用",
    url: "https://aihubmix.com/v1",
  },
];
export function Models() {
  const { state, setState, live, refresh } = useStore();
  const { message, modal } = App.useApp();
  const [provider, setProvider] = useState("all");
  const [type, setType] = useState("all");
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testScenario, setTestScenario] = useState("success");
  const [form] = Form.useForm();
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);
  const test = (model: ModelConfig) => {
    if (live) {
      setTesting(model.id);
      void write(`/models/${model.id}/test`, {})
        .then(() => refresh())
        .then(() => message.success("真实模型测试通过"))
        .catch(async (error) => {
          await refresh();
          message.error(String(error));
        })
        .finally(() => setTesting(null));
      return;
    }
    setTesting(model.id);
    timeouts.current.push(
      setTimeout(() => {
        setState((s) => ({
          ...s,
          models: s.models.map((m) =>
            m.id === model.id
              ? {
                  ...m,
                  status: testScenario === "success" ? "ready" : "failed",
                }
              : m,
          ),
        }));
        setTesting(null);
        testScenario === "success"
          ? message.success(
              `模拟测试通过${model.type === "Embedding" ? `：返回 ${model.dimension || 1024} 维向量` : model.type === "Rerank" ? "：返回候选排序" : "：流式响应完成"}`,
            )
          : message.error("模拟请求超时，请检查配置并重试");
      }, 650),
    );
  };
  const openModel = (model?: ModelConfig) => {
    setEditing(model || null);
    form.resetFields();
    form.setFieldsValue(
      model || {
        provider: provider === "all" ? "通义百炼" : provider,
        type: type === "all" || type === "ocr" ? "LLM" : type,
        url:
          providers.find((p) => p.name === provider)?.url || providers[0].url,
        dimension: 1024,
      },
    );
    setFormOpen(true);
  };
  const save = async () => {
    const v = await form.validateFields().catch(() => undefined);
    if (!v) return;
    if (live) {
      try {
        await write(
          editing ? `/models/${editing.id}` : "/models",
          v,
          editing ? "PUT" : "POST",
        );
        await refresh();
        setFormOpen(false);
        form.setFieldValue("apiKey", "");
        message.success("模型已保存，请执行连接测试");
      } catch (error) {
        message.error(String(error));
      }
      return;
    }
    const model: ModelConfig = {
      ...v,
      id: editing?.id || uid(),
      status: "untested",
    };
    setState((s) => ({
      ...s,
      models: editing
        ? s.models.map((m) => (m.id === editing.id ? model : m))
        : [...s.models, model],
    }));
    setFormOpen(false);
    message.success("演示模型配置已保存，请分别测试其能力");
  };
  const rows = state.models.filter(
    (m) =>
      (provider === "all" || m.provider === provider) &&
      (type === "all" || m.type === type),
  );
  const selectedType = Form.useWatch("type", form);
  return (
    <div className="page">
      <PageHeading
        title="模型服务"
        description="统一管理模型与解析能力，为知识问答配置合适的引擎。"
        actions={
          type !== "ocr" ? (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => openModel()}
            >
              添加模型
            </Button>
          ) : null
        }
      />
      <div className="provider-cards">
        {providers.map((p) => (
          <button
            key={p.name}
            className={`provider-card ${provider === p.name ? "selected" : ""}`}
            onClick={() => setProvider((v) => (v === p.name ? "all" : p.name))}
          >
            <span className={`provider-logo ${p.className}`}>{p.short}</span>
            <div>
              <h3>{p.name}</h3>
              <p>{p.description}</p>
            </div>
            <span className="provider-count">
              {state.models.filter((m) => m.provider === p.name).length} 个模型
            </span>
            {provider === p.name ? (
              <CheckCircle2 size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        ))}
      </div>
      {live && type !== "ocr" ? (
        <ModelPresetSetup onInstalled={setProvider} />
      ) : null}
      <Tabs
        className="model-tabs"
        activeKey={type}
        onChange={setType}
        items={[
          { key: "all", label: "全部模型" },
          { key: "LLM", label: "对话模型 LLM" },
          { key: "Embedding", label: "向量模型 Embedding" },
          { key: "Rerank", label: "重排模型 Rerank" },
          { key: "ocr", label: "文档解析 / OCR" },
        ]}
      />
      {type === "ocr" ? (
        <OcrSettings />
      ) : (
        <>
          <div className="model-notice">
            <KeyRound size={17} />
            <div>
              <strong>
                {live ? "模型凭证由服务端加密保存" : "当前为模型配置交互演示"}
              </strong>
              <span>
                {live
                  ? "连接测试将真实调用服务商 API，可能产生用量费用。"
                  : "不接收真实密钥、不发送网络请求。测试结果来自你选择的演示场景。"}
              </span>
            </div>
            {!live ? (
              <Select
                aria-label="模拟模型测试结果"
                value={testScenario}
                onChange={setTestScenario}
                options={[
                  { value: "success", label: "模拟测试成功" },
                  { value: "fail", label: "模拟请求超时" },
                ]}
              />
            ) : null}
          </div>
          <section className="panel">
            <div className="table-toolbar">
              <h3>
                {provider === "all" ? "已配置模型" : provider}{" "}
                <Tag>{rows.length}</Tag>
              </h3>
              {provider !== "all" ? (
                <Button type="text" onClick={() => setProvider("all")}>
                  查看全部服务商
                </Button>
              ) : (
                <span className="text-muted">三类模型独立配置与测试</span>
              )}
            </div>
            <Table<ModelConfig>
              dataSource={rows}
              rowKey="id"
              pagination={false}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: "模型名称",
                  width: 260,
                  render: (_, m) => (
                    <div className="file-name">
                      <span
                        className={`icon-square ${m.type === "LLM" ? "blue" : m.type === "Embedding" ? "blue" : "teal"}`}
                      >
                        <Sparkles size={18} />
                      </span>
                      <span>
                        {m.name}
                        <small>{m.model}</small>
                      </span>
                    </div>
                  ),
                },
                {
                  title: "能力类型",
                  dataIndex: "type",
                  width: 160,
                  render: (v) => (
                    <Tag
                      variant="filled"
                      color={
                        v === "LLM"
                          ? "blue"
                          : v === "Embedding"
                            ? "blue"
                            : "cyan"
                      }
                    >
                      {v}
                    </Tag>
                  ),
                },
                { title: "服务商", dataIndex: "provider", width: 120 },
                {
                  title: live ? "连接状态" : "演示状态",
                  dataIndex: "status",
                  width: 115,
                  render: (v, model) =>
                    live && !model.hasKey ? (
                      <Tag color="gold">待填密钥</Tag>
                    ) : (
                      <Status status={v} />
                    ),
                },
                {
                  title: "参数",
                  width: 120,
                  render: (_, m) =>
                    m.type === "Embedding"
                      ? `${m.dimension || 1024} 维`
                      : m.type === "LLM"
                        ? "流式回答"
                        : "结果重排",
                },
                {
                  title: "操作",
                  width: 200,
                  render: (_, m) => (
                    <div className="table-actions">
                      <Button
                        type="link"
                        size="small"
                        loading={testing === m.id}
                        disabled={
                          (live && !m.hasKey) || (!!testing && testing !== m.id)
                        }
                        onClick={() => test(m)}
                      >
                        {live ? "连接测试" : "模拟测试"}
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => openModel(m)}
                      >
                        配置
                      </Button>
                      <Tooltip title={live ? "删除模型配置" : "删除演示模型"}>
                        <Button
                          type="text"
                          size="small"
                          aria-label={`删除模型 ${m.name}`}
                          onClick={() => {
                            if (
                              state.knowledge.some((k) => k.embedding === m.id)
                            ) {
                              message.warning(
                                "该向量模型已被知识库绑定，请先更换模型",
                              );
                              return;
                            }
                            modal.confirm({
                              title: "删除此模型配置？",
                              content: live
                                ? "此模型将不再用于问答，请确认没有被知识库绑定。"
                                : "删除后不再用于演示问答。",
                              okText: "删除",
                              cancelText: "取消",
                              onOk: () =>
                                live
                                  ? api(`/models/${m.id}`, { method: "DELETE" })
                                      .then(() => refresh())
                                      .catch((error) =>
                                        message.error(String(error)),
                                      )
                                  : setState((s) => ({
                                      ...s,
                                      models: s.models.filter(
                                        (x) => x.id !== m.id,
                                      ),
                                    })),
                            });
                          }}
                        >
                          <MoreHorizontal size={16} />
                        </Button>
                      </Tooltip>
                    </div>
                  ),
                },
              ]}
            />
          </section>
          <div className="capability-guide">
            <div>
              <Layers3 size={22} />
              <h4>对话模型</h4>
              <p>
                理解问题与上下文
                <br />
                组织有依据的回答
              </p>
            </div>
            <ArrowRight size={17} />
            <div>
              <DatabaseIcon />
              <h4>向量模型</h4>
              <p>
                将知识与问题转为向量
                <br />
                找到语义相关的内容
              </p>
            </div>
            <ArrowRight size={17} />
            <div>
              <FlaskConical size={22} />
              <h4>重排模型</h4>
              <p>
                对候选知识再次排序
                <br />
                把更相关的资料交给模型
              </p>
            </div>
          </div>
        </>
      )}
      <Modal
        title={editing ? "编辑模型配置" : "添加模型"}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={save}
        okText={live ? "保存模型配置" : "保存演示配置"}
        cancelText="取消"
        width={560}
        forceRender
      >
        <Form form={form} layout="vertical">
          <div className="form-two">
            <Form.Item
              name="provider"
              label="模型服务商"
              rules={[{ required: true }]}
            >
              <Select
                options={providers.map((p) => ({
                  value: p.name,
                  label: p.name,
                }))}
                onChange={(v) =>
                  form.setFieldValue(
                    "url",
                    providers.find((p) => p.name === v)?.url,
                  )
                }
              />
            </Form.Item>
            <Form.Item
              name="type"
              label="能力类型"
              rules={[{ required: true }]}
            >
              <Select
                options={["LLM", "Embedding", "Rerank"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="name"
            label="显示名称"
            rules={[
              { required: true, whitespace: true, message: "请输入显示名称" },
            ]}
          >
            <Input placeholder="例如：通义 · 企业问答" maxLength={40} />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型 ID"
            rules={[
              { required: true, whitespace: true, message: "请输入模型 ID" },
            ]}
          >
            <Input placeholder="填写服务商提供的模型标识" maxLength={120} />
          </Form.Item>
          <Form.Item
            name="url"
            label="Base URL / 接口地址"
            rules={[
              { required: true, message: "请输入接口地址" },
              { type: "url", message: "请输入有效的 HTTP(S) 地址" },
              {
                validator: (_, v) =>
                  !v || /^https?:\/\//.test(v)
                    ? Promise.resolve()
                    : Promise.reject(new Error("只支持 HTTP(S) 地址")),
              },
            ]}
          >
            <Input placeholder="https://…" />
          </Form.Item>
          {selectedType === "Embedding" ? (
            <Form.Item
              name="dimension"
              label="向量维度"
              rules={[{ required: true, message: "请输入向量维度" }]}
            >
              <InputNumber min={64} max={4096} style={{ width: "100%" }} />
            </Form.Item>
          ) : null}
          <Form.Item
            name="apiKey"
            label="API Key"
            extra={
              live && editing?.hasKey
                ? "已保存密钥。留空保留原密钥。"
                : undefined
            }
          >
            <Input.Password
              disabled={!live}
              autoComplete="new-password"
              placeholder={
                live
                  ? "填写该服务商的 API Key，由服务端加密保存"
                  : "原型不接收真实密钥，后端接入后再配置"
              }
            />
          </Form.Item>
          {live ? (
            <Form.Item name="timeout" label="请求超时（秒）">
              <InputNumber
                min={5}
                max={180}
                placeholder="默认 60"
                style={{ width: "100%" }}
              />
            </Form.Item>
          ) : null}
          <div className="soft-note">
            <ShieldCheck size={16} />
            {live
              ? "保存不会调用模型，请分别执行 LLM、Embedding 与 Rerank 连接测试。"
              : "界面演示不验证服务商、区域或模型是否真实可用。"}
          </div>
        </Form>
      </Modal>
    </div>
  );
}
function DatabaseIcon() {
  return <Layers3 size={22} />;
}
function OcrSettings() {
  const { state, setState, live, refresh } = useStore();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  return (
    <section className="panel settings-panel ocr-panel">
      <div className="settings-intro">
        <span className="icon-square blue">
          <Cloud size={22} />
        </span>
        <h3>云端文档解析</h3>
        <p>扫描 PDF、图片与复杂表格通过云端 API 识别，不下载本地模型。</p>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={state.ocr}
        onFinish={async (values) => {
          if (live) {
            try {
              await write(
                "/settings/ocr",
                { ...values, region: "cn-hangzhou" },
                "PUT",
              );
              await refresh();
              form.setFieldsValue({ accessKeyId: "", accessKeySecret: "" });
              message.success("解析服务配置已保存");
            } catch (error) {
              message.error(String(error));
            }
            return;
          }
          setState((s) => ({ ...s, ocr: values }));
          message.success("解析服务演示配置已保存");
        }}
      >
        <Form.Item label="解析服务商" name="provider">
          <Select
            options={[
              {
                value: "阿里云 DocMind",
                label: "阿里云 DocMind · 文档智能解析",
              },
            ]}
          />
        </Form.Item>
        <Form.Item label="服务区域" name="region">
          <Select
            options={(live
              ? ["cn-hangzhou"]
              : ["华东 1（杭州）", "华东 2（上海）"]
            ).map((value) => ({
              value,
              label: value,
            }))}
          />
        </Form.Item>
        {live ? (
          <Form.Item name="accessKeyId" label="AccessKey ID">
            <Input.Password
              autoComplete="new-password"
              placeholder={
                state.ocr.hasKey
                  ? "已保存，留空不变"
                  : "填写云端文档解析 AccessKey ID"
              }
            />
          </Form.Item>
        ) : null}
        <Form.Item
          name="accessKeySecret"
          label="AccessKey Secret"
          extra="DocMind 与百炼模型服务独立，正式版需分别配置凭证。"
        >
          <Input.Password
            disabled={!live}
            autoComplete="new-password"
            placeholder={
              live ? "填写 Secret，已保存时留空不变" : "原型不接收真实凭证"
            }
          />
        </Form.Item>
        <Form.Item label="启用云端解析" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <div className="soft-note">
          <CircleHelp size={17} />
          {live
            ? "启用后，扫描件和图片会调用云端解析，按服务商规则计费。"
            : "当前仅保存配置，OCR、表格识别和坐标返回需后端联调验证。"}
        </div>
        <Button type="primary" htmlType="submit">
          保存解析配置
        </Button>
      </Form>
    </section>
  );
}
