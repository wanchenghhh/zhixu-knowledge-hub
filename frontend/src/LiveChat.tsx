import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App, Button, Input, Select, Tag } from "antd";
import {
  ArrowUp,
  Copy,
  Layers3,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, streamChat } from "./api";
import { useStore } from "./store";
import type { ChatMessage, Source } from "./data";
import { SourceButtons, SourceDrawer } from "./components";
export default function LiveChat() {
  const { state, refresh } = useStore();
  const { message, modal } = App.useApp();
  const [params] = useSearchParams();
  const available = state.knowledge.filter((k) =>
    state.files.some((f) => f.kbId === k.id && f.status === "ready"),
  );
  const [kbIds, setKbIds] = useState<string[] | null>(() =>
    available.some((k) => k.id === params.get("kb"))
      ? [params.get("kb")!]
      : available.length
        ? available.slice(0, 1).map((k) => k.id)
        : null,
  );
  const [modelId, setModelId] = useState(
    () =>
      state.models.find((m) => m.type === "LLM" && m.status === "ready")?.id,
  );
  const [active, setActive] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const epoch = useRef(0);
  const sessions = state.sessions.filter((s) => s.role === state.role);
  const current = sessions.find((s) => s.id === active);
  const selectedKbIds =
    current?.kbIds ||
    kbIds ||
    (available.some((k) => k.id === params.get("kb"))
      ? [params.get("kb")!]
      : available.slice(0, 1).map((k) => k.id));
  const messages = streaming ? pending : current?.messages || pending;
  const readyModels = state.models.filter(
    (m) => m.type === "LLM" && m.status === "ready",
  );
  const selectedModel =
    readyModels.find((m) => m.id === modelId) || readyModels[0];
  useEffect(
    () => () => {
      epoch.current++;
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    scroll.current?.scrollTo({
      top: messages.length ? scroll.current.scrollHeight : 0,
      behavior: "instant",
    });
  }, [messages.at(-1)?.text, messages.length]);
  const stop = () => abort.current?.abort();
  const send = async () => {
    const question = input.trim();
    const scope = selectedKbIds;
    if (!question || streaming) return;
    if (!scope.length || !selectedModel) {
      message.warning("请先选择已就绪的知识库和对话模型");
      return;
    }
    const requestEpoch = ++epoch.current;
    let conversationId = active;
    const user: ChatMessage = {
      id: crypto.randomUUID(),
      kind: "user",
      text: question,
      sources: [],
    };
    let assistant: ChatMessage = {
      id: crypto.randomUUID(),
      kind: "assistant",
      text: "",
      sources: [],
    };
    const base = [...(current?.messages || []), user];
    setPending([...base, assistant]);
    setInput("");
    setStreaming(true);
    setStage("正在连接");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChat(
        {
          question,
          kbIds: scope,
          modelId: selectedModel.id,
          conversationId: active,
          topK: state.knowledge.find((k) => scope.includes(k.id))?.topK || 5,
          threshold:
            state.knowledge.find((k) => scope.includes(k.id))?.threshold ?? 0.3,
          rerank: true,
        },
        controller.signal,
        (name, data) => {
          if (epoch.current !== requestEpoch) return;
          if (name === "meta") {
            conversationId = String(data.conversationId);
            setActive(conversationId);
          }
          if (name === "status") setStage(String(data.stage));
          if (name === "token") {
            assistant = {
              ...assistant,
              text: assistant.text + String(data.text),
            };
            setPending([...base, assistant]);
          }
          if (name === "done") {
            assistant = data.message as unknown as ChatMessage;
            setPending([...base, assistant]);
            if (data.status === "failed")
              message.error(assistant.error || "对话生成失败");
          }
        },
      );
    } catch (error) {
      if (epoch.current !== requestEpoch) return;
      if (!controller.signal.aborted) {
        message.error(String(error));
        assistant = {
          ...assistant,
          text: assistant.text || String(error),
          error: String(error),
        };
      } else
        assistant = {
          ...assistant,
          text: assistant.text || "生成已停止。",
          cancelled: true,
        };
      setPending([...base, assistant]);
    } finally {
      if (epoch.current === requestEpoch) {
        setStreaming(false);
        setStage("");
        abort.current = null;
        await refresh().catch(() => {});
        if (epoch.current === requestEpoch && conversationId)
          setActive(conversationId);
      }
    }
  };
  const reset = () => {
    epoch.current++;
    stop();
    abort.current = null;
    setStreaming(false);
    setStage("");
    setActive(null);
    setPending([]);
  };
  return (
    <div className="chat-workspace">
      <aside className="chat-history">
        <Button type="primary" icon={<Plus size={16} />} onClick={reset}>
          发起新对话
        </Button>
        <div className="history-label" style={{ marginTop: 22 }}>
          当前浏览器与角色的对话
        </div>
        <div className="history-items">
          {sessions.map((s) => (
            <div className={active === s.id ? "active" : ""} key={s.id}>
              <button
                onClick={() => {
                  reset();
                  setActive(s.id);
                }}
              >
                <span>
                  {s.title}
                  <small>{s.date}</small>
                </span>
              </button>
              <button
                aria-label={`删除对话 ${s.title}`}
                onClick={() =>
                  modal.confirm({
                    title: "删除此对话？",
                    okText: "删除",
                    cancelText: "取消",
                    onOk: async () => {
                      await api(`/conversations/${s.id}`, { method: "DELETE" });
                      if (active === s.id) reset();
                      await refresh();
                    },
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <p className="history-footer">
          数据保存在服务端，按角色与浏览器会话区分。
        </p>
      </aside>
      <section className="chat-main">
        <header className="chat-header">
          <div>
            <Sparkles size={18} />
            <strong>知识助手</strong>
            <Tag>基于真实知识库</Tag>
          </div>
        </header>
        <div className="chat-scroll" ref={scroll}>
          {messages.length ? (
            <div className="messages">
              {messages.map((m) => (
                <article className={`chat-message ${m.kind}`} key={m.id}>
                  <span className="message-avatar">
                    {m.kind === "user" ? "我" : <Layers3 size={18} />}
                  </span>
                  <div className="message-body">
                    <div className="message-author">
                      {m.kind === "user" ? "你" : "知序知识助手"}
                    </div>
                    <div className="message-text">
                      <ReactMarkdown>{m.text || stage}</ReactMarkdown>
                    </div>
                    {m.sources.length ? (
                      <SourceButtons sources={m.sources} onSelect={setSource} />
                    ) : null}
                    {m.error ? (
                      <div className="soft-note warning">{m.error}</div>
                    ) : null}
                    {m.warnings?.map((w) => (
                      <div className="soft-note warning" key={w}>
                        {w}
                      </div>
                    ))}
                    {m.kind === "assistant" && m.duration !== undefined ? (
                      <div className="message-tools">
                        <button
                          aria-label="复制回答"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(m.text)
                              .then(() => message.success("回答已复制"))
                              .catch(() =>
                                message.error("复制失败，请手动选择文本"),
                              )
                          }
                        >
                          <Copy size={13} />
                          复制
                        </button>
                        <span>
                          {m.duration.toFixed(2)} 秒 · {m.tokens ?? "未知"} LLM
                          Tokens{m.cancelled ? " · 已停止" : ""}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="chat-welcome">
              <span className="chat-welcome-logo">
                <Layers3 size={38} />
              </span>
              <h1>有问题，让知识来回答。</h1>
              <p>
                先配置并测试模型，导入资料后即可开始提问。
                <br />
                答案基于知识库检索，支持查看引用与原文件。
              </p>
              <div className="suggestions">
                <button onClick={() => setInput("差旅报销需要什么材料？")}>
                  差旅报销需要什么材料？
                </button>
                <button onClick={() => setInput("住宿标准是多少？")}>
                  住宿标准是多少？
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="composer-area">
          <div className="knowledge-picker">
            <span>检索范围</span>
            <Select
              aria-label="选择对话知识库"
              mode="multiple"
              placeholder="选择已就绪的知识库"
              value={selectedKbIds}
              options={available.map((k) => ({ value: k.id, label: k.name }))}
              onChange={setKbIds}
              disabled={!!current || streaming}
            />
          </div>
          <div className="composer">
            <Input.TextArea
              aria-label="输入问题"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入问题，查看有来源的回答…"
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={4000}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-bottom">
              <Select
                aria-label="选择对话模型"
                className="chat-model-select"
                variant="borderless"
                placeholder="请先配置对话模型"
                value={selectedModel?.id}
                onChange={setModelId}
                disabled={streaming}
                options={readyModels.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
              />
              {streaming ? (
                <button
                  className="stop-button"
                  aria-label="停止生成"
                  onClick={stop}
                >
                  <Square size={13} />
                  停止生成
                </button>
              ) : (
                <button
                  className="send-button"
                  aria-label="发送问题"
                  disabled={
                    !input.trim() || !available.length || !selectedModel
                  }
                  onClick={() => void send()}
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
          <p className="composer-caption">
            {stage || "真实模型调用，使用量以服务商返回为准。请核对引用原文。"}
          </p>
        </div>
      </section>
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
