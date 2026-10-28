import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Modal, Radio, Select } from "antd";
import { api, write } from "../api";
import "./evaluation.css";
export interface Dataset {
  id: string;
  name: string;
  description: string;
  count: number;
  good: number;
  bad: number;
  updated: string;
}
export interface EvaluationCase {
  id: string;
  datasetId: string;
  logId: string;
  label: "good" | "bad";
  note: string;
  expected: string;
  created: string;
  snapshot: {
    question: string;
    answer: string;
    kbIds: string[];
    model: string;
    tokens: number | null;
    status: string;
    logDate: string;
    sources: { name: string; location: string; text: string }[];
  };
}
export default function CaseCollector({
  logId,
  onClose,
}: {
  logId: string | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [sets, setSets] = useState<Dataset[]>([]);
  const [chosen, setChosen] = useState<string>();
  const [label, setLabel] = useState<"good" | "bad">("good");
  const [note, setNote] = useState("");
  const [expected, setExpected] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!logId) return;
    let active = true;
    setError("");
    setNote("");
    setExpected("");
    setLabel("good");
    api<Dataset[]>("/evaluation-datasets")
      .then((rows) => {
        if (active) {
          setSets(rows);
          setChosen(rows[0]?.id);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [logId]);
  const create = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const row = await write<Dataset>("/evaluation-datasets", {
        name: name.trim(),
        description: "",
      });
      setSets([row, ...sets]);
      setChosen(row.id);
      setName("");
      message.success("评测集已创建");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  const save = async () => {
    if (!chosen) {
      setError("请选择或创建评测集");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await write(`/evaluation-datasets/${chosen}/cases`, {
        logId,
        label,
        note,
        expected,
      });
      message.success("已加入评测集");
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal
      open={!!logId}
      title="加入评测集"
      onCancel={onClose}
      onOk={save}
      okText="保存案例"
      confirmLoading={loading}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <p>将这条真实日志保存为案例，原日志过期后仍可查看保存时的内容。</p>
      <p>评测集</p>
      <Select
        aria-label="选择评测集"
        style={{ width: "100%" }}
        value={chosen}
        options={sets.map((x) => ({
          value: x.id,
          label: `${x.name} · ${x.count} 条`,
        }))}
        onChange={setChosen}
        placeholder="请选择评测集"
      />
      <div className="case-create">
        <Input
          aria-label="新评测集名称"
          placeholder="新评测集名称"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button onClick={create} loading={loading} disabled={!name.trim()}>
          创建评测集
        </Button>
      </div>
      <p>案例标签</p>
      <Radio.Group
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        options={[
          { value: "good", label: "Good Case" },
          { value: "bad", label: "Bad Case" },
        ]}
      />
      <p>备注（可选）</p>
      <Input.TextArea
        aria-label="案例备注"
        rows={2}
        maxLength={4000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="记录好在哪里，或需要改进的问题"
      />
      <p>期望答案（可选）</p>
      <Input.TextArea
        aria-label="期望答案"
        rows={3}
        maxLength={8000}
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
        placeholder="用于后续评测的参考答案"
      />
    </Modal>
  );
}
