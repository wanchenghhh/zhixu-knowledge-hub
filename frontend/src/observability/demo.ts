/** Isolated design fixtures. Never merged with server logs, usage or billing. */
export type RunKind = "build" | "agent" | "chat";
export type RunStatus = "success" | "failed" | "waiting";
export interface Span {
  id: string;
  parent?: string;
  name: string;
  type: "pipeline" | "LLM" | "tool" | "skill" | "wait";
  status: "成功" | "失败" | "已加载" | "等待确认";
  offset: number;
  duration: number;
  input: unknown;
  output: unknown;
  inputTokens?: number;
  outputTokens?: number;
  usage?: "actual" | "unknown";
  cost?: number;
  context?: Record<string, unknown>;
  error?: { code: string; message: string; attempts: number; recovery: string };
}
export interface DemoRun {
  id: string;
  name: string;
  kind: RunKind;
  status: RunStatus;
  entity: string;
  version: string;
  started: string;
  spans: Span[];
  warnings: string[];
}
const context = {
  systemPrompt:
    "依据当前有效制度回答，使用 [序号] 标注证据；原文缺失的信息请说明未识别。",
  promptVersion: "制度助手 v3",
  messages: [{ role: "user", content: "出差报销需要哪些材料，多久内提交？" }],
  document: "差旅制度 v2.pdf",
  documentVersion: "v2 · 当前有效",
  page: 3,
  snippet: "返回后15个工作日内提交报销材料，包括审批单、发票和行程凭证。",
  retrieval: { topK: 5, filters: { effective: true }, candidates: 20 },
  model: "qwen-plus（示例）",
  temperature: 0.2,
};
export const demoRuns: DemoRun[] = [
  {
    id: "demo-build-01",
    name: "差旅制度 v2 · 索引构建",
    kind: "build",
    status: "success",
    entity: "差旅制度知识库（示例）",
    version: "索引代次 2",
    started: "2026-10-28 14:10:00",
    warnings: ["负责人未识别，待人工补充"],
    spans: [
      {
        id: "upload",
        name: "文件上传与私有存储",
        type: "pipeline",
        status: "成功",
        offset: 0,
        duration: 0.4,
        input: { file: "差旅制度 v2.pdf", size: "84 KB" },
        output: { stored: true, version: "v2" },
      },
      {
        id: "parse",
        name: "文档解析",
        type: "pipeline",
        status: "成功",
        offset: 0.4,
        duration: 1.2,
        input: { format: "PDF", pages: 8 },
        output: { pages: 8, tables: 2, ocr: "文本 PDF，本次未调用 OCR" },
      },
      {
        id: "metadata",
        name: "抽取文档元数据",
        type: "LLM",
        status: "成功",
        offset: 1.6,
        duration: 2,
        input: {
          document: "差旅制度 v2.pdf",
          fields: ["日期", "版本", "主体", "负责人", "关键词", "建议问题"],
        },
        output: {
          date: "2026-10-01",
          version: "v2",
          entity: "示例企业",
          owner: "未识别",
          keywords: ["差旅", "报销"],
          questions: ["多久内提交报销？"],
        },
        inputTokens: 1320,
        outputTokens: 280,
        usage: "actual",
        cost: 0.0032,
      },
      {
        id: "split",
        name: "智能切分",
        type: "pipeline",
        status: "成功",
        offset: 3.6,
        duration: 0.3,
        input: { maxLength: 2000, parentChild: true },
        output: { chunks: 32, parents: 8, tableHeader: true },
      },
      {
        id: "embed",
        name: "文档与建议问题向量化",
        type: "LLM",
        status: "成功",
        offset: 3.9,
        duration: 3.8,
        input: { model: "text-embedding-v4", chunks: 32, questions: 8 },
        output: { vectors: 40, dimensions: 1024 },
        inputTokens: 2130,
        outputTokens: 0,
        usage: "actual",
        cost: 0.001,
      },
      {
        id: "index",
        name: "索引写入与生效切换",
        type: "pipeline",
        status: "成功",
        offset: 7.7,
        duration: 0.7,
        input: { generation: 2 },
        output: { written: 40, activeGeneration: 2, previousGeneration: 1 },
      },
    ],
  },
  {
    id: "demo-agent-02",
    name: "差旅制度报告 · 章节生成",
    kind: "agent",
    status: "failed",
    entity: "制度报告助手（示例）",
    version: "发布版 v3",
    started: "2026-10-28 14:30:00",
    warnings: ["章节生成未返回 usage，用量汇总为部分已知"],
    spans: [
      {
        id: "validate",
        name: "任务输入校验",
        type: "pipeline",
        status: "成功",
        offset: 0,
        duration: 0.02,
        input: { topic: "差旅制度说明报告" },
        output: { valid: true },
      },
      {
        id: "skill",
        name: "Skill · 制度报告规范 v1",
        type: "skill",
        status: "已加载",
        offset: 0.02,
        duration: 0.04,
        input: {
          name: "制度报告规范",
          version: "v1",
          source: "应用配置",
          hash: "demo-a81c",
        },
        output: {
          loaded: true,
          instructions: "按适用范围、材料、期限编排，保留引用。",
        },
        context: {
          activation: "应用显式选择",
          resource: "报告规范.md",
          execution: "仅加载；后续模型执行作为子节点",
        },
      },
      {
        id: "outline",
        parent: "skill",
        name: "LLM · 生成大纲",
        type: "LLM",
        status: "成功",
        offset: 0.06,
        duration: 1.8,
        input: { task: "生成差旅制度说明报告" },
        output: { outline: ["适用范围", "报销材料", "提交期限"] },
        inputTokens: 620,
        outputTokens: 210,
        usage: "actual",
        cost: 0.00166,
        context,
      },
      {
        id: "wait",
        name: "等待用户确认大纲",
        type: "wait",
        status: "成功",
        offset: 1.86,
        duration: 80,
        input: { outlineVersion: 1 },
        output: { confirmed: true, checkpoint: "outline-1" },
      },
      {
        id: "search",
        parent: "skill",
        name: "工具 · knowledge_search",
        type: "tool",
        status: "成功",
        offset: 81.86,
        duration: 0.64,
        input: { query: "差旅报销材料与提交期限", topK: 5 },
        output: {
          matches: 5,
          sources: [{ file: "差旅制度 v2.pdf", page: 3, version: "v2" }],
        },
        context,
      },
      {
        id: "chapter",
        parent: "skill",
        name: "LLM · 生成报告章节",
        type: "LLM",
        status: "成功",
        offset: 82.5,
        duration: 4.6,
        input: { chapter: "报销材料", context: context.snippet },
        output: { text: "报销需提交审批单、发票和行程凭证。[1]" },
        usage: "unknown",
        context,
      },
      {
        id: "export",
        name: "工具 · document_export",
        type: "tool",
        status: "失败",
        offset: 87.1,
        duration: 0.18,
        input: { format: "docx", sections: "缺少数组结构" },
        output: { created: false },
        error: {
          code: "tool.schema_validation",
          message: "sections 必须为数组，参数校验失败；未生成文件。",
          attempts: 2,
          recovery: "重试后仍失败；检查工具参数与版本 schema。",
        },
      },
    ],
  },
  {
    id: "demo-chat-03",
    name: "差旅报销需要哪些材料？",
    kind: "chat",
    status: "success",
    entity: "制度咨询客服（示例）",
    version: "发布版 v2",
    started: "2026-10-28 15:00:00",
    warnings: [],
    spans: [
      {
        id: "validate",
        name: "输入校验",
        type: "pipeline",
        status: "成功",
        offset: 0,
        duration: 0.02,
        input: { question: "差旅报销需要哪些材料？" },
        output: { valid: true },
      },
      {
        id: "embed",
        name: "查询 Embedding",
        type: "LLM",
        status: "成功",
        offset: 0.02,
        duration: 0.2,
        input: { query: "差旅报销需要哪些材料？", model: "text-embedding-v4" },
        output: { dimensions: 1024 },
        inputTokens: 12,
        outputTokens: 0,
        usage: "actual",
        cost: 0.000006,
      },
      {
        id: "retrieve",
        name: "混合召回",
        type: "tool",
        status: "成功",
        offset: 0.22,
        duration: 0.1,
        input: { filters: { effective: true }, topK: 20 },
        output: { candidates: 20, method: "RRF" },
        context,
      },
      {
        id: "rerank",
        parent: "retrieve",
        name: "Rerank · 候选重排",
        type: "LLM",
        status: "成功",
        offset: 0.32,
        duration: 0.3,
        input: { model: "gte-rerank-v2", documents: 20 },
        output: { kept: 5, scoreType: "rerank", billingUnit: "未返回计量" },
        usage: "unknown",
      },
      {
        id: "generate",
        name: "LLM · 流式回答",
        type: "LLM",
        status: "成功",
        offset: 0.62,
        duration: 2.3,
        input: { messages: context.messages, context: context.snippet },
        output: {
          answer: "请提交审批单、发票与行程凭证，返回后15个工作日内提交。[1]",
          firstTokenMs: 540,
        },
        inputTokens: 940,
        outputTokens: 308,
        usage: "actual",
        cost: 0.002496,
        context,
      },
      {
        id: "save",
        name: "引用校验与记录保存",
        type: "pipeline",
        status: "成功",
        offset: 2.92,
        duration: 0.1,
        input: { citations: [1] },
        output: {
          valid: true,
          sources: [{ file: "差旅制度 v2.pdf", page: 3 }],
        },
      },
    ],
  },
  {
    id: "demo-agent-04",
    name: "报告大纲 · 等待确认",
    kind: "agent",
    status: "waiting",
    entity: "制度报告助手（示例）",
    version: "发布版 v3",
    started: "2026-10-28 15:10:00",
    warnings: [],
    spans: [
      {
        id: "outline",
        name: "LLM · 生成大纲",
        type: "LLM",
        status: "成功",
        offset: 0,
        duration: 1.8,
        input: { task: "编写制度报告" },
        output: { outline: ["适用范围", "操作要求"] },
        inputTokens: 620,
        outputTokens: 210,
        usage: "actual",
        cost: 0.00166,
        context,
      },
      {
        id: "wait",
        name: "等待用户确认",
        type: "wait",
        status: "等待确认",
        offset: 1.8,
        duration: 80,
        input: { outlineVersion: 1 },
        output: { checkpoint: "outline-1", awaiting: "user_confirmation" },
      },
    ],
  },
];
export const kindLabels: Record<RunKind, string> = {
  build: "知识库构建",
  agent: "Agent 运行",
  chat: "对话日志",
};
export const statusLabels: Record<RunStatus, string> = {
  success: "成功",
  failed: "失败",
  waiting: "等待确认",
};
export function summary(run: DemoRun) {
  const calls = run.spans.filter((s) => s.type === "LLM");
  return {
    tokens: calls.reduce(
      (n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
      0,
    ),
    unknown: calls.filter((s) => s.usage === "unknown").length,
    cost: calls.reduce((n, s) => n + (s.cost ?? 0), 0),
    unpriced: calls.filter((s) => s.cost === undefined).length,
    elapsed: Math.max(...run.spans.map((s) => s.offset + s.duration)),
    active: run.spans
      .filter((s) => s.type !== "wait")
      .reduce((n, s) => n + s.duration, 0),
  };
}
