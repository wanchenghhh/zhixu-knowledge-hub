import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Result,
  Steps,
  Tag,
  Upload,
} from "antd";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CloudUpload,
  FileText,
  FlaskConical,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useStore } from "./store";
import type { KnowledgeFile } from "./data";
import { fileType, nowLabel, readableSize, uid, validateFile } from "./domain";
import { FileBadge } from "./components";
import LiveImport from "./LiveImport";
interface Pending {
  id: string;
  name: string;
  size: string;
  type: string;
  content: string;
  localText: boolean;
}
const sampleContent =
  "差旅报销应在出差结束后 15 个工作日内提交。\n\n报销材料包括出差申请单、行程单、合规发票及支付凭证。住宿标准：一线城市每晚不超过 500 元，其他城市每晚不超过 350 元。超标部分需补充审批说明。";
export default function ImportWizard({
  kbId,
  open,
  onClose,
  onChat,
}: {
  kbId: string;
  open: boolean;
  onClose: () => void;
  onChat: () => void;
}) {
  const { live } = useStore();
  return live ? (
    <LiveImport kbId={kbId} open={open} onClose={onClose} onChat={onChat} />
  ) : (
    <DemoImport kbId={kbId} open={open} onClose={onClose} onChat={onChat} />
  );
}
function DemoImport({
  kbId,
  open,
  onClose,
  onChat,
}: {
  kbId: string;
  open: boolean;
  onClose: () => void;
  onChat: () => void;
}) {
  const { state, setState } = useStore();
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<Pending[]>([]);
  const [parse, setParse] = useState("auto");
  const [chunkSize, setChunkSize] = useState(800);
  const [overlap, setOverlap] = useState(100);
  const [fail, setFail] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState(0);
  const [reading, setReading] = useState(0);
  const committed = useRef(false);
  const kb = state.knowledge.find((k) => k.id === kbId);
  const missingModel = !state.models.some(
    (m) => m.id === kb?.embedding && m.status === "ready",
  );
  useEffect(() => {
    if (open) {
      setStep(0);
      setFiles([]);
      setProgress(0);
      setDone(false);
      setFail(false);
      setSelected(0);
      committed.current = false;
    }
  }, [open]);
  useEffect(() => {
    if (step !== 3 || done || !open) return;
    const t = setTimeout(() => setProgress((p) => Math.min(100, p + 20)), 340);
    if (progress === 100 && !committed.current) {
      clearTimeout(t);
      committed.current = true;
      const created: KnowledgeFile[] = files.map((f, i) => ({
        id: f.id,
        kbId,
        name: f.name,
        size: f.size,
        type: f.type,
        status: fail && i === files.length - 1 ? "failed" : "ready",
        content: f.content,
        location:
          f.type === "PDF"
            ? "第 1 页"
            : f.type === "WORD"
              ? "示例章节 · 第 1 段"
              : f.type === "EXCEL"
                ? "Sheet1 · 第 2–8 行"
                : f.type === "IMAGE"
                  ? "图片 · 识别区域 1"
                  : "文档开头 · 第 1–10 行",
        updated: nowLabel(),
        error:
          fail && i === files.length - 1
            ? "模拟 OCR 请求超时，可在任务中心重试"
            : undefined,
      }));
      setState((s) => ({
        ...s,
        files: [...created, ...s.files],
        knowledge: s.knowledge.map((k) =>
          k.id === kbId ? { ...k, updated: nowLabel() } : k,
        ),
        tasks: [
          {
            id: uid(),
            kbId,
            name: `${kb?.name} · 文件导入`,
            status: fail ? "failed" : "success",
            total: files.length,
            finished: files.length - (fail ? 1 : 0),
            date: nowLabel(),
            error: fail ? "模拟解析超时，1 个文件未完成" : undefined,
            fileIds: created.map((f) => f.id),
          },
          ...s.tasks,
        ],
      }));
      setDone(true);
    }
    return () => clearTimeout(t);
  }, [step, progress, done, open, files, fail, kbId, kb?.name, setState]);
  const addSamples = () => {
    const samples = [
      {
        id: uid(),
        name: "差旅报销补充说明.md",
        size: "12 KB",
        type: "MD",
        content: sampleContent,
        localText: false,
      },
      {
        id: uid(),
        name: "办公流程说明.pdf",
        size: "1.6 MB",
        type: "PDF",
        content:
          "办公设备申请需在办公系统提交，注明设备用途和需求时间，经直属负责人审批后由行政统一配发。涉及软件采购时，还需完成信息安全审核。",
        localText: false,
      },
      {
        id: uid(),
        name: "费用标准表.xlsx",
        size: "96 KB",
        type: "EXCEL",
        content:
          "费用类型 | 一线城市 | 其他城市\n住宿费用 | 500 元/晚 | 350 元/晚\n市内交通 | 凭票报销 | 凭票报销\n餐饮补助 | 80 元/日 | 60 元/日",
        localText: false,
      },
    ];
    setFiles((prev) => [
      ...prev,
      ...samples.filter(
        (x) =>
          !prev.some((f) => f.name === x.name) &&
          !state.files.some((f) => f.kbId === kbId && f.name === x.name),
      ),
    ]);
    message.success("已添加可体验的示例资料");
  };
  const localUpload = async (file: File) => {
    const error = validateFile(file.name, file.size);
    if (error) {
      message.error(`${file.name}：${error}`);
      return Upload.LIST_IGNORE;
    }
    setReading((n) => n + 1);
    try {
      const isText = /\.(md|csv)$/i.test(file.name);
      const content = isText
        ? (await file.text()).slice(0, 16000)
        : `【${file.name} 的模拟解析结果】\n\n${sampleContent}\n\n二进制文件将在后端接入后真实解析；此处仅用于确认预览与构建交互。`;
      setFiles((prev) =>
        prev.some((f) => f.name === file.name)
          ? prev
          : [
              ...prev,
              {
                id: uid(),
                name: file.name,
                size: readableSize(file.size),
                type: fileType(file.name),
                content,
                localText: isText,
              },
            ],
      );
    } catch {
      message.error("无法读取文件，请重试");
    } finally {
      setReading((n) => n - 1);
    }
    return Upload.LIST_IGNORE;
  };
  const current = files[selected] || files[0];
  return (
    <Modal
      className="import-modal"
      title={
        <>
          <span className="modal-breadcrumb">
            {kb?.name}
            <ChevronRight size={14} />
          </span>
          <span className="inline-icon">
            <CloudUpload size={21} />
            导入知识
          </span>
        </>
      }
      open={open}
      onCancel={onClose}
      closable={step !== 3 || done}
      mask={{ closable: step !== 3 || done }}
      width={960}
      destroyOnHidden
      footer={
        step === 3 ? (
          <div className="wizard-footer">
            <span>演示构建 · 未调用模型 API</span>
            <div>
              <Button onClick={onClose} disabled={!done}>
                返回文件列表
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  onClose();
                  onChat();
                }}
                disabled={!done || files.length - (fail ? 1 : 0) === 0}
              >
                去对话 <ArrowRight size={15} />
              </Button>
            </div>
          </div>
        ) : (
          <div className="wizard-footer">
            <span>
              <FlaskConical size={14} />
              原型仅模拟解析与构建，文件不会上传
            </span>
            <div>
              {step > 0 ? (
                <Button
                  icon={<ArrowLeft size={14} />}
                  onClick={() => setStep((s) => s - 1)}
                >
                  上一步
                </Button>
              ) : (
                <Button onClick={onClose}>取消</Button>
              )}
              <Button
                type="primary"
                disabled={
                  !files.length || reading > 0 || (step === 2 && missingModel)
                }
                onClick={() => {
                  if (
                    step === 1 &&
                    !state.ocr.enabled &&
                    (parse === "enhanced" ||
                      files.some((f) =>
                        ["PDF", "IMAGE", "WORD"].includes(f.type),
                      ))
                  ) {
                    message.error(
                      "云端解析已停用，请先由管理员在模型服务中启用",
                    );
                    return;
                  }
                  if (step === 1 && overlap >= chunkSize) {
                    message.error("重叠长度必须小于分块长度");
                    return;
                  }
                  setStep((s) => s + 1);
                }}
              >
                {step === 0
                  ? "设置解析方式"
                  : step === 1
                    ? "预览知识片段"
                    : "确认并开始构建"}
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )
      }
    >
      <Steps
        className="import-steps"
        current={step}
        items={["选择文件", "解析与分块", "预览确认", "构建结果"].map(
          (title) => ({ title }),
        )}
      />
      {step === 0 ? (
        <div className="wizard-body">
          <Upload.Dragger
            className="upload-area"
            multiple
            accept=".pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.xls,.xlsx,.csv"
            showUploadList={false}
            beforeUpload={localUpload}
          >
            <span className="upload-illustration">
              <CloudUpload size={37} strokeWidth={1.4} />
            </span>
            <h3>
              拖拽文件到这里，或 <span>点击选择文件</span>
            </h3>
            <p>支持 Word、PDF、Markdown、图片和 Excel / CSV</p>
            <small>单个文件不超过 20 MB · 支持批量选择</small>
          </Upload.Dragger>
          <div className="sample-hint">
            <Sparkles size={17} />
            <span>还没有准备资料？先用示例走通完整流程。</span>
            <Button size="small" onClick={addSamples}>
              使用示例资料
            </Button>
          </div>
          <div className="selected-files-title">
            待导入文件 <Tag>{files.length}</Tag>
            {reading > 0 ? <span>正在读取文件…</span> : null}
          </div>
          {files.length ? (
            <div className="pending-list">
              {files.map((f) => (
                <div key={f.id}>
                  <FileBadge type={f.type} />
                  <span>
                    {f.name}
                    <small>
                      {f.size}
                      {f.localText ? " · 可预览本地文本" : " · 模拟解析预览"}
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`移除 ${f.name}`}
                    onClick={() =>
                      setFiles((p) => p.filter((x) => x.id !== f.id))
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="pending-placeholder">
              文件将在这里展示，可在构建前移除。
            </div>
          )}
        </div>
      ) : step === 1 ? (
        <div className="wizard-body parse-config">
          <div className="section-label">
            <span>01</span>
            <h3>文件解析方式</h3>
          </div>
          <Radio.Group
            value={parse}
            onChange={(e) => setParse(e.target.value)}
            className="parse-options"
          >
            <Radio value="auto">
              <strong>
                自动识别 <Tag color="purple">推荐</Tag>
              </strong>
              <p>普通文档直接提取，扫描件与图片使用云端 OCR。</p>
            </Radio>
            <Radio value="enhanced">
              <strong>增强解析</strong>
              <p>使用云端解析处理复杂 PDF、混合版面与表格。</p>
            </Radio>
          </Radio.Group>
          <div className="section-label">
            <span>02</span>
            <h3>知识分块</h3>
          </div>
          <div className="form-two">
            <label>
              分块长度 <span className="text-muted">Tokens</span>
              <InputNumber
                aria-label="分块长度"
                min={100}
                max={4000}
                step={100}
                value={chunkSize}
                onChange={(v) => setChunkSize(v || 800)}
              />
            </label>
            <label>
              重叠长度 <span className="text-muted">Tokens</span>
              <InputNumber
                aria-label="重叠长度"
                min={0}
                max={1000}
                step={50}
                value={overlap}
                onChange={(v) => setOverlap(v ?? 100)}
              />
            </label>
          </div>
          <p className="field-help">
            保留标题与段落结构；表格按行组切分，并保留列标题和原始行号。
          </p>
          <div className="section-label">
            <span>03</span>
            <h3>构建模型</h3>
          </div>
          <div className="model-summary">
            <span className="purple icon-square">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>
                {state.models.find((m) => m.id === kb?.embedding)?.name ||
                  "尚未配置向量模型"}
              </strong>
              <small>
                绑定当前知识库 ·{" "}
                {state.models.find((m) => m.id === kb?.embedding)?.dimension ||
                  "—"}{" "}
                维
              </small>
            </div>
            <Tag color={missingModel ? "orange" : "green"}>
              {missingModel ? "需要配置" : "演示可用"}
            </Tag>
          </div>
          <div className="failure-demo">
            <Checkbox
              checked={fail}
              onChange={(e) => setFail(e.target.checked)}
            >
              模拟最后一个文件 OCR 超时
            </Checkbox>
            <small>用于体验部分失败与重试，不影响其他文件构建。</small>
          </div>
          <div className="soft-note">
            <AlertCircle size={17} />
            正式版在开始解析前提示云端调用。当前原型不产生费用。
          </div>
        </div>
      ) : step === 2 ? (
        <div className="wizard-body">
          <div className="preview-summary">
            <Check size={16} />
            {files.length} 份文件已准备好{" "}
            <span>请检查知识片段后再开始构建</span>
          </div>
          <div className="preview-layout">
            <div className="preview-file-list">
              {files.map((f, i) => (
                <button
                  className={selected === i ? "selected" : ""}
                  key={f.id}
                  onClick={() => setSelected(i)}
                >
                  <FileBadge type={f.type} />
                  <span>
                    {f.name}
                    <small>
                      {f.localText ? "本地文本预览" : "示例解析结果"}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="chunk-preview">
              <div>
                <Tag>片段预览</Tag>
                <span>
                  {current?.localText
                    ? "已读取本地文本 · 最多展示 16,000 字符"
                    : "模拟内容 · 非真实文件解析"}
                </span>
              </div>
              <h3>{current?.name}</h3>
              <p>{current?.content}</p>
              <footer>
                分块长度 {chunkSize} · 重叠 {overlap} ·{" "}
                {parse === "auto" ? "自动识别" : "增强解析"}
              </footer>
            </div>
          </div>
          {missingModel ? (
            <div className="soft-note warning">
              请先为知识库选择可用向量模型，再开始构建。
            </div>
          ) : null}
        </div>
      ) : (
        <div className="wizard-body build-result">
          {done ? (
            <Result
              status={fail ? "warning" : "success"}
              title={
                fail
                  ? "构建完成，部分文件需要处理"
                  : "知识已就绪，可以开始提问了"
              }
              subTitle={`${files.length - (fail ? 1 : 0)} / ${files.length} 份文件演示构建成功${fail ? "，失败文件可在任务中心单独重试。" : "，现在可以进入在线对话查看引用效果。"}`}
            />
          ) : (
            <>
              <div className="build-orbit">
                <DatabaseIcon />
              </div>
              <h2>
                {progress < 40
                  ? "正在解析资料"
                  : progress < 80
                    ? "正在生成向量"
                    : "正在建立索引"}
              </h2>
              <p>整理知识片段，保留原始资料的位置与结构</p>
              <Progress percent={progress} strokeColor="#7863e6" />
            </>
          )}
          <div className="build-file-results">
            {files.map((f, i) => (
              <div key={f.id}>
                <FileBadge type={f.type} />
                <span>{f.name}</span>
                {done ? (
                  <Tag
                    color={fail && i === files.length - 1 ? "orange" : "green"}
                  >
                    {fail && i === files.length - 1 ? "模拟超时" : "已就绪"}
                  </Tag>
                ) : (
                  <span className="text-muted">
                    {progress < 40
                      ? "解析中"
                      : progress < 80
                        ? "向量化中"
                        : "建立索引"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
function DatabaseIcon() {
  return <FileText size={34} strokeWidth={1.4} />;
}
