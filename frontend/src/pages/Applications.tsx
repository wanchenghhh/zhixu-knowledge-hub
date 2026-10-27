import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  App,
  Alert,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Select,
  Switch,
  Tabs,
  Tag,
} from "antd";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Copy,
  FilePenLine,
  LayoutGrid,
  MessageSquare,
  Play,
  Plus,
  Rocket,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import { PageHeading } from "../components";
import { useStore } from "../store";
import { roles } from "../data";
import {
  exampleKnowledge,
  PROTOTYPE_NOTICE,
  seedApplications,
  templates,
  usePrototype,
} from "../prototype";
import type { Application, ApplicationConfig } from "../prototype";
import ReactMarkdown from "react-markdown";
import LiveApplications from "../LiveApplications";
import LiveAppExperience from "../LiveAppExperience";
import MetadataFilters from "../MetadataFilters";

export default function Applications() {
  const { live } = useStore();
  return live ? <LiveApplications /> : <PrototypeApplications />;
}
function PrototypeApplications() {
  const { id, mode } = useParams();
  const [apps, saveApps] = usePrototype<Application[]>(
    "applications",
    seedApplications,
  );
  const { state } = useStore();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [create, setCreate] = useState(false);
  const [kind, setKind] = useState<ApplicationConfig["kind"]>("service");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const canManage = state.role !== "user";
  const application = apps.find((a) => a.id === id);
  const update = (app: Application) =>
    saveApps(apps.map((a) => (a.id === app.id ? app : a)));
  const visible = apps.filter(
    (a) => canManage || a.published?.visible.includes(state.role),
  );
  if (id) {
    if (
      !application ||
      (!canManage &&
        (mode !== "run" ||
          !application.published?.visible.includes(state.role)))
    )
      return (
        <Result
          status="403"
          title="无法访问此应用"
          subTitle="该应用尚未发布或当前角色不可见。"
          extra={
            <Button onClick={() => navigate("/applications")}>
              返回应用中心
            </Button>
          }
        />
      );
    return mode === "run" ? (
      <RunApplication application={application} />
    ) : (
      <ApplicationEditor key={id} application={application} onSave={update} />
    );
  }
  const items = visible.filter(
    (a) =>
      (filter === "all" ||
        (filter === "published" ? !!a.published : !a.published)) &&
      `${a.draft.name}${a.draft.description}`.includes(search),
  );
  return (
    <div className="page studio-page">
      <PageHeading
        title="应用中心"
        description="让同一份企业知识，服务于不同的工作场景。"
        actions={
          canManage ? (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                setName("");
                setCreate(true);
              }}
            >
              创建应用
            </Button>
          ) : undefined
        }
      />
      <Alert showIcon type="info" title={PROTOTYPE_NOTICE} />
      <div className="studio-intro">
        <div>
          <div className="eyebrow">FROM KNOWLEDGE TO ACTION</div>
          <h2>从一个场景，开始创造价值</h2>
          <p>选择模板，绑定知识与模型，把工作方式沉淀成可复用的应用。</p>
        </div>
        <div className="studio-intro-icons">
          <MessageSquare />
          <ArrowRight size={17} />
          <FilePenLine />
          <ArrowRight size={17} />
          <Sparkles />
        </div>
      </div>
      <div className="studio-toolbar">
        <div className="filter-tabs">
          {[
            ["all", "全部应用"],
            ["published", "已发布"],
            ["draft", "草稿"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          prefix={<Search size={15} />}
          placeholder="搜索应用名称或说明"
          aria-label="搜索应用"
          style={{ width: 260 }}
        />
      </div>
      <div className="application-grid">
        {items.map((a) => (
          <article className="application-card" key={a.id}>
            <div className="application-top">
              <span
                className={`application-icon ${a.draft.kind === "report" ? "blue" : "purple"}`}
              >
                {a.draft.kind === "report" ? (
                  <FilePenLine size={24} />
                ) : (
                  <Bot size={24} />
                )}
              </span>
              <Tag color={a.published ? "green" : "default"}>
                {a.published ? `已发布 · v${a.revision}` : "草稿"}
              </Tag>
            </div>
            <h2>
              {a.published && !canManage ? a.published.name : a.draft.name}
            </h2>
            <p>{a.draft.description}</p>
            <div className="application-facts">
              <span>{a.draft.kind === "report" ? "报告撰写" : "智能客服"}</span>
              <span>{a.draft.kbIds.length} 个知识库</span>
              <span>{a.draft.model}</span>
            </div>
            <div className="application-card-bottom">
              {canManage ? (
                <Button
                  icon={<Settings2 size={14} />}
                  onClick={() => navigate(`/applications/${a.id}/edit`)}
                >
                  配置应用
                </Button>
              ) : null}
              <Button
                type={canManage ? "default" : "primary"}
                icon={<Play size={14} />}
                disabled={!a.published}
                onClick={() => navigate(`/applications/${a.id}/run`)}
              >
                使用应用
              </Button>
              {canManage ? (
                <Button
                  type="text"
                  aria-label={`复制${a.draft.name}`}
                  icon={<Copy size={15} />}
                  onClick={() => {
                    saveApps([
                      ...apps,
                      {
                        id: crypto.randomUUID(),
                        draft: {
                          ...structuredClone(a.draft),
                          name: `${a.draft.name} · 副本`,
                        },
                        revision: 0,
                        updated: "刚刚",
                      },
                    ]);
                    message.success("已复制为新草稿");
                  }}
                />
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {!items.length ? <Empty description="当前没有符合条件的应用" /> : null}
      <div className="studio-footnote">
        <LayoutGrid size={15} />
        应用独立保存配置、发布版本和会话；知识库可被多个应用复用。
      </div>
      <Modal
        title="创建一个新应用"
        open={create}
        onCancel={() => setCreate(false)}
        okText="创建并配置"
        onOk={() => {
          if (!name.trim()) {
            message.warning("请填写应用名称");
            return;
          }
          const row = {
            id: crypto.randomUUID(),
            draft: { ...structuredClone(templates[kind]), name: name.trim() },
            revision: 0,
            updated: "刚刚",
          };
          saveApps([...apps, row]);
          setCreate(false);
          navigate(`/applications/${row.id}/edit`);
        }}
      >
        <div className="template-options">
          {(["service", "report"] as const).map((k) => (
            <button
              key={k}
              className={kind === k ? "selected" : ""}
              onClick={() => {
                setKind(k);
                setName(templates[k].name);
              }}
            >
              {k === "service" ? <Bot /> : <FilePenLine />}
              <strong>{k === "service" ? "智能客服" : "报告撰写"}</strong>
              <span>
                {k === "service"
                  ? "检索知识，提供有来源的多轮回答"
                  : "先规划大纲，再按章节检索与撰写"}
              </span>
            </button>
          ))}
        </div>
        <Form layout="vertical">
          <Form.Item label="应用名称" required>
            <Input
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：售后服务助手"
            />
          </Form.Item>
        </Form>
      </Modal>
      {canManage && apps.length > 2 ? (
        <Button
          type="text"
          danger
          onClick={() =>
            modal.confirm({
              title: "重置本地应用原型？",
              content: "清除本浏览器创建的应用和发布草稿，恢复两个示例模板。",
              onOk: () => saveApps(structuredClone(seedApplications)),
            })
          }
        >
          重置原型数据
        </Button>
      ) : null}
    </div>
  );
}

export function ApplicationEditor({
  application,
  onSave,
}: {
  application: Application;
  onSave: (a: Application) => void | Promise<void>;
}) {
  const { state, live } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [config, setConfig] = useState(() =>
    structuredClone(application.draft),
  );
  const [tab, setTab] = useState("basic");
  const [saved, setSaved] = useState(JSON.stringify(application.draft));
  const dirty = JSON.stringify(config) !== saved;
  const patch = (value: Partial<ApplicationConfig>) =>
    setConfig((c) => ({ ...c, ...value }));
  const knowledge = state.knowledge.length
    ? state.knowledge.map((k) => ({ value: k.id, label: k.name }))
    : exampleKnowledge;
  const models = state.models.filter((m) => m.type === "LLM");
  const valid = () => {
    if (!config.name.trim() || !config.prompt.trim() || !config.kbIds.length) {
      message.warning("请填写应用名称、角色指令，并至少绑定一个知识库");
      return false;
    }
    return true;
  };
  const save = async (publish = false) => {
    if (!valid()) return;
    try {
      await onSave({
        ...application,
        draft: structuredClone(config),
        ...(publish
          ? {
              published: structuredClone(config),
              revision: application.revision + 1,
            }
          : {}),
        updated: "刚刚",
      });
      setSaved(JSON.stringify(config));
      message.success(
        publish
          ? live
            ? "应用已发布，可从独立入口使用"
            : "原型发布版本已保存，可从独立入口使用"
          : live
            ? "服务端草稿已保存"
            : "本地草稿已保存",
      );
    } catch (error) {
      message.error(String(error));
    }
  };
  return (
    <div className="page studio-page">
      <button className="back-link" onClick={() => navigate("/applications")}>
        <ArrowLeft size={14} />
        全部应用
      </button>
      <PageHeading
        title={config.name || "未命名应用"}
        description={`${config.kind === "report" ? "报告撰写" : "智能客服"} · ${dirty ? "有未保存修改" : live ? "服务端草稿已保存" : "本地草稿已保存"}`}
        actions={
          <>
            <Button icon={<Save size={15} />} onClick={() => save()}>
              保存草稿
            </Button>
            <Button
              type="primary"
              icon={<Rocket size={15} />}
              onClick={() => save(true)}
            >
              {live ? "发布应用" : "发布原型"}
            </Button>
          </>
        }
      />
      <Alert
        type="info"
        showIcon
        title={
          live
            ? "真实应用配置 · 保存草稿后可调试，发布后供对应角色使用。"
            : PROTOTYPE_NOTICE
        }
      />
      <div className="application-editor">
        <section className="studio-panel application-config">
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: "basic", label: "基础配置" },
              { key: "knowledge", label: "知识与检索" },
              { key: "experience", label: "体验与发布" },
            ]}
          />
          <Form layout="vertical">
            {tab === "basic" ? (
              <>
                <Form.Item label="应用名称" required>
                  <Input
                    maxLength={60}
                    value={config.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="应用说明">
                  <Input.TextArea
                    rows={2}
                    value={config.description}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="对话模型">
                  <Select
                    value={config.model}
                    onChange={(model) => patch({ model })}
                    options={
                      models.length
                        ? models.map((m) => ({
                            value: live ? m.id : m.model,
                            label: `${m.provider} · ${m.model}`,
                          }))
                        : [
                            {
                              value: "qwen-plus",
                              label: "AIHubMix · qwen-plus（示例）",
                            },
                          ]
                    }
                  />
                </Form.Item>
                <Form.Item
                  label="角色与指令"
                  required
                  extra="明确工作职责、引用规则和资料不足时的处理方式。"
                >
                  <Input.TextArea
                    rows={7}
                    value={config.prompt}
                    onChange={(e) => patch({ prompt: e.target.value })}
                  />
                </Form.Item>
                {config.kind === "report" ? (
                  <>
                    <Form.Item label="报告大纲模板">
                      <Input.TextArea
                        rows={5}
                        value={config.outline}
                        onChange={(e) => patch({ outline: e.target.value })}
                      />
                    </Form.Item>
                    <div className="report-flow">
                      输入任务 <ArrowRight size={13} />
                      规划大纲 <ArrowRight size={13} />
                      分章节检索 <ArrowRight size={13} />
                      撰写与引用
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
            {tab === "knowledge" ? (
              <>
                <Form.Item label="绑定知识库" required>
                  <Select
                    mode="multiple"
                    value={config.kbIds}
                    onChange={(kbIds) => patch({ kbIds })}
                    options={knowledge}
                  />
                </Form.Item>
                <div className="studio-setting">
                  <div>
                    <strong>仅检索当前有效版本</strong>
                    <p>保留历史资料；需要追溯时，可在使用入口选择历史范围。</p>
                  </div>
                  <Switch
                    checked={config.currentOnly}
                    onChange={(currentOnly) => patch({ currentOnly })}
                  />
                </div>
                <Form.Item
                  label="元数据过滤条件"
                  extra={
                    live
                      ? "过滤条件在召回前执行；范围比较支持日期和数字。"
                      : "原型支持配置表达意图；后端接入后校验字段类型并参与过滤。"
                  }
                >
                  {live ? (
                    <MetadataFilters
                      kbIds={config.kbIds}
                      value={config.metadataFilters || []}
                      onChange={(metadataFilters) =>
                        patch({ metadataFilters, filters: "" })
                      }
                    />
                  ) : (
                    <Input
                      value={config.filters}
                      onChange={(e) => patch({ filters: e.target.value })}
                      placeholder="例如：主体 = 华东项目；生效日期 ≤ 当前日期"
                    />
                  )}
                </Form.Item>
                <div className="studio-form-row">
                  <Form.Item label="召回片段上限">
                    <InputNumber
                      min={1}
                      max={20}
                      value={config.topK}
                      onChange={(v) => patch({ topK: v ?? 5 })}
                    />
                  </Form.Item>
                  <Form.Item label="相关性阈值">
                    <InputNumber
                      min={0}
                      max={1}
                      step={0.05}
                      value={config.threshold}
                      onChange={(v) => patch({ threshold: v ?? 0.3 })}
                    />
                  </Form.Item>
                </div>
                <div className="studio-setting">
                  <div>
                    <strong>启用重排</strong>
                    <p>使用知识库绑定的 Rerank 模型筛选相关依据。</p>
                  </div>
                  <Switch
                    checked={config.rerank}
                    onChange={(rerank) => patch({ rerank })}
                  />
                </div>
                <Form.Item label="保留最近对话轮数">
                  <InputNumber
                    min={0}
                    max={20}
                    value={config.history}
                    onChange={(v) => patch({ history: v ?? 6 })}
                  />
                </Form.Item>
              </>
            ) : null}
            {tab === "experience" ? (
              <>
                <Form.Item label="欢迎语">
                  <Input.TextArea
                    rows={3}
                    value={config.welcome}
                    onChange={(e) => patch({ welcome: e.target.value })}
                  />
                </Form.Item>
                <Form.Item label="开场问题（每行一个）">
                  <Input.TextArea
                    rows={3}
                    value={config.questions.join("\n")}
                    onChange={(e) =>
                      patch({ questions: e.target.value.split("\n") })
                    }
                  />
                </Form.Item>
                <Form.Item label="输入字段（每行一个）">
                  <Input.TextArea
                    rows={3}
                    value={config.fields.join("\n")}
                    onChange={(e) =>
                      patch({
                        fields: e.target.value.split("\n").filter(Boolean),
                      })
                    }
                    placeholder="例如：报告主题、时间范围、面向读者"
                  />
                </Form.Item>
                <Form.Item label="可使用角色">
                  <Checkbox.Group
                    value={config.visible}
                    onChange={(v) =>
                      patch({ visible: v as ApplicationConfig["visible"] })
                    }
                    options={Object.entries(roles).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </Form.Item>
                {config.kind === "report" ? (
                  <Form.Item label="报告导出格式">
                    <Select
                      value={config.format}
                      onChange={(format) => patch({ format })}
                      options={[
                        { value: "markdown", label: "Markdown" },
                        {
                          value: "docx",
                          label: "Word（.docx）",
                        },
                      ]}
                    />
                  </Form.Item>
                ) : null}
                <Alert
                  type="success"
                  showIcon
                  title={
                    application.published
                      ? `已有发布版本 v${application.revision}`
                      : "尚未发布"
                  }
                  description="保存草稿不会更改已发布配置；发布后独立使用入口读取新版本。"
                />
                {application.published ? (
                  <Button
                    className="studio-gap"
                    icon={<Play size={14} />}
                    onClick={() =>
                      navigate(`/applications/${application.id}/run`)
                    }
                  >
                    打开已发布版本
                  </Button>
                ) : null}
              </>
            ) : null}
          </Form>
        </section>
        <section className="studio-panel application-preview">
          <div className="studio-panel-heading">
            <span>
              <Play size={15} />
              交互预览
            </span>
            <Tag>使用当前草稿</Tag>
          </div>
          {live ? (
            <LiveAppExperience
              key={application.id + config.kind}
              application={application}
              config={config}
              draft
            />
          ) : (
            <AppExperience key={config.kind} config={config} />
          )}
        </section>
      </div>
    </div>
  );
}
function RunApplication({ application }: { application: Application }) {
  const navigate = useNavigate();
  if (!application.published)
    return (
      <Result
        title="应用尚未发布"
        extra={
          <Button onClick={() => navigate("/applications")}>
            返回应用中心
          </Button>
        }
      />
    );
  return (
    <div className="page studio-page">
      <button className="back-link" onClick={() => navigate("/applications")}>
        <ArrowLeft size={14} />
        应用中心
      </button>
      <PageHeading
        title={application.published.name}
        description={`发布版本 v${application.revision} · ${application.published.description}`}
      />
      <Alert showIcon type="info" title={PROTOTYPE_NOTICE} />
      <div className="studio-panel standalone-app">
        <AppExperience config={application.published} />
      </div>
    </div>
  );
}
function AppExperience({ config }: { config: ApplicationConfig }) {
  const { message } = App.useApp();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asked, setAsked] = useState("");
  const [stage, setStage] = useState(0);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const run = (text = question) => {
    if (!text.trim()) {
      message.warning("请填写问题或任务");
      return;
    }
    if (config.fields.some((f) => !inputs[f]?.trim())) {
      message.warning("请先填写输入字段");
      return;
    }
    setAsked(text);
    setQuestion("");
    if (config.kind === "report") {
      setStage(1);
      setAnswer("");
    } else
      setAnswer(
        "这是用于确认交互的示例回答：\n\n差旅报销需要出差申请单、行程单、合规发票及支付凭证。请在出差结束后 **15 个工作日内**提交。\n\n[1]《差旅报销管理办法》v2.1 · 第 3 页\n\n正式接入后，这里将返回所绑定知识库的真实检索结果。",
      );
  };
  const report = () => {
    setStage(2);
    setAnswer(
      `# ${inputs["报告主题"] || asked}\n\n> 原型示例报告，用于确认章节、引用和导出交互。\n\n${(
        config.outline || "一、摘要\n二、重点进展\n三、后续计划"
      )
        .split("\n")
        .filter(Boolean)
        .map(
          (h, i) =>
            `## ${h}\n\n${i === 0 ? "本报告围绕指定主题整理现有资料。" : "此处将根据章节主题检索当前有效资料，汇总事实并标注来源。"} [${i + 1}]\n`,
        )
        .join(
          "\n",
        )}\n## 资料来源\n\n正式版本将在这里列出逐章节关联的原文件与位置。`,
    );
  };
  const download = () => {
    if (config.format === "docx") {
      message.info(
        "Word 导出将在后端接入时实现，当前可切换为 Markdown 体验下载",
      );
      return;
    }
    const blob = new Blob([answer], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "报告原型.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      {config.fields.length ? (
        <Form layout="vertical" className="experience-inputs">
          {config.fields.map((field, i) => (
            <Form.Item key={`${field}-${i}`} label={field} required>
              <Input
                value={inputs[field] || ""}
                onChange={(e) =>
                  setInputs((p) => ({ ...p, [field]: e.target.value }))
                }
                placeholder={`请输入${field}`}
              />
            </Form.Item>
          ))}
        </Form>
      ) : null}
      {!asked ? (
        <div className="experience-questions">
          {config.questions.filter(Boolean).map((q, i) => (
            <button
              key={i}
              onClick={() => {
                setQuestion(q);
              }}
            >
              {q}
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      ) : (
        <div className="experience-question">{asked}</div>
      )}
      {stage === 1 ? (
        <div className="outline-preview">
          <Tag color="purple">1 / 2 · 确认大纲</Tag>
          <h3>先确定报告结构</h3>
          <p>可修改章节，再继续撰写。</p>
          <Input.TextArea
            aria-label="待确认的大纲"
            defaultValue={config.outline}
            rows={5}
            onChange={(e) =>
              setInputs((p) => ({ ...p, _outline: e.target.value }))
            }
          />
          <Button
            type="primary"
            icon={<Check size={14} />}
            onClick={() => {
              if (inputs._outline !== undefined) {
                const sections = inputs._outline.trim();
                if (!sections) {
                  message.warning("请保留至少一个章节");
                  return;
                }
                setStage(2);
                setAnswer(
                  `# ${inputs["报告主题"] || asked}\n\n> 原型示例报告，尚未调用真实模型。\n\n${sections
                    .split("\n")
                    .map(
                      (h) =>
                        `## ${h}\n\n此处展示按章节检索后生成的正文与来源引用。`,
                    )
                    .join("\n\n")}`,
                );
              } else report();
            }}
          >
            确认大纲，预览报告
          </Button>
        </div>
      ) : null}
      {answer ? (
        <div className="experience-answer">
          <Tag color="purple">示例输出 · 未调用模型</Tag>
          <ReactMarkdown>{answer}</ReactMarkdown>
          {config.kind === "report" ? (
            <Button onClick={download}>
              下载{config.format === "markdown" ? " Markdown" : " Word"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="experience-compose">
        <Input.TextArea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={
            config.kind === "report"
              ? "描述本次报告任务…"
              : "输入你想了解的问题…"
          }
          aria-label="应用任务或问题"
        />
        <Button
          type="primary"
          aria-label="运行交互预览"
          icon={<Send size={16} />}
          onClick={() => run()}
        />
      </div>
      <div className="experience-note">
        交互预览 · 不发起模型请求 ·{" "}
        {config.currentOnly ? "当前有效版本" : "包含历史版本"}
      </div>
    </div>
  );
}
