import { write, downloadOriginal } from "./api";
import type { ReactNode } from "react";
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Box,
  Check,
  ChevronRight,
  FileText,
  Folder,
  Image,
  Layers3,
  MessageSquare,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Knowledge, KnowledgeFile, Source } from "./data";
import { roles } from "./data";
import { useStore } from "./store";
import { nowLabel, uid, visibleKnowledge } from "./domain";
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const C =
    name === "people"
      ? Users
      : name === "box"
        ? Box
        : name === "chat"
          ? MessageSquare
          : name === "shield"
            ? ShieldCheck
            : name === "folder"
              ? Folder
              : Layers3;
  return <C size={size} strokeWidth={1.8} />;
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function FileBadge({ type }: { type: string }) {
  return (
    <span className={`file-badge ${type.toLowerCase()}`}>
      {type === "IMAGE" ? (
        <Image size={18} />
      ) : type === "MD" ? (
        <FileText size={18} />
      ) : (
        <span>
          {type === "WORD"
            ? "W"
            : type === "EXCEL"
              ? "X"
              : type === "PDF"
                ? "PDF"
                : type}
        </span>
      )}
    </span>
  );
}
export function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    ready: "已就绪",
    awaiting_outline: "待确认大纲",
    failed: "失败",
    disabled: "已停用",
    success: "已完成",
    running: "构建中",
    untested: "未测试",
    queued: "排队中",
    parsing: "解析中",
    preview: "待确认构建",
    indexing: "向量化中",
    uploading: "上传中",
    retried: "已重试",
    empty: "无依据",
    cancelled: "已停止",
  };
  return (
    <span className={`status ${status}`}>
      <span />
      {labels[status] || status}
    </span>
  );
}
export function KnowledgeMark({
  kb,
  small = false,
}: {
  kb: Knowledge;
  small?: boolean;
}) {
  return (
    <span className={`knowledge-mark ${kb.color}${small ? " small" : ""}`}>
      <Icon name={kb.icon} size={small ? 19 : 25} />
    </span>
  );
}
export function CountPill({ children }: { children: ReactNode }) {
  return <span className="count-pill">{children}</span>;
}
export function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-panel">
      <Empty
        image={
          <div className="empty-icon">
            <BookOpen size={34} />
          </div>
        }
        description={
          <>
            <h3>{title}</h3>
            <p>{description}</p>
          </>
        }
      />
      {action}
    </div>
  );
}
export function NewKnowledge({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { state, setState, live, refresh } = useStore();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const submit = async () => {
    const v = await form.validateFields().catch(() => undefined);
    if (!v) return;
    if (live) {
      try {
        const created = await write<Knowledge>("/knowledge", {
          ...v,
          rerankModel: state.models.find(
            (m) => m.type === "Rerank" && m.status === "ready",
          )?.id,
        });
        await refresh();
        form.resetFields();
        onClose();
        onCreated?.(created.id);
        message.success("知识库已创建");
      } catch (error) {
        message.error(String(error));
      }
      return;
    }
    const id = uid();
    setState((s) => ({
      ...s,
      knowledge: [
        {
          id,
          name: v.name.trim(),
          description:
            v.description?.trim() || "添加资料，开启团队的知识协作。",
          category: v.category,
          color: "blue",
          icon: "folder",
          visible: ["admin", "manager"],
          embedding: v.embedding,
          rerank: true,
          topK: 5,
          threshold: 0.45,
          prompt: "请根据知识库内容回答并标记来源；依据不足时明确说明。",
          updated: nowLabel(),
        },
        ...s.knowledge,
      ],
    }));
    form.resetFields();
    onClose();
    message.success("知识库已创建，接下来可以导入知识");
    onCreated?.(id);
  };
  return (
    <Modal
      title={
        <div className="modal-title-icon">
          <span className="purple icon-square">
            <Layers3 size={20} />
          </span>
          <div>
            新建知识库<small>为一个主题建立有序的知识空间</small>
          </div>
        </div>
      }
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="创建知识库"
      cancelText="取消"
      width={520}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          category: "通用知识",
          embedding: live
            ? state.models.find(
                (m) => m.type === "Embedding" && m.status === "ready",
              )?.id
            : "embed-qwen",
        }}
      >
        <Form.Item
          name="name"
          label="知识库名称"
          rules={[
            { required: true, whitespace: true, message: "请输入知识库名称" },
            { max: 30, message: "名称最多 30 个字" },
          ]}
        >
          <Input
            placeholder="例如：员工制度与人事"
            maxLength={30}
            showCount
            autoFocus
          />
        </Form.Item>
        <Form.Item name="description" label="知识库说明">
          <Input.TextArea
            placeholder="简单介绍这里有哪些资料，帮助团队找到需要的知识"
            rows={3}
            maxLength={160}
            showCount
          />
        </Form.Item>
        <div className="form-two">
          <Form.Item name="category" label="知识分类">
            <Select
              options={[
                "通用知识",
                "人力资源",
                "产品技术",
                "客户服务",
                "财务管理",
                "项目管理",
              ].map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item
            name="embedding"
            label="向量模型"
            rules={[{ required: true, message: "请选择向量模型" }]}
          >
            <Select
              options={state.models
                .filter((m) => m.type === "Embedding" && m.status === "ready")
                .map((m) => ({ value: m.id, label: m.name }))}
            />
          </Form.Item>
        </div>
        <div className="soft-note">
          <ShieldCheck size={17} />
          创建后默认对管理员和知识库管理人员可见，可在配置中开放给使用者。
        </div>
      </Form>
    </Modal>
  );
}
export function SourceDrawer({
  source,
  onClose,
}: {
  source: Source | null;
  onClose: () => void;
}) {
  const { state, live } = useStore();
  const { message } = App.useApp();
  const allowed =
    source &&
    visibleKnowledge(state.knowledge, state.role).some(
      (k) => k.id === source.kbId,
    );
  const file = source
    ? state.files.find(
        (f) =>
          f.id === source.fileId &&
          (f.status === "ready" || (live && state.role !== "user")),
      )
    : null;
  return (
    <Drawer title="查看引用来源" open={!!source} onClose={onClose} size={560}>
      {allowed && file && source ? (
        <>
          <div className="source-document-title">
            <FileBadge type={file.type} />
            <div>
              <h3>{source.name}</h3>
              <p>{source.location}</p>
            </div>
          </div>
          <div className="source-toolbar">
            <Tag color="blue">{live ? "来源原文" : "演示原文"}</Tag>
            <span>
              来自 {state.knowledge.find((k) => k.id === source.kbId)?.name}
            </span>
          </div>
          <article className="document-paper">
            <div className="paper-kicker">DOCUMENT PREVIEW</div>
            <h2>{source.name.replace(/\.[^.]+$/, "")}</h2>
            <p className="paper-location">{source.location}</p>
            <hr />
            <mark>{source.text}</mark>
            <div className="paper-footer">
              {live
                ? "以上为文档提取的正文与来源位置，可下载原文件核对。PDF 按页定位，Word 按段落或云端页码定位，表格按工作表与行定位。"
                : "这是原型的资料片段预览。真实 PDF 页码跳转与文件读取将在后端联调时接入。"}
            </div>
          </article>
          {live ? (
            <Button
              block
              onClick={() =>
                void downloadOriginal(source.fileId, source.name).catch(
                  (error) => message.error(String(error)),
                )
              }
            >
              下载原文件
            </Button>
          ) : null}
          <Button
            icon={<ArrowDownToLine size={15} />}
            onClick={() =>
              downloadText(
                `${source.name}-引用.txt`,
                `${source.name}\n${source.location}\n\n${source.text}`,
              )
            }
            block
          >
            下载引用片段（TXT）
          </Button>
        </>
      ) : (
        <Empty description="该文件已停用、删除或当前角色无权查看" />
      )}
    </Drawer>
  );
}
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
export function SourceButtons({
  sources,
  onSelect,
}: {
  sources: Source[];
  onSelect: (s: Source) => void;
}) {
  return (
    <div className="source-buttons">
      {sources.map((s, i) => (
        <button key={s.fileId} onClick={() => onSelect(s)}>
          <span className="source-number">{s.citation || i + 1}</span>
          <span>
            {s.name}
            <small>{s.location}</small>
          </span>
          <ArrowUpRight size={14} />
        </button>
      ))}
    </div>
  );
}
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip title={children}>
      <span className="info-dot">i</span>
    </Tooltip>
  );
}
export function FileName({
  file,
  onClick,
}: {
  file: KnowledgeFile;
  onClick?: () => void;
}) {
  return (
    <button className="file-name" onClick={onClick}>
      <FileBadge type={file.type} />
      <span>
        {file.name}
        <small>
          {file.size} ·{" "}
          {file.type === "WORD"
            ? "Word 文档"
            : file.type === "EXCEL"
              ? "电子表格"
              : file.type === "IMAGE"
                ? "图片"
                : "文档"}
        </small>
      </span>
    </button>
  );
}
export function GuideStep({
  n,
  title,
  description,
  done,
  onClick,
}: {
  n: number;
  title: string;
  description: string;
  done?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="guide-step" onClick={onClick}>
      <span className={done ? "done" : ""}>
        {done ? <Check size={15} /> : n}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <ChevronRight size={16} />
    </button>
  );
}
export function RoleTags({ kb }: { kb: Knowledge }) {
  return (
    <div className="role-tags">
      {kb.visible
        .filter((x) => x !== "admin")
        .map((x) => (
          <span key={x}>{roles[x]}</span>
        ))}
      {kb.visible.length === 1 ? (
        <span>
          <ShieldCheck size={12} />
          仅管理员
        </span>
      ) : null}
    </div>
  );
}
export function AddButton({
  onClick,
  children = "新建知识库",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <Button type="primary" icon={<Plus size={17} />} onClick={onClick}>
      {children}
    </Button>
  );
}
