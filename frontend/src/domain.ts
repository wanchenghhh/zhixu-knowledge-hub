import type { Knowledge, KnowledgeFile, LogEntry, Role, Source } from "./data";
import { sourceOf } from "./data";
export function visibleKnowledge(knowledge: Knowledge[], role: Role) {
  return knowledge.filter((k) => role === "admin" || k.visible.includes(role));
}
export function accessibleLogs(
  logs: LogEntry[],
  knowledge: Knowledge[],
  role: Role,
) {
  const ids = new Set(visibleKnowledge(knowledge, role).map((k) => k.id));
  return role === "user"
    ? []
    : logs.filter((l) => l.kbIds.every((id) => ids.has(id)));
}
export function validateFile(name: string, size: number) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (
    ![
      "pdf",
      "docx",
      "doc",
      "md",
      "png",
      "jpg",
      "jpeg",
      "xlsx",
      "xls",
      "csv",
    ].includes(ext || "")
  )
    return "不支持此文件格式";
  if (size > 20 * 1024 * 1024) return "文件超过 20 MB，请选择较小文件";
  if (size === 0) return "文件为空，无法导入";
  return null;
}
export function fileType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ["doc", "docx"].includes(ext)
    ? "WORD"
    : ["xls", "xlsx", "csv"].includes(ext)
      ? "EXCEL"
      : ["png", "jpg", "jpeg"].includes(ext)
        ? "IMAGE"
        : ext.toUpperCase();
}
export function readableSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
const groups = [
  ["年假", "假期", "休假", "请假"],
  ["报销", "差旅", "住宿", "发票"],
  ["入职", "新员工", "导师"],
  ["补卡", "考勤"],
  ["导入", "知识库", "构建", "上传"],
  ["接口", "api", "密钥", "sse"],
  ["客户", "密码", "服务", "反馈"],
  ["预算", "付款", "审批"],
  ["经营", "战略", "复盘"],
];
export function retrieveDemo(
  question: string,
  files: KnowledgeFile[],
  ids: string[],
  limit = 5,
): Source[] {
  const lower = question.toLowerCase();
  const group = groups.find((words) => words.some((w) => lower.includes(w)));
  if (!group) return [];
  return files
    .filter((f) => ids.includes(f.kbId) && f.status === "ready")
    .map((f) => ({
      file: f,
      score: group.reduce(
        (n, w) => n + (f.content.toLowerCase().includes(w) ? 1 : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x, i) => sourceOf(x.file, Math.max(0.5, 0.96 - i * 0.07)));
}
export function answerDemo(question: string, sources: Source[]) {
  if (!sources.length)
    return "当前知识库中未找到足够依据。\n\n你可以换一种问法，或联系知识库管理人员补充相关资料。";
  return `根据已选择知识库中的资料，关于“${question}”：\n\n${sources
    .slice(0, 2)
    .map((s, i) => `${s.text} [${i + 1}]`)
    .join("\n\n")}\n\n以上内容来自当前资料版本，请结合实际业务流程使用。`;
}
export const nowLabel = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
export const uid = () => crypto.randomUUID();
