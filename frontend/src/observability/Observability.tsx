import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Clock3,
  GitBranch,
  Settings2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { PageHeading, downloadText } from "../components";
import { useStore } from "../store";
import { demoRuns, kindLabels, statusLabels, summary } from "./demo";
import type { DemoRun, Span } from "./demo";
import "./observability.css";

const views = [
  { key: "overview", label: "总览" },
  { key: "build", label: "知识库构建" },
  { key: "agent", label: "Agent 运行" },
  { key: "chat", label: "对话日志" },
  { key: "cost", label: "用量与费用" },
  { key: "events", label: "异常事件" },
];
const fields = [
  "输入 / 输出",
  "调用上下文",
  "用量与费用",
  "事件",
  "异常",
  "元信息",
];
const money = (n: number) =>
  `CNY ${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const seconds = (n: number) => `${n.toFixed(2)} 秒`;
const json = (value: unknown) => JSON.stringify(value, null, 2);
function StateTag({ value }: { value: string }) {
  return (
    <Tag
      color={
        value === "失败" ? "error" : value === "成功" ? "success" : "processing"
      }
    >
      {value}
    </Tag>
  );
}
function DataBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="obs-block">
      <h3>{title}</h3>
      <pre>{typeof value === "string" ? value : json(value)}</pre>
    </section>
  );
}
function NodeDetails({
  run,
  span,
  tab,
}: {
  run: DemoRun;
  span: Span;
  tab: string;
}) {
  if (tab === "1")
    return (
      <>
        <Alert
          type="info"
          title="调用时可见的上下文"
          description="展示实际发送的消息、检索片段和配置快照；不包含模型隐藏思维链。"
        />
        <DataBlock
          title="上下文快照 · 示例"
          value={
            span.context ?? {
              note: "本节点未使用模型上下文",
              application: run.entity,
              version: run.version,
              input: span.input,
            }
          }
        />
      </>
    );
  if (tab === "2")
    return (
      <>
        <div className="obs-kv">
          <span>
            输入 Token
            <strong>
              {span.inputTokens ?? (span.type === "LLM" ? "未知" : "不适用")}
            </strong>
          </span>
          <span>
            输出 Token
            <strong>
              {span.outputTokens ?? (span.type === "LLM" ? "未知" : "不适用")}
            </strong>
          </span>
          <span>
            估算费用
            <strong>
              {span.cost !== undefined
                ? money(span.cost)
                : span.type === "LLM"
                  ? "未定价"
                  : "本节点不计模型费"}
            </strong>
          </span>
          <span>
            用量来源
            <strong>
              {span.usage === "actual"
                ? "服务商返回（示例）"
                : span.type === "LLM"
                  ? "未知"
                  : "不适用"}
            </strong>
          </span>
        </div>
        <Alert
          type="warning"
          title="尚未接入真实账单对账"
          description="这里的价格和用量均为示例。生产方案将保留单价、币种、生效日期与路由后模型；未知用量不算 0。"
        />
        <DataBlock
          title="计量规则"
          value="仅叶子模型请求归账，父节点展示聚合。真实重试各自计量，重复投递不重复记账。缓存和推理用量按服务商口径记录，不重复叠加。"
        />
      </>
    );
  if (tab === "3")
    return (
      <DataBlock
        title="节点事件 · 示例"
        value={[
          {
            at: `+${span.offset.toFixed(2)}s`,
            event: "节点开始",
            span: span.id,
          },
          {
            at: `+${(span.offset + span.duration).toFixed(2)}s`,
            event: span.status,
            attempts: span.error?.attempts ?? 1,
          },
          ...(span.type === "wait"
            ? [
                {
                  event:
                    span.status === "等待确认"
                      ? "已保存检查点，等待用户确认"
                      : "收到确认，按检查点恢复",
                },
              ]
            : []),
        ]}
      />
    );
  if (tab === "4")
    return span.error ? (
      <>
        <Alert
          type="error"
          showIcon
          title={span.error.code}
          description={span.error.message}
        />
        <DataBlock
          title="异常与恢复"
          value={{
            severity: "error",
            attempts: span.error.attempts,
            recovery: span.error.recovery,
            traceId: run.id,
            spanId: span.id,
            rootCause: span.name,
          }}
        />
      </>
    ) : (
      <Empty description="本示例节点无异常；可选择左侧失败节点定位" />
    );
  if (tab === "5")
    return (
      <DataBlock
        title="关联信息 · 示例"
        value={{
          traceId: run.id,
          spanId: span.id,
          parentSpanId: span.parent ?? "root",
          type: span.type,
          application: run.entity,
          version: run.version,
          environment: "prototype",
          providerRequestId: "未采集（示例不发送模型请求）",
          usageEventId:
            span.type === "LLM" ? `${run.id}:${span.id}:attempt-1` : null,
        }}
      />
    );
  return (
    <>
      <DataBlock title="输入 · 示例" value={span.input} />
      <DataBlock title="输出 · 示例" value={span.output} />
      {span.type === "skill" ? (
        <Alert
          type="info"
          title="Skill 已加载，不等于已执行"
          description="Skill 是指令和资源包，实际模型与工具调用作为子节点记录。当前运行器尚未接入 Skill，本条为设计示例。"
        />
      ) : null}
    </>
  );
}
function RunDetail({
  run,
  onClose,
}: {
  run: DemoRun | null;
  onClose: () => void;
}) {
  const [node, setNode] = useState("");
  const [tab, setTab] = useState("0");
  const [view, setView] = useState("tree");
  if (!run) return null;
  const span = run.spans.find((s) => s.id === node) ?? run.spans[0];
  const total = summary(run);
  return (
    <Drawer
      open
      onClose={onClose}
      width="min(1450px, 96vw)"
      title={
        <div className="obs-detail-title">
          <strong>{run.name}</strong>
          <small>
            {run.id} · 设计示例 · {run.started}
          </small>
        </div>
      }
      className="obs-drawer"
      extra={<Tag color="blue">示例链路</Tag>}
    >
      <div className="obs-detail-grid">
        <aside className="obs-tree">
          <div className="obs-section-title">
            <h3>执行链路</h3>
            <Select
              size="small"
              aria-label="链路显示方式"
              value={view}
              onChange={setView}
              options={[
                { value: "tree", label: "调用树" },
                { value: "timeline", label: "时间线" },
              ]}
            />
          </div>
          {run.spans.map((s) => (
            <button
              key={s.id}
              className={`obs-node ${s.id === span.id ? "selected" : ""} ${s.status === "失败" ? "error" : ""}`}
              style={{
                marginLeft: view === "tree" && s.parent ? 16 : 0,
                width:
                  view === "tree" && s.parent ? "calc(100% - 16px)" : undefined,
              }}
              onClick={() => setNode(s.id)}
              aria-pressed={s.id === span.id}
            >
              <span>
                {s.status === "失败"
                  ? "×"
                  : s.status === "等待确认"
                    ? "◷"
                    : "✓"}
                　{s.name}
              </span>
              <small>
                {seconds(s.duration)} · {s.type}
              </small>
              {view === "timeline" ? (
                <span className="obs-timeline-track">
                  <span
                    style={{
                      marginLeft: `${(s.offset / total.elapsed) * 90}%`,
                      width: `${Math.max((s.duration / total.elapsed) * 90, 1)}%`,
                    }}
                  />
                </span>
              ) : null}
            </button>
          ))}
        </aside>
        <section className="obs-node-detail">
          <div className="obs-section-title">
            <h2>{span.name}</h2>
            <StateTag value={span.status} />
          </div>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={fields.map((label, i) => ({
              key: String(i),
              label,
              children: <NodeDetails run={run} span={span} tab={String(i)} />,
            }))}
          />
        </section>
        <aside className="obs-summary">
          <h3>运行摘要</h3>
          <StateTag value={statusLabels[run.status]} />
          {[
            ["所属对象", run.entity],
            ["版本", run.version],
            ["总耗时", seconds(total.elapsed)],
            ["活动耗时", seconds(total.active)],
            [
              "等待耗时",
              seconds(
                run.spans
                  .filter((s) => s.type === "wait")
                  .reduce((n, s) => n + s.duration, 0),
              ),
            ],
            [
              "已知 Token",
              `${total.tokens.toLocaleString()}${total.unknown ? " · 部分已知" : ""}`,
            ],
            [
              "估算费用",
              `${money(total.cost)}${total.unpriced ? " · 部分定价" : ""}`,
            ],
            ["实际账单", "未接入对账"],
          ].map(([k, v]) => (
            <div className="obs-summary-row" key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
          <p>示例中的工具与 Skill 不代表线上运行器已接入相同能力。</p>
        </aside>
      </div>
    </Drawer>
  );
}
export default function Observability() {
  const navigate = useNavigate();
  const { state, live } = useStore();
  const [params, setParams] = useSearchParams();
  const view = views.some((v) => v.key === params.get("view"))
    ? params.get("view")!
    : "overview";
  const status = params.get("status") ?? "all";
  const query = params.get("q") ?? "";
  const entity = params.get("entity") ?? "all";
  const [selected, setSelected] = useState<DemoRun | null>(null);
  const [settings, setSettings] = useState(false);
  const [sample, setSample] = useState(true);
  const change = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
      return next;
    });
  const filtered = demoRuns.filter(
    (r) =>
      (!["build", "agent", "chat"].includes(view) || r.kind === view) &&
      (status === "all" || r.status === status) &&
      (entity === "all" || r.entity === entity) &&
      `${r.id} ${r.name} ${r.entity} ${r.spans.map((s) => s.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const totals = filtered.map(summary);
  const calls = filtered.flatMap((r) =>
    r.spans.filter((s) => s.type === "LLM").map((s) => ({ run: r, span: s })),
  );
  const tokens = totals.reduce((n, s) => n + s.tokens, 0),
    cost = totals.reduce((n, s) => n + s.cost, 0),
    unknown = totals.reduce((n, s) => n + s.unknown, 0),
    unpriced = totals.reduce((n, s) => n + s.unpriced, 0);
  const ended = filtered.filter((r) => r.status !== "waiting");
  const failure = ended.length
    ? `${((ended.filter((r) => r.status === "failed").length / ended.length) * 100).toFixed(1)}%`
    : "—";
  const durations = ended.map((r) => summary(r).active).sort((a, b) => a - b);
  const p95 = durations.length
    ? seconds(durations[Math.ceil(0.95 * durations.length) - 1])
    : "—";
  const stats =
    view === "cost"
      ? [
          ["估算模型费用", money(cost), "示例单价 × 已知计量"],
          ["已对账实际费用", "—", "未接入服务商账单"],
          ["已知 Token", tokens.toLocaleString(), `${unknown} 次调用用量未知`],
          ["未定价调用", `${unpriced} 次`, "未知消耗与未定价不算 0"],
        ]
      : [
          ["根运行次数", `${filtered.length} 次`, "当前筛选的设计示例"],
          ["执行失败率", failure, "仅已结束根运行，等待单列"],
          ["P95 活动耗时", p95, "示例不含人工确认等待"],
          [
            "估算模型费用",
            money(cost),
            `${unpriced} 次未定价 · ${unknown} 次用量未知`,
          ],
        ];
  const events = filtered.flatMap((r) =>
    r.spans
      .filter((s) => s.error)
      .map((s) => ({
        key: `${r.id}:${s.id}`,
        run: r,
        name: s.error!.code,
        severity: "错误",
        message: s.error!.message,
        count: s.error!.attempts,
      }))
      .concat(
        r.warnings.map((w, i) => ({
          key: `${r.id}:warning-${i}`,
          run: r,
          name: w.includes("usage")
            ? "telemetry.usage_missing"
            : "metadata.incomplete",
          severity: "警告",
          message: w,
          count: 1,
        })),
      ),
  );
  const exportCurrent = () =>
    downloadText(
      "可观测中心-设计示例.json",
      json({
        dataSource: "prototype-only",
        notice: "示例数据，非真实调用或账单",
        filters: { view, status, query, entity },
        runs: filtered,
      }),
    );
  return (
    <div className="page obs-page">
      <PageHeading
        title="可观测中心"
        description="从知识构建到 Agent 执行，追溯每一次调用与消耗。"
        actions={
          <>
            <Button
              icon={<Settings2 size={15} />}
              onClick={() => setSettings(true)}
            >
              采集设置
            </Button>
            <Button onClick={() => navigate("/logs")}>
              现有{live ? "真实" : "演示"}对话日志 <ArrowRight size={15} />
            </Button>
          </>
        }
      />
      <Alert
        showIcon
        type="info"
        title="可观测功能原型 · 示例数据"
        description="本页展示待接入的观测能力，不发送模型请求，不计入真实用量。已有对话日志仍可通过右上角入口查看。"
      />
      <Tabs
        activeKey={view}
        onChange={(value) => change("view", value)}
        items={views}
      />
      <div className="obs-filters">
        <Select
          aria-label="观测时间范围"
          value="demo"
          options={[{ value: "demo", label: "2026-10-28 · 示例日期" }]}
        />
        <Select
          aria-label="观测运行状态"
          value={status}
          onChange={(v) => change("status", v)}
          options={[
            { value: "all", label: "全部状态" },
            ...Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Select
          aria-label="观测所属对象"
          value={entity}
          onChange={(v) => change("entity", v)}
          options={[
            { value: "all", label: "全部应用 / 知识库" },
            ...Array.from(new Set(demoRuns.map((r) => r.entity))).map((v) => ({
              value: v,
              label: v,
            })),
          ]}
        />
        <Input
          aria-label="搜索观测记录"
          placeholder="搜索任务、工具、Skill 或 Trace ID"
          allowClear
          value={query}
          onChange={(e) => change("q", e.target.value)}
        />
        <Button
          icon={<ArrowDownToLine size={15} />}
          disabled={!filtered.length}
          onClick={exportCurrent}
        >
          导出示例
        </Button>
      </div>
      <div className="obs-stats">
        {stats.map(([label, value, note], i) => {
          const Icon = [Activity, TriangleAlert, Clock3, Zap][i];
          return (
            <section className="panel obs-stat" key={label}>
              <div>
                <span>{label}</span>
                <Icon size={17} />
              </div>
              <strong>{value}</strong>
              <small>{note}</small>
            </section>
          );
        })}
      </div>
      {view === "overview" ? (
        <div className="obs-overview">
          <section className="panel obs-panel">
            <h2>
              运行耗时分布 <small>当前筛选 · 示例活动耗时</small>
            </h2>
            {filtered.length ? (
              filtered.map((r) => (
                <button
                  className="obs-duration"
                  key={r.id}
                  onClick={() => setSelected(r)}
                >
                  <span>{r.name}</span>
                  <span className="obs-duration-track">
                    <span
                      style={{
                        width: `${Math.max((summary(r).active / Math.max(...totals.map((t) => t.active))) * 100, 2)}%`,
                      }}
                    />
                  </span>
                  <strong>{seconds(summary(r).active)}</strong>
                </button>
              ))
            ) : (
              <Empty description="没有符合筛选条件的示例" />
            )}
          </section>
          <section className="panel obs-panel">
            <h2>需要关注</h2>
            <div className="obs-attention">
              <span>执行失败</span>
              <Tag color="error">
                {filtered.filter((r) => r.status === "failed").length} 个运行
              </Tag>
            </div>
            <div className="obs-attention">
              <span>调用用量缺失</span>
              <Tag color="warning">{unknown} 次</Tag>
            </div>
            <div className="obs-attention">
              <span>等待用户确认</span>
              <Tag color="blue">
                {filtered.filter((r) => r.status === "waiting").length} 个运行
              </Tag>
            </div>
            <p>
              业务失败、数据缺失和人工等待分别统计。引用率不代表回答准确率。
            </p>
          </section>
        </div>
      ) : null}
      {view === "build" ? (
        <Alert
          type="info"
          title="逐文件追溯构建过程"
          description="上传 → 解析 / OCR → 元数据抽取 → 切分 → Embedding → 索引写入 → 生效切换；保留文件、页码与索引版本。"
        />
      ) : null}
      {view === "agent" ? (
        <Alert
          type="info"
          title="观察模型、工具、Skill 与执行环境"
          description="点击记录查看调用树或时间线。Skill 加载与实际执行分开；上下文超限、最大轮数、检查点和恢复等通过事件呈现。"
        />
      ) : null}
      {view === "chat" ? (
        <Alert
          type="info"
          title="按会话聚合，按单轮追踪"
          description="展示检索、重排、实际请求上下文、首 Token 时延与引用。这里为示例，真实历史请使用右上角日志入口。"
        />
      ) : null}
      {view === "cost" ? (
        <section className="panel obs-panel">
          <h2>
            调用计量明细 <Tag>全部为示例</Tag>
          </h2>
          <Table
            size="middle"
            rowKey={(r) => `${r.run.id}:${r.span.id}`}
            dataSource={calls}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            scroll={{ x: 900 }}
            columns={[
              {
                title: "调用 / 模型",
                render: (_, r) => (
                  <>
                    <strong>{r.span.name}</strong>
                    <small className="obs-cell-note">{r.run.entity}</small>
                  </>
                ),
              },
              {
                title: "输入 / 输出 Token",
                render: (_, r) =>
                  `${r.span.inputTokens ?? "未知"} / ${r.span.outputTokens ?? "未知"}`,
              },
              {
                title: "用量来源",
                render: (_, r) =>
                  r.span.usage === "actual" ? (
                    <Tag>服务商返回 · 示例</Tag>
                  ) : (
                    <Tag color="warning">未知</Tag>
                  ),
              },
              {
                title: "估算费用",
                render: (_, r) =>
                  r.span.cost !== undefined ? (
                    money(r.span.cost)
                  ) : (
                    <Tag color="warning">未定价</Tag>
                  ),
              },
              { title: "实际费用", render: () => "未接入对账" },
              {
                title: "",
                render: (_, r) => (
                  <Button type="link" onClick={() => setSelected(r.run)}>
                    查看链路
                  </Button>
                ),
              },
            ]}
          />
          <p>
            父节点不重复计费；币种分开汇总。OCR、Rerank
            等按各自计量单位归账，未返回用量不推定免费。
          </p>
        </section>
      ) : null}
      {view === "events" ? (
        <section className="panel obs-panel">
          <h2>
            异常事件 <small>示例指纹聚合</small>
          </h2>
          <Table
            rowKey="key"
            dataSource={events}
            pagination={false}
            columns={[
              {
                title: "级别",
                dataIndex: "severity",
                render: (v) => (
                  <Tag color={v === "错误" ? "error" : "warning"}>{v}</Tag>
                ),
              },
              { title: "分类", dataIndex: "name" },
              { title: "异常说明", dataIndex: "message" },
              { title: "次数", dataIndex: "count" },
              {
                title: "关联运行",
                render: (_, r) => (
                  <Button type="link" onClick={() => setSelected(r.run)}>
                    {r.run.name}
                  </Button>
                ),
              },
            ]}
          />
          <p>
            后端接入后补充首次 /
            最近发生、影响运行数与处理状态；当前原型不修改真实异常状态。
          </p>
        </section>
      ) : null}
      {view !== "cost" && view !== "events" ? (
        <section className="panel obs-panel">
          <div className="obs-section-title">
            <h2>{views.find((v) => v.key === view)?.label}记录</h2>
            <small>{filtered.length} 条设计示例</small>
          </div>
          <Table
            rowKey="id"
            dataSource={filtered}
            pagination={false}
            scroll={{ x: 1000 }}
            columns={[
              {
                title: "任务 / 输入内容",
                render: (_, r) => (
                  <>
                    <strong>{r.name}</strong>
                    <small className="obs-cell-note">
                      {r.id} · {r.started}
                    </small>
                  </>
                ),
              },
              { title: "类型", render: (_, r) => kindLabels[r.kind] },
              {
                title: "状态",
                render: (_, r) => <StateTag value={statusLabels[r.status]} />,
              },
              {
                title: "活动耗时",
                render: (_, r) => seconds(summary(r).active),
              },
              {
                title: "已知 Token",
                render: (_, r) => (
                  <>
                    {summary(r).tokens.toLocaleString()}
                    {summary(r).unknown ? (
                      <Tooltip title="存在未返回用量的调用，汇总为部分已知">
                        <Tag color="warning">部分</Tag>
                      </Tooltip>
                    ) : null}
                  </>
                ),
              },
              {
                title: "估算费用",
                render: (_, r) => (
                  <>
                    {money(summary(r).cost)}
                    {summary(r).unpriced ? (
                      <small className="obs-cell-note">部分定价</small>
                    ) : null}
                  </>
                ),
              },
              {
                title: "",
                render: (_, r) => (
                  <Button
                    type="link"
                    icon={<GitBranch size={14} />}
                    onClick={() => setSelected(r)}
                  >
                    查看链路
                  </Button>
                ),
              },
            ]}
          />
        </section>
      ) : null}
      <div className="obs-footnote">
        原型环境 · 已知用量与未采集分开显示 · 本页筛选和导出仅作用于设计示例
      </div>
      <RunDetail
        key={selected?.id ?? "closed"}
        run={selected}
        onClose={() => setSelected(null)}
      />
      <Modal
        open={settings}
        onCancel={() => setSettings(false)}
        title="采集设置 · 方案预览"
        footer={
          <Button type="primary" onClick={() => setSettings(false)}>
            我知道了
          </Button>
        }
      >
        <Alert type="info" title="此处仅预览策略，不改变服务端采集" />
        <div className="obs-setting">
          <span>成功正文采样</span>
          <Switch checked={sample} onChange={setSample} />
        </div>
        <div className="obs-setting">
          <span>正文保留期</span>
          <Tag>建议 7 天</Tag>
        </div>
        <div className="obs-setting">
          <span>摘要与计量保留期</span>
          <Tag>建议 90 天</Tag>
        </div>
        <p>
          API Key、Authorization、Cookie
          不入库。计量与状态不采样。正文按权限查看和脱敏，采集异常不阻塞业务。
        </p>
        <p>
          {state.role === "manager"
            ? "管理人员仅能查看管理范围。"
            : "管理员可管理全局采集策略。"}
          当前为自由切换角色体验，无法可靠按真实员工归因费用。
        </p>
      </Modal>
    </div>
  );
}
