import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Input, Select, Tag, Tooltip } from "antd";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  Database,
  FileText,
  History,
  Layers3,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "../store";
import type { Role, Source } from "../data";
import {
  answerDemo,
  nowLabel,
  retrieveDemo,
  uid,
  visibleKnowledge,
} from "../domain";
import { SourceButtons, SourceDrawer } from "../components";
import LiveChat from "../LiveChat";
interface Generation {
  model: string;
  sessionId: string;
  messageId: string;
  answer: string;
  question: string;
  sources: Source[];
  kbIds: string[];
  role: Role;
  cursor: number;
  started: number;
  finished: boolean;
}
export default function Chat() {
  const { live } = useStore();
  return live ? <LiveChat /> : <DemoChat />;
}
function DemoChat() {
  const { state, setState } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { message, modal } = App.useApp();
  const knowledge = visibleKnowledge(state.knowledge, state.role);
  const ready = knowledge.filter((k) =>
    state.files.some((f) => f.kbId === k.id && f.status === "ready"),
  );
  const initialIds = ready.some((k) => k.id === params.get("kb"))
    ? [params.get("kb")!]
    : ready.slice(0, 1).map((k) => k.id);
  const [kbIds, setKbIds] = useState<string[]>(initialIds);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [references, setReferences] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const availableModels = state.models.filter(
    (m) => m.type === "LLM" && m.status === "ready",
  );
  const [modelId, setModelId] = useState(availableModels[0]?.id);
  const selectedModel =
    availableModels.find((m) => m.id === modelId) || availableModels[0];
  const end = useRef<HTMLDivElement>(null);
  const gen = useRef<Generation | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const allowedIds = new Set(knowledge.map((k) => k.id));
  const sessions = state.sessions.filter(
    (s) => s.role === state.role && s.kbIds.every((id) => allowedIds.has(id)),
  );
  const current = sessions.find((s) => s.id === activeId);
  const visibleKbIds = (current?.kbIds || kbIds).filter((id) =>
    ready.some((k) => k.id === id),
  );
  const hasLlm = !!selectedModel;
  const finish = (cancelled = false) => {
    const g = gen.current;
    if (!g || g.finished) return;
    g.finished = true;
    if (timer.current) clearInterval(timer.current);
    const duration = Math.max(
      0.1,
      Number(((performance.now() - g.started) / 1000).toFixed(2)),
    );
    const text = cancelled
      ? g.answer.slice(0, g.cursor) || "生成已停止。"
      : g.answer;
    const tokens = cancelled
      ? null
      : Math.ceil((g.answer.length + g.question.length) / 1.5);
    setState((s) => ({
      ...s,
      sessions: s.sessions.map((session) =>
        session.id === g.sessionId
          ? {
              ...session,
              messages: session.messages.map((m) =>
                m.id === g.messageId
                  ? {
                      ...m,
                      text,
                      sources: g.sources,
                      cancelled,
                      duration,
                      tokens: tokens ?? undefined,
                    }
                  : m,
              ),
            }
          : session,
      ),
      logs: [
        {
          id: uid(),
          role: g.role,
          kbIds: g.kbIds,
          question: g.question,
          answer: text,
          status: cancelled
            ? "cancelled"
            : g.sources.length
              ? "success"
              : "empty",
          tokens,
          duration,
          model: g.model,
          date: nowLabel(),
          sources: g.sources,
        },
        ...s.logs,
      ],
    }));
    setStreaming(false);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      finishRef.current(true);
    },
    [],
  );
  useEffect(() => {
    const container = end.current?.parentElement;
    if (container)
      container.scrollTo({
        top: current ? container.scrollHeight : 0,
        behavior: streaming ? "instant" : "smooth",
      });
  }, [current?.id, current?.messages.at(-1)?.text, streaming]);
  const send = (value = input) => {
    const question = value.trim();
    if (!question || streaming) return;
    if (!visibleKbIds.length) {
      message.warning("请先选择已就绪的知识库");
      return;
    }
    if (!hasLlm) {
      message.warning("请先配置可用的对话模型");
      return;
    }
    const previous = current?.messages
      .filter((m) => m.kind === "user")
      .at(-1)?.text;
    const retrievalQuestion =
      previous &&
      /^(那|这个|这些|还有|需要|要|它|多久|多少|什么|具体|可以)/.test(question)
        ? `${previous} ${question}`
        : question;
    const sources = retrieveDemo(retrievalQuestion, state.files, visibleKbIds)
      .filter(
        (source) =>
          source.score >=
          (state.knowledge.find((k) => k.id === source.kbId)?.threshold || 0),
      )
      .slice(0, 2);
    const answer = answerDemo(question, sources);
    const sessionId = current?.id || uid();
    const messageId = uid();
    const newMessages = [
      { id: uid(), kind: "user" as const, text: question, sources: [] },
      { id: messageId, kind: "assistant" as const, text: "", sources: [] },
    ];
    setState((s) => ({
      ...s,
      sessions: current
        ? s.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, messages: [...session.messages, ...newMessages] }
              : session,
          )
        : [
            {
              id: sessionId,
              role: s.role,
              title: question.slice(0, 26),
              kbIds: visibleKbIds,
              messages: newMessages,
              date: nowLabel(),
            },
            ...s.sessions,
          ],
    }));
    setActiveId(sessionId);
    setInput("");
    setStreaming(true);
    gen.current = {
      model: selectedModel?.model || "演示模型",
      sessionId,
      messageId,
      question,
      answer,
      sources,
      kbIds: visibleKbIds,
      role: state.role,
      cursor: 0,
      started: performance.now(),
      finished: false,
    };
    timer.current = setInterval(() => {
      const g = gen.current;
      if (!g || g.finished) return;
      g.cursor = Math.min(g.answer.length, g.cursor + 4);
      setState((s) => ({
        ...s,
        sessions: s.sessions.map((session) =>
          session.id === g.sessionId
            ? {
                ...session,
                messages: session.messages.map((m) =>
                  m.id === g.messageId
                    ? { ...m, text: g.answer.slice(0, g.cursor) }
                    : m,
                ),
              }
            : session,
        ),
      }));
      if (g.cursor >= g.answer.length) finishRef.current(false);
    }, 80);
  };
  const newChat = () => {
    finish(true);
    setActiveId(null);
    setInput("");
    setHistoryOpen(false);
  };
  const deleteSession = (id: string) =>
    modal.confirm({
      title: "删除这段对话？",
      content: "删除后将从当前浏览器的对话历史中移除，日志记录仍保留。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => {
        if (id === activeId) {
          finish(true);
          setActiveId(null);
        }
        setState((s) => ({
          ...s,
          sessions: s.sessions.filter((x) => x.id !== id),
        }));
      },
    });
  const latestSources =
    current?.messages
      .filter((m) => m.kind === "assistant")
      .at(-1)
      ?.sources.filter((s) =>
        state.files.some((f) => f.id === s.fileId && f.status === "ready"),
      ) || [];
  const suggestions = [
    {
      title: "差旅报销需要准备什么材料？",
      label: "制度与流程",
      icon: FileText,
    },
    { title: "年假应该提前多久申请？", label: "人事与考勤", icon: ShieldCheck },
    {
      title: "如何导入文件并构建知识库？",
      label: "产品与操作",
      icon: Database,
    },
  ];
  return (
    <div
      className={`chat-workspace ${references && latestSources.length ? "with-references" : ""}`}
    >
      <aside className={`chat-history ${historyOpen ? "show-history" : ""}`}>
        <Button
          type="primary"
          icon={<Plus size={17} />}
          onClick={newChat}
          block
        >
          发起新对话
        </Button>
        <Input
          className="history-search"
          prefix={<Search size={14} />}
          placeholder="搜索历史对话"
          aria-label="搜索历史对话"
          value={historySearch}
          onChange={(e) => setHistorySearch(e.target.value)}
          variant="borderless"
        />
        <div className="history-label">
          当前角色的对话 <span>{sessions.length}</span>
        </div>
        <div className="history-items">
          {sessions
            .filter((s) => s.title.includes(historySearch))
            .map((s) => (
              <div key={s.id} className={s.id === activeId ? "active" : ""}>
                <button
                  onClick={() => {
                    finish(true);
                    setActiveId(s.id);
                    setHistoryOpen(false);
                  }}
                >
                  <MessageSquare size={15} />
                  <span>
                    {s.title}
                    <small>{s.date.slice(5)}</small>
                  </span>
                </button>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "delete",
                        label: "删除对话",
                        danger: true,
                        icon: <Trash2 size={14} />,
                      },
                    ],
                    onClick: () => deleteSession(s.id),
                  }}
                >
                  <button aria-label={`对话更多操作 ${s.title}`}>
                    <MoreHorizontal size={15} />
                  </button>
                </Dropdown>
              </div>
            ))}
          {!sessions.length ? (
            <div className="history-empty">
              <History size={24} />
              <p>你的提问，从这里开始</p>
              <small>对话仅保存在当前浏览器</small>
            </div>
          ) : null}
        </div>
        <div className="history-footer">
          <ShieldCheck size={14} />
          <span>
            按角色区分对话记录
            <br />
            <small>自由切换角色 · 无身份认证</small>
          </span>
        </div>
      </aside>
      <section className="chat-main">
        <header className="chat-header">
          <div>
            <button
              className="chat-history-toggle icon-button"
              aria-label="展开对话历史"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              <History size={18} />
            </button>
            <span className="chat-title-icon">
              <Sparkles size={17} />
            </span>
            <strong>知识助手</strong>
            <Tag variant="filled">基于知识库回答</Tag>
          </div>
          <button
            className="icon-button"
            aria-label="显示引用侧栏"
            onClick={() => setReferences((v) => !v)}
          >
            <BookOpen size={18} />
          </button>
        </header>
        <div className="chat-scroll">
          {!current ? (
            <div className="chat-welcome">
              <span className="chat-welcome-logo">
                <Layers3 size={39} strokeWidth={1.5} />
                <span>✦</span>
              </span>
              <div className="eyebrow">KNOWLEDGE, WITH CONFIDENCE</div>
              <h1>有问题，让知识来回答。</h1>
              <p>
                连接企业资料，为每一个答案找到依据。
                <br />
                选择知识库，从你关心的问题开始。
              </p>
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => send(s.title)}
                    disabled={streaming || !visibleKbIds.length || !hasLlm}
                  >
                    <s.icon size={18} />
                    <span>
                      <small>{s.label}</small>
                      <strong>{s.title}</strong>
                    </span>
                    <ArrowUp size={15} />
                  </button>
                ))}
              </div>
              <span className="welcome-hint">
                <ShieldCheck size={13} />
                答案附有来源，你可以随时查看原文
              </span>
            </div>
          ) : (
            <div className="messages">
              {current.messages.map((m, i) => (
                <article key={m.id} className={`chat-message ${m.kind}`}>
                  <span className="message-avatar">
                    {m.kind === "user" ? "我" : <Layers3 size={20} />}
                  </span>
                  <div className="message-body">
                    <div className="message-author">
                      {m.kind === "user" ? "你" : "知序知识助手"}
                      {m.kind === "assistant" ? <span>演示回答</span> : null}
                    </div>
                    <div
                      className={`message-text ${streaming && i === current.messages.length - 1 ? "streaming-text" : ""}`}
                    >
                      {m.text ? (
                        <ReactMarkdown>{m.text}</ReactMarkdown>
                      ) : (
                        <span className="thinking">
                          <span />
                          <span />
                          <span />
                          正在查找知识…
                        </span>
                      )}
                    </div>
                    {m.kind === "assistant" && m.sources.length > 0 ? (
                      <SourceButtons
                        sources={m.sources.filter((s) =>
                          state.files.some(
                            (f) => f.id === s.fileId && f.status === "ready",
                          ),
                        )}
                        onSelect={setSource}
                      />
                    ) : null}
                    {m.kind === "assistant" &&
                    (!streaming || i !== current.messages.length - 1) ? (
                      <div className="message-tools">
                        <Tooltip title="复制回答">
                          <button
                            aria-label="复制回答"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(m.text);
                                setCopied(m.id);
                                message.success("回答已复制");
                              } catch {
                                message.warning(
                                  "浏览器暂不支持复制，请直接选择文本",
                                );
                              }
                            }}
                          >
                            {copied === m.id ? (
                              <Check size={14} />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </Tooltip>
                        {i === current.messages.length - 1 ? (
                          <Tooltip title="重新生成（新一次演示调用）">
                            <button
                              aria-label="重新生成"
                              onClick={() =>
                                send(
                                  current.messages
                                    .slice(0, i)
                                    .reverse()
                                    .find((x) => x.kind === "user")?.text || "",
                                )
                              }
                            >
                              <RefreshCw size={14} />
                            </button>
                          </Tooltip>
                        ) : null}
                        <span>
                          {m.cancelled
                            ? "已停止 · 用量未知"
                            : `${m.duration?.toFixed(2) || "—"} 秒 · ${m.tokens || "—"} 模拟 Tokens`}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
          <div ref={end} />
        </div>
        <div className="composer-area">
          <div className="knowledge-picker">
            <Database size={15} />
            <span>检索范围</span>
            <Select
              aria-label="选择对话知识库"
              mode="multiple"
              placeholder="请选择知识库"
              value={visibleKbIds}
              disabled={!!current || streaming}
              onChange={setKbIds}
              maxTagCount="responsive"
              options={ready.map((k) => ({ value: k.id, label: k.name }))}
              variant="borderless"
            />
            <Tooltip
              title={
                current
                  ? "会话绑定知识库，点击新对话可重新选择"
                  : "可选择多个知识库"
              }
            >
              <span className="picker-help">
                {current ? "会话已绑定" : "可多选"}
              </span>
            </Tooltip>
          </div>
          {!hasLlm ? (
            <div className="composer-warning">
              未配置可用对话模型。
              {state.role === "admin" ? (
                <button onClick={() => navigate("/models")}>前往配置</button>
              ) : (
                "请联系管理员配置模型。"
              )}
            </div>
          ) : null}
          {!ready.length ? (
            <div className="composer-warning">
              还没有已就绪的知识库，请先导入资料。
            </div>
          ) : null}
          <div className="composer">
            <Input.TextArea
              aria-label="输入问题"
              placeholder={
                visibleKbIds.length
                  ? "输入你的问题，答案将基于所选知识库…"
                  : "先选择一个已就绪的知识库"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={2000}
              disabled={!ready.length}
            />
            <div className="composer-bottom">
              <Select
                aria-label="选择对话模型"
                className="chat-model-select"
                variant="borderless"
                size="small"
                prefix={<Sparkles size={13} />}
                value={selectedModel?.id}
                placeholder="未配置模型"
                disabled={streaming || !hasLlm}
                onChange={setModelId}
                options={availableModels.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
              {streaming ? (
                <button
                  className="stop-button"
                  aria-label="停止生成"
                  onClick={() => finish(true)}
                >
                  <Square size={13} fill="currentColor" />
                  停止生成
                </button>
              ) : (
                <button
                  className="send-button"
                  aria-label="发送问题"
                  disabled={!input.trim() || !visibleKbIds.length || !hasLlm}
                  onClick={() => send()}
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </div>
          <p className="composer-caption">
            演示回答由本地规则生成 · 请核对引用内容{" "}
            <span>Enter 发送，Shift + Enter 换行</span>
          </p>
        </div>
      </section>
      {references && latestSources.length ? (
        <aside className="chat-references">
          <div>
            <h3>
              <BookOpen size={17} />
              引用资料 <Tag>{latestSources.length}</Tag>
            </h3>
            <button
              aria-label="收起引用资料"
              className="icon-button"
              onClick={() => setReferences(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>回答依据，清晰可溯</p>
          {latestSources.map((s, i) => (
            <button
              key={s.fileId}
              className="reference-card"
              onClick={() => setSource(s)}
            >
              <span className="reference-file">
                <span>{i + 1}</span>
                <FileText size={16} />
                <strong>{s.name}</strong>
              </span>
              <small>{s.location}</small>
              <p>{s.text}</p>
              <footer>
                查看原文 <ArrowRight size={13} />
              </footer>
            </button>
          ))}
        </aside>
      ) : null}
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
