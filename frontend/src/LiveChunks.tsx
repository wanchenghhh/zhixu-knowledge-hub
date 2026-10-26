import { useEffect, useState } from "react";
import { App, Button, Input, Modal, Tag } from "antd";
import { ArrowUpRight } from "lucide-react";
import { api, write } from "./api";
import { useStore } from "./store";
import type { Knowledge, Source } from "./data";
type Chunk = {
  id: string;
  text: string;
  location: string;
  metadata: Record<string, unknown>;
};
export default function LiveChunks({
  kb,
  onSource,
}: {
  kb: Knowledge;
  onSource: (s: Source) => void;
}) {
  const { state, refresh } = useStore();
  const { message } = App.useApp();
  const [rows, setRows] = useState<
    (Chunk & { fileId: string; name: string })[]
  >([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Chunk | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const files = state.files.filter(
    (f) => f.kbId === kb.id && f.status === "ready",
  );
  const fingerprint = files
    .map((f) => `${f.id}:${f.updated}:${f.chunkCount}`)
    .join("|");
  const load = async () => {
    const groups = await Promise.all(
      files.map(async (f) =>
        (await api<Chunk[]>(`/files/${f.id}/chunks`)).map((c) => ({
          ...c,
          fileId: f.id,
          name: f.name,
        })),
      ),
    );
    setRows(groups.flat());
  };
  useEffect(() => {
    let active = true;
    const groups = Promise.all(
      files.map(async (f) =>
        (await api<Chunk[]>(`/files/${f.id}/chunks`)).map((c) => ({
          ...c,
          fileId: f.id,
          name: f.name,
        })),
      ),
    );
    groups
      .then((data) => {
        if (active) setRows(data.flat());
      })
      .catch((error) => message.error(String(error)));
    return () => {
      active = false;
    };
  }, [fingerprint]);
  return (
    <section className="chunks-panel">
      <div className="table-toolbar">
        <span>{rows.length} 个已索引片段</span>
        <Input
          aria-label="搜索知识片段"
          placeholder="搜索真实知识片段"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {rows
        .filter((c) => `${c.name}${c.text}`.includes(search))
        .map((c, i) => (
          <article className="chunk-card" key={c.id}>
            <div>
              <span className="chunk-index">CHUNK {i + 1}</span>
              <Tag color="green">已索引</Tag>
              <span className="text-muted">{c.text.length} 字符</span>
              {state.role !== "user" ? (
                <Button
                  type="text"
                  onClick={() => {
                    setEditing(c);
                    setText(c.text);
                  }}
                >
                  编辑片段
                </Button>
              ) : null}
            </div>
            <p>{c.text}</p>
            <button
              className="chunk-source"
              onClick={() =>
                onSource({
                  chunkId: c.id,
                  fileId: c.fileId,
                  kbId: kb.id,
                  name: c.name,
                  text: c.text,
                  location: c.location,
                  score: 1,
                })
              }
            >
              {c.name} · {c.location}
              <ArrowUpRight size={14} />
            </button>
          </article>
        ))}
      <Modal
        title="编辑并更新索引"
        open={!!editing}
        confirmLoading={busy}
        onCancel={() => setEditing(null)}
        okText="保存并重新向量化"
        cancelText="取消"
        onOk={async () => {
          if (!text.trim()) return;
          setBusy(true);
          try {
            await write(`/chunks/${editing?.id}`, { text }, "PATCH");
            await refresh();
            await load();
            setEditing(null);
            message.success("知识片段与索引已更新");
          } catch (error) {
            message.error(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="soft-note">
          保存会调用向量模型，成功后更新索引，失败不覆盖原片段。
        </div>
        <Input.TextArea
          aria-label="片段内容"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={16000}
        />
      </Modal>
    </section>
  );
}
