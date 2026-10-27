import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Form, Input, Select, Tag } from "antd";
import {
  Bot,
  Download,
  FilePenLine,
  LoaderCircle,
  Send,
  Square,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, apiHeaders, streamChat, write } from "./api";
import { SourceDrawer } from "./components";
import type { ChatMessage, Source } from "./data";
import type { Application, ApplicationConfig } from "./prototype";
interface Run {
  id: string;
  status: string;
  outline: string[];
  output: string;
  sources: Source[];
  stage: string;
  error?: string;
  question: string;
  usage: { calls?: { type: string; usage?: { total_tokens?: number } }[] };
}
interface Conversation {
  id: string;
  title: string;
  revision: number;
  messages: ChatMessage[];
}
export default function LiveAppExperience({
  application,
  config,
  draft = false,
}: {
  application: Application;
  config: ApplicationConfig;
  draft?: boolean;
}) {
  const { message } = App.useApp();
  const [question, setQuestion] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [outline, setOutline] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (draft) return;
    let mounted = true;
    api<Conversation[]>(`/applications/${application.id}/conversations`)
      .then((rows) => {
        if (mounted) setConversations(rows);
      })
      .catch(() => {});
    api<Run[]>(`/applications/${application.id}/runs`)
      .then((rows) => {
        if (mounted) setRuns(rows);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [application.id, draft]);
  useEffect(() => {
    if (draft) {
      abort.current?.abort();
      setConversationId(undefined);
      setMessages([]);
    }
  }, [draft, config.model, config.kbIds.join(",")]);
  const runId = run?.id;
  const running = run?.status === "queued" || run?.status === "running";
  useEffect(() => {
    if (!runId || !running) return;
    let active = true,
      inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api<Run>(`/application-runs/${runId}`);
        if (active) {
          setRun(result);
          setError("");
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        inFlight = false;
      }
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId, running]);
  useEffect(() => {
    if (run?.status === "awaiting_outline") setOutline(run.outline.join("\n"));
  }, [run?.id, run?.status]);
  const send = async (text = question) => {
    if (!text.trim()) {
      message.warning("请填写问题或任务");
      return;
    }
    if (config.fields.some((f) => !inputs[f]?.trim())) {
      message.warning("请填写全部输入字段");
      return;
    }
    const input = {
      question: text,
      inputs: Object.fromEntries(config.fields.map((f) => [f, inputs[f]])),
      conversationId,
    };
    setError("");
    if (config.kind === "report") {
      setBusy(true);
      try {
        const result = await write<Run>(
          draft
            ? `/applications/${application.id}/preview`
            : `/applications/${application.id}/runs`,
          draft ? { config, input } : input,
        );
        setRun(result);
        setQuestion("");
        setRuns((rows) => [result, ...rows]);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    const assistant = crypto.randomUUID();
    setMessages((rows) => [
      ...rows,
      { id: crypto.randomUUID(), kind: "user", text, sources: [] },
      { id: assistant, kind: "assistant", text: "", sources: [] },
    ]);
    setQuestion("");
    setBusy(true);
    setStage("正在连接");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChat(
        draft ? { config, input } : input,
        controller.signal,
        (event, data) => {
          if (event === "meta")
            setConversationId(data.conversationId as string);
          if (event === "status") setStage(data.stage as string);
          if (event === "token")
            setMessages((rows) =>
              rows.map((row) =>
                row.id === assistant
                  ? { ...row, text: row.text + String(data.text || "") }
                  : row,
              ),
            );
          if (event === "done") {
            const response = data.message as unknown as ChatMessage;
            setMessages((rows) =>
              rows.map((row) => (row.id === assistant ? response : row)),
            );
            if (data.status === "failed")
              setError(response.error || "生成失败");
          }
        },
        draft
          ? `/applications/${application.id}/preview`
          : `/applications/${application.id}/chat`,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(String(e));
      else setStage("已停止，请稍后查看历史记录");
    } finally {
      setBusy(false);
      abort.current = null;
      setStage("");
      if (!draft)
        api<Conversation[]>(`/applications/${application.id}/conversations`)
          .then(setConversations)
          .catch(() => {});
    }
  };
  const action = async (name: string, body: unknown = {}) => {
    if (!run) return;
    setBusy(true);
    try {
      setRun(await write<Run>(`/application-runs/${run.id}/${name}`, body));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const download = async (format: string) => {
    if (!run) return;
    try {
      const response = await fetch(
        `/api/v1/application-runs/${run.id}/download?format=${format}`,
        { headers: apiHeaders() },
      );
      if (!response.ok) {
        const data = await response.json();
        throw Error(data.message || "导出失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${config.name}.${format === "docx" ? "docx" : "md"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      message.error(String(e));
    }
  };
  return (
    <div className="app-experience">
      <div className="experience-welcome">
        <span className="application-icon purple">
          {config.kind === "report" ? <FilePenLine /> : <Bot />}
        </span>
        <h2>{config.name}</h2>
        <p>{config.welcome}</p>
      </div>
      {draft ? (
        <Alert
          type="info"
          showIcon
          title="真实草稿调试"
          description="使用当前编辑配置调用模型，消耗会记录在日志中；不改变已发布版本。"
        />
      ) : null}
      {draft && config.kind === "service" ? (
        <Button
          className="studio-gap"
          disabled={busy}
          onClick={() => {
            setConversationId(undefined);
            setMessages([]);
          }}
        >
          重置调试对话
        </Button>
      ) : null}
      {config.fields.length ? (
        <Form layout="vertical" className="experience-inputs">
          {config.fields.map((field) => (
            <Form.Item key={field} label={field} required>
              <Input
                value={inputs[field] || ""}
                onChange={(e) =>
                  setInputs((p) => ({ ...p, [field]: e.target.value }))
                }
              />
            </Form.Item>
          ))}
        </Form>
      ) : null}
      {!draft && config.kind === "service" ? (
        <div className="studio-toolbar">
          <Select
            disabled={busy}
            style={{ width: "75%" }}
            placeholder="查看历史对话"
            allowClear
            value={conversationId}
            options={conversations.map((c) => ({
              value: c.id,
              label: `${c.title} · v${c.revision}`,
            }))}
            onChange={(id) => {
              setConversationId(id);
              setMessages(
                conversations.find((c) => c.id === id)?.messages || [],
              );
            }}
          />
          <Button
            disabled={busy}
            onClick={() => {
              setConversationId(undefined);
              setMessages([]);
            }}
          >
            新对话
          </Button>
        </div>
      ) : null}
      {!draft && config.kind === "report" && runs.length ? (
        <Select
          className="studio-gap"
          placeholder="查看报告记录"
          value={run?.id}
          options={runs.map((r) => ({ value: r.id, label: r.question }))}
          onChange={async (id) => {
            try {
              setRun(await api<Run>(`/application-runs/${id}`));
            } catch (e) {
              setError(String(e));
            }
          }}
        />
      ) : null}
      {!messages.length && !run ? (
        <div className="experience-questions">
          {config.questions.filter(Boolean).map((q, i) => (
            <button key={i} onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
      ) : null}
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            m.kind === "user" ? "experience-question" : "experience-answer"
          }
        >
          {m.text ? (
            <ReactMarkdown>{m.text}</ReactMarkdown>
          ) : (
            <span className="text-muted">{stage || "等待回答…"}</span>
          )}
          {m.sources?.length ? (
            <div className="live-source-list">
              {m.sources.map((s, i) => (
                <Button
                  size="small"
                  type="link"
                  key={s.chunkId || i}
                  onClick={() => setSource(s)}
                >
                  [{s.citation || i + 1}] {s.name} · {s.location}
                </Button>
              ))}
            </div>
          ) : null}
          {m.tokens != null ? (
            <p className="text-muted">
              {m.tokens} LLM tokens · {m.duration} 秒
            </p>
          ) : null}
        </div>
      ))}
      {run ? (
        <div className="studio-gap">
          <div className="studio-panel-heading">
            <span>
              {running ? <LoaderCircle size={16} /> : null}
              {run.stage}
            </span>
            <Tag>{run.status}</Tag>
          </div>
          {run.error ? <Alert showIcon type="error" title={run.error} /> : null}
          {run.status === "awaiting_outline" ? (
            <div className="outline-preview">
              <h3>确认报告大纲</h3>
              <p>每行一个章节，确认后开始逐章检索与撰写。</p>
              <Input.TextArea
                value={outline}
                rows={7}
                onChange={(e) => setOutline(e.target.value)}
              />
              <Button
                type="primary"
                loading={busy}
                onClick={() =>
                  action("confirm", {
                    outline: outline
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              >
                确认并开始撰写
              </Button>
            </div>
          ) : null}
          {run.output ? (
            <div className="experience-answer">
              <ReactMarkdown>{run.output}</ReactMarkdown>
              <div className="live-source-list">
                {run.sources.map((s, i) => (
                  <Button
                    size="small"
                    type="link"
                    key={s.chunkId || i}
                    onClick={() => setSource(s)}
                  >
                    [{i + 1}] {s.name} · {s.location}
                  </Button>
                ))}
              </div>
              <Button
                icon={<Download size={14} />}
                onClick={() => download("markdown")}
              >
                Markdown
              </Button>
              <Button
                icon={<Download size={14} />}
                onClick={() => download("docx")}
              >
                Word
              </Button>
            </div>
          ) : null}
          {["queued", "running", "awaiting_outline"].includes(run.status) ? (
            <Button danger loading={busy} onClick={() => action("cancel")}>
              停止任务
            </Button>
          ) : null}
          {run.status === "failed" ? (
            <Button loading={busy} onClick={() => action("retry")}>
              从失败处继续
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => setError("")}
        />
      ) : null}
      <div className="experience-compose">
        <Input.TextArea
          aria-label="应用问题或报告任务"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={
            config.kind === "report" ? "描述本次报告任务…" : "输入问题…"
          }
          disabled={busy}
        />
        {busy && config.kind === "service" ? (
          <Button
            danger
            icon={<Square size={15} />}
            onClick={() => abort.current?.abort()}
          >
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            aria-label="执行应用"
            loading={busy}
            disabled={running}
            icon={<Send size={16} />}
            onClick={() => send()}
          />
        )}
      </div>
      <div className="experience-note">
        真实模型调用 · {config.currentOnly ? "当前有效版本" : "包含历史版本"} ·
        日志记录实际用量
      </div>
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
