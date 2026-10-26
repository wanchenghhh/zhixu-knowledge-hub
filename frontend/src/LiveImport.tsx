import { useEffect, useState } from "react";
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
import { CloudUpload, FileText } from "lucide-react";
import { write, uploadKnowledgeFile } from "./api";
import { useStore } from "./store";
import { validateFile } from "./domain";
import type { KnowledgeFile, Task } from "./data";
import { Status } from "./components";
export default function LiveImport({
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
  const { state, refresh } = useStore();
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<File[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState("auto");
  const [size, setSize] = useState(800);
  const [overlap, setOverlap] = useState(100);
  const [taskId, setTaskId] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const files = ids
    .map((id) => state.files.find((f) => f.id === id))
    .filter((f): f is KnowledgeFile => !!f);
  const parsing =
    ids.length > files.length ||
    files.some((f) => ["queued", "parsing"].includes(f.status));
  const task = state.tasks.find((t) => t.id === taskId);
  useEffect(() => {
    if (open) {
      setStep(0);
      setSelected([]);
      setIds([]);
      setConsent(false);
      setTaskId("");
      setPreviewIndex(0);
    }
  }, [open]);
  const parse = async () => {
    if (!consent) {
      message.warning("请确认解析调用提示");
      return;
    }
    if (overlap >= size) {
      message.error("重叠长度必须小于分块长度");
      return;
    }
    setBusy(true);
    const uploaded: string[] = [];
    try {
      for (const file of selected) {
        const result = await uploadKnowledgeFile(
          kbId,
          file,
          { parseMode: mode, chunkSize: size, overlap },
          state.runtime?.uploadStrategy,
        );
        uploaded.push(result.file.id);
        setIds([...uploaded]);
      }
      await refresh();
      setStep(2);
    } catch (error) {
      message.error(String(error));
      if (uploaded.length) {
        await refresh();
        setStep(2);
      }
    } finally {
      setBusy(false);
    }
  };
  const build = async () => {
    setBusy(true);
    try {
      const fileIds = files
        .filter((f) => f.status === "preview")
        .map((f) => f.id);
      const result = await write<Task>(`/knowledge/${kbId}/build`, { fileIds });
      setTaskId(result.id);
      await refresh();
      setStep(3);
    } catch (error) {
      message.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  const current = files[previewIndex];
  return (
    <Modal
      title="导入知识"
      open={open}
      onCancel={onClose}
      width={940}
      closable={!busy}
      mask={{ closable: !busy }}
      footer={
        <div className="wizard-footer">
          <span>真实文件处理 · 任务与进度保存在服务端</span>
          <div>
            <Button onClick={onClose} disabled={busy}>
              关闭
            </Button>
            {step === 0 ? (
              <Button
                type="primary"
                disabled={!selected.length}
                onClick={() => setStep(1)}
              >
                设置解析方式
              </Button>
            ) : step === 1 ? (
              <>
                <Button disabled={busy} onClick={() => setStep(0)}>
                  上一步
                </Button>
                <Button
                  type="primary"
                  loading={busy}
                  disabled={!consent}
                  onClick={parse}
                >
                  开始解析并预览
                </Button>
              </>
            ) : step === 2 ? (
              <Button
                type="primary"
                disabled={parsing || !files.some((f) => f.status === "preview")}
                loading={busy}
                onClick={build}
              >
                确认并构建索引
              </Button>
            ) : (
              <Button
                type="primary"
                disabled={task?.status !== "success"}
                onClick={() => {
                  onClose();
                  onChat();
                }}
              >
                开始对话
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Steps
        current={step}
        className="import-steps"
        items={["选择文件", "解析与分块", "预览确认", "构建结果"].map(
          (title) => ({ title }),
        )}
      />
      <div className="wizard-body">
        {step === 0 ? (
          <>
            <Upload.Dragger
              multiple
              accept=".pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={(file) => {
                const error = validateFile(file.name, file.size);
                if (error) {
                  message.error(error);
                  return Upload.LIST_IGNORE;
                }
                setSelected((s) =>
                  s.some((f) => f.name === file.name) ? s : [...s, file],
                );
                return Upload.LIST_IGNORE;
              }}
            >
              <CloudUpload size={36} />
              <h3>选择或拖入需要构建的资料</h3>
              <p>
                支持 Word、PDF、Markdown、图片、Excel / CSV，单文件不超过 20
                MB。
              </p>
            </Upload.Dragger>
            <div className="sample-hint">
              <span>从真实 Markdown 示例开始验证完整链路。</span>
              <Button
                onClick={() =>
                  setSelected((s) => [
                    ...s.filter((f) => f.name !== "差旅报销示例.md"),
                    new File(
                      [
                        "# 差旅报销\n差旅报销需在出差结束后 15 个工作日内提交，附合规发票和支付凭证。\n一线城市住宿标准为每晚 500 元，其他城市 350 元。",
                      ],
                      "差旅报销示例.md",
                      { type: "text/markdown" },
                    ),
                  ])
                }
              >
                使用 Markdown 示例
              </Button>
            </div>
            {selected.map((f) => (
              <div className="activity-row" key={f.name}>
                <FileText size={16} />
                <span style={{ flex: 1 }}>{f.name}</span>
                <Button
                  type="text"
                  onClick={() => setSelected((s) => s.filter((x) => x !== f))}
                >
                  移除
                </Button>
              </div>
            ))}
          </>
        ) : step === 1 ? (
          <div className="parse-config">
            <h3>解析方式</h3>
            <Radio.Group
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: "auto", label: "自动识别" },
                { value: "enhanced", label: "云端增强解析" },
              ]}
            />
            <div className="form-two" style={{ marginTop: 25 }}>
              <label>
                分块长度（字符）
                <InputNumber
                  aria-label="分块长度"
                  min={100}
                  max={4000}
                  value={size}
                  onChange={(v) => setSize(v || 800)}
                />
              </label>
              <label>
                重叠长度（字符）
                <InputNumber
                  aria-label="重叠长度"
                  min={0}
                  max={1000}
                  value={overlap}
                  onChange={(v) => setOverlap(v ?? 100)}
                />
              </label>
            </div>
            <div className="soft-note">
              扫描件、含图片的 PDF、Word 插图和单独图片会使用云端 OCR；PDF /
              Word 增强解析也会调用云端服务。请先在模型服务中配置
              DocMind。Markdown 和表格文件使用本地规则解析。
            </div>
            <Checkbox
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            >
              确认开始解析；涉及云端解析时将按服务商规则计费。
            </Checkbox>
          </div>
        ) : step === 2 ? (
          <>
            <div className="preview-summary">
              {parsing
                ? "正在解析，完成后可预览并确认构建"
                : "解析完成，请核对内容与来源位置后再构建"}
            </div>
            <div className="preview-layout">
              <div className="preview-file-list">
                {files.map((f, i) => (
                  <button
                    key={f.id}
                    onClick={() => setPreviewIndex(i)}
                    className={previewIndex === i ? "selected" : ""}
                  >
                    <span>
                      {f.name}
                      <small>
                        <Status status={f.status} />
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="chunk-preview">
                <h3>{current?.name || "正在准备文件…"}</h3>
                {current?.error ? (
                  <div className="soft-note warning">{current.error}</div>
                ) : null}
                {current?.preview?.map((b, i) => (
                  <article key={i}>
                    <Tag>{b.location}</Tag>
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        lineHeight: 2,
                        margin: "12px 0 22px",
                      }}
                    >
                      {b.text}
                    </p>
                  </article>
                ))}
              </div>
            </div>
            <p className="field-help">
              确认构建将调用知识库绑定的向量模型。解析失败的文件可在任务中心重试。
            </p>
          </>
        ) : (
          <>
            <Result
              status={
                task?.status === "success"
                  ? "success"
                  : task?.status === "failed"
                    ? "warning"
                    : "info"
              }
              title={
                task?.status === "success"
                  ? "知识已就绪"
                  : task?.status === "failed"
                    ? "部分文件未完成，请检查错误"
                    : "正在构建知识索引"
              }
              subTitle={task?.error || task?.stage || "排队中"}
            />
            <Progress
              percent={
                task
                  ? Math.round((task.finished / Math.max(1, task.total)) * 100)
                  : 0
              }
            />
            {files.map((f) => (
              <div className="activity-row" key={f.id}>
                <span style={{ flex: 1 }}>{f.name}</span>
                <Status status={f.status} />
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
