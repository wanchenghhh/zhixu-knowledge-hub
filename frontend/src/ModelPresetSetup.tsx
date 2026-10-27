import { useEffect, useState } from "react";
import { Alert, App, Button, Checkbox, Form, Input, Modal, Tag } from "antd";
import { ExternalLink, KeyRound } from "lucide-react";
import { api, write } from "./api";
import { useStore } from "./store";

interface Preset {
  id: string;
  provider: string;
  title: string;
  pricing: string;
  description: string;
  keyUrl: string;
  docsUrl: string;
  hasStoredKey: boolean;
  models: { name: string; type: string; model: string }[];
}

export default function ModelPresetSetup({
  onInstalled,
}: {
  onInstalled: (provider: string) => void;
}) {
  const { state, refresh } = useStore();
  const { message } = App.useApp();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Preset | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const apiKey = Form.useWatch("apiKey", form);
  useEffect(() => {
    let active = true;
    api<Preset[]>("/model-presets")
      .then((value) => {
        if (active) setPresets(value);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const close = () => {
    if (!saving) {
      form.resetFields();
      setSelected(null);
    }
  };
  const save = async () => {
    if (!selected) return;
    const values = await form.validateFields().catch(() => undefined);
    if (!values) return;
    setSaving(true);
    try {
      await write(`/model-presets/${selected.id}/install`, {
        apiKey: values.apiKey?.trim() || undefined,
        freeQuotaConfirmed: !!values.freeQuotaConfirmed,
      });
      await refresh();
      setPresets(await api<Preset[]>("/model-presets"));
      onInstalled(selected.provider);
      form.resetFields();
      setSelected(null);
      message.success(
        values.apiKey?.trim() || selected.hasStoredKey
          ? "凭证已保存，请逐项执行连接测试"
          : "预设已保存，待填写服务商密钥",
      );
    } catch (e) {
      message.error(String(e));
    } finally {
      setSaving(false);
    }
  };
  if (!presets.length && !error) return null;
  return (
    <section className="model-preset-section" aria-label="免费与试用模型接入">
      <div className="studio-panel-heading">
        <h2>免费与试用快捷接入</h2>
        <span className="text-muted">各服务商使用各自的 API Key</span>
      </div>
      {error ? (
        <Alert
          type="warning"
          showIcon
          title="接入预设暂时未加载"
          description={error}
        />
      ) : null}
      <div className="model-preset-grid">
        {presets.map((preset) => {
          const configured = state.models.filter(
            (m) =>
              m.provider === preset.provider &&
              preset.models.some(
                (item) => item.type === m.type && item.model === m.model,
              ),
          );
          const ready = configured.filter(
            (m) => m.hasKey && m.status === "ready",
          ).length;
          return (
            <article className="model-preset-card" key={preset.id}>
              <div className="studio-panel-heading">
                <h3>{preset.title}</h3>
                <Tag color={preset.id === "openrouter" ? "green" : "gold"}>
                  {preset.id === "openrouter" ? "免费模型" : "试用额度"}
                </Tag>
              </div>
              <strong className="model-preset-pricing">{preset.pricing}</strong>
              <p>{preset.description}</p>
              <div className="model-preset-models">
                {preset.models.map((model) => (
                  <span key={model.model}>
                    <Tag>{model.type}</Tag>
                    <code>{model.model}</code>
                  </span>
                ))}
              </div>
              <div className="model-preset-footer">
                <span>
                  {configured.length
                    ? `已预置 ${configured.length} 项 · 已验证 ${ready} 项`
                    : "尚未添加预设"}
                </span>
                <Button
                  icon={<KeyRound size={14} />}
                  onClick={() => {
                    form.resetFields();
                    setSelected(preset);
                  }}
                >
                  {configured.length ? "配置接入密钥" : "添加接入预设"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <Modal
        title={selected?.title || "模型接入"}
        open={!!selected}
        onCancel={close}
        onOk={save}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        okText="保存接入配置"
        forceRender
        width={620}
      >
        {selected ? (
          <>
            <Alert
              type={selected.id === "openrouter" ? "info" : "warning"}
              showIcon
              title={selected.pricing}
              description={selected.description}
            />
            <div className="model-preset-links">
              <a href={selected.keyUrl} target="_blank" rel="noreferrer">
                获取服务商 API Key <ExternalLink size={12} />
              </a>
              <a href={selected.docsUrl} target="_blank" rel="noreferrer">
                查看官方额度规则 <ExternalLink size={12} />
              </a>
            </div>
            <Form form={form} layout="vertical">
              <Form.Item
                name="apiKey"
                label={`${selected.provider} API Key`}
                extra={
                  selected.hasStoredKey
                    ? `留空复用该服务商已保存的密钥。${selected.id === "tongyi" ? "同一北京地域密钥可配置三类模型。" : ""}`
                    : "可以先留空保存预设；未填写前不会变为可用，也不会发起模型调用。"
                }
              >
                <Input.Password
                  maxLength={2000}
                  autoComplete="new-password"
                  placeholder="只在此处填写，密钥由服务端加密保存"
                  disabled={saving}
                />
              </Form.Item>
              {selected.id === "tongyi" ? (
                <Form.Item
                  name="freeQuotaConfirmed"
                  valuePropName="checked"
                  rules={[
                    {
                      validator: (_, value) =>
                        (apiKey?.trim() || selected.hasStoredKey) && !value
                          ? Promise.reject(
                              new Error("请先确认百炼的免费额度与用完即停设置"),
                            )
                          : Promise.resolve(),
                    },
                  ]}
                >
                  <Checkbox disabled={saving}>
                    我已在百炼确认上述三个模型仍有免费额度，并开启“免费额度用完即停”。
                  </Checkbox>
                </Form.Item>
              ) : null}
            </Form>
            <p className="studio-help">
              保存后请在下方列表逐项执行连接测试；只有真实测试成功的模型才可用于知识库和应用。
            </p>
          </>
        ) : null}
      </Modal>
    </section>
  );
}
