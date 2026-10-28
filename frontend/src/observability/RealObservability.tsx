import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Collapse,
  Drawer,
  Empty,
  Input,
  Select,
  Table,
  Tabs,
  Tag,
} from "antd";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import { PageHeading, downloadText } from "../components";
import { api } from "../api";
import { accessibleLogs } from "../domain";
import type { LogEntry, Task, TraceCall } from "../data";
import { useStore } from "../store";
import CaseCollector from "../evaluation/CaseCollector";
import "../evaluation/evaluation.css";

const tabs = [
  { key: "overview", label: "总览" },
  { key: "build", label: "知识库构建" },
  { key: "agent", label: "Agent 运行" },
  { key: "chat", label: "对话日志" },
  { key: "cost", label: "用量与费用" },
  { key: "events", label: "异常事件" },
];
type Row = {
  id: string;
  kind: "build" | "agent" | "chat";
  title: string;
  date: string;
  status: string;
  duration?: number;
  tokens: number | null;
  error?: string;
  calls: TraceCall[];
  input: unknown;
  output: unknown;
  plan?: unknown;
  kb: string;
  logId?: string;
};
const statusLabels: Record<string, string> = {
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
  empty: "无依据",
  running: "运行中",
  queued: "排队中",
  awaiting_outline: "等待确认",
  retried: "已重试",
};
function fmt(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function codeFor(call: TraceCall): {
  title: string;
  code: string;
  explain: string;
  file: string;
} {
  const name = call.name || "";
  if (call.type === "Embedding")
    return {
      title: "文本向量化",
      code: 'body = post(self.model, "embeddings", payload)',
      explain:
        "将文本批次发送给所选向量模型，检查数量和维度后供检索或索引使用；向量数值未记录。",
      file: "backend/app/providers.py",
    };
  if (call.type === "Rerank")
    return {
      title: "检索结果重排",
      code: "results, usage = rerank(\n    bounded_model(model), query,\n    [doc.page_content for doc in candidates], min(20, len(candidates)),\n)",
      explain:
        "将查询和候选片段送入重排模型，按返回索引和分数重新排序；失败时保留融合检索结果。",
      file: "backend/app/retrieval.py",
    };
  if (call.type === "LLM" && !call.round)
    return call.name === "流式回答"
      ? {
          title: "流式回答",
          code: "stream = (prompt | adapter).astream(values)",
          explain: "将组装后的提示词和检索上下文送入模型，逐步返回回答。",
          file: "backend/app/chat.py",
        }
      : {
          title: "模型请求",
          code: "result = adapter.invoke(messages)",
          explain: "将系统指令与本次输入发送给模型，并记录可见输出与用量。",
          file: "backend/app/processing.py",
        };
  if (call.type === "LLM")
    return {
      title: "模型与工具循环",
      code: "response = agent.invoke(messages)\nmessages.append(response)\n# 模型请求工具时，执行工具并将结果加入下一轮上下文",
      explain:
        "将当前消息发送给模型；若模型返回工具调用，执行结果会加入下一轮消息，直到返回最终结果或达到调用上限。普通流式问答使用 chat.py 中的 astream。",
      file: "backend/app/agent_tools.py",
    };
  if (name === "calculator")
    return {
      title: "算术工具",
      code: "def calculator(expression: str) -> str:\n    return str(calculate(expression))",
      explain:
        "接收算术表达式并交给受限制的计算器；只支持数字、括号和基本运算，不执行任意代码。",
      file: "backend/app/agent_tools.py",
    };
  if (name === "activate_skill" || name === "read_skill_resource")
    return {
      title: "Skill 资源调用",
      code:
        name === "activate_skill"
          ? "skill = by_name.get(name)\ntext = base64.b64decode(skill.files['SKILL.md']).decode('utf-8-sig')"
          : "encoded = skill.files.get(path)\ncontent = base64.b64decode(encoded).decode('utf-8-sig')",
      explain:
        "只从应用绑定的 Skill 版本加载指令或读取已激活 Skill 的文本资源；不会执行包内脚本。",
      file: "backend/app/agent_tools.py",
    };
  if (name === "current_time")
    return {
      title: "当前时间工具",
      code: "return datetime.now(ZoneInfo(timezone)).isoformat()",
      explain: "根据所选时区读取当前时间，并返回 ISO 格式。",
      file: "backend/app/agent_tools.py",
    };
  if (call.type === "Retrieval")
    return {
      title: "知识检索",
      code: name.includes("报告")
        ? 'documents = retriever.invoke(f"{run.question} {title}")'
        : "documents = retriever.invoke(search_question)\nall_sources = [as_source(d) for d in documents]",
      explain:
        "按照知识库权限、版本范围和检索参数召回资料，并为回答整理可引用的来源。",
      file: name.includes("报告")
        ? "backend/app/application_jobs.py"
        : "backend/app/chat.py",
    };
  if (call.type === "Pipeline")
    return {
      title: "知识处理阶段",
      code: name.includes("解析")
        ? "file.blocks = parse_file(file, db, job)"
        : name.includes("切分")
          ? "prepare_file(db, kb, file, job, started + 90)"
          : "usage = index_documents(db, kb, file, model, generation, file.options, job, deadline=started + 90)",
      explain: name.includes("解析")
        ? "解析源文档并保留文本块与来源位置。"
        : name.includes("切分")
          ? "抽取元数据并按照配置生成可检索的切分预览。"
          : "对片段向量化，写入索引并在成功后切换到新版本。",
      file: "backend/app/jobs.py",
    };
  return {
    title: "调用记录",
    code: "# 此类型没有可展示的代码摘录",
    explain: "该记录由服务商适配器或历史流程产生；未采集更细的内部步骤。",
    file: "backend/app/providers.py",
  };
}
function Value({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="trace-value">
      <h4>{title}</h4>
      {value === undefined || value === null ? (
        <p className="trace-missing">当时未采集或该字段不适用</p>
      ) : (
        <pre>{fmt(value)}</pre>
      )}
    </section>
  );
}
function TraceDetails({ row, close }: { row: Row | null; close: () => void }) {
  if (!row) return null;
  const nodes = row.calls.length ? row.calls : [];
  return (
    <Drawer
      open
      onClose={close}
      width="min(1450px, 96vw)"
      className="obs-drawer"
      title={
        <div className="obs-detail-title">
          <strong>{row.title}</strong>
          <small>
            {row.id} · {row.date} · 真实记录
          </small>
        </div>
      }
      extra={
        <Tag color={row.status === "failed" ? "error" : "blue"}>
          {statusLabels[row.status] || row.status}
        </Tag>
      }
    >
      <div className="trace-layout">
        <aside className="trace-nav">
          <h3>本次执行</h3>
          <p>{nodes.length} 个已记录节点</p>
          <a href="#trace-io">任务输入与结果</a>
          {nodes.map((c, i) => (
            <a href={`#trace-node-${i}`} key={i}>
              <span>{c.status === "failed" ? "×" : "●"}</span>{" "}
              {c.round ? `第 ${c.round} 轮 · ` : ""}
              {c.name || c.model || c.type}
            </a>
          ))}
          {row.error ? <a href="#trace-error">运行异常</a> : null}
        </aside>
        <main className="trace-main">
          <Alert
            type="info"
            showIcon
            title="单次执行全过程"
            description="按已记录顺序展示任务、检索、模型消息、工具与 Skill 结果。模型未返回的内部推理无法读取；历史未采集的内容不会补造。"
          />
          <div id="trace-io" className="trace-card">
            <h3>任务与结果</h3>
            <div className="trace-grid">
              <Value title="输入" value={row.input} />
              <Value title="最终输出" value={row.output} />
            </div>
            {row.plan ? (
              <Value title="已生成的报告大纲 / 计划" value={row.plan} />
            ) : null}
          </div>
          {!nodes.length ? (
            <Empty description="此历史运行没有保存节点详情。新运行会记录实际可获取的内容。" />
          ) : null}
          {nodes.map((call, i) => {
            const source = codeFor(call);
            return (
              <article id={`trace-node-${i}`} className="trace-card" key={i}>
                <div className="trace-head">
                  <div>
                    <span className="trace-seq">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <strong>
                      {call.round ? `第 ${call.round} 轮 · ` : ""}
                      {call.name || call.model || call.type}
                    </strong>
                    <Tag>{call.type}</Tag>
                  </div>
                  <div>
                    <Tag
                      color={
                        call.status === "failed"
                          ? "error"
                          : call.status === "success"
                            ? "success"
                            : "default"
                      }
                    >
                      {call.status
                        ? statusLabels[call.status] || call.status
                        : "状态未采集"}
                    </Tag>
                    <span className="trace-muted">
                      {call.duration !== undefined
                        ? `${call.duration.toFixed(2)} 秒`
                        : "耗时未采集"}
                    </span>
                  </div>
                </div>
                <Collapse
                  ghost
                  defaultActiveKey={call.status === "failed" ? ["content"] : []}
                  items={[
                    {
                      key: "content",
                      label: "展开本节点：输入、上下文、输出与异常",
                      children: (
                        <>
                          <div className="trace-grid">
                            <Value
                              title={
                                call.type === "LLM"
                                  ? "模型输入与调用上下文"
                                  : "输入与调用参数"
                              }
                              value={call.input}
                            />
                            <Value
                              title={
                                call.type === "LLM"
                                  ? "模型返回与工具请求"
                                  : "输出 / 工具结果"
                              }
                              value={call.output}
                            />
                          </div>
                          {call.error ? (
                            <Value title="异常与恢复信息" value={call.error} />
                          ) : null}
                          <div className="trace-metrics">
                            <span>
                              时间：
                              {call.startedAt
                                ? new Date(call.startedAt).toLocaleString(
                                    "zh-CN",
                                    { timeZone: "Asia/Shanghai" },
                                  )
                                : "未采集"}
                            </span>
                            <span>
                              Token：
                              {call.usage?.total_tokens ?? "未知 / 不适用"}
                            </span>
                            {call.toolCallId ? (
                              <span>工具调用 ID：{call.toolCallId}</span>
                            ) : null}
                          </div>
                          <details className="trace-code">
                            <summary>查看运行代码与解释</summary>
                            <p>{source.explain}</p>
                            <pre>{source.code}</pre>
                            <a
                              href={`https://github.com/wanchenghhh/zhixu-knowledge-hub/blob/main/${source.file}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查看 {source.title} 的完整源码 ↗
                            </a>
                            <p>
                              代码摘录对应当前实现；历史运行可能使用其他版本。
                            </p>
                          </details>
                        </>
                      ),
                    },
                  ]}
                />
              </article>
            );
          })}
          {row.error ? (
            <div id="trace-error" className="trace-card">
              <Value title="运行异常" value={row.error} />
            </div>
          ) : null}
        </main>
        <aside className="trace-summary">
          <h3>运行信息</h3>
          {[
            ["状态", statusLabels[row.status] || row.status],
            ["所属知识库", row.kb],
            [
              "耗时",
              row.duration !== undefined
                ? `${row.duration.toFixed(2)} 秒`
                : "未采集",
            ],
            [
              "已知 LLM Token",
              row.tokens === null ? "未知" : row.tokens.toLocaleString(),
            ],
            ["实际费用", "未接入账单"],
            ["记录范围", "已有记录 · 不包含模型隐藏推理"],
          ].map(([k, v]) => (
            <div className="obs-summary-row" key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </aside>
      </div>
    </Drawer>
  );
}
function taskRow(t: Task, kb: string): Row {
  const calls = [...(t.traceEvents || []), ...(t.usage?.calls || [])];
  const llm = (t.usage?.calls || []).filter((c) => c.type === "LLM");
  return {
    id: t.id,
    kind: t.kind === "report" ? "agent" : "build",
    title: t.name,
    date: t.date,
    status: t.status,
    error: t.error,
    calls,
    input: {
      question: t.question,
      inputs: t.inputs,
      fileIds: t.fileIds,
      stage: t.stage,
    },
    output: { finished: t.finished, total: t.total, sections: t.sections },
    plan: t.outline?.length ? t.outline : undefined,
    kb,
    tokens:
      llm.length && llm.every((c) => c.usage)
        ? llm.reduce((n, c) => n + (c.usage?.total_tokens || 0), 0)
        : null,
  };
}
function logRow(l: LogEntry, kb: string): Row {
  return {
    id: l.id,
    logId: l.id,
    kind: l.applicationId ? "agent" : "chat",
    title: l.question,
    date: l.date,
    status: l.status,
    error: l.error,
    duration: l.duration,
    tokens: l.tokens,
    calls: l.details?.calls || [],
    input: { question: l.question, inputs: l.details?.inputs },
    output: { answer: l.answer, sources: l.sources },
    plan: l.details?.outline?.length ? l.details.outline : undefined,
    kb,
  };
}
export default function RealObservability() {
  const { state, refresh, connectionError } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Row | null>(null);
  const [caseLogId, setCaseLogId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [traceLoading, setTraceLoading] = useState("");
  const { message } = App.useApp();
  const openRow = async (row: Row) => {
    setTraceLoading(row.id);
    try {
      const detail = await api<{
        calls: TraceCall[];
        input: unknown;
        output: unknown;
        plan?: unknown;
        error?: string;
      }>(`/observability/runs/${row.id}`);
      setSelected({ ...row, ...detail });
    } catch (error) {
      message.error(String(error));
    } finally {
      setTraceLoading("");
    }
  };
  const view = tabs.some((t) => t.key === params.get("view"))
    ? params.get("view")!
    : "overview";
  const status = params.get("status") || "all",
    query = params.get("q") || "";
  const set = (key: string, value: string) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (value && value !== "all") n.set(key, value);
      else n.delete(key);
      return n;
    });
  const logs = accessibleLogs(state.logs, state.knowledge, state.role);
  const ids = new Set(logs.map((l) => l.id));
  const kbName = (id: string) =>
    state.knowledge.find((k) => k.id === id)?.name || "知识库不可用";
  const all: Row[] = [
    ...logs.map((l) => logRow(l, l.kbIds.map(kbName).join("、"))),
    ...state.tasks
      .filter((t) => !ids.has(t.id))
      .map((t) => taskRow(t, kbName(t.kbId))),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const base = all.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      `${r.title} ${r.id} ${r.kb} ${r.calls.map((c) => c.name || c.model || "").join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const rows = base.filter(
    (r) => !["build", "agent", "chat"].includes(view) || r.kind === view,
  );
  const events = base.flatMap((row) => [
    ...row.calls
      .filter((c) => c.status === "failed" || c.error)
      .map((call, i) => ({ id: `${row.id}-${i}`, row, call })),
    ...(row.error
      ? [
          {
            id: `${row.id}-root`,
            row,
            call: {
              type: "运行",
              name: "运行失败",
              status: "failed",
              error: row.error,
            } as TraceCall,
          },
        ]
      : []),
  ]);
  const calls = base.flatMap((row) =>
    row.calls
      .filter((c) => ["LLM", "Embedding", "Rerank", "OCR"].includes(c.type))
      .map((call, i) => ({ id: `${row.id}-${i}`, row, call })),
  );
  const completed = base.filter((r) =>
    ["success", "failed", "empty"].includes(r.status),
  );
  const known = base.filter((r) => r.tokens !== null);
  const total = known.reduce((n, r) => n + (r.tokens || 0), 0);
  const stats = [
    ["运行记录", `${base.length} 次`, "当前已载入范围"],
    [
      "执行失败",
      `${base.filter((r) => r.status === "failed").length} 次`,
      `${completed.length} 个已结束运行`,
    ],
    [
      "已知 LLM Token",
      total.toLocaleString(),
      `${base.length - known.length} 次运行用量未知`,
    ],
    ["费用", "未定价", "尚未接入服务商账单与价格"],
  ];
  const exportRows = () =>
    downloadText(
      "可观测记录.json",
      JSON.stringify({ scope: "当前已载入并授权的记录", rows }, null, 2),
    );
  return (
    <div className="page obs-page">
      <PageHeading
        title="可观测中心"
        description="查看知识构建、Agent 执行、对话与消耗的真实记录。"
        actions={
          <>
            <Button
              icon={<RefreshCw size={15} />}
              loading={loading}
              onClick={() => {
                setLoading(true);
                void refresh()
                  .catch((error) => message.error(String(error)))
                  .finally(() => setLoading(false));
              }}
            >
              刷新
            </Button>
            <Button onClick={() => navigate("/logs")}>对话日志</Button>
          </>
        }
      />
      <Alert
        type={connectionError ? "warning" : "info"}
        showIcon
        title={connectionError || "真实运行记录"}
        description="新发生的运行记录可展示已采集的节点输入、输出、上下文和异常。历史数据与未返回的用量会标明缺失；实际费用尚未接入。"
      />
      <Tabs activeKey={view} onChange={(v) => set("view", v)} items={tabs} />
      <div className="obs-filters">
        <Select
          aria-label="观测运行状态"
          value={status}
          onChange={(v) => set("status", v)}
          options={[
            { value: "all", label: "全部状态" },
            ...Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Input
          aria-label="搜索观测记录"
          placeholder="搜索任务、工具、Skill 或 ID"
          allowClear
          value={query}
          onChange={(e) => set("q", e.target.value)}
        />
        <Button
          icon={<ArrowDownToLine size={15} />}
          disabled={!rows.length}
          onClick={exportRows}
        >
          导出记录摘要
        </Button>
      </div>
      <div className="obs-stats">
        {stats.map(([k, v, n]) => (
          <section className="panel obs-stat" key={k}>
            <div>{k}</div>
            <strong>{v}</strong>
            <small>{n}</small>
          </section>
        ))}
      </div>
      <Alert
        type="warning"
        title="统计范围说明"
        description="统计基于已载入的授权记录：最多 1,000 条对话日志、500 个知识任务和当前浏览器的最近 100 个报告任务；不是全量账单统计。"
      />
      {view === "events" ? (
        <section className="panel obs-panel">
          <h2>异常节点与运行</h2>
          <Table
            rowKey="id"
            dataSource={events}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: "节点", render: (_, r) => r.call.name || r.call.type },
              { title: "异常", render: (_, r) => r.call.error || "未采集详情" },
              {
                title: "所属运行",
                render: (_, r) => (
                  <Button type="link" onClick={() => void openRow(r.row)}>
                    {r.row.title}
                  </Button>
                ),
              },
            ]}
          />
        </section>
      ) : view === "cost" ? (
        <section className="panel obs-panel">
          <h2>模型调用用量</h2>
          <Table
            rowKey="id"
            dataSource={calls}
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: "调用",
                render: (_, r) =>
                  `${r.call.type} · ${r.call.model || r.call.name || "未标注"}`,
              },
              {
                title: "Token",
                render: (_, r) => r.call.usage?.total_tokens ?? "未知",
              },
              { title: "费用", render: () => "未定价" },
              {
                title: "运行",
                render: (_, r) => (
                  <Button type="link" onClick={() => void openRow(r.row)}>
                    {r.row.title}
                  </Button>
                ),
              },
            ]}
          />
          <p>
            服务商返回 Token 不等于实际账单；未返回用量不计为零。OCR
            与重排按服务商返回的计量字段展示。
          </p>
        </section>
      ) : (
        <section className="panel obs-panel">
          <div className="obs-section-title">
            <h2>{tabs.find((t) => t.key === view)?.label}记录</h2>
            <small>{rows.length} 条已载入记录</small>
          </div>
          <Table
            rowKey="id"
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 950 }}
            columns={[
              {
                title: "任务 / 问题",
                render: (_, r) => (
                  <>
                    <strong>{r.title}</strong>
                    <small className="obs-cell-note">
                      {r.id} · {r.date}
                    </small>
                  </>
                ),
              },
              {
                title: "类型",
                render: (_, r) =>
                  ({
                    build: "知识库构建",
                    agent: "Agent / 应用",
                    chat: "在线对话",
                  })[r.kind],
              },
              {
                title: "状态",
                render: (_, r) => (
                  <Tag
                    color={
                      r.status === "failed"
                        ? "error"
                        : r.status === "success"
                          ? "success"
                          : "default"
                    }
                  >
                    {statusLabels[r.status] || r.status}
                  </Tag>
                ),
              },
              { title: "已知 Token", render: (_, r) => r.tokens ?? "未知" },
              {
                title: "耗时",
                render: (_, r) =>
                  r.duration === undefined
                    ? "未采集"
                    : `${r.duration.toFixed(2)} 秒`,
              },
              {
                title: "",
                render: (_, r) => (
                  <>
                    <Button
                      type="link"
                      loading={traceLoading === r.id}
                      onClick={() => void openRow(r)}
                    >
                      查看执行过程
                    </Button>
                    {r.logId ? (
                      <Button
                        type="link"
                        onClick={() => setCaseLogId(r.logId!)}
                      >
                        加入评测集
                      </Button>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        </section>
      )}
      <p className="obs-footnote">
        节点内容中识别出的密钥会被隐藏；单字段超过 30,000
        字符会标注截断。历史数据按实际采集情况展示。
      </p>
      <TraceDetails row={selected} close={() => setSelected(null)} />
      <CaseCollector logId={caseLogId} onClose={() => setCaseLogId(null)} />
    </div>
  );
}
