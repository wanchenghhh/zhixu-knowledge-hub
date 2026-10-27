import { useState } from "react";
import LiveKnowledgeStudio from "../LiveKnowledgeStudio";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Result,
  Select,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
} from "antd";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  History,
  Plus,
  Save,
  ScanText,
  Scissors,
  Sparkles,
} from "lucide-react";
import { PageHeading } from "../components";
import { useStore } from "../store";
import { PROTOTYPE_NOTICE, usePrototype } from "../prototype";

interface MetadataField {
  id: string;
  name: string;
  type: string;
  description: string;
  value: string;
  source: string;
  generated: boolean;
  manual?: boolean;
  enabled: boolean;
}
interface ImportDesign {
  strategy: string;
  size: number;
  overlap: number;
  separator: string;
  parent: boolean;
  parentSize: number;
  extract: boolean;
  model: string;
  fields: MetadataField[];
  currentOnly: boolean;
  version: string;
  relation: string;
}
const fields: MetadataField[] = [
  {
    id: "title",
    name: "标题",
    type: "文本",
    description: "文档正式标题",
    value: "差旅报销管理办法",
    source: "第 1 页 · 标题",
    generated: false,
    enabled: true,
  },
  {
    id: "published",
    name: "发布日期",
    type: "日期",
    description: "文档发布的日期，原文未提供则留空",
    value: "2026-09-01",
    source: "第 1 页 · 发布信息",
    generated: false,
    enabled: true,
  },
  {
    id: "effective",
    name: "生效日期",
    type: "日期",
    description: "规则开始生效的日期",
    value: "2026-10-01",
    source: "第 1 页 · 生效日期",
    generated: false,
    enabled: true,
  },
  {
    id: "version",
    name: "版本",
    type: "文本",
    description: "原文标注的版本号",
    value: "v2.1",
    source: "第 1 页 · 版本信息",
    generated: false,
    enabled: true,
  },
  {
    id: "entity",
    name: "主体实体",
    type: "多值文本",
    description: "文档涉及的企业、项目或产品",
    value: "知序科技；全体员工",
    source: "第 1 页 · 适用范围",
    generated: false,
    enabled: true,
  },
  {
    id: "owner",
    name: "负责人",
    type: "文本",
    description: "原文明确标注的负责人，不根据部门推测人名",
    value: "",
    source: "原文未提供 · 未识别",
    generated: false,
    enabled: true,
  },
  {
    id: "keywords",
    name: "检索关键词",
    type: "多值文本",
    description: "提炼与本资料相关的检索词",
    value: "差旅报销；住宿标准；审批流程；发票凭证",
    source: "模型生成 · 可编辑",
    generated: true,
    enabled: true,
  },
  {
    id: "questions",
    name: "建议问题",
    type: "多值文本",
    description: "生成可被本资料回答的问题，作为辅助检索索引",
    value: "差旅报销需要哪些材料？\n住宿费用标准是多少？\n超过标准如何审批？",
    source: "模型生成 · 关联原文片段",
    generated: true,
    enabled: true,
  },
];
const initial: ImportDesign = {
  strategy: "structure",
  size: 800,
  overlap: 100,
  separator: "\\n\\n",
  parent: true,
  parentSize: 2000,
  extract: true,
  model: "qwen-plus",
  fields,
  currentOnly: true,
  version: "v2.1",
  relation: "travel",
};
const strategies = [
  {
    value: "structure",
    label: "自动结构切分",
    desc: "优先保留章节与段落边界，适合大多数文档。",
  },
  {
    value: "custom",
    label: "自定义切分",
    desc: "按长度、标题、页或指定规则控制切片边界。",
  },
  {
    value: "semantic",
    label: "语义切分",
    desc: "根据段落语义变化寻找边界，将增加 Embedding 调用。",
  },
  {
    value: "qa",
    label: "问答对模式",
    desc: "保留已有问答对，或用 LLM 提取问答对并人工确认。",
  },
];
const sample = `差旅报销管理办法\n版本：v2.1　发布日期：2026-09-01\n生效日期：2026-10-01\n适用范围：知序科技全体员工\n\n一、报销材料\n员工应在出差结束后 15 个工作日内提交报销。材料包括出差申请单、行程单、合规发票及支付凭证。\n\n二、住宿标准\n一线城市住宿每晚不超过 500 元，其他城市每晚不超过 350 元。超标部分需补充审批说明。\n\n城市类别 | 住宿标准 | 审批要求\n一线城市 | 500 元/晚 | 超标需补充审批\n其他城市 | 350 元/晚 | 超标需补充审批\n\n三、审批流程\n员工提交申请后，由直属负责人审核，财务部门复核。存在材料缺失时，需补充后再次提交。`;
function previewChunks(config: ImportDesign, custom: string) {
  if (config.strategy === "qa")
    return [
      {
        title: "问答对 01",
        text: "问：差旅报销需要哪些材料？\n答：出差申请单、行程单、合规发票及支付凭证。",
        location: "第 3 页 · 报销材料",
      },
      {
        title: "问答对 02",
        text: "问：住宿费用标准是多少？\n答：一线城市每晚不超过 500 元，其他城市每晚不超过 350 元。",
        location: "第 3 页 · 住宿标准",
      },
    ];
  const text = custom || sample;
  if (config.strategy === "custom") {
    let chunks: string[] = [];
    if (config.separator === "page") chunks = text.split(/(?=二、|三、)/);
    else if (config.separator === "heading")
      chunks = text.split(/(?=[一二三四五六七八九十]+、)/);
    else if (config.separator === "length") {
      for (
        let i = 0;
        i < text.length;
        i += Math.max(1, config.size - config.overlap)
      )
        chunks.push(text.slice(i, i + config.size));
    } else {
      try {
        const regex = new RegExp(
          config.separator === "\\n\\n" ? "\n\n" : config.separator,
        );
        if (!regex.test("")) chunks = text.split(regex);
        else return [];
      } catch {
        return [];
      }
    }
    return chunks
      .filter((s) => s.trim())
      .map((s, i) => ({
        title: `自定义片段 ${String(i + 1).padStart(2, "0")}`,
        text: s,
        location: "示例文本 · 边界预览",
      }));
  }
  if (custom)
    return custom
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((s, i) => ({
        title: `段落 ${i + 1}`,
        text: s,
        location: "本地文本预览",
      }));
  return [
    {
      title: "报销材料",
      text: "员工应在出差结束后 15 个工作日内提交报销。材料包括出差申请单、行程单、合规发票及支付凭证。",
      location: "第 3 页 · 第一节",
    },
    {
      title: "住宿标准",
      text: "一线城市住宿每晚不超过 500 元，其他城市每晚不超过 350 元。超标部分需补充审批说明。\n\n城市类别 | 住宿标准 | 审批要求\n一线城市 | 500 元/晚 | 超标需补充审批\n其他城市 | 350 元/晚 | 超标需补充审批",
      location: "第 3 页 · 第二节 · 保留表头",
    },
    {
      title: "审批流程",
      text: "员工提交申请后，由直属负责人审核，财务部门复核。存在材料缺失时，需补充后再次提交。",
      location: "第 4 页 · 第三节",
    },
  ];
}
export default function KnowledgeStudio() {
  const { live } = useStore();
  return live ? <LiveKnowledgeStudio /> : <PrototypeKnowledgeStudio />;
}
function PrototypeKnowledgeStudio() {
  const { id } = useParams();
  const { state } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [config, saveConfig] = usePrototype<ImportDesign>(
    `import-${id || "sample"}`,
    initial,
  );
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState("extract");
  const [source, setSource] = useState<MetadataField | null>(null);
  const [showField, setShowField] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("文本");
  const [fieldDesc, setFieldDesc] = useState("");
  const [selected, setSelected] = useState(0);
  const [custom, setCustom] = useState("");
  const [fileName, setFileName] = useState("差旅报销管理办法-v2.1.pdf");
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState(false);
  const kb = state.knowledge.find((k) => k.id === id);
  const unavailable =
    !!id &&
    (!kb || (state.role !== "admin" && !kb.visible.includes(state.role)));
  const patch = (p: Partial<ImportDesign>) => {
    setDraft((c) => ({ ...c, ...p }));
    setSaved(false);
  };
  const changeField = (field: MetadataField, p: Partial<MetadataField>) =>
    patch({
      fields: draft.fields.map((f) => (f.id === field.id ? { ...f, ...p } : f)),
    });
  const chunks = previewChunks(draft, custom);
  const active = chunks[Math.min(selected, Math.max(0, chunks.length - 1))];
  const commit = () => {
    saveConfig(structuredClone(draft));
    setSaved(true);
    message.success("导入方案已保存在本浏览器，未提交真实构建任务");
  };
  const next = () => {
    if (
      step === 2 &&
      (draft.overlap >= draft.size ||
        (draft.parent && draft.parentSize < draft.size) ||
        !chunks.length)
    ) {
      message.warning("请检查切分参数、父片段长度和自定义规则");
      return;
    }
    setStep((s) => s + 1);
  };
  if (state.role === "user" || unavailable)
    return (
      <Result
        status="403"
        title="当前角色无法配置此知识库"
        extra={
          <Button onClick={() => navigate("/knowledge")}>返回知识库</Button>
        }
      />
    );
  return (
    <div className="page studio-page">
      <button
        className="back-link"
        onClick={() => navigate(id ? `/knowledge/${id}` : "/knowledge")}
      >
        <ArrowLeft size={14} />
        {kb?.name || "知识库"}
      </button>
      <PageHeading
        title="把文档，整理成可用的知识"
        description="自动补全知识线索，保留内容结构，让每一次检索更准确。"
        actions={
          <Button icon={<Save size={15} />} onClick={commit}>
            保存导入方案
          </Button>
        }
      />
      <Alert type="info" showIcon title={PROTOTYPE_NOTICE} />
      <div className="studio-panel import-steps">
        <Steps
          current={step}
          items={[
            { title: "选择资料" },
            { title: "元数据" },
            { title: "切分预览" },
            { title: "版本与构建" },
          ]}
        />
      </div>
      {step === 0 ? (
        <div className="studio-two-column">
          <section className="studio-panel">
            <div className="studio-panel-heading">
              <span>
                <FileText size={17} />
                本次导入
              </span>
              <Tag>交互示例</Tag>
            </div>
            <div className="sample-file">
              <span className="application-icon purple">
                <FileText />
              </span>
              <div>
                <strong>{fileName}</strong>
                <p>
                  {custom
                    ? "本地文本预览 · 元数据抽取仍使用示例值"
                    : "示例资料 · 4 页 · 含标题、表格与版本信息"}
                </p>
              </div>
              <Tag color="green">可预览</Tag>
            </div>
            <Upload
              accept=".md,.txt"
              showUploadList={false}
              beforeUpload={async (file) => {
                if (file.size > 1024 * 1024) {
                  message.warning("原型文本预览限 1 MB");
                  return false;
                }
                if (!/\.(md|txt)$/i.test(file.name)) {
                  message.warning(
                    "原型仅直接预览 Markdown / TXT；其他格式请使用示例资料",
                  );
                  return false;
                }
                const text = await file.text();
                if (!text.trim()) {
                  message.warning("文件为空");
                  return false;
                }
                setCustom(text);
                setFileName(file.name);
                setSelected(0);
                message.info(
                  "已在本地读取文本，不上传服务器；抽取结果仍为示例",
                );
                return false;
              }}
            >
              <Button icon={<Plus size={15} />}>选择本地文本预览</Button>
            </Upload>
            <Button
              type="text"
              onClick={() => {
                setCustom("");
                setFileName("差旅报销管理办法-v2.1.pdf");
              }}
            >
              使用示例资料
            </Button>
            <div className="studio-divider" />
            <h3>本次处理方案</h3>
            <div className="process-summary">
              <span>
                <ScanText size={17} />
                自动抽取元数据
              </span>
              <ChevronRight size={14} />
              <span>
                <Scissors size={17} />
                结构与语义切分
              </span>
              <ChevronRight size={14} />
              <span>
                <GitBranch size={17} />
                版本关联
              </span>
            </div>
            <p className="studio-help">
              正式接入后支持现有全部文件格式；先预览确认，再生成索引。原始文件始终保留。
            </p>
          </section>
          <section className="studio-panel">
            <div className="studio-panel-heading">
              <span>
                <BookOpen size={17} />
                原文预览
              </span>
              <Tag>未调用解析模型</Tag>
            </div>
            <pre className="document-preview">{custom || sample}</pre>
          </section>
        </div>
      ) : null}
      {step === 1 ? (
        <section className="studio-panel metadata-panel">
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: "extract", label: "抽取结果与修正" },
              { key: "schema", label: "知识库字段模板" },
            ]}
          />
          <div className="studio-setting">
            <div>
              <strong>自动抽取元数据</strong>
              <p>事实字段保留原文依据；关键词和建议问题标记为模型生成。</p>
            </div>
            <Switch
              checked={draft.extract}
              onChange={(extract) => patch({ extract })}
            />
          </div>
          {draft.extract ? (
            <>
              <div className="metadata-model">
                <span>抽取模型</span>
                <Select
                  value={draft.model}
                  onChange={(model) => patch({ model })}
                  options={
                    state.models.filter((m) => m.type === "LLM").length
                      ? state.models
                          .filter((m) => m.type === "LLM")
                          .map((m) => ({
                            value: m.model,
                            label: `${m.provider} · ${m.model}`,
                          }))
                      : [
                          {
                            value: "qwen-plus",
                            label: "AIHubMix · qwen-plus（示例）",
                          },
                        ]
                  }
                  style={{ width: 280 }}
                />
                <Tag>异步任务 · 单独记录用量</Tag>
              </div>
              {tab === "extract" ? (
                <>
                  <div className="metadata-legend">
                    <Tag color="blue">事实抽取</Tag>来自原文，可查看依据{" "}
                    <Tag color="blue">模型生成</Tag>用于召回增强，支持修正
                  </div>
                  <Table
                    pagination={false}
                    rowKey="id"
                    dataSource={draft.fields.filter((f) => f.enabled)}
                    columns={[
                      { title: "字段", dataIndex: "name", width: 140 },
                      {
                        title: "内容",
                        render: (_, f: MetadataField) => (
                          <Input.TextArea
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            value={f.value}
                            placeholder="未识别，可手动补充"
                            aria-label={`元数据-${f.name}`}
                            onChange={(e) =>
                              changeField(f, {
                                value: e.target.value,
                                manual: true,
                              })
                            }
                          />
                        ),
                      },
                      {
                        title: "来源与依据",
                        width: 240,
                        render: (_, f: MetadataField) => (
                          <div className="metadata-source">
                            <Tag
                              color={
                                f.generated
                                  ? "blue"
                                  : f.value
                                    ? "blue"
                                    : "default"
                              }
                            >
                              {f.manual
                                ? "人工修正"
                                : f.generated
                                  ? "模型生成"
                                  : f.value
                                    ? "事实抽取"
                                    : "未识别"}
                            </Tag>
                            <button onClick={() => setSource(f)}>
                              {f.source}
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        ),
                      },
                    ]}
                  />
                </>
              ) : (
                <>
                  <Alert
                    showIcon
                    type="info"
                    title="字段模板按知识库保存，文档可以单独修正抽取结果。"
                  />
                  <Table
                    pagination={false}
                    rowKey="id"
                    dataSource={draft.fields}
                    columns={[
                      {
                        title: "启用",
                        width: 65,
                        render: (_, f: MetadataField) => (
                          <Checkbox
                            aria-label={`启用${f.name}`}
                            checked={f.enabled}
                            onChange={(e) =>
                              changeField(f, { enabled: e.target.checked })
                            }
                          />
                        ),
                      },
                      { title: "字段", dataIndex: "name", width: 150 },
                      { title: "类型", dataIndex: "type", width: 130 },
                      { title: "抽取要求", dataIndex: "description" },
                    ]}
                  />
                  <Button
                    className="studio-gap"
                    icon={<Plus size={15} />}
                    onClick={() => setShowField(true)}
                  >
                    新增自定义字段
                  </Button>
                </>
              )}
            </>
          ) : (
            <Alert
              type="warning"
              showIcon
              title="本次跳过自动抽取，仍保留文件名称和原文定位。"
            />
          )}
        </section>
      ) : null}
      {step === 2 ? (
        <div className="import-chunk-layout">
          <section className="studio-panel chunk-settings">
            <div className="studio-panel-heading">
              <span>
                <Scissors size={17} />
                切分设置
              </span>
            </div>
            <Radio.Group
              value={draft.strategy}
              onChange={(e) => {
                patch({ strategy: e.target.value });
                setSelected(0);
              }}
              className="strategy-options"
            >
              {strategies.map((s) => (
                <Radio value={s.value} key={s.value}>
                  <strong>{s.label}</strong>
                  {s.value === "structure" ? (
                    <Tag color="blue">推荐</Tag>
                  ) : null}
                  <p>{s.desc}</p>
                </Radio>
              ))}
            </Radio.Group>
            <Form layout="vertical">
              <div className="studio-form-row">
                <Form.Item label="片段最大长度（字符）">
                  <InputNumber
                    min={100}
                    max={4000}
                    step={100}
                    value={draft.size}
                    onChange={(v) => patch({ size: v ?? 800 })}
                  />
                </Form.Item>
                <Form.Item label="重叠长度（字符）">
                  <InputNumber
                    min={0}
                    max={1000}
                    value={draft.overlap}
                    onChange={(v) => patch({ overlap: v ?? 100 })}
                  />
                </Form.Item>
              </div>
              {draft.strategy === "custom" ? (
                <Form.Item label="切分边界">
                  <Select
                    value={
                      ["length", "page", "heading", "\\n\\n"].includes(
                        draft.separator,
                      )
                        ? draft.separator
                        : "regex"
                    }
                    onChange={(separator) => {
                      patch({
                        separator:
                          separator === "regex"
                            ? "(?=第[一二三四五六七八九十]+章)"
                            : separator,
                      });
                      setSelected(0);
                    }}
                    options={[
                      { value: "length", label: "按长度" },
                      { value: "heading", label: "按标题" },
                      { value: "page", label: "按页（示例分页）" },
                      { value: "\\n\\n", label: "按空行分隔" },
                      { value: "regex", label: "自定义正则" },
                    ]}
                  />
                  {!["length", "page", "heading", "\\n\\n"].includes(
                    draft.separator,
                  ) ? (
                    <Input
                      className="studio-gap"
                      value={draft.separator}
                      onChange={(e) => patch({ separator: e.target.value })}
                      aria-label="切分正则表达式"
                    />
                  ) : null}
                </Form.Item>
              ) : null}
            </Form>
            <div className="studio-divider" />
            <div className="studio-setting">
              <div>
                <strong>父子检索</strong>
                <p>小片段用于召回，返回所属章节补充上下文。</p>
              </div>
              <Switch
                checked={draft.parent}
                onChange={(parent) => patch({ parent })}
              />
            </div>
            {draft.parent ? (
              <Form layout="vertical">
                <Form.Item label="父片段最大长度（字符）">
                  <InputNumber
                    min={draft.size}
                    max={12000}
                    value={draft.parentSize}
                    onChange={(v) => patch({ parentSize: v ?? 2000 })}
                  />
                </Form.Item>
              </Form>
            ) : null}
            <Alert
              type={
                draft.strategy === "semantic" || draft.strategy === "qa"
                  ? "warning"
                  : "info"
              }
              showIcon
              title={
                draft.strategy === "semantic"
                  ? "语义边界当前为示例，接入后端后计算。"
                  : draft.strategy === "qa"
                    ? "问答对当前为示例，接入后端后提取。"
                    : "结构边界当前为示例；自定义长度和分隔符可直接预览。"
              }
            />
          </section>
          <section className="studio-panel studio-chunk-preview">
            <div className="studio-panel-heading">
              <span>
                切分预览 <Tag>{chunks.length} 个片段</Tag>
              </span>
              <Tag>原文定位保留</Tag>
            </div>
            <div className="chunk-preview-body">
              <div className="chunk-preview-list">
                {chunks.map((c, i) => (
                  <button
                    key={i}
                    className={selected === i ? "active" : ""}
                    onClick={() => setSelected(i)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <strong>{c.title}</strong>
                    <small>{c.text.length} 字符</small>
                  </button>
                ))}
              </div>
              <div className="chunk-preview-content">
                {active ? (
                  <>
                    <div className="inline-icon">
                      <Tag color="blue">{active.location}</Tag>
                      <span className="text-muted">
                        {active.text.length} 字符
                      </span>
                    </div>
                    <h2>{active.title}</h2>
                    <pre>{active.text}</pre>
                    <div className="chunk-index-meta">
                      <strong>附加到此片段的索引信息</strong>
                      <p>
                        版本 {draft.version} · 主体 知序科技 · 生效日期
                        2026-10-01
                      </p>
                      <Tag>差旅报销</Tag>
                      <Tag>住宿标准</Tag>
                      {draft.parent ? (
                        <div className="parent-context">
                          <GitBranch size={15} />
                          父片段：差旅报销管理办法 / 本章上下文
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <Alert
                    showIcon
                    type="error"
                    title="规则无效或未生成片段，请调整表达式。"
                  />
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="studio-two-column">
          <section className="studio-panel">
            <div className="studio-panel-heading">
              <span>
                <GitBranch size={17} />
                版本关系
              </span>
              <Button
                type="text"
                icon={<History size={14} />}
                onClick={() => setHistory(true)}
              >
                查看历史
              </Button>
            </div>
            <Form layout="vertical">
              <Form.Item label="关联文档">
                <Select
                  value={draft.relation}
                  onChange={(relation) => patch({ relation })}
                  options={[
                    {
                      value: "travel",
                      label: "差旅报销管理办法（示例文档组）",
                    },
                    { value: "new", label: "作为独立新文档" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="本次版本号">
                <Input
                  value={draft.version}
                  onChange={(e) => patch({ version: e.target.value })}
                  placeholder="未识别时可手动填写"
                />
              </Form.Item>
            </Form>
            <Alert
              showIcon
              type="info"
              title="系统建议版本关系，由管理人员确认。"
              description="正式接入后结合标题与内容判断；不会仅凭同名文件自动替换。"
            />
            <div className="version-timeline">
              <div>
                <span className="version-dot" />
                <strong>
                  {draft.relation === "new"
                    ? "独立新文档"
                    : draft.version || "未标注版本"}
                </strong>
                <Tag color="green">待构建生效</Tag>
                <p>2026-10-01 起生效 · 构建成功后切换</p>
              </div>
              {draft.relation === "travel" ? (
                <div>
                  <span className="version-dot old" />
                  <strong>v2.0</strong>
                  <Tag>历史版本</Tag>
                  <p>原文和索引保留，可在历史检索中查看</p>
                </div>
              ) : null}
            </div>
            <div className="studio-setting">
              <div>
                <strong>默认仅检索当前有效版本</strong>
                <p>新索引构建失败时继续使用原有有效版本。</p>
              </div>
              <Switch
                checked={draft.currentOnly}
                onChange={(currentOnly) => patch({ currentOnly })}
              />
            </div>
          </section>
          <section className="studio-panel build-review">
            <div className="studio-panel-heading">
              <span>
                <CheckCircle2 size={17} />
                构建前确认
              </span>
            </div>
            <dl>
              <dt>导入资料</dt>
              <dd>{fileName}</dd>
              <dt>元数据索引</dt>
              <dd>
                {draft.extract
                  ? `${draft.fields.filter((f) => f.enabled).length} 个字段，支持过滤与召回`
                  : "跳过自动抽取"}
              </dd>
              <dt>切分方式</dt>
              <dd>
                {strategies.find((s) => s.value === draft.strategy)?.label} ·{" "}
                {chunks.length} 个预览片段
              </dd>
              <dt>上下文策略</dt>
              <dd>{draft.parent ? "父子检索" : "按命中片段返回"}</dd>
              <dt>版本范围</dt>
              <dd>{draft.currentOnly ? "当前有效版本" : "包含历史版本"}</dd>
            </dl>
            <div className="build-cost">
              <Sparkles size={20} />
              <div>
                <strong>正式构建将调用云端模型</strong>
                <p>
                  抽取、语义处理与向量化会分别记录用量，实际消耗以服务商返回为准。
                </p>
              </div>
            </div>
            {saved ? (
              <Alert
                showIcon
                type="success"
                title="导入方案已保存"
                description="本次原型未上传文件或发起真实构建，可返回任意步骤继续调整。"
              />
            ) : (
              <Button
                size="large"
                type="primary"
                block
                icon={<Check size={17} />}
                onClick={commit}
              >
                确认方案并保存原型
              </Button>
            )}
          </section>
        </div>
      ) : null}
      <div className="studio-step-footer">
        <Button
          disabled={step === 0}
          icon={<ArrowLeft size={15} />}
          onClick={() => setStep((s) => s - 1)}
        >
          上一步
        </Button>
        <span>
          {step + 1} / 4 ·{" "}
          {
            [
              "选择资料与处理方案",
              "抽取与修正元数据",
              "检查内容边界",
              "关联版本并确认方案",
            ][step]
          }
        </span>
        {step < 3 ? (
          <Button type="primary" onClick={next}>
            下一步
            <ArrowRight size={15} />
          </Button>
        ) : (
          <Button onClick={() => setStep(0)}>返回资料</Button>
        )}
      </div>
      <Drawer
        title={source?.generated ? "模型生成字段说明" : "原文依据"}
        open={!!source}
        onClose={() => setSource(null)}
        width={500}
      >
        {source ? (
          <>
            <Tag color={source.generated ? "blue" : "blue"}>{source.name}</Tag>
            <h2 className="studio-gap">{source.source}</h2>
            <p className="studio-help">
              {source.generated
                ? "这类内容用于增强检索，并非原文事实。正式接入后会关联所依据的原文片段。"
                : source.id === "owner"
                  ? "原文没有明确负责人，保持未识别。可以人工补充，并记录为人工修正。"
                  : "以下为示例原文，正式接入后会展示精确来源位置。"}
            </p>
            <pre className="document-preview">
              {source.id === "owner"
                ? "未找到明确负责人。"
                : source.generated
                  ? source.value
                  : sample.split("\n\n")[0]}
            </pre>
          </>
        ) : null}
      </Drawer>
      <Drawer
        title="文档历史与检索范围"
        open={history}
        onClose={() => setHistory(false)}
        width={520}
      >
        <Alert
          showIcon
          type="info"
          title="默认检索当前有效版本，历史版本保留可追溯。"
        />
        <Table
          className="studio-gap"
          pagination={false}
          rowKey="version"
          dataSource={[
            { version: "v2.1", date: "2026-10-01", state: "待构建生效" },
            { version: "v2.0", date: "2026-01-01", state: "当前有效" },
            { version: "v1.0", date: "2025-06-01", state: "历史" },
          ]}
          columns={[
            { title: "版本", dataIndex: "version" },
            { title: "生效日期", dataIndex: "date" },
            { title: "状态", dataIndex: "state" },
          ]}
        />
        <p className="studio-help">
          以文档组维护版本关系，结合生效日期确定当前版本；构建成功后再切换。
        </p>
      </Drawer>
      <Modal
        title="新增知识库元数据字段"
        open={showField}
        onCancel={() => setShowField(false)}
        okText="添加字段"
        onOk={() => {
          if (
            !fieldName.trim() ||
            draft.fields.some((f) => f.name === fieldName.trim())
          ) {
            message.warning("请填写不重复的字段名称");
            return;
          }
          patch({
            fields: [
              ...draft.fields,
              {
                id: crypto.randomUUID(),
                name: fieldName.trim(),
                type: fieldType,
                description: fieldDesc,
                value: "",
                source: "自定义字段 · 待抽取",
                generated: false,
                enabled: true,
              },
            ],
          });
          setFieldName("");
          setFieldDesc("");
          setShowField(false);
          message.success("已添加到本库原型字段模板");
        }}
      >
        <Form layout="vertical">
          <Form.Item label="字段名称" required>
            <Input
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="例如：项目编号"
            />
          </Form.Item>
          <Form.Item label="字段类型">
            <Select
              value={fieldType}
              onChange={setFieldType}
              options={["文本", "多值文本", "日期", "数字"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item label="抽取要求">
            <Input.TextArea
              value={fieldDesc}
              onChange={(e) => setFieldDesc(e.target.value)}
              placeholder="说明从哪里提取、缺失时如何处理"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
