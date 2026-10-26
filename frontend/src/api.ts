import type { Role } from "./data";
let currentRole: Role =
  (sessionStorage.getItem("zhixu-live-role") as Role) || "admin";
if (!["admin", "manager", "user"].includes(currentRole)) currentRole = "admin";
let browserId = localStorage.getItem("zhixu-browser-id");
if (!browserId) {
  browserId = crypto.randomUUID();
  localStorage.setItem("zhixu-browser-id", browserId);
}
export function setApiRole(role: Role) {
  currentRole = role;
  sessionStorage.setItem("zhixu-live-role", role);
}
export function getApiRole() {
  return currentRole;
}
export function apiHeaders() {
  return { "X-Role": currentRole, "X-Session-ID": browserId! };
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: {
      ...apiHeaders(),
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: `请求失败 (${response.status})` }));
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : JSON.stringify(body.message),
    );
  }
  return response.json();
}
export function write<T = unknown>(
  path: string,
  body: unknown,
  method = "POST",
) {
  return api<T>(path, { method, body: JSON.stringify(body) });
}
export async function downloadOriginal(id: string, name: string) {
  const r = await fetch(`/api/v1/files/${id}/download`, {
    headers: apiHeaders(),
  });
  if (!r.ok) throw new Error("原文件不可访问");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function streamChat(
  body: unknown,
  signal: AbortSignal,
  onEvent: (name: string, data: Record<string, unknown>) => void,
) {
  const response = await fetch("/api/v1/chat", {
    method: "POST",
    headers: { ...apiHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message || "对话请求失败");
  }
  if (!response.body) throw new Error("浏览器不支持流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const name = raw
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (name && data) onEvent(name, JSON.parse(data));
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function uploadKnowledgeFile(
  kbId: string,
  file: File,
  options: unknown,
  strategy: string = "multipart",
  onProgress?: (percent: number) => void,
) {
  if (strategy !== "chunked") {
    const data = new FormData();
    data.append("file", file);
    data.append("consent", "true");
    data.append("options", JSON.stringify(options));
    return api<{ file: { id: string } }>(`/knowledge/${kbId}/upload`, {
      method: "POST",
      body: data,
    });
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const upload = await write<{
    id: string;
    partBytes: number;
    received: string[];
  }>(`/knowledge/${kbId}/uploads`, {
    name: file.name,
    size: file.size,
    sha256,
    options,
    consent: true,
  });
  const parts = Math.ceil(file.size / upload.partBytes);
  for (let index = 0; index < parts; index++) {
    if (!upload.received.includes(String(index)))
      await api(`/files/${upload.id}/parts/${index}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(
          index * upload.partBytes,
          (index + 1) * upload.partBytes,
        ),
      });
    onProgress?.(Math.round(((index + 1) / parts) * 100));
  }
  return write<{ file: { id: string } }>(
    `/files/${upload.id}/complete-upload`,
    {},
  );
}
