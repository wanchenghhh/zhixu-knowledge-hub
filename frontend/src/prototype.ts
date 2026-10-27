import { useState } from "react";
import type { Role } from "./data";

export const PROTOTYPE_NOTICE =
  "v1.2 交互原型 · 使用示例资料，新增配置仅保存在此浏览器，暂未接入后端。";
export function usePrototype<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`zhixu-v12-${key}`);
      return stored ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  const save = (next: T) => {
    localStorage.setItem(`zhixu-v12-${key}`, JSON.stringify(next));
    setValue(next);
  };
  return [value, save] as const;
}
export interface ApplicationConfig {
  name: string;
  description: string;
  kind: "service" | "report";
  model: string;
  kbIds: string[];
  prompt: string;
  welcome: string;
  questions: string[];
  fields: string[];
  visible: Role[];
  history: number;
  topK: number;
  threshold: number;
  rerank: boolean;
  currentOnly: boolean;
  filters: string;
  metadataFilters?: import("./MetadataFilters").MetadataFilter[];
  outline: string;
  format: "markdown" | "docx";
}
export interface Application {
  id: string;
  draft: ApplicationConfig;
  published?: ApplicationConfig;
  revision: number;
  updated: string;
}
export const templates: Record<ApplicationConfig["kind"], ApplicationConfig> = {
  service: {
    name: "企业智能客服",
    description: "基于制度与产品资料，提供有来源的多轮解答。",
    kind: "service",
    model: "qwen-plus",
    kbIds: ["hr"],
    prompt:
      "你是企业智能客服。先理解问题，再检索资料；基于当前有效版本回答并标注来源。没有依据时说明信息不足，不编造流程与承诺。",
    welcome: "你好，我是企业知识助手。关于制度和业务流程，有什么可以帮你？",
    questions: ["差旅报销需要哪些材料？", "住宿费用标准是多少？"],
    fields: [],
    visible: ["admin", "manager", "user"],
    history: 6,
    topK: 5,
    threshold: 0.3,
    rerank: true,
    currentOnly: true,
    filters: "",
    outline: "",
    format: "markdown",
  },
  report: {
    name: "业务报告助手",
    description: "从明确任务到章节检索，生成可溯源的结构化报告。",
    kind: "report",
    model: "qwen-plus",
    kbIds: ["product"],
    prompt:
      "你是企业报告撰写助手。根据用户主题生成大纲，逐章节检索资料，再撰写报告。事实与建议分别表达，每个关键结论标注来源；资料不足的章节明确标记待补充。",
    welcome: "提供报告主题、时间范围和写作要求，我将帮你整理一份有依据的报告。",
    questions: ["整理一份本季度产品进展报告"],
    fields: ["报告主题", "时间范围", "面向读者"],
    visible: ["admin", "manager", "user"],
    history: 3,
    topK: 8,
    threshold: 0.3,
    rerank: true,
    currentOnly: true,
    filters: "",
    outline: "一、摘要\n二、重点进展\n三、问题与风险\n四、后续计划",
    format: "markdown",
  },
};
export const seedApplications: Application[] = [
  {
    id: "service-guide",
    draft: structuredClone(templates.service),
    published: structuredClone(templates.service),
    revision: 1,
    updated: "示例配置",
  },
  {
    id: "report-guide",
    draft: structuredClone(templates.report),
    revision: 0,
    updated: "示例草稿",
  },
];
export const exampleKnowledge = [
  { value: "hr", label: "员工制度与人事（示例）" },
  { value: "product", label: "产品与技术文档（示例）" },
];
