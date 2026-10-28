import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Radio,
  Select,
  Table,
  Tag,
} from "antd";
import { Plus, RefreshCw } from "lucide-react";
import { api, write } from "../api";
import { PageHeading, downloadText } from "../components";
import type { Dataset, EvaluationCase } from "./CaseCollector";
import "./evaluation.css";
export default function EvaluationSets() {
  const { message, modal } = App.useApp();
  const [sets, setSets] = useState<Dataset[]>([]);
  const [active, setActive] = useState("");
  const [cases, setCases] = useState<EvaluationCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<EvaluationCase | null>(null);
  const [label, setLabel] = useState<"good" | "bad">("good");
  const [note, setNote] = useState("");
  const [expected, setExpected] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const loadSets = useCallback(async () => {
    const rows = await api<Dataset[]>("/evaluation-datasets");
    setSets(rows);
    setActive((prev) =>
      rows.some((r) => r.id === prev) ? prev : rows[0]?.id || "",
    );
  }, []);
  const loadCases = useCallback(async (id: string) => {
    if (!id) {
      setCases([]);
      return;
    }
    setCases(await api<EvaluationCase[]>(`/evaluation-datasets/${id}/cases`));
  }, []);
  useEffect(() => {
    void loadSets().catch((e) => setError(String(e)));
  }, [loadSets]);
  useEffect(() => {
    let alive = true;
    if (!active) {
      setCases([]);
      return;
    }
    setLoading(true);
    api<EvaluationCase[]>(`/evaluation-datasets/${active}/cases`)
      .then((v) => {
        if (alive) {
          setCases(v);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active]);
  const reload = async () => {
    setLoading(true);
    try {
      await Promise.all([loadSets(), loadCases(active)]);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const addSet = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const result = await write<Dataset>("/evaluation-datasets", {
        name,
        description,
      });
      await loadSets();
      setActive(result.id);
      setCreate(false);
      setName("");
      setDescription("");
      message.success("评测集已创建");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const edit = (row: EvaluationCase) => {
    setSelected(row);
    setLabel(row.label);
    setNote(row.note);
    setExpected(row.expected);
  };
  const save = async () => {
    if (!selected) return;
    setLoading(true);
    try {
      await write(
        `/evaluation-cases/${selected.id}`,
        { label, note, expected },
        "PATCH",
      );
      await reload();
      setSelected(null);
      message.success("案例已更新");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const remove = (row: EvaluationCase) =>
    modal.confirm({
      title: "从评测集移除这个案例？",
      content: "只移除本评测集中的案例快照，不会删除原始对话日志。",
      okText: "移除",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api(`/evaluation-cases/${row.id}`, { method: "DELETE" });
        setSelected(null);
        await reload();
        message.success("案例已移除");
      },
    });
  const rows = cases.filter(
    (c) =>
      (filter === "all" || c.label === filter) &&
      `${c.snapshot.question} ${c.snapshot.answer} ${c.note}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="page evaluation-page">
      <PageHeading
        title="评测集"
        description="把线上 Good Case 和 Bad Case 沉淀为可复用的评测案例。"
        actions={
          <>
            <Button
              icon={<RefreshCw size={15} />}
              loading={loading}
              onClick={() => void reload()}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<Plus size={15} />}
              onClick={() => setCreate(true)}
            >
              新建评测集
            </Button>
          </>
        }
      />
      <Alert
        type="info"
        showIcon
        title="从真实对话日志手动收集案例"
        description="每条案例保留问题、回答、来源、模型和人工标注快照，可填写期望答案。此版本负责收集与管理，自动评分后续接入。"
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
      <div className="evaluation-layout">
        <aside className="panel evaluation-sidebar">
          <div className="obs-section-title">
            <strong>我的评测集</strong>
            <span>{sets.length} 个</span>
          </div>
          {sets.length ? (
            sets.map((s) => (
              <button
                key={s.id}
                className={`evaluation-set ${active === s.id ? "active" : ""}`}
                onClick={() => setActive(s.id)}
              >
                <strong>{s.name}</strong>
                <small>
                  {s.count} 个案例 · Good {s.good} / Bad {s.bad}
                </small>
              </button>
            ))
          ) : (
            <Empty description="暂无评测集" />
          )}
        </aside>
        <section className="panel evaluation-content">
          <div className="obs-section-title">
            <div>
              <h2>{sets.find((s) => s.id === active)?.name || "选择评测集"}</h2>
              <p>
                {sets.find((s) => s.id === active)?.description ||
                  "在日志详情中点击“加入评测集”即可收集案例。"}
              </p>
            </div>
            <Button
              disabled={!rows.length}
              onClick={() =>
                downloadText(
                  "评测案例.json",
                  JSON.stringify(
                    { dataset: sets.find((s) => s.id === active), cases: rows },
                    null,
                    2,
                  ),
                )
              }
            >
              导出案例
            </Button>
          </div>
          <div className="evaluation-filters">
            <Select
              aria-label="案例标签"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "全部案例" },
                { value: "good", label: "Good Case" },
                { value: "bad", label: "Bad Case" },
              ]}
            />
            <Input
              aria-label="搜索案例"
              placeholder="搜索问题、回答或备注"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              allowClear
            />
          </div>
          <Table
            rowKey="id"
            dataSource={rows}
            loading={loading}
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: "标签",
                render: (_, r) => (
                  <Tag color={r.label === "good" ? "success" : "error"}>
                    {r.label === "good" ? "Good" : "Bad"}
                  </Tag>
                ),
              },
              {
                title: "用户问题",
                render: (_, r) => (
                  <>
                    <strong>{r.snapshot.question}</strong>
                    <small className="obs-cell-note">
                      {r.snapshot.logDate} · {r.snapshot.model}
                    </small>
                  </>
                ),
              },
              { title: "标注备注", render: (_, r) => r.note || "—" },
              {
                title: "",
                render: (_, r) => (
                  <Button type="link" onClick={() => edit(r)}>
                    查看与标注
                  </Button>
                ),
              },
            ]}
          />
        </section>
      </div>
      <Modal
        open={create}
        title="新建评测集"
        onCancel={() => setCreate(false)}
        onOk={addSet}
        okText="创建"
        confirmLoading={loading}
        okButtonProps={{ disabled: !name.trim() }}
      >
        <p>名称</p>
        <Input
          aria-label="评测集名称"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <p>说明（可选）</p>
        <Input.TextArea
          aria-label="评测集说明"
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </Modal>
      <Drawer
        open={!!selected}
        title="案例详情与标注"
        width={700}
        onClose={() => setSelected(null)}
        extra={
          selected ? (
            <Button danger onClick={() => remove(selected)}>
              移除案例
            </Button>
          ) : null
        }
      >
        {selected ? (
          <>
            <h3>用户问题</h3>
            <div className="evaluation-text">{selected.snapshot.question}</div>
            <h3>原始回答</h3>
            <div className="evaluation-text">
              {selected.snapshot.answer || "无回答"}
            </div>
            <h3>来源资料</h3>
            {selected.snapshot.sources.length ? (
              selected.snapshot.sources.map((s, i) => (
                <div className="evaluation-text" key={i}>
                  <strong>
                    {s.name} · {s.location}
                  </strong>
                  <p>{s.text}</p>
                </div>
              ))
            ) : (
              <p>无引用来源</p>
            )}
            <h3>标签</h3>
            <Radio.Group
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              options={[
                { value: "good", label: "Good Case" },
                { value: "bad", label: "Bad Case" },
              ]}
            />
            <h3>备注</h3>
            <Input.TextArea
              aria-label="编辑案例备注"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={4000}
            />
            <h3>期望答案</h3>
            <Input.TextArea
              aria-label="编辑期望答案"
              rows={4}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              maxLength={8000}
            />
            <div className="evaluation-actions">
              <Button type="primary" loading={loading} onClick={save}>
                保存标注
              </Button>
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
