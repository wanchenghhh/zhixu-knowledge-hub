export type Role = "admin" | "manager" | "user";
export const roles: Record<Role, string> = {
  admin: "管理员",
  manager: "知识库管理人员",
  user: "使用者",
};
export type FileStatus =
  | "ready"
  | "failed"
  | "disabled"
  | "queued"
  | "parsing"
  | "preview"
  | "indexing"
  | "uploading";
export interface Knowledge {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  visible: Role[];
  embedding: string;
  rerankModel?: string | null;
  rerank: boolean;
  topK: number;
  threshold: number;
  prompt: string;
  updated: string;
}
export interface KnowledgeFile {
  id: string;
  kbId: string;
  name: string;
  size: string;
  type: string;
  status: FileStatus;
  content: string;
  location: string;
  updated: string;
  error?: string;
  chunkCount?: number;
  preview?: { text: string; location: string }[];
}
export interface Task {
  id: string;
  kbId: string;
  name: string;
  status: "success" | "failed" | "running" | "queued" | "retried";
  kind?: string;
  stage?: string;
  usage?: {
    calls?: {
      type: string;
      model: string;
      usage?: Record<string, number> | null;
    }[];
  };
  total: number;
  finished: number;
  date: string;
  error?: string;
  fileIds: string[];
}
export interface Source {
  chunkId?: string;
  citation?: number;
  page?: number;
  fileId: string;
  kbId: string;
  name: string;
  location: string;
  text: string;
  score: number;
}
export interface ChatMessage {
  error?: string;
  warnings?: string[];
  id: string;
  kind: "user" | "assistant";
  text: string;
  sources: Source[];
  cancelled?: boolean;
  duration?: number;
  tokens?: number | null;
}
export interface Session {
  id: string;
  role: Role;
  title: string;
  kbIds: string[];
  messages: ChatMessage[];
  date: string;
}
export interface LogEntry {
  details?: {
    stages?: Record<string, number>;
    usage?: Record<string, number>;
    warnings?: string[];
    calls?: {
      type: string;
      model: string;
      usage?: Record<string, number> | null;
    }[];
  };
  id: string;
  role: Role;
  kbIds: string[];
  question: string;
  answer: string;
  status: "success" | "failed" | "cancelled" | "empty";
  tokens: number | null;
  duration: number;
  model: string;
  date: string;
  sources: Source[];
  error?: string;
}
export interface ModelConfig {
  hasKey?: boolean;
  apiKey?: string;
  timeout?: number;
  id: string;
  provider: string;
  type: "LLM" | "Embedding" | "Rerank";
  name: string;
  model: string;
  url: string;
  status: "untested" | "ready" | "failed";
  dimension?: number;
}
export interface State {
  version: 1;
  runtime?: { uploadStrategy: "multipart" | "chunked"; maxFileBytes: number };
  role: Role;
  knowledge: Knowledge[];
  files: KnowledgeFile[];
  tasks: Task[];
  sessions: Session[];
  logs: LogEntry[];
  models: ModelConfig[];
  ocr: { provider: string; region: string; enabled: boolean; hasKey?: boolean };
}
const prompt =
  "你是企业知识助手。请严格基于提供的资料回答，引用来源编号；依据不足时说明未找到相关信息。";
