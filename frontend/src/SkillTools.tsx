import { useEffect, useState } from "react";
import { Alert, App, Button, Checkbox, Select, Tag, Upload } from "antd";
import { Upload as UploadIcon } from "lucide-react";
import { api } from "./api";

interface Skill {
  id: string;
  name: string;
  description: string;
  sha256: string;
  files: string[];
}
export default function SkillTools({
  live,
  skillIds,
  tools,
  onChange,
}: {
  live: boolean;
  skillIds: string[];
  tools: string[];
  onChange: (value: { skillIds?: string[]; tools?: string[] }) => void;
}) {
  const { message } = App.useApp();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!live) return;
    let active = true;
    api<Skill[]>("/skills")
      .then((rows) => {
        if (active) setSkills(rows);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [live]);
  const upload = async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const skill = await api<Skill>("/skills", { method: "POST", body: form });
      const next = [skill, ...skills.filter((item) => item.id !== skill.id)];
      setSkills(next);
      onChange({
        skillIds: [
          ...skillIds.filter(
            (id) => next.find((item) => item.id === id)?.name !== skill.name,
          ),
          skill.id,
        ],
      });
      message.success(`已上传并选择 ${skill.name}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="application-skills">
      <Alert
        type="info"
        showIcon
        title="让应用按需调用 Skill 与工具"
        description="上传标准 SKILL.md，或上传包含 SKILL.md 与配套文件的 ZIP。模型可激活 Skill 并按需读取文本资源；脚本和外部 MCP 工具暂不执行。工具调用需要模型支持 tool calling。"
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
      <div className="studio-setting">
        <div>
          <strong>Skill 包</strong>
          <p>
            选择当前应用可用的 Skill，发布后使用固定版本。单个上传包不超过 1
            MB。
          </p>
        </div>
        <Upload
          accept=".zip,.md"
          showUploadList={false}
          disabled={!live || loading}
          beforeUpload={(file) => {
            void upload(file);
            return false;
          }}
        >
          <Button icon={<UploadIcon size={14} />} loading={loading}>
            上传 Skill 包
          </Button>
        </Upload>
      </div>
      <Select
        mode="multiple"
        aria-label="绑定 Skill"
        style={{ width: "100%" }}
        value={skillIds}
        onChange={(skillIds) => onChange({ skillIds })}
        disabled={!live}
        placeholder={live ? "选择已上传的 Skill" : "连接服务后可上传 Skill"}
        options={skills.map((s) => ({
          value: s.id,
          label: `${s.name} · ${s.sha256.slice(0, 8)}`,
        }))}
      />
      {skills
        .filter((s) => skillIds.includes(s.id))
        .map((s) => (
          <div key={s.id} className="soft-note">
            <div>
              <strong>{s.name}</strong> <Tag>{s.files.length} 个文件</Tag>
              <p>{s.description}</p>
            </div>
          </div>
        ))}
      <div className="studio-setting">
        <div>
          <strong>内置工具</strong>
          <p>仅为当前应用启用选中的工具，由模型在需要时调用。</p>
        </div>
      </div>
      <Checkbox.Group
        value={tools}
        onChange={(values) => onChange({ tools: values.map(String) })}
        options={[
          { value: "current_time", label: "当前时间" },
          { value: "calculator", label: "算术计算" },
        ]}
      />
    </div>
  );
}
