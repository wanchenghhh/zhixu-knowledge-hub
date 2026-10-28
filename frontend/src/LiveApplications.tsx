import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  App,
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Tag,
} from "antd";
import {
  ArrowLeft,
  Bot,
  Copy,
  FilePenLine,
  Play,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
import { api, write } from "./api";
import { PageHeading } from "./components";
import { useStore } from "./store";
import { ApplicationEditor } from "./pages/Applications";
import { templates } from "./prototype";
import type { Application, ApplicationConfig } from "./prototype";
import LiveAppExperience from "./LiveAppExperience";

export default function LiveApplications() {
  const { id, mode } = useParams();
  const { state } = useStore();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ApplicationConfig["kind"]>("service");
  const [search, setSearch] = useState("");
  const refresh = async () => {
    const items = await api<Application[]>("/applications");
    setApps(items);
    setError("");
    return items;
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Application[]>("/applications")
      .then((items) => {
        if (active) {
          setApps(items);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [state.role, id]);
  const application = apps.find((a) => a.id === id);
  const canManage = state.role !== "user";
  const save = async (value: Application) => {
    await write(`/applications/${value.id}`, value.draft, "PUT");
    if (value.revision > (application?.revision || 0))
      await write(`/applications/${value.id}/publish`, {});
    await refresh();
  };
  if (loading)
    return (
      <div className="page">
        <Alert type="info" title="正在加载应用…" />
      </div>
    );
  if (error)
    return (
      <div className="page">
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button
              onClick={() => {
                setLoading(true);
                refresh()
                  .catch((e) => setError(String(e)))
                  .finally(() => setLoading(false));
              }}
            >
              重新加载
            </Button>
          }
        />
      </div>
    );
  if (id) {
    if (!application)
      return (
        <Result
          status="404"
          title="应用不存在或当前角色不可见"
          extra={
            <Button onClick={() => navigate("/applications")}>
              返回应用中心
            </Button>
          }
        />
      );
    if (mode === "run" && application.published)
      return (
        <div className="page studio-page">
          <button
            className="back-link"
            onClick={() => navigate("/applications")}
          >
            <ArrowLeft size={14} />
            应用中心
          </button>
          <PageHeading
            title={application.published.name}
            description={`已发布 v${application.revision} · ${application.published.description}`}
          />
          <div className="studio-panel standalone-app">
            <LiveAppExperience
              key={`${id}-${application.revision}-${state.role}`}
              application={application}
              config={application.published}
            />
          </div>
        </div>
      );
    if (!canManage) return <Result status="403" title="当前角色不能编辑应用" />;
    return (
      <ApplicationEditor key={id} application={application} onSave={save} />
    );
  }
  const items = apps.filter((a) =>
    `${a.draft.name}${a.draft.description}`.includes(search),
  );
  const make = async () => {
    if (!name.trim()) {
      message.warning("请填写应用名称");
      return;
    }
    const model = state.models.find(
      (m) => m.type === "LLM" && m.status === "ready",
    );
    const kb = state.knowledge[0];
    if (!model || !kb) {
      message.warning("请先配置可用对话模型并创建知识库");
      return;
    }
    try {
      const config = {
        ...structuredClone(templates[kind]),
        name: name.trim(),
        model: model.id,
        kbIds: [kb.id],
      };
      const app = await write<Application>("/applications", config);
      setCreate(false);
      await refresh();
      navigate(`/applications/${app.id}/edit`);
    } catch (e) {
      message.error(String(e));
    }
  };
  return (
    <div className="page studio-page">
      <PageHeading
        title="应用中心"
        description="配置不同场景，复用企业知识，独立管理发布与执行。"
        actions={
          canManage ? (
            <>
              <Button onClick={() => navigate("/observability?view=agent")}>
                观测运行 · 原型
              </Button>
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
            </>
          ) : undefined
        }
      />
      <Alert
        type="success"
        showIcon
        title="已连接真实应用服务"
        description="草稿与发布版本保存在服务端；问答和报告会实际调用已配置模型。"
      />
      <div className="studio-toolbar">
        <h2>{items.length} 个应用</h2>
        <Input
          style={{ width: 280 }}
          prefix={<Search size={15} />}
          placeholder="搜索应用"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="application-grid">
        {items.map((a) => (
          <article key={a.id} className="application-card">
            <div className="application-top">
              <span
                className={`application-icon ${a.draft.kind === "report" ? "blue" : "purple"}`}
              >
                {a.draft.kind === "report" ? <FilePenLine /> : <Bot />}
              </span>
              <Tag color={a.published ? "green" : "default"}>
                {a.published ? `已发布 · v${a.revision}` : "草稿"}
              </Tag>
            </div>
            <h2>{a.draft.name}</h2>
            <p>{a.draft.description}</p>
            <div className="application-facts">
              <span>{a.draft.kind === "report" ? "报告撰写" : "智能客服"}</span>
              <span>{a.draft.kbIds.length} 个知识库</span>
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
                disabled={!a.published}
                icon={<Play size={14} />}
                onClick={() => navigate(`/applications/${a.id}/run`)}
              >
                使用应用
              </Button>
              {canManage ? (
                <Button
                  type="text"
                  icon={<Copy size={14} />}
                  aria-label="复制应用"
                  onClick={async () => {
                    try {
                      await write(`/applications/${a.id}/copy`, {});
                      await refresh();
                      message.success("已复制为新草稿");
                    } catch (e) {
                      message.error(String(e));
                    }
                  }}
                />
              ) : null}
            </div>
            {canManage && a.published ? (
              <Button
                type="link"
                onClick={() =>
                  Modal.confirm({
                    title: "下架此应用？",
                    content: "下架后使用入口停止接受请求，草稿和历史记录保留。",
                    onOk: async () => {
                      await write(`/applications/${a.id}/unpublish`, {});
                      await refresh();
                    },
                  })
                }
              >
                下架应用
              </Button>
            ) : null}
          </article>
        ))}
      </div>
      {!items.length ? (
        <Empty
          description={
            canManage
              ? "创建客服或报告应用，从一个场景开始。"
              : "暂时没有当前角色可用的已发布应用。"
          }
        />
      ) : null}
      <Modal
        title="创建应用"
        open={create}
        onCancel={() => setCreate(false)}
        okText="创建并配置"
        onOk={make}
      >
        <Form layout="vertical">
          <Form.Item label="应用模板">
            <Select
              value={kind}
              onChange={(v) => {
                setKind(v);
                setName(templates[v].name);
              }}
              options={[
                { value: "service", label: "智能客服 · 多轮检索问答" },
                { value: "report", label: "报告撰写 · 大纲确认与章节生成" },
              ]}
            />
          </Form.Item>
          <Form.Item label="应用名称" required>
            <Input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