export const seedKnowledge: Knowledge[] = [
  {
    id: "hr",
    name: "员工制度与人事",
    description: "让每一项制度都有据可查，覆盖入职、考勤、假期与报销。",
    category: "人力资源",
    color: "purple",
    icon: "people",
    visible: ["admin", "manager", "user"],
    embedding: "embed-qwen",
    rerank: true,
    topK: 5,
    threshold: 0.45,
    prompt,
    updated: "2026-10-26 10:24",
  },
  {
    id: "product",
    name: "产品与技术文档",
    description: "产品使用手册、接口规范及技术实践，让协作更高效。",
    category: "产品技术",
    color: "blue",
    icon: "box",
    visible: ["admin", "manager", "user"],
    embedding: "embed-qwen",
    rerank: true,
    topK: 5,
    threshold: 0.45,
    prompt,
    updated: "2026-10-26 09:42",
  },
  {
    id: "service",
    name: "客户服务知识",
    description: "常见问题、服务流程与标准话术，持续沉淀服务经验。",
    category: "客户服务",
    color: "teal",
    icon: "chat",
    visible: ["admin", "manager", "user"],
    embedding: "embed-qwen",
    rerank: true,
    topK: 5,
    threshold: 0.45,
    prompt,
    updated: "2026-10-25 16:18",
  },
  {
    id: "finance",
    name: "财务管理规范",
    description: "预算编制与付款审批流程，供知识库管理人员维护。",
    category: "财务管理",
    color: "amber",
    icon: "chart",
    visible: ["admin", "manager"],
    embedding: "embed-qwen",
    rerank: true,
    topK: 5,
    threshold: 0.45,
    prompt,
    updated: "2026-10-25 14:30",
  },
  {
    id: "strategy",
    name: "经营战略资料",
    description: "年度经营规划与管理层会议资料，仅管理员可见。",
    category: "经营管理",
    color: "pink",
    icon: "shield",
    visible: ["admin"],
    embedding: "embed-qwen",
    rerank: true,
    topK: 5,
    threshold: 0.45,
    prompt,
    updated: "2026-10-24 11:05",
  },
  {
    id: "new",
    name: "项目经验沉淀",
    description: "从一次复盘开始，让项目经验成为可复用的知识。",
    category: "项目管理",
    color: "slate",
    icon: "folder",
    visible: ["admin", "manager"],
    embedding: "embed-qwen",
    rerank: true,
    topK: 5,
    threshold: 0.45,
    prompt,
    updated: "2026-10-26 08:50",
  },
];
export const seedFiles: KnowledgeFile[] = [
  {
    id: "f-hr1",
    kbId: "hr",
    name: "员工手册（2026版）.pdf",
    size: "2.4 MB",
    type: "PDF",
    status: "ready",
    content:
      "员工申请年假需提前 3 个工作日在办公系统提交申请，经直属负责人审批后生效。入职满一年可享受 5 天带薪年假。年假应于当年使用，特殊情况经批准可延至次年 3 月 31 日。",
    location: "第 12 页 · 第四章 假期管理",
    updated: "2026-10-26 10:24",
  },
  {
    id: "f-hr2",
    kbId: "hr",
    name: "差旅与费用报销管理办法.docx",
    size: "846 KB",
    type: "WORD",
    status: "ready",
    content:
      "差旅报销应在出差结束后 15 个工作日内提交。所需材料包括：出差申请单、行程单、合规发票及支付凭证。住宿标准：一线城市每晚不超过 500 元，其他城市每晚不超过 350 元。超标部分需补充审批说明。",
    location: "第二章 · 第 3–5 段",
    updated: "2026-10-25 15:30",
  },
  {
    id: "f-hr3",
    kbId: "hr",
    name: "新员工入职指引.md",
    size: "24 KB",
    type: "MD",
    status: "ready",
    content:
      "新员工入职当天需携带身份证、学历证明及银行卡信息，到人力资源部办理入职。完成劳动合同签署、办公设备领取及信息安全培训。试用期内由导师协助制定成长计划，每月进行一次反馈。",
    location: "入职准备 · 第 8–15 行",
    updated: "2026-10-24 14:20",
  },
  {
    id: "f-hr4",
    kbId: "hr",
    name: "考勤流程扫描件.png",
    size: "1.1 MB",
    type: "IMAGE",
    status: "failed",
    content: "考勤异常需在三个工作日内提交补卡申请，由直属负责人审核。",
    location: "图片 · 识别区域 1",
    updated: "2026-10-26 09:12",
    error: "云端 OCR 请求超时。请检查解析服务后重试。",
  },
  {
    id: "f-pr1",
    kbId: "product",
    name: "知序产品使用指南.pdf",
    size: "3.8 MB",
    type: "PDF",
    status: "ready",
    content:
      "知序支持创建知识库、批量导入文件及在线对话。导入流程为：选择文件、解析与分块、预览确认、构建索引。文件状态变为“已就绪”后，即可选择该知识库进行问答。管理员可以在模型服务中配置对话、向量和重排模型。",
    location: "第 5 页 · 2.1 知识导入",
    updated: "2026-10-26 09:42",
  },
  {
    id: "f-pr2",
    kbId: "product",
    name: "接口设计规范.md",
    size: "68 KB",
    type: "MD",
    status: "ready",
    content:
      "所有业务接口使用 /api/v1 前缀。成功响应包含 data，失败响应包含 code、message 和 request_id。API Key 仅在后端使用，不得写入前端代码。对话接口采用 SSE 推送状态、文本与引用。",
    location: "接口约定 · 第 12–24 行",
    updated: "2026-10-25 11:20",
  },
  {
    id: "f-s1",
    kbId: "service",
    name: "客户服务常见问题.xlsx",
    size: "128 KB",
    type: "EXCEL",
    status: "ready",
    content:
      "问题：忘记密码怎么办？答：通过企业统一身份平台重置密码，或联系 IT 服务台。问题：如何反馈产品问题？答：提交问题描述、复现步骤和截图，工作日 2 小时内响应。问题：服务时间？答：工作日 9:00–18:00。",
    location: "常见问题 · 第 2–8 行",
    updated: "2026-10-25 16:18",
  },
  {
    id: "f-fi1",
    kbId: "finance",
    name: "预算审批管理规范.pdf",
    size: "1.8 MB",
    type: "PDF",
    status: "ready",
    content:
      "部门年度预算于每年 11 月提交。单笔付款 5 万元以内由部门负责人和财务审批，超过 5 万元增加总经理审批。所有付款必须附合同、验收材料及合法发票。",
    location: "第 8 页 · 付款审批",
    updated: "2026-10-25 14:30",
  },
  {
    id: "f-st1",
    kbId: "strategy",
    name: "年度经营规划.pdf",
    size: "4.2 MB",
    type: "PDF",
    status: "ready",
    content:
      "年度经营规划关注产品质量、客户成功与组织效率。季度复盘由管理层组织，评估重点项目进度和资源投入。此资料仅向管理员角色开放。",
    location: "第 3 页 · 经营重点",
    updated: "2026-10-24 11:05",
  },
];
export const seedModels: ModelConfig[] = [
  {
    id: "llm-qwen",
    provider: "通义百炼",
    type: "LLM",
    name: "通义 · 企业问答",
    model: "qwen-plus",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    status: "ready",
  },
  {
    id: "embed-qwen",
    provider: "通义百炼",
    type: "Embedding",
    name: "通义 · 文本向量",
    model: "text-embedding-v4",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    status: "ready",
    dimension: 1024,
  },
  {
    id: "rerank-qwen",
    provider: "通义百炼",
    type: "Rerank",
    name: "通义 · 结果重排",
    model: "gte-rerank-v2",
    url: "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
    status: "ready",
  },
  {
    id: "llm-or",
    provider: "OpenRouter",
    type: "LLM",
    name: "OpenRouter · 备用对话",
    model: "请填写模型 ID",
    url: "https://openrouter.ai/api/v1",
    status: "untested",
  },
  {
    id: "rerank-ah",
    provider: "AIHubMix",
    type: "Rerank",
    name: "AIHubMix · 备用重排",
    model: "jina-reranker-v3",
    url: "https://aihubmix.com/v1",
    status: "untested",
  },
];
export const sourceOf = (file: KnowledgeFile, score = 0.94): Source => ({
  fileId: file.id,
  kbId: file.kbId,
  name: file.name,
  location: file.location,
  text: file.content,
  score,
});
export function initialState(): State {
  return {
    version: 1,
    role: "admin",
    knowledge: structuredClone(seedKnowledge),
    files: structuredClone(seedFiles),
    models: structuredClone(seedModels),
    sessions: [],
    ocr: {
      provider: "阿里云 DocMind",
      region: "华东 1（杭州）",
      enabled: true,
    },
    tasks: [
      {
        id: "task-1",
        kbId: "hr",
        name: "人事制度 · 批量导入",
        status: "failed",
        total: 4,
        finished: 3,
        date: "2026-10-26 10:24",
        error: "1 个文件 OCR 超时，可单独重试",
        fileIds: ["f-hr1", "f-hr2", "f-hr3", "f-hr4"],
      },
      {
        id: "task-2",
        kbId: "product",
        name: "产品文档 · 索引构建",
        status: "success",
        total: 2,
        finished: 2,
        date: "2026-10-26 09:42",
        fileIds: ["f-pr1", "f-pr2"],
      },
    ],
    logs: Array.from({ length: 16 }, (_, i) => {
      const kbId = i % 3 === 0 ? "product" : i % 3 === 1 ? "hr" : "service";
      const file = seedFiles.find(
        (f) => f.kbId === kbId && f.status === "ready",
      )!;
      return {
        id: `log-${i}`,
        role: i % 4 === 0 ? "manager" : "user",
        kbIds: [kbId],
        question:
          kbId === "hr"
            ? "年假应该提前多久申请？"
            : kbId === "product"
              ? "如何导入文件并构建知识库？"
              : "产品问题如何反馈？",
        answer: file.content,
        status: i === 5 ? "failed" : i === 9 ? "empty" : "success",
        tokens: i === 5 ? null : 680 + i * 37,
        duration: 2.1 + (i % 5) * 0.43,
        model: "qwen-plus",
        date: `2026-10-${String(26 - Math.floor(i / 3)).padStart(2, "0")} ${String(10 - (i % 3)).padStart(2, "0")}:${String(12 + i).padStart(2, "0")}`,
        sources: i === 5 || i === 9 ? [] : [sourceOf(file)],
        error: i === 5 ? "模型服务请求超时" : undefined,
      } as LogEntry;
    }),
  };
}
