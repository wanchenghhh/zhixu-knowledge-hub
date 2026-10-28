import { api, write } from "../api";
import LiveChunks from "../LiveChunks";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  App,
  Button,
  Checkbox,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Slider,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  Database,
  FileText,
  FlaskConical,
  Grid2X2,
  List,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useStore } from "../store";
import type { Knowledge, KnowledgeFile, Source } from "../data";
import { sourceOf } from "../data";
import {
  AddButton,
  EmptyPanel,
  FileName,
  KnowledgeMark,
  NewKnowledge,
  PageHeading,
  RoleTags,
  SourceDrawer,
  Status,
} from "../components";
import { nowLabel, retrieveDemo, visibleKnowledge } from "../domain";
import ImportWizard from "../ImportWizard";
export default function KnowledgePage() {
  return <KnowledgeRouter />;
}
function KnowledgeRouter() {
  const { "*": path } = useParams();
  return path ? <KnowledgeDetail id={path.split("/")[0]} /> : <KnowledgeList />;
}
function KnowledgeList() {
  const { state, setState, live, refresh } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  useEffect(() => setSearch(params.get("q") || ""), [params]);
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("grid");
  const [create, setCreate] = useState(false);
  const { modal, message } = App.useApp();
  const canManage = state.role !== "user";
  const all = visibleKnowledge(state.knowledge, state.role);
  const countFiles = (id: string) => state.files.filter((f) => f.kbId === id);
  const ready = (id: string) =>
    countFiles(id).filter((f) => f.status === "ready").length;
  const knowledge = all.filter(
    (k) =>
      (!search ||
        `${k.name}${k.description}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (category === "all" || k.category === category) &&
      (filter === "all" ||
        (filter === "ready" ? ready(k.id) > 0 : countFiles(k.id).length === 0)),
  );
  const remove = (id: string) =>
    modal.confirm({
      title: "删除此知识库？",
      content: live
        ? "将永久删除知识库及其文件，操作前请确认已备份。"
        : "该知识库及其文件会从原型中移除。此操作仅影响当前浏览器的演示数据。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (live) {
          try {
            await api(`/knowledge/${id}`, { method: "DELETE" });
            await refresh();
            message.success("知识库已删除");
          } catch (error) {
            message.error(String(error));
          }
          return;
        }
        setState((s) => ({
          ...s,
          knowledge: s.knowledge.filter((k) => k.id !== id),
          files: s.files.filter((f) => f.kbId !== id),
          tasks: s.tasks.filter((t) => t.kbId !== id),
        }));
        message.success("知识库已删除");
      },
    });
  return (
    <div className="page">
      <PageHeading
        title="知识库"
        description="汇聚企业知识，让每一份资料都能成为可靠的答案。"
        actions={
          canManage ? (
            <>
              <Button onClick={() => navigate("/observability?view=build")}>
                观测构建 · 原型
              </Button>
              <Button
                icon={<Sparkles size={15} />}
                onClick={() => navigate("/ingestion")}
              >
                {live ? "智能导入与加工" : "智能导入原型"}
              </Button>
              <AddButton onClick={() => setCreate(true)} />
            </>
          ) : (
            <Button
              type="primary"
              onClick={() => navigate("/chat")}
              icon={<BookOpen size={16} />}
            >
              开始对话
            </Button>
          )
        }
      />
      <div className="knowledge-toolbar">
        <div className="filter-tabs">
          {[
            { value: "all", label: "全部知识库", count: all.length },
            {
              value: "ready",
              label: "可用于对话",
              count: all.filter((k) => ready(k.id) > 0).length,
            },
            {
              value: "empty",
              label: "未导入资料",
              count: all.filter((k) => !countFiles(k.id).length).length,
            },
          ].map((f) => (
            <button
              key={f.value}
              className={filter === f.value ? "active" : ""}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              <span>{f.count}</span>
            </button>
          ))}
        </div>
        <div className="knowledge-controls">
          <Input
            prefix={<Search size={15} />}
            placeholder="搜索知识库名称或说明"
            aria-label="筛选知识库"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Select
            aria-label="知识分类"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "全部分类" },
              ...Array.from(new Set(all.map((k) => k.category))).map(
                (value) => ({ value, label: value }),
              ),
            ]}
          />
          <div className="view-toggle">
            <button
              className={view === "grid" ? "active" : ""}
              aria-label="卡片视图"
              onClick={() => setView("grid")}
            >
              <Grid2X2 size={17} />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              aria-label="列表视图"
              onClick={() => setView("list")}
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </div>
      {knowledge.length ? (
        <div className={view === "grid" ? "knowledge-grid" : "knowledge-list"}>
          {knowledge.map((k) => (
            <article className="knowledge-card" key={k.id}>
              <div className="knowledge-card-head">
                <button
                  className="card-open"
                  onClick={() => navigate(`/knowledge/${k.id}`)}
                  aria-label={`打开${k.name}`}
                >
                  <KnowledgeMark kb={k} />
                </button>
                <Tag variant="filled">{k.category}</Tag>
                {canManage ? (
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: "settings",
                          label: "知识库配置",
                          icon: <Settings2 size={14} />,
                        },
                        {
                          key: "delete",
                          label: "删除知识库",
                          icon: <Trash2 size={14} />,
                          danger: true,
                        },
                      ],
                      onClick: ({ key }) =>
                        key === "delete"
                          ? remove(k.id)
                          : navigate(`/knowledge/${k.id}?tab=settings`),
                    }}
                    trigger={["click"]}
                  >
                    <button
                      className="icon-button card-menu"
                      aria-label={`${k.name}更多操作`}
                    >
                      <MoreHorizontal size={19} />
                    </button>
                  </Dropdown>
                ) : null}
              </div>
              <button
                className="card-text"
                onClick={() => navigate(`/knowledge/${k.id}`)}
              >
                <h2>
                  {k.name}
                  <ArrowUpRight size={16} />
                </h2>
                <p>{k.description}</p>
              </button>
              <div className="knowledge-card-metrics">
                <span>
                  <FileText size={14} />
                  <strong>{countFiles(k.id).length}</strong> 份文件
                </span>
                <span>
                  <Database size={14} />
                  <strong>
                    {live
                      ? countFiles(k.id)
                          .filter((f) => f.status === "ready")
                          .reduce((n, f) => n + (f.chunkCount || 0), 0)
                      : ready(k.id)}
                  </strong>{" "}
                  个片段
                </span>
                {ready(k.id) > 0 ? (
                  <span className="kb-ready">
                    <span />
                    可用于对话
                  </span>
                ) : (
                  <span className="text-muted">等待导入</span>
                )}
              </div>
              <div className="knowledge-card-footer">
                <RoleTags kb={k} />
                <span>{k.updated.slice(5, 10)} 更新</span>
              </div>
              <div className="card-hover-actions">
                <button onClick={() => navigate(`/chat?kb=${k.id}`)}>
                  进入对话 <ArrowRight size={13} />
                </button>
                <button onClick={() => navigate(`/knowledge/${k.id}`)}>
                  管理知识 <ChevronRight size={13} />
                </button>
              </div>
            </article>
          ))}
          {canManage ? (
            <button
              className="create-knowledge-card"
              onClick={() => setCreate(true)}
            >
              <span>
                <Plus size={25} />
              </span>
              <strong>创建新的知识空间</strong>
              <p>沉淀资料，连接团队的每一次提问</p>
            </button>
          ) : null}
        </div>
      ) : (
        <EmptyPanel
          title="没有找到知识库"
          description={
            search
              ? "试试其他名称，或清除筛选条件。"
              : "创建一个知识库，从第一份资料开始积累。"
          }
          action={
            <Button
              onClick={() => {
                setSearch("");
                setFilter("all");
                setCategory("all");
              }}
            >
              清除筛选
            </Button>
          }
        />
      )}
      <div className="knowledge-bottom-note">
        <ShieldCheck size={15} />
        仅展示当前角色可见的知识库。可见范围由知识库配置决定。
      </div>
      <NewKnowledge
        open={create}
        onClose={() => setCreate(false)}
        onCreated={(id) => navigate(`/knowledge/${id}?import=1`)}
      />
    </div>
  );
}
function KnowledgeDetail({ id }: { id: string }) {
  const { state, live } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(params.get("import") === "1");
  const [source, setSource] = useState<Source | null>(null);
  const kb = visibleKnowledge(state.knowledge, state.role).find(
    (k) => k.id === id,
  );
  const canManage = state.role !== "user";
  const activeTab = params.get("tab") || "files";
  useEffect(() => setSource(null), [state.role, id]);
  if (!kb)
    return (
      <EmptyPanel
        title="暂时无法访问此知识库"
        description="该知识库已删除，或当前角色没有可见权限。"
        action={
          <Button onClick={() => navigate("/knowledge")}>返回知识库</Button>
        }
      />
    );
  const files = state.files.filter((f) => f.kbId === id);
  const tabs = [
    {
      key: "files",
      label: (
        <span className="inline-icon">
          文件 <span className="tab-number">{files.length}</span>
        </span>
      ),
      children: (
        <FilePanel
          kb={kb}
          onImport={() => setImportOpen(true)}
          onSource={setSource}
        />
      ),
    },
    {
      key: "chunks",
      label: "知识片段",
      children: <Chunks kb={kb} onSource={setSource} />,
    },
    ...(canManage
      ? [
          {
            key: "test",
            label: (
              <span className="inline-icon">
                检索测试 <FlaskConical size={13} />
              </span>
            ),
            children: <RetrievalTest kb={kb} onSource={setSource} />,
          },
          {
            key: "qa",
            label: "问答设置",
            children: <QaSettings key={kb.id} kb={kb} />,
          },
          {
            key: "settings",
            label: "权限与配置",
            children: <KnowledgeSettings key={kb.id} kb={kb} />,
          },
        ]
      : []),
  ];
  return (
    <div className="page detail-page">
      <button className="back-link" onClick={() => navigate("/knowledge")}>
        <ArrowLeft size={14} />
        全部知识库
      </button>
      <div className="detail-heading">
        <KnowledgeMark kb={kb} />
        <div>
          <div className="inline-icon">
            <h1>{kb.name}</h1>
            <Tag variant="filled">{kb.category}</Tag>
          </div>
          <p>{kb.description}</p>
        </div>
        <div className="heading-actions">
          {canManage ? (
            <Button
              icon={<Sparkles size={15} />}
              onClick={() => navigate(`/knowledge/${id}/design`)}
            >
              {live ? "智能导入与加工" : "智能导入原型"}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              icon={<CloudUpload size={16} />}
              onClick={() => setImportOpen(true)}
            >
              导入知识
            </Button>
          ) : null}
          <Button
            type="primary"
            icon={<BookOpen size={16} />}
            onClick={() => navigate(`/chat?kb=${id}`)}
            disabled={!files.some((f) => f.status === "ready")}
          >
            开始对话 <ArrowUpRight size={14} />
          </Button>
        </div>
      </div>
      <div className="detail-meta">
        <span>
          <Database size={13} />
          {state.models.find((m) => m.id === kb.embedding)?.name ||
            "未配置向量模型"}
        </span>
        <span>
          <ShieldCheck size={13} />
          {kb.visible.includes("user") ? "对使用者可见" : "管理角色可见"}
        </span>
        <span>更新于 {kb.updated}</span>
      </div>
      <Tabs
        className="detail-tabs"
        activeKey={tabs.some((t) => t.key === activeTab) ? activeTab : "files"}
        onChange={(tab) => setParams({ tab })}
        items={tabs}
        destroyOnHidden
      />
      <ImportWizard
        kbId={id}
        open={importOpen && canManage}
        onClose={() => {
          setImportOpen(false);
          if (params.has("import")) setParams({ tab: "files" });
        }}
        onChat={() => navigate(`/chat?kb=${id}`)}
      />
      <SourceDrawer source={source} onClose={() => setSource(null)} />
    </div>
  );
}
function FilePanel({
  kb,
  onImport,
  onSource,
}: {
  kb: Knowledge;
  onImport: () => void;
  onSource: (s: Source) => void;
}) {
  const { state, setState, live, refresh } = useStore();
  const { message, modal } = App.useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const canManage = state.role !== "user";
  const files = state.files.filter((f) => f.kbId === kb.id);
  const filtered = files.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === "all" || f.status === status),
  );
  const change = (
    ids: string[],
    action: "delete" | "disable" | "enable" | "retry",
  ) => {
    const exec = async () => {
      if (live) {
        try {
          if (action === "retry") {
            const jobs = [
              ...new Set(
                ids
                  .map(
                    (id) =>
                      state.tasks.find(
                        (t) => t.status === "failed" && t.fileIds.includes(id),
                      )?.id,
                  )
                  .filter(Boolean),
              ),
            ];
            if (!jobs.length) throw new Error("没有可重试的任务");
            for (const task of jobs) await write(`/tasks/${task}/retry`, {});
          } else {
            for (const id of ids) {
              if (action === "delete")
                await api(`/files/${id}`, { method: "DELETE" });
              else await write(`/files/${id}`, { action }, "PATCH");
            }
          }
          await refresh();
          setSelected([]);
          message.success("操作已提交");
        } catch (error) {
          message.error(String(error));
        }
        return;
      }
      setState((s) => ({
        ...s,
        files:
          action === "delete"
            ? s.files.filter((f) => !ids.includes(f.id))
            : s.files.map((f) =>
                ids.includes(f.id)
                  ? {
                      ...f,
                      status: action === "disable" ? "disabled" : "ready",
                      error: undefined,
                      updated: nowLabel(),
                    }
                  : f,
              ),
        tasks:
          action === "retry"
            ? s.tasks.map((t) => ({
                ...t,
                finished: t.fileIds.filter(
                  (fileId) =>
                    ids.includes(fileId) ||
                    s.files.some(
                      (f) => f.id === fileId && f.status === "ready",
                    ),
                ).length,
                status: t.fileIds.every(
                  (fileId) =>
                    ids.includes(fileId) ||
                    s.files.some(
                      (f) => f.id === fileId && f.status === "ready",
                    ),
                )
                  ? "success"
                  : t.status,
                error: t.fileIds.every(
                  (fileId) =>
                    ids.includes(fileId) ||
                    s.files.some(
                      (f) => f.id === fileId && f.status === "ready",
                    ),
                )
                  ? undefined
                  : t.error,
              }))
            : s.tasks,
      }));
      setSelected([]);
      message.success(
        action === "retry"
          ? "演示重试成功，文件已就绪"
          : action === "delete"
            ? "文件已删除"
            : action === "disable"
              ? "已停用，文件不再参与问答"
              : "文件已启用",
      );
    };
    if (action === "delete")
      modal.confirm({
        title: `删除 ${ids.length} 份文件？`,
        content: live
          ? "删除后不再参与检索与问答，原文件也将删除。"
          : "删除后不再参与检索与问答，仅影响演示数据。",
        okText: "删除",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: exec,
      });
    else exec();
  };
  return (
    <>
      <div className="file-overview">
        <span>
          <CheckCircle2 size={15} />
          {files.filter((f) => f.status === "ready").length} 份文件已就绪
        </span>
        <span>
          {files.filter((f) => f.status === "failed").length} 份处理失败
        </span>
        <span>
          {files.filter((f) => f.status === "disabled").length} 份已停用
        </span>
        <p>已就绪的文件会自动参与知识库问答</p>
      </div>
      <section className="panel file-panel">
        <div className="table-toolbar">
          <div className="inline-icon">
            <Input
              prefix={<Search size={15} />}
              placeholder="搜索文件名称"
              aria-label="搜索文件"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
            />
            <Select
              aria-label="文件状态"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "全部状态" },
                ...(live
                  ? [
                      { value: "queued", label: "排队中" },
                      { value: "parsing", label: "解析中" },
                      { value: "preview", label: "待确认构建" },
                      { value: "indexing", label: "构建中" },
                    ]
                  : []),
                { value: "ready", label: "已就绪" },
                { value: "failed", label: "失败" },
                { value: "disabled", label: "已停用" },
              ]}
            />
          </div>
          {canManage ? (
            <Button type="primary" icon={<Plus size={16} />} onClick={onImport}>
              导入文件
            </Button>
          ) : null}
        </div>
        {selected.length && canManage ? (
          <div className="bulk-bar">
            <span>已选择 {selected.length} 份文件</span>
            <Button
              size="small"
              onClick={() => change(selected.map(String), "disable")}
            >
              批量停用
            </Button>
            <Button
              size="small"
              danger
              onClick={() => change(selected.map(String), "delete")}
            >
              删除
            </Button>
            <button className="text-button" onClick={() => setSelected([])}>
              取消选择
            </button>
          </div>
        ) : null}
        <Table<KnowledgeFile>
          rowKey="id"
          dataSource={filtered}
          rowSelection={
            canManage
              ? { selectedRowKeys: selected, onChange: setSelected }
              : undefined
          }
          pagination={{
            pageSize: 8,
            hideOnSinglePage: true,
            showTotal: (t) => `共 ${t} 份文件`,
          }}
          scroll={{ x: 800 }}
          locale={{
            emptyText: (
              <EmptyPanel
                title={
                  files.length ? "没有匹配的文件" : "为知识库添加第一份资料"
                }
                description="上传文件或使用示例，开始体验知识构建流程。"
                action={
                  canManage ? (
                    <Button onClick={onImport}>导入知识</Button>
                  ) : undefined
                }
              />
            ),
          }}
          columns={[
            {
              title: "文件名称",
              key: "name",
              render: (_, f) => (
                <FileName file={f} onClick={() => onSource(sourceOf(f))} />
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 105,
              render: (status) => <Status status={status} />,
            },
            {
              title: "知识片段",
              width: 100,
              render: (_, f) =>
                f.status === "ready" ? (
                  <span className="table-number">
                    {f.chunkCount ?? 1} <small>个</small>
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              title: "更新时间",
              dataIndex: "updated",
              width: 164,
              render: (v) => <span className="text-muted">{v}</span>,
            },
            {
              title: "操作",
              width: canManage ? 156 : 80,
              render: (_, f) => (
                <div className="table-actions">
                  {live && f.status === "preview" && canManage ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() =>
                        void write(`/knowledge/${kb.id}/build`, {
                          fileIds: [f.id],
                        })
                          .then(() => refresh())
                          .catch((error) => message.error(String(error)))
                      }
                    >
                      构建
                    </Button>
                  ) : null}
                  {f.status === "failed" && canManage ? (
                    <Tooltip title={f.error}>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => change([f.id], "retry")}
                      >
                        重试
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => onSource(sourceOf(f))}
                    >
                      查看
                    </Button>
                  )}
                  {canManage ? (
                    <Dropdown
                      trigger={["click"]}
                      menu={{
                        items: [
                          {
                            key: f.status === "disabled" ? "enable" : "disable",
                            label:
                              f.status === "disabled" ? "启用文件" : "停用文件",
                          },
                          { key: "delete", label: "删除文件", danger: true },
                        ],
                        onClick: ({ key }) =>
                          change(
                            [f.id],
                            key as "delete" | "disable" | "enable",
                          ),
                      }}
                    >
                      <button
                        className="icon-button"
                        aria-label={`${f.name}操作`}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </Dropdown>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
        <div className="table-bottom">
          共 {filtered.length} 份文件 <span>·</span>{" "}
          {live ? "文件与索引保存在服务端" : "内容与索引均为原型演示"}
        </div>
      </section>
    </>
  );
}
function Chunks({
  kb,
  onSource,
}: {
  kb: Knowledge;
  onSource: (s: Source) => void;
}) {
  const { live } = useStore();
  return live ? (
    <LiveChunks kb={kb} onSource={onSource} />
  ) : (
    <DemoChunks kb={kb} onSource={onSource} />
  );
}
function DemoChunks({
  kb,
  onSource,
}: {
  kb: Knowledge;
  onSource: (s: Source) => void;
}) {
  const { state, setState } = useStore();
  const { modal, message } = App.useApp();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<KnowledgeFile | null>(null);
  const [text, setText] = useState("");
  const files = state.files.filter(
    (f) =>
      f.kbId === kb.id &&
      f.status === "ready" &&
      `${f.name}${f.content}`.includes(search),
  );
  return (
    <div className="chunks-panel">
      <div className="table-toolbar">
        <span className="text-muted">每份演示文件提供 1 个预览片段</span>
        <Input
          prefix={<Search size={15} />}
          aria-label="搜索知识片段"
          placeholder="搜索知识片段"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>
      {files.length ? (
        files.map((f, i) => (
          <article className="chunk-card" key={f.id}>
            <div>
              <span className="chunk-index">
                CHUNK {String(i + 1).padStart(3, "0")}
              </span>
              <Tag color="green">已索引</Tag>
              <span className="text-muted">{f.content.length} 字符</span>
              {state.role !== "user" ? (
                <Button
                  type="text"
                  size="small"
                  onClick={() => {
                    setEditing(f);
                    setText(f.content);
                  }}
                >
                  编辑片段
                </Button>
              ) : null}
            </div>
            <p>{f.content}</p>
            <button
              className="chunk-source"
              onClick={() => onSource(sourceOf(f))}
            >
              <FileText size={14} />
              {f.name}
              <span>{f.location}</span>
              <ArrowUpRight size={13} />
            </button>
          </article>
        ))
      ) : (
        <EmptyPanel
          title="还没有可用片段"
          description="请先导入文件，或调整搜索内容。"
        />
      )}
      <Modal
        title="编辑知识片段"
        open={!!editing}
        onCancel={() => setEditing(null)}
        okText="保存并模拟重建"
        cancelText="取消"
        onOk={() => {
          if (!text.trim()) {
            message.warning("片段内容不能为空");
            return;
          }
          modal.confirm({
            title: "保存并重建此片段？",
            content:
              "保存后将更新演示问答使用的内容，真实向量重建将在后端接入。",
            okText: "确认保存",
            cancelText: "取消",
            onOk: () => {
              setState((s) => ({
                ...s,
                files: s.files.map((f) =>
                  f.id === editing?.id
                    ? { ...f, content: text.trim(), updated: nowLabel() }
                    : f,
                ),
              }));
              setEditing(null);
              message.success("片段已保存，演示索引已更新");
            },
          });
        }}
      >
        <Input.TextArea
          aria-label="片段内容"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          maxLength={16000}
          showCount
        />
      </Modal>
    </div>
  );
}
function RetrievalTest({
  kb,
  onSource,
}: {
  kb: Knowledge;
  onSource: (s: Source) => void;
}) {
  const { state, live } = useStore();
  const { message } = App.useApp();
  const [question, setQuestion] = useState("差旅报销需要准备什么材料？");
  const [rerank, setRerank] = useState(kb.rerank);
  const [limit, setLimit] = useState(kb.topK);
  const [threshold, setThreshold] = useState(kb.threshold);
  const [results, setResults] = useState<Source[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const run = () => {
    setLoading(true);
    if (live) {
      void write<{ sources: Source[]; warnings: string[] }>("/retrieval", {
        question,
        kbIds: [kb.id],
        topK: limit,
        threshold,
        rerank,
      })
        .then((result) => {
          setResults(result.sources);
          result.warnings.forEach((w) => message.warning(w));
        })
        .catch((error) => message.error(String(error)))
        .finally(() => setLoading(false));
      return;
    }
    timer.current = setTimeout(() => {
      setResults(
        retrieveDemo(question, state.files, [kb.id], limit)
          .map((s, i) => ({
            ...s,
            score: rerank ? s.score : Math.max(0.4, s.score - 0.08 - i * 0.02),
          }))
          .filter((s) => s.score >= threshold),
      );
      setLoading(false);
    }, 600);
  };
  return (
    <div className="retrieval-layout">
      <section className="panel retrieval-config">
        <h3>
          <FlaskConical size={18} />
          检索效果测试
        </h3>
        <p>先测试知识是否命中，再优化回答。</p>
        <label>测试问题</label>
        <Input.TextArea
          aria-label="检索测试问题"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="输入一个与当前知识库有关的问题"
          rows={4}
        />
        <label>
          召回上限 <span>Top K</span>
        </label>
        <Select
          aria-label="召回上限"
          value={limit}
          onChange={setLimit}
          options={[3, 5, 10, 20].map((value) => ({
            value,
            label: `${value} 个片段`,
          }))}
        />
        <label>
          最低相关度 <strong>{threshold.toFixed(2)}</strong>
        </label>
        <Slider
          aria-label="最低相关度"
          min={0}
          max={1}
          step={0.05}
          value={threshold}
          onChange={setThreshold}
        />
        <div className="setting-switch">
          <span>
            结果重排 <small>提高候选片段的相关性</small>
          </span>
          <Switch checked={rerank} onChange={setRerank} aria-label="启用重排" />
        </div>
        <div className="retrieval-mode">
          <CheckCircle2 size={14} />
          混合检索 · 向量 + 中文关键词
        </div>
        <Button
          type="primary"
          icon={<Search size={16} />}
          onClick={run}
          loading={loading}
          disabled={!question.trim()}
          block
        >
          开始测试
        </Button>
        <small className="simulation-note">
          {live
            ? "调用已配置的向量与重排模型，请关注服务商用量。"
            : "使用关键词规则模拟召回与分数，非真实模型测试。"}
        </small>
      </section>
      <section className="retrieval-results">
        {loading ? (
          <div className="retrieval-placeholder">
            <LoaderCircle className="spin" size={28} />
            <h3>{live ? "正在检索…" : "正在模拟检索…"}</h3>
          </div>
        ) : results === null ? (
          <div className="retrieval-placeholder">
            <span className="empty-icon">
              <Search size={34} />
            </span>
            <h3>看看知识库能找到什么</h3>
            <p>输入问题，查看召回片段、相关度和来源。</p>
          </div>
        ) : (
          <>
            <div className="retrieval-results-header">
              <h3>
                检索结果 <Tag>{results.length}</Tag>
              </h3>
              <span>
                {live ? "实际检索结果" : rerank ? "已模拟重排" : "未开启重排"}
              </span>
            </div>
            {results.length ? (
              results.map((s, i) => (
                <article className="retrieval-result" key={s.fileId}>
                  <div>
                    <span className="result-rank">{i + 1}</span>
                    <strong>{s.name}</strong>
                    <span className="result-score">
                      {s.score.toFixed(2)} <small>相关度</small>
                    </span>
                  </div>
                  <p>{s.text}</p>
                  <footer>
                    <span>{s.location}</span>
                    <button onClick={() => onSource(s)}>
                      查看原文 <ArrowUpRight size={13} />
                    </button>
                  </footer>
                </article>
              ))
            ) : (
              <EmptyPanel
                title="未找到足够相关的片段"
                description="尝试调整问题、降低阈值，或检查是否导入了相关资料。"
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
function QaSettings({ kb }: { kb: Knowledge }) {
  const { state, setState, live, refresh } = useStore();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  return (
    <section className="panel settings-panel">
      <div className="settings-intro">
        <h3>让回答更符合团队需要</h3>
        <p>
          {live
            ? "配置检索参数、模型与回答规则，设置保存到服务端。"
            : "配置检索与回答规则，所有设置在原型中本地保存。"}
        </p>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={kb}
        onFinish={async (values) => {
          if (live) {
            try {
              await write(`/knowledge/${kb.id}`, { ...kb, ...values }, "PUT");
              await refresh();
              message.success("问答设置已保存");
            } catch (error) {
              message.error(String(error));
            }
            return;
          }
          setState((s) => ({
            ...s,
            knowledge: s.knowledge.map((k) =>
              k.id === kb.id ? { ...k, ...values, updated: nowLabel() } : k,
            ),
          }));
          message.success("问答设置已保存");
        }}
      >
        <Form.Item label="检索方式">
          <Radio.Group
            value="hybrid"
            options={[{ value: "hybrid", label: "混合检索（向量 + 关键词）" }]}
          />
        </Form.Item>
        <div className="form-two">
          <Form.Item name="topK" label="召回片段上限">
            <InputNumber min={1} max={20} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="threshold" label="最低相关度">
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </div>
        {live ? (
          <Form.Item name="rerankModel" label="重排模型">
            <Select
              allowClear
              options={state.models
                .filter((m) => m.type === "Rerank" && m.status === "ready")
                .map((m) => ({ value: m.id, label: m.name }))}
            />
          </Form.Item>
        ) : null}
        <Form.Item name="rerank" label="启用结果重排" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="prompt"
          label="回答规则（系统提示词）"
          rules={[
            { required: true, whitespace: true, message: "请填写回答规则" },
          ]}
        >
          <Input.TextArea rows={5} maxLength={2000} showCount />
        </Form.Item>
        <div className="soft-note">
          <ShieldCheck size={17} />
          {live
            ? "请通过检索测试和实际对话验证参数效果。"
            : "原型回答使用演示规则；真实提示词效果将在后端接入后验证。"}
        </div>
        <Button type="primary" htmlType="submit">
          保存问答设置
        </Button>
      </Form>
    </section>
  );
}
function KnowledgeSettings({ kb }: { kb: Knowledge }) {
  const { state, setState, live, refresh } = useStore();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const submit = (values: {
    name: string;
    description: string;
    embedding: string;
    public: boolean;
    manager: boolean;
  }) => {
    const save = async () => {
      if (live) {
        try {
          const result = await write<{ task: unknown }>(
            `/knowledge/${kb.id}`,
            {
              ...kb,
              ...values,
              visible: [
                "admin",
                ...(values.manager ? ["manager"] : []),
                ...(values.public ? ["user"] : []),
              ],
            },
            "PUT",
          );
          await refresh();
          message.success(
            result.task
              ? "已开始重建索引，成功前保留原模型与索引"
              : "配置已保存",
          );
        } catch (error) {
          message.error(String(error));
        }
        return;
      }
      setState((s) => ({
        ...s,
        knowledge: s.knowledge.map((k) =>
          k.id === kb.id
            ? {
                ...k,
                name: values.name.trim(),
                description: values.description,
                embedding: values.embedding,
                visible: [
                  "admin",
                  ...(values.manager ? ["manager" as const] : []),
                  ...(values.public ? ["user" as const] : []),
                ],
                updated: nowLabel(),
              }
            : k,
        ),
      }));
      message.success("知识库配置已保存");
    };
    if (values.embedding !== kb.embedding)
      modal.confirm({
        title: live
          ? "更换向量模型并重建索引？"
          : "更换向量模型并模拟重建索引？",
        content: live
          ? "重建会调用新向量模型并产生费用；全部成功后切换，失败保留旧索引。"
          : "正式版会产生向量化调用费用。当前原型只保存配置，不调用模型。",
        okText: "确认更换",
        cancelText: "取消",
        onOk: save,
      });
    else save();
  };
  return (
    <section className="panel settings-panel">
      <div className="settings-intro">
        <h3>知识库配置</h3>
        <p>管理基本信息、模型绑定与角色可见范围。</p>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ...kb,
          public: kb.visible.includes("user"),
          manager: kb.visible.includes("manager"),
        }}
        onFinish={submit}
      >
        <Form.Item
          name="name"
          label="知识库名称"
          rules={[{ required: true, whitespace: true, message: "请填写名称" }]}
        >
          <Input maxLength={30} />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <Input.TextArea rows={3} maxLength={160} />
        </Form.Item>
        <Form.Item
          name="embedding"
          label="向量模型"
          rules={[{ required: true, message: "请选择模型" }]}
        >
          <Select
            options={state.models
              .filter((m) => m.type === "Embedding" && m.status === "ready")
              .map((m) => ({
                value: m.id,
                label: `${m.name} · ${m.dimension} 维`,
              }))}
          />
        </Form.Item>
        <div className="permission-block">
          <h4>
            <ShieldCheck size={17} />
            角色可见范围
          </h4>
          <Checkbox checked disabled>
            管理员 · 始终可见
          </Checkbox>
          <Form.Item name="manager" valuePropName="checked">
            <Checkbox disabled={state.role !== "admin"}>
              知识库管理人员 · 可管理
            </Checkbox>
          </Form.Item>
          <Form.Item name="public" valuePropName="checked">
            <Checkbox>使用者 · 可问答及查看资料</Checkbox>
          </Form.Item>
          <p>未开放给使用者的知识库，不会出现在其列表、对话选择与引用中。</p>
        </div>
        <div className="soft-note">
          <LockKeyhole size={16} />
          角色可自由切换，此模式用于体验功能分工，不验证真实身份。
        </div>
        <Button type="primary" htmlType="submit">
          保存配置
        </Button>
      </Form>
    </section>
  );
}
