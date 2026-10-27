import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Segmented } from "antd";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  MessageSquare,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useStore } from "../store";
import { accessibleLogs, visibleKnowledge } from "../domain";
import {
  CountPill,
  GuideStep,
  KnowledgeMark,
  NewKnowledge,
  Status,
} from "../components";
export default function Dashboard() {
  const { state, live } = useStore();
  const todayLabel = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const nav = useNavigate();
  const [create, setCreate] = useState(false);
  const [range, setRange] = useState("近 7 天");
  const knowledge = visibleKnowledge(state.knowledge, state.role);
  const ids = new Set(knowledge.map((k) => k.id));
  const files = state.files.filter((f) => ids.has(f.kbId));
  const logs = accessibleLogs(state.logs, state.knowledge, state.role);
  const today = logs.filter((l) =>
    l.date.startsWith(live ? todayLabel : "2026-10-26"),
  );
  const tokens = logs.reduce((n, l) => n + (l.tokens || 0), 0);
  const ready = files.filter((f) => f.status === "ready").length;
  const average = logs.length
    ? (logs.reduce((n, l) => n + l.duration, 0) / logs.length).toFixed(2)
    : "—";
  const stats = [
    {
      label: "知识库总数",
      value: knowledge.length,
      unit: "个",
      note: `${knowledge.filter((k) => files.some((f) => f.kbId === k.id && f.status === "ready")).length} 个知识库可用于对话`,
      icon: Database,
      color: "blue",
    },
    {
      label: "已就绪文件",
      value: ready,
      unit: "份",
      note: `共 ${files.length} 份文件，持续积累中`,
      icon: FileText,
      color: "blue",
    },
    {
      label: "今日对话次数",
      value: today.length,
      unit: "次",
      note: "每一次提问，都有知识回应",
      icon: MessageSquare,
      color: "teal",
    },
    {
      label: "平均响应时长",
      value: average,
      unit: "秒",
      note: `累计消耗 ${tokens.toLocaleString()} LLM Tokens`,
      icon: Clock3,
      color: "amber",
    },
  ];
  const demoChartValues =
    range === "近 7 天" ? [1, 3, 2, 4, 3, 5, 3] : [3, 5, 4, 7, 5, 8, 6];
  const days = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
      new Date(Date.now() - (6 - i) * (range === "近 7 天" ? 1 : 5) * 86400000),
    ),
  );
  const chartValues = live
    ? days.map((day) => logs.filter((l) => l.date.startsWith(day)).length)
    : demoChartValues;
  const chartTotal = chartValues.reduce((n, value) => n + value, 0);
  const chartScale = Math.max(8, ...chartValues);
  return (
    <div className="page dashboard">
      <div className="dashboard-welcome">
        <div>
          <div className="eyebrow">YOUR KNOWLEDGE, CONNECTED</div>
          <h1>
            知识有序，工作有据<span className="heading-spark">✦</span>
          </h1>
          <p>欢迎回来。在这里沉淀团队经验，让知识成为触手可及的答案。</p>
        </div>
        <Button
          type="primary"
          icon={<Plus size={17} />}
          onClick={() => setCreate(true)}
        >
          新建知识库
        </Button>
      </div>
      <div className="stats-grid">
        {stats.map((s) => (
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
            <p>{s.note}</p>
          </div>
        ))}
      </div>
      <div className="dashboard-middle">
        <section className="panel trend-panel">
          <div className="panel-heading">
            <h2>
              知识使用趋势<CountPill>{live ? "实际记录" : "演示"}</CountPill>
            </h2>
            <Segmented
              size="small"
              value={range}
              onChange={(v) => setRange(String(v))}
              options={live ? ["近 7 天"] : ["近 7 天", "近 30 天"]}
            />
          </div>
          <div className="chart-summary">
            <strong>
              {live ? chartTotal : range === "近 7 天" ? "21" : "38"}
              <small>次对话</small>
            </strong>
            <span>
              <TrendingUp size={14} /> 让知识被更多人看见
            </span>
          </div>
          <div className="chart" role="img" aria-label={`${range}演示对话趋势`}>
            <div className="chart-labels">
              {[
                chartScale,
                Math.round(chartScale * 0.75),
                Math.round(chartScale * 0.5),
                Math.round(chartScale * 0.25),
                0,
              ].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
            <svg viewBox="0 0 700 150" preserveAspectRatio="none">
              <defs>
                <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity=".26" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity=".01" />
                </linearGradient>
              </defs>
              {[10, 42, 74, 106, 138].map((y) => (
                <line
                  key={y}
                  x1="0"
                  y1={y}
                  x2="700"
                  y2={y}
                  stroke="#e4e9ef"
                  strokeDasharray="4 5"
                />
              ))}
              <path
                d={`M 10 138 ${chartValues.map((n, i) => `L ${10 + i * 113} ${138 - n * (120 / chartScale)}`).join(" ")} L 688 138 Z`}
                fill="url(#area)"
              />
              <polyline
                points={chartValues
                  .map(
                    (n, i) => `${10 + i * 113},${138 - n * (120 / chartScale)}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {chartValues.map((n, i) => (
                <circle
                  key={i}
                  cx={10 + i * 113}
                  cy={138 - n * (120 / chartScale)}
                  r="3.5"
                  fill="white"
                  stroke="#2563eb"
                  strokeWidth="2"
                />
              ))}
            </svg>
            <div className="chart-dates">
              {(range === "近 7 天"
                ? [
                    "10/20",
                    "10/21",
                    "10/22",
                    "10/23",
                    "10/24",
                    "10/25",
                    "10/26",
                  ]
                : [
                    "09/27",
                    "10/02",
                    "10/07",
                    "10/12",
                    "10/17",
                    "10/22",
                    "10/26",
                  ]
              ).map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>
        </section>
        <section className="panel guide-panel">
          <div className="panel-heading">
            <h2>
              <Sparkles size={17} />
              开启知识之旅
            </h2>
            <span className="text-muted">3 步上手</span>
          </div>
          <p className="panel-intro">从第一份资料，到第一个可信答案。</p>
          <GuideStep
            n={1}
            title="建立知识空间"
            description="为团队创建一个知识库"
            done={knowledge.length > 0}
            onClick={() => setCreate(true)}
          />
          <GuideStep
            n={2}
            title="导入并构建知识"
            description="上传资料，预览片段与索引"
            done={ready > 0}
            onClick={() =>
              nav(
                knowledge.length
                  ? `/knowledge/${knowledge[0].id}?import=1`
                  : "/models",
              )
            }
          />
          <GuideStep
            n={3}
            title="开始第一场对话"
            description="提问、追问，查看答案来源"
            onClick={() => nav("/chat")}
          />
          <div className="guide-tip">
            <CheckCircle2 size={15} />
            推荐先用示例资料体验完整流程
          </div>
        </section>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <h2>
            最近更新的知识库 <CountPill>{knowledge.length}</CountPill>
          </h2>
          <button className="text-button" onClick={() => nav("/knowledge")}>
            查看全部 <ArrowRight size={14} />
          </button>
        </div>
        <div className="recent-grid">
          {knowledge.slice(0, 3).map((k) => (
            <button
              className="recent-card"
              key={k.id}
              onClick={() => nav(`/knowledge/${k.id}`)}
            >
              <div className="recent-card-top">
                <KnowledgeMark kb={k} />
                <span className="category-chip">{k.category}</span>
              </div>
              <h3>
                {k.name}
                <ArrowUpRight size={16} />
              </h3>
              <p>{k.description}</p>
              <div className="recent-card-bottom">
                <span>
                  <FileText size={13} />
                  {files.filter((f) => f.kbId === k.id).length} 份文件
                </span>
                <span>更新于 {k.updated.slice(5, 10)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="panel activity-panel">
        <div className="panel-heading">
          <h2>最近动态</h2>
          <button className="text-button" onClick={() => nav("/tasks")}>
            任务中心 <ArrowRight size={14} />
          </button>
        </div>
        {state.tasks
          .filter((t) => ids.has(t.kbId))
          .slice(0, 3)
          .map((t) => (
            <div className="activity-row" key={t.id}>
              <span
                className={`activity-icon ${t.status === "failed" ? "amber" : "purple"}`}
              >
                <FileText size={17} />
              </span>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.finished} / {t.total} 份文件处理完成
                </small>
              </div>
              <Status status={t.status} />
              <time>{t.date.slice(5)}</time>
            </div>
          ))}
      </section>
      <NewKnowledge
        open={create}
        onClose={() => setCreate(false)}
        onCreated={(id) => nav(`/knowledge/${id}`)}
      />
    </div>
  );
}
