import { useEffect, useRef, useState } from "react";
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
  Slider,
  Select,
  Steps,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  LoaderCircle,
  Plus,
  Save,
  Scissors,
} from "lucide-react";
import { api, uploadKnowledgeFile, write } from "./api";
import { PageHeading } from "./components";
import { useStore } from "./store";
interface Options {
  chunkSize: number;
  lengthUnit: "characters" | "tokens";
  delimiters: string[];
  delimiterPosition: string;
  headingLevel: number;
  tableHeader: boolean;
  overlap: number;
  parseMode: string;
  strategy: string;
  boundary: string;
  separator: string;
  parent: boolean;
  parentSize: number;
  semanticThreshold: number;
  extractMetadata: boolean;
  extractionModel: string | null;
  questionMode: string;
}
interface Field {
  id: string;
  name: string;
  type: string;
  description: string;
  generated: boolean;
  enabled: boolean;
}
interface Config {
  options: Options;
  fields: Field[];
}
interface Value {
  value: unknown;
  source: string;
  quote?: string;
  location?: string;
  manual?: boolean;
}
interface Detail {
  id: string;
  name: string;
  status: string;
  content: string;
  error?: string;
  metadata: Record<string, Value>;
  fields: Field[];
  preparedCount: number;
  options: Options;
  version: {
    group: string;
    groupFileId?: string | null;
    suggestedGroupFileId?: string | null;
    label: string;
    effectiveOn: string;
    expiresOn: string;
    current: boolean;
    pending?: {
      document_group: string;
      version_label: string;
      effective_on: string;
      expires_on: string;
    };
  };
}
interface Preview {
  total: number;
  items: {
    text: string;
    metadata: {
      location: string;
      parentText?: string;
      tablePreserved?: boolean;
      tableHeaderRepeated?: boolean;
      length?: number;
      lengthUnit?: string;
      lengthWarning?: string;
    };
  }[];
}
interface Version {
  id: string;
  name: string;
  title: string;
  group: string;
  label: string;
  effectiveOn: string;
  current: boolean;
  status: string;
}
const defaults: Options = {
  chunkSize: 800,
  lengthUnit: "characters",
  delimiters: ["\n\n"],
  delimiterPosition: "start",
  headingLevel: 2,
  tableHeader: true,
  overlap: 100,
  parseMode: "auto",
  strategy: "smart",
  boundary: "paragraph",
  separator: "\\n\\n",
  parent: true,
  parentSize: 2400,
  semanticThreshold: 0.65,
  extractMetadata: true,
  extractionModel: null,
  questionMode: "extract",
};
export default function LiveKnowledgeStudio() {
  const params = useParams();
  const { state, refresh } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [kbId, setKbId] = useState(params.id || "");
  const [config, setConfig] = useState<Config>({
    options: defaults,
    fields: [],
  });
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview>({ total: 0, items: [] });
  const [versions, setVersions] = useState<Version[]>([]);
  const [groupFileId, setGroupFileId] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [effective, setEffective] = useState("");
  const [expires, setExpires] = useState("");
  const [source, setSource] = useState<Value | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [showField, setShowField] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("文本");
  const [fieldDesc, setFieldDesc] = useState("");
  const [previewOptions, setPreviewOptions] = useState("");
  const [built, setBuilt] = useState(false);
  const [progress, setProgress] = useState(0);
  const target = useRef(1);
  const pending = busy || !!taskId;
  const options = config.options;
  const active = preview.items[selected];
  useEffect(() => {
    if (!kbId && state.knowledge.length) setKbId(state.knowledge[0].id);
  }, [state.knowledge, kbId]);
  useEffect(() => {
    if (!kbId) return;
    let active = true;
    setError("");
    api<Config>(`/knowledge/${kbId}/processing`)
      .then((data) => {
        if (active)
          setConfig({
            ...data,
            options: {
              ...defaults,
              ...data.options,
              strategy: ["structure", "semantic"].includes(
                data.options.strategy,
              )
                ? "smart"
                : data.options.strategy,
              ...(data.options.strategy === "custom" &&
              data.options.boundary === "paragraph"
                ? { boundary: "delimiter", delimiters: ["\n\n"] }
                : {}),
            },
          });
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    api<Version[]>(`/knowledge/${kbId}/versions`)
      .then((data) => {
        if (active) setVersions(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kbId]);
  const applyDetail = (row: Detail) => {
    setDetail(row);
    setValues(
      Object.fromEntries(
        Object.entries(row.metadata).map(([key, item]) => [
          key,
          Array.isArray(item.value)
            ? item.value.join("\n")
            : item.value == null
              ? ""
              : String(item.value),
        ]),
      ),
    );
    const pending = row.version.pending;
    setGroupFileId(row.version.groupFileId || null);
    setVersion(
      pending?.version_label ||
        row.version.label ||
        String(row.metadata.version?.value || ""),
    );
    setEffective(
      pending?.effective_on ||
        row.version.effectiveOn ||
        String(row.metadata.effective?.value || ""),
    );
    setExpires(pending?.expires_on || row.version.expiresOn || "");
  };
  const load = async (id: string) => {
    const row = await api<Detail>(`/files/${id}/detail`);
    applyDetail(row);
    const chunks = await api<Preview>(`/files/${id}/preview`);
    setPreview(chunks);
    setSelected(0);
    return row;
  };
  useEffect(() => {
    if (!taskId || !fileId) return;
    let active = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const job = await api<{
          status: string;
          stage: string;
          error?: string;
        }>(`/tasks/${taskId}`);
        if (!active) return;
        setStage(job.stage);
        if (job.status === "success") {
          await load(fileId);
          if (!active) return;
          setTaskId("");
          setStep(target.current);
          setPreviewOptions(JSON.stringify(config.options));
          if (target.current === 3) setBuilt(true);
          await refresh();
          api<Version[]>(`/knowledge/${kbId}/versions`)
            .then(setVersions)
            .catch(() => {});
        } else if (job.status === "failed") {
          setTaskId("");
          setError(job.error || "处理失败，可重试任务");
          await refresh();
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [taskId, fileId]);
  const patch = (p: Partial<Options>) => {
    setConfig((c) => ({ ...c, options: { ...c.options, ...p } }));
    setBuilt(false);
  };
  const guarded = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const saveConfig = async () => {
    await write(`/knowledge/${kbId}/processing`, config, "PUT");
  };
  const start = () =>
    guarded(async () => {
      if (!kbId) throw Error("请先选择知识库");
      if (!consent) throw Error("请先确认云端调用提示");
      if (options.overlap >= options.chunkSize)
        throw Error("重叠长度须小于片段长度");
      await saveConfig();
      target.current = 1;
      if (fileId) {
        const result = await write<{ task: { id: string } }>(
          `/files/${fileId}/prepare`,
          { options, reextract: true },
        );
        setTaskId(result.task.id);
      } else {
        if (!file) throw Error("请选择文件");
        const result = await uploadKnowledgeFile(
          kbId,
          file,
          options,
          state.runtime?.uploadStrategy || "multipart",
          setProgress,
        );
        setFileId(result.file.id);
        if (result.task) setTaskId(result.task.id);
        else throw Error("服务端未返回解析任务");
      }
      setStage("等待解析与元数据抽取");
    });
  const saveMetadata = () =>
    guarded(async () => {
      await saveConfig();
      const payload: Record<string, unknown> = {};
      for (const field of config.fields.filter((f) => f.enabled)) {
        const raw = values[field.id] || "";
        payload[field.id] =
          field.type === "多值文本"
            ? raw
                .split(/[\n;；]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : field.type === "数字"
              ? raw.trim()
                ? Number(raw)
                : null
              : raw.trim() || null;
      }
      await write(`/files/${fileId}/metadata`, { values: payload }, "PATCH");
      await load(fileId);
      setStep(2);
    });
  const makePreview = () =>
    guarded(async () => {
      await saveConfig();
      target.current = 2;
      const result = await write<{ task: { id: string } }>(
        `/files/${fileId}/prepare`,
        { options },
      );
      setTaskId(result.task.id);
      setStage("生成切分预览");
    });
  const build = () =>
    guarded(async () => {
      if (!consent) throw Error("请确认云端调用提示");
      await write(
        `/files/${fileId}/version`,
        {
          groupFileId,
          label: version,
          effectiveOn: effective,
          expiresOn: expires,
        },
        "PUT",
      );
      const job = await write<{ id: string }>(`/knowledge/${kbId}/build`, {
        fileIds: [fileId],
      });
      target.current = 3;
      setTaskId(job.id);
      setStage("等待向量构建");
    });
  if (state.role === "user")
    return (
      <div className="page">
        <Alert type="warning" title="使用者不能修改文档处理配置" />
      </div>
    );
  return (
    <div className="page studio-page">
      <button
        className="back-link"
        onClick={() => navigate(kbId ? `/knowledge/${kbId}` : "/knowledge")}
      >
        <ArrowLeft size={14} />
        知识库
      </button>
      <PageHeading
        title="文档导入与知识加工"
        description="从真实资料提取元数据、检查切分，并建立可追溯的版本索引。"
        actions={
          <Button
            icon={<Save size={15} />}
            disabled={!kbId || pending}
            onClick={() =>
              guarded(async () => {
                await saveConfig();
                message.success("知识库处理方案已保存");
              })
            }
          >
            保存本库方案
          </Button>
        }
      />
      <Alert
        type="success"
        showIcon
        title="已连接真实文档处理服务"
        description="元数据、语义切分与问答对提取会按所选策略调用云端模型，用量记录在任务中。"
      />
      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          closable
          onClose={() => setError("")}
        />
      ) : null}
      {pending ? (
        <Alert
          type="info"
          showIcon
          icon={<LoaderCircle size={17} />}
          title={stage || "正在处理…"}
          description={
            progress > 0 && progress < 100
              ? `上传进度 ${progress}%`
              : "任务进度已保存，可在任务中心查看与重试。"
          }
        />
      ) : null}
      <div className="studio-panel import-steps">
        <Steps
          current={step}
          items={[
            { title: "选择与解析" },
            { title: "元数据修正" },
            { title: "切分预览" },
            { title: "版本与构建" },
          ]}
        />
      </div>
      {step === 0 ? (
        <div className="studio-two-column">
          <section className="studio-panel">
            <Form layout="vertical">
              <Form.Item label="目标知识库" required>
                <Select
                  disabled={pending || !!params.id}
                  value={kbId || undefined}
                  onChange={(id) => {
                    setKbId(id);
                    setFileId("");
                    setDetail(null);
                    setFile(null);
                    setBuilt(false);
                  }}
                  options={state.knowledge.map((k) => ({
                    value: k.id,
                    label: k.name,
                  }))}
                />
              </Form.Item>
              <Form.Item label="原始文件">
                <Upload
                  accept=".pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
                  showUploadList={false}
                  disabled={pending}
                  beforeUpload={(item) => {
                    if (
                      item.size >
                      (state.runtime?.maxFileBytes || 20 * 1024 * 1024)
                    ) {
                      message.warning("文件不能超过20 MB");
                      return false;
                    }
                    setFile(item);
                    setFileId("");
                    setDetail(null);
                    setBuilt(false);
                    return false;
                  }}
                >
                  <Button icon={<Plus size={15} />} disabled={pending}>
                    选择文件
                  </Button>
                </Upload>
                {file ? (
                  <p className="studio-help">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB
                  </p>
                ) : null}
              </Form.Item>
              <Form.Item label="或升级已有文档">
                <Select
                  allowClear
                  disabled={pending}
                  placeholder="重新抽取并调整已有文档"
                  value={fileId || undefined}
                  options={state.files
                    .filter(
                      (f) =>
                        f.kbId === kbId &&
                        ![
                          "queued",
                          "parsing",
                          "indexing",
                          "uploading",
                        ].includes(f.status),
                    )
                    .map((f) => ({ value: f.id, label: f.name }))}
                  onChange={(id) => {
                    setFileId(id || "");
                    setFile(null);
                    if (id) load(id).catch((e) => setError(String(e)));
                    else setDetail(null);
                  }}
                />
              </Form.Item>
              <Form.Item label="抽取模型">
                <Select
                  allowClear
                  disabled={pending}
                  value={options.extractionModel || undefined}
                  placeholder="自动选择已就绪的对话模型"
                  options={state.models
                    .filter((m) => m.type === "LLM" && m.status === "ready")
                    .map((m) => ({
                      value: m.id,
                      label: `${m.provider} · ${m.model}`,
                    }))}
                  onChange={(extractionModel) =>
                    patch({ extractionModel: extractionModel || null })
                  }
                />
              </Form.Item>
              <div className="studio-setting">
                <div>
                  <strong>自动提取元数据</strong>
                  <p>事实字段保留原文证据，缺失内容明确留空。</p>
                </div>
                <Switch
                  checked={options.extractMetadata}
                  disabled={pending}
                  onChange={(extractMetadata) => patch({ extractMetadata })}
                />
              </div>
              <Form.Item label="文档解析">
                <Select
                  disabled={pending}
                  value={options.parseMode}
                  onChange={(parseMode) => patch({ parseMode })}
                  options={[
                    { value: "auto", label: "自动解析" },
                    {
                      value: "enhanced",
                      label: "增强云端解析（需配置 DocMind）",
                    },
                  ]}
                />
              </Form.Item>
              <Checkbox
                checked={consent}
                disabled={pending}
                onChange={(e) => setConsent(e.target.checked)}
              >
                允许将此资料发送至已配置的云端模型与解析 API。
              </Checkbox>
            </Form>
            <Button
              className="studio-gap"
              type="primary"
              loading={pending}
              disabled={!kbId || (!file && !fileId)}
              onClick={start}
            >
              导入并解析抽取
            </Button>
          </section>
          <section className="studio-panel">
            <h2>处理后的知识可检索、可追溯</h2>
            <p className="studio-help">
              系统会保留原文件、解析内容和来源位置。当前处理方案按知识库保存，新文件可以复用；已有文件通过明确的升级操作更新。
            </p>
            {detail ? (
              <>
                <div className="studio-divider" />
                <Tag>{detail.name}</Tag>
                <pre className="document-preview">{detail.content}</pre>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
      {step === 1 ? (
        <section className="studio-panel metadata-panel">
          <div className="studio-panel-heading">
            <span>
              <FileText size={16} />
              {detail?.name}
            </span>
            <Button
              disabled={pending}
              icon={<Plus size={14} />}
              onClick={() => setShowField(true)}
            >
              扩展字段
            </Button>
          </div>
          {!options.extractMetadata ? (
            <Alert
              type="info"
              title="本次未启用自动抽取，可填写元数据或返回重新抽取。"
            />
          ) : null}
          <Table
            rowKey="id"
            pagination={false}
            dataSource={config.fields}
            columns={[
              {
                title: "启用",
                width: 65,
                render: (_, f: Field) => (
                  <Checkbox
                    checked={f.enabled}
                    disabled={pending}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        fields: c.fields.map((x) =>
                          x.id === f.id
                            ? { ...x, enabled: e.target.checked }
                            : x,
                        ),
                      }))
                    }
                  />
                ),
              },
              { title: "字段", dataIndex: "name", width: 125 },
              { title: "类型", dataIndex: "type", width: 100 },
              {
                title: "提取结果（可修正）",
                render: (_, f: Field) => (
                  <Input.TextArea
                    aria-label={`元数据-${f.name}`}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    disabled={pending || !f.enabled}
                    placeholder="未识别，可人工补充"
                    value={values[f.id] || ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.id]: e.target.value }))
                    }
                  />
                ),
              },
              {
                title: "依据",
                width: 185,
                render: (_, f: Field) => {
                  const value = detail?.metadata[f.id];
                  return (
                    <div>
                      <Tag
                        color={
                          value?.manual
                            ? "gold"
                            : value?.source === "generated"
                              ? "blue"
                              : value?.value
                                ? "blue"
                                : "default"
                        }
                      >
                        {value?.manual
                          ? "人工修正"
                          : value?.source === "generated"
                            ? "模型生成"
                            : value?.value
                              ? "事实抽取"
                              : "未识别"}
                      </Tag>
                      <Button
                        type="link"
                        size="small"
                        onClick={() =>
                          setSource(value || { value: null, source: "missing" })
                        }
                      >
                        查看依据
                      </Button>
                    </div>
                  );
                },
              },
            ]}
          />
          <Button
            type="primary"
            disabled={pending}
            className="studio-gap"
            onClick={saveMetadata}
          >
            保存修正，进入切分
          </Button>
        </section>
      ) : null}
      {step === 2 ? (
        <div className="import-chunk-layout">
          <section className="studio-panel chunk-settings">
            <h2>切分策略</h2>
            <Radio.Group
              className="chunk-method-grid studio-gap"
              disabled={pending || options.strategy === "qa"}
              value={
                options.strategy === "custom"
                  ? options.boundary
                  : options.strategy
              }
              onChange={(e) => {
                const method = e.target.value;
                patch({
                  strategy: ["smart"].includes(method) ? method : "custom",
                  ...(!["smart"].includes(method) ? { boundary: method } : {}),
                });
              }}
            >
              {[
                [
                  "smart",
                  "智能切分",
                  "结合段落结构、表格和语义相关性确定边界，适合通用资料。",
                ],
                [
                  "length",
                  "按长度切分",
                  "按字符或 Token 控制长度，适合上下文受限的场景。",
                ],
                ["page", "按页切分", "按 PDF 真实页码隔离内容，长页继续细分。"],
                [
                  "heading",
                  "按标题切分",
                  "按所选标题层级划分章节，章节之间不混合。",
                ],
                [
                  "regex",
                  "按正则切分",
                  "通过正则表达式识别分隔位置，适合规则文档。",
                ],
                [
                  "delimiter",
                  "按符号切分",
                  "按一个或多个明确分隔符切分，无需编写正则。",
                ],
              ].map(([value, label, description]) => (
                <Radio key={value} value={value}>
                  <strong>{label}</strong>
                  {value === "smart" ? <Tag color="blue">推荐</Tag> : null}
                  <p>{description}</p>
                </Radio>
              ))}
            </Radio.Group>
            <Form layout="vertical">
              <Form.Item label="长度单位">
                <Select
                  disabled={pending}
                  value={options.lengthUnit}
                  options={[
                    { value: "characters", label: "字符" },
                    { value: "tokens", label: "Token（通用分词器）" },
                  ]}
                  onChange={(lengthUnit) => patch({ lengthUnit })}
                />
                {options.lengthUnit === "tokens" ? (
                  <p className="studio-help">
                    使用离线 cl100k_base
                    分词器控制切片长度；服务商实际计费以其用量为准。
                  </p>
                ) : null}
              </Form.Item>
              <Form.Item
                label={`最大分段长度（${options.lengthUnit === "tokens" ? "Token" : "字符"}）`}
              >
                <div className="chunk-length-control">
                  <Slider
                    min={10}
                    max={6000}
                    disabled={pending}
                    value={options.chunkSize}
                    onChange={(chunkSize) =>
                      patch({
                        chunkSize,
                        overlap: Math.min(options.overlap, chunkSize - 1),
                        parentSize: Math.max(options.parentSize, chunkSize),
                      })
                    }
                  />
                  <InputNumber
                    min={10}
                    max={6000}
                    disabled={pending}
                    value={options.chunkSize}
                    onChange={(v) => {
                      if (v)
                        patch({
                          chunkSize: v,
                          overlap: Math.min(options.overlap, v - 1),
                          parentSize: Math.max(options.parentSize, v),
                        });
                    }}
                  />
                </div>
              </Form.Item>
              <Form.Item label="重叠长度（同一分段内）">
                <InputNumber
                  min={0}
                  max={Math.min(1000, options.chunkSize - 1)}
                  disabled={pending}
                  value={options.overlap}
                  onChange={(v) => patch({ overlap: v ?? 0 })}
                />
                <p className="studio-help">
                  重叠与父片段均不会跨越所选的页、章节或分隔符边界。
                </p>
              </Form.Item>
              {options.strategy === "custom" && options.boundary === "page" ? (
                <Alert
                  className="studio-gap"
                  type="info"
                  showIcon
                  title="仅适用于有真实页码的解析结果"
                  description="PDF 保留原始页码。Word、Markdown 没有固定页码时，请选按标题或智能切分。"
                />
              ) : null}
              {options.strategy === "custom" &&
              options.boundary === "heading" ? (
                <Form.Item label="标题层级">
                  <Select
                    disabled={pending}
                    value={options.headingLevel}
                    options={[1, 2, 3, 4, 5, 6].map((value) => ({
                      value,
                      label: `按 ${value} 级及以上标题切分`,
                    }))}
                    onChange={(headingLevel) => patch({ headingLevel })}
                  />
                  <p className="studio-help">
                    支持 Markdown # 标题与 Word
                    标题样式；较低级标题随所属章节保留。
                  </p>
                </Form.Item>
              ) : null}
              {options.strategy === "custom" && options.boundary === "regex" ? (
                <Form.Item label="正则表达式">
                  <Input
                    disabled={pending}
                    value={options.separator}
                    onChange={(e) => patch({ separator: e.target.value })}
                    placeholder="例如：第[一二三四五六七八九十]+章"
                  />
                  <p className="studio-help">
                    按匹配位置切分，支持多行标记
                    (?m)。表达式设有超时与空匹配保护。
                  </p>
                </Form.Item>
              ) : null}
              {options.strategy === "custom" &&
              options.boundary === "delimiter" ? (
                <Form.Item label="分隔符（可多选或输入）">
                  <Select
                    mode="tags"
                    disabled={pending}
                    value={options.delimiters.map((value) =>
                      value.replace(/\n/g, "\\n").replace(/\t/g, "\\t"),
                    )}
                    options={[
                      { value: "\\n\\n", label: "空行 \\n\\n" },
                      { value: "\\n", label: "换行 \\n" },
                      { value: "---", label: "分隔线 ---" },
                      { value: "。", label: "句号 。" },
                      { value: "；", label: "分号 ；" },
                    ]}
                    onChange={(values) =>
                      patch({
                        delimiters: values.map((value) =>
                          value.replace(/\\n/g, "\n").replace(/\\t/g, "\t"),
                        ),
                      })
                    }
                  />
                  <p className="studio-help">
                    输入后按回车添加。支持 \\n 换行、\\t
                    制表符；多个符号按任意一个命中切分，优先匹配较长符号。
                  </p>
                </Form.Item>
              ) : null}
              {options.strategy === "custom" &&
              ["regex", "delimiter", "paragraph"].includes(options.boundary) ? (
                <Form.Item label="分隔标记保留方式">
                  <Select
                    disabled={pending}
                    value={options.delimiterPosition}
                    options={[
                      { value: "start", label: "保留在下一片段开头" },
                      { value: "end", label: "保留在上一片段结尾" },
                      { value: "remove", label: "移除分隔标记" },
                    ]}
                    onChange={(delimiterPosition) =>
                      patch({ delimiterPosition })
                    }
                  />
                </Form.Item>
              ) : null}
              <div className="studio-setting">
                <div>
                  <strong>表格表头拼装</strong>
                  <p>
                    智能切分时，将表头附到各行组，帮助理解 Excel、CSV
                    与文档表格。
                  </p>
                </div>
                <Switch
                  disabled={pending || options.strategy !== "smart"}
                  checked={options.tableHeader}
                  onChange={(tableHeader) => patch({ tableHeader })}
                />
              </div>
              {options.strategy === "smart" ? (
                <Form.Item label="语义合并阈值">
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={pending}
                    value={options.semanticThreshold}
                    onChange={(v) => patch({ semanticThreshold: v ?? 0.65 })}
                  />
                </Form.Item>
              ) : null}
              <details className="studio-gap">
                <summary>高级设置：内容组织方式</summary>
                <Form.Item label="内容组织" className="studio-gap">
                  <Select
                    disabled={pending}
                    value={options.strategy === "qa" ? "qa" : "document"}
                    options={[
                      {
                        value: "document",
                        label: "通用文档（使用所选切分方式）",
                      },
                      { value: "qa", label: "问答对（每组问答单独组织）" },
                    ]}
                    onChange={(value) =>
                      patch({ strategy: value === "qa" ? "qa" : "smart" })
                    }
                  />
                  <p className="studio-help">
                    问答对按完整问答组织内容，不与六种切分方式叠加。
                  </p>
                </Form.Item>
                {options.strategy === "qa" ? (
                  <Form.Item label="问答对来源">
                    <Select
                      disabled={pending}
                      value={options.questionMode}
                      onChange={(questionMode) => patch({ questionMode })}
                      options={[
                        {
                          value: "extract",
                          label: "模型提取，答案必须有原文依据",
                        },
                        {
                          value: "existing",
                          label: "读取已有 Q/A 或问/答格式",
                        },
                      ]}
                    />
                  </Form.Item>
                ) : null}
              </details>
              <div className="studio-setting">
                <div>
                  <strong>父子检索（独立开关）</strong>
                  <p>用小片段召回，补充较大上下文；可与标题等切分方式搭配。</p>
                </div>
                <Switch
                  disabled={pending}
                  checked={options.parent}
                  onChange={(parent) => patch({ parent })}
                />
              </div>
              {options.parent ? (
                <Form.Item label="父片段最大长度">
                  <InputNumber
                    min={options.chunkSize}
                    max={12000}
                    disabled={pending}
                    value={options.parentSize}
                    onChange={(v) => patch({ parentSize: v || 2400 })}
                  />
                </Form.Item>
              ) : null}
            </Form>
            <Button
              block
              type="primary"
              loading={pending}
              icon={<Scissors size={15} />}
              onClick={makePreview}
            >
              生成 / 更新真实预览
            </Button>
            <p className="studio-help">
              智能切分中的语义判断调用 Embedding；问答对提取调用
              LLM。相同配置可复用已保存结果。
            </p>
          </section>
          <section className="studio-panel studio-chunk-preview">
            <div className="studio-panel-heading">
              <span>
                真实切分预览 <Tag>{preview.total} 个片段</Tag>
              </span>
              <Tag>
                {JSON.stringify(options) === previewOptions
                  ? "当前方案"
                  : "请更新预览"}
              </Tag>
            </div>
            <div className="chunk-preview-body">
              <div className="chunk-preview-list">
                {preview.items.map((item, i) => (
                  <button
                    key={i}
                    className={selected === i ? "active" : ""}
                    onClick={() => setSelected(i)}
                  >
                    <strong>
                      {i + 1}. {item.metadata.location}
                    </strong>
                    <small>
                      {item.metadata.length ?? item.text.length}{" "}
                      {item.metadata.lengthUnit === "tokens" ? "Token" : "字符"}
                      {item.metadata.lengthWarning ? " · 长度提示" : ""}
                    </small>
                  </button>
                ))}
              </div>
              <div className="chunk-preview-content">
                {active ? (
                  <>
                    <Tag>{active.metadata.location}</Tag>
                    <pre>{active.text}</pre>
                    {active.metadata.lengthWarning ? (
                      <Alert
                        type="warning"
                        showIcon
                        title={active.metadata.lengthWarning}
                      />
                    ) : null}
                    {active.metadata.tablePreserved ? (
                      <Tag color="blue">
                        {active.metadata.tableHeaderRepeated === false
                          ? "表格按行组保留"
                          : "表头随行组保留"}
                      </Tag>
                    ) : null}
                    {active.metadata.parentText ? (
                      <details className="studio-gap">
                        <summary>查看父片段上下文</summary>
                        <pre>{active.metadata.parentText}</pre>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="studio-help">配置切分策略后点击生成预览。</p>
                )}
              </div>
            </div>
            {preview.total > preview.items.length ? (
              <Button
                onClick={() =>
                  guarded(async () => {
                    const next = await api<Preview>(
                      `/files/${fileId}/preview?offset=${preview.items.length}`,
                    );
                    setPreview((p) => ({
                      ...p,
                      items: [...p.items, ...next.items],
                    }));
                  })
                }
              >
                加载更多片段
              </Button>
            ) : null}
          </section>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="studio-two-column">
          <section className="studio-panel">
            <h2>确认版本关系</h2>
            {!groupFileId && detail?.version.suggestedGroupFileId ? (
              <Alert
                className="studio-gap"
                type="info"
                title="发现标题相同的已有文档，可确认为同一文档的不同版本。"
                action={
                  <Button
                    disabled={pending || built}
                    onClick={() =>
                      setGroupFileId(
                        detail.version.suggestedGroupFileId || null,
                      )
                    }
                  >
                    采用关联建议
                  </Button>
                }
              />
            ) : null}
            <Form layout="vertical" className="studio-gap">
              <Form.Item label="关联已有文档组">
                <Select
                  allowClear
                  disabled={pending || built}
                  value={groupFileId || undefined}
                  placeholder="作为独立新文档"
                  options={versions
                    .filter((v) => v.id !== fileId)
                    .map((v) => ({
                      value: v.id,
                      label: `${v.title} · ${v.label || "未标版本"}${v.current ? " · 当前有效" : ""}`,
                    }))}
                  onChange={(id) => setGroupFileId(id || null)}
                />
              </Form.Item>
              <Form.Item label="本次版本号">
                <Input
                  disabled={pending || built}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="原文未标注时可留空"
                />
              </Form.Item>
              <Form.Item label="生效日期">
                <Input
                  type="date"
                  disabled={pending || built}
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </Form.Item>
              <Form.Item label="失效日期（可选）">
                <Input
                  type="date"
                  disabled={pending || built}
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </Form.Item>
            </Form>
            <Alert
              type="info"
              showIcon
              title="默认仅检索当前有效版本"
              description="未来生效的版本暂不参与默认检索；新索引构建成功后才加入版本选择，原版本保留。"
            />
            <div className="studio-gap">
              <h3>已有版本</h3>
              {versions
                .filter((v) => v.id !== fileId)
                .map((v) => (
                  <p className="studio-help" key={v.id}>
                    {v.name} · {v.label || "未标版本"}{" "}
                    <Tag color={v.current ? "green" : "default"}>
                      {v.current ? "当前有效" : "历史 / 未生效"}
                    </Tag>
                  </p>
                ))}
            </div>
          </section>
          <section className="studio-panel build-review">
            <h2>构建前确认</h2>
            <dl>
              <dt>文档</dt>
              <dd>{detail?.name}</dd>
              <dt>元数据</dt>
              <dd>{Object.keys(detail?.metadata || {}).length} 个已保存字段</dd>
              <dt>切分</dt>
              <dd>
                {options.strategy} · {preview.total} 个片段
              </dd>
              <dt>索引模型</dt>
              <dd>
                {
                  state.models.find(
                    (m) =>
                      m.id ===
                      state.knowledge.find((k) => k.id === kbId)?.embedding,
                  )?.model
                }
              </dd>
              <dt>生效切换</dt>
              <dd>构建成功后切换，失败保留旧索引</dd>
            </dl>
            {built ? (
              <Alert
                type="success"
                showIcon
                title="知识构建成功"
                description="已生成真实向量及辅助问题索引，可以进入在线对话或应用中心使用。"
              />
            ) : (
              <Button
                type="primary"
                size="large"
                block
                loading={pending}
                onClick={build}
              >
                确认版本并构建知识
              </Button>
            )}
            {built ? (
              <Button
                className="studio-gap"
                type="primary"
                onClick={() => navigate(`/chat?kb=${kbId}`)}
              >
                使用此知识库问答
              </Button>
            ) : null}
          </section>
        </div>
      ) : null}
      <div className="studio-step-footer">
        <Button
          disabled={step === 0 || pending}
          icon={<ArrowLeft size={15} />}
          onClick={() => setStep((s) => s - 1)}
        >
          上一步
        </Button>
        <span>{step + 1} / 4 · 配置与处理结果保存在服务端</span>
        {step === 2 ? (
          <Button
            type="primary"
            disabled={
              pending ||
              !preview.total ||
              JSON.stringify(options) !== previewOptions
            }
            onClick={() => setStep(3)}
          >
            确认切分，选择版本
            <ArrowRight size={15} />
          </Button>
        ) : null}
      </div>
      <Drawer
        title="来源依据与修正记录"
        open={!!source}
        onClose={() => setSource(null)}
        width={500}
      >
        {source ? (
          <>
            <Tag>
              {source.source === "manual"
                ? "人工修正"
                : source.source === "generated"
                  ? "模型生成"
                  : source.source === "missing"
                    ? "未识别"
                    : "事实抽取"}
            </Tag>
            <p className="studio-help">{source.location || "未提供原文位置"}</p>
            <pre className="document-preview">
              {source.quote ||
                "此字段没有逐字原文依据；生成内容与人工补充不会标记为原文事实。"}
            </pre>
          </>
        ) : null}
      </Drawer>
      <Modal
        title="扩展知识库字段"
        open={showField}
        onCancel={() => setShowField(false)}
        okText="添加字段"
        onOk={() => {
          if (
            !fieldName.trim() ||
            config.fields.some((f) => f.name === fieldName.trim())
          ) {
            message.warning("请输入不重复的字段名称");
            return;
          }
          setConfig((c) => ({
            ...c,
            fields: [
              ...c.fields,
              {
                id:
                  "custom_" +
                  crypto.randomUUID().replaceAll("-", "").slice(0, 20),
                name: fieldName.trim(),
                type: fieldType,
                description: fieldDesc,
                enabled: true,
                generated: false,
              },
            ],
          }));
          setShowField(false);
          setFieldName("");
          setFieldDesc("");
        }}
      >
        <Form layout="vertical">
          <Form.Item label="字段名称">
            <Input
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
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
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
