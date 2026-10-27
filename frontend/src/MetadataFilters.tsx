import { useEffect, useState } from "react";
import { Button, Input, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { api } from "./api";
export interface MetadataFilter {
  field: string;
  operator: "eq" | "contains" | "gte" | "lte";
  value: string | number;
}
export default function MetadataFilters({
  kbIds,
  value,
  onChange,
}: {
  kbIds: string[];
  value: MetadataFilter[];
  onChange: (v: MetadataFilter[]) => void;
}) {
  const [fields, setFields] = useState<
    { id: string; name: string; type: string }[]
  >([]);
  const signature = kbIds.join(",");
  useEffect(() => {
    let active = true;
    Promise.allSettled(
      kbIds.map((id) =>
        api<{
          fields: {
            id: string;
            name: string;
            type: string;
            enabled: boolean;
          }[];
        }>(`/knowledge/${id}/processing`),
      ),
    ).then((results) => {
      if (!active) return;
      const map = new Map<string, { id: string; name: string; type: string }>();
      for (const result of results)
        if (result.status === "fulfilled")
          for (const f of result.value.fields) if (f.enabled) map.set(f.id, f);
      setFields([...map.values()]);
    });
    return () => {
      active = false;
    };
  }, [signature]);
  return (
    <div>
      {value.map((row, i) => (
        <div key={i} className="live-filter-row">
          <Select
            aria-label="过滤字段"
            style={{ width: 140 }}
            value={row.field || undefined}
            placeholder="选择字段"
            options={fields.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(field) =>
              onChange(
                value.map((r, n) =>
                  n === i ? { ...r, field, operator: "eq" } : r,
                ),
              )
            }
          />
          <Select
            aria-label="比较方式"
            value={row.operator}
            style={{ width: 110 }}
            options={[
              { value: "eq", label: "等于" },
              ...(["日期", "数字"].includes(
                fields.find((f) => f.id === row.field)?.type || "",
              )
                ? []
                : [{ value: "contains", label: "包含" }]),
              ...(["日期", "数字"].includes(
                fields.find((f) => f.id === row.field)?.type || "",
              )
                ? [
                    { value: "gte", label: "大于等于" },
                    { value: "lte", label: "小于等于" },
                  ]
                : []),
            ]}
            onChange={(operator) =>
              onChange(value.map((r, n) => (n === i ? { ...r, operator } : r)))
            }
          />
          <Input
            aria-label="过滤值"
            value={row.value}
            placeholder="输入匹配值"
            onChange={(e) =>
              onChange(
                value.map((r, n) =>
                  n === i ? { ...r, value: e.target.value } : r,
                ),
              )
            }
          />
          <Button
            type="text"
            aria-label="删除过滤条件"
            icon={<Trash2 size={14} />}
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          />
        </div>
      ))}
      <Button
        size="small"
        disabled={!fields.length || value.length >= 20}
        icon={<Plus size={13} />}
        onClick={() =>
          onChange([
            ...value,
            { field: fields[0]?.id || "", operator: "eq", value: "" },
          ])
        }
      >
        添加过滤条件
      </Button>
    </div>
  );
}
