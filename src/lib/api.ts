// ============================================================================
// API クライアント (同一オリジン /api/v1)
// ============================================================================

export const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL
  ?? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "";

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  retryable: boolean;
  constructor(code: string, message: string, status: number, requestId?: string, retryable = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    credentials: "include",
  });
  if (!res.ok) {
    let data: { error?: { code: string; message: string; request_id?: string; retryable?: boolean } } | null = null;
    try { data = await res.json(); } catch { /* ignore */ }
    throw new ApiError(
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.message ?? `HTTP ${res.status}`,
      res.status,
      data?.error?.request_id,
      data?.error?.retryable ?? false,
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

// ---- 型 (worker/src/shared.ts と対応) ----
export interface User {
  id: string;
  login_id: string;
  display_name: string;
  role: string;
  storage_quota_bytes: number;
  status: string;
  last_login_at: string | null;
  created_at: string;
}
export interface Conversation { id: string; user_id: string; project_id: string | null; title: string; created_at: string; updated_at: string; project_name?: string | null; last_message?: string | null; }
export interface Message { id: string; conversation_id: string; role: string; content: string; model: string | null; token_usage: { total_tokens?: number } | null; created_at: string; }
export interface WorkItem { id: string; user_id: string; project_id: string | null; goal: string; constraints: string; status: string; version: number; started_at: string | null; finished_at: string | null; created_at: string; updated_at: string; project_name?: string | null; }
export interface AgentRun { id: string; work_id: string | null; goal: string; status: string; plan: string[] | null; model: string | null; started_at: string | null; finished_at: string | null; created_at: string; token_usage: { total_tokens?: number } | null; error_code: string | null; }
export interface TaskItem { id: string; title: string; status: string; sequence: number; tool_log: { tool: string; summary: string; ok: boolean }[] | null; started_at: string | null; finished_at: string | null; }
export interface Artifact { id: string; artifact_type: string; name: string; review_status: string; created_at: string; file_id: string | null; }
export interface Project { id: string; name: string; folder_name: string; description: string; owner_id: string; storage_quota_bytes: number; status: string; created_at: string; updated_at: string; member_count?: number; usage_bytes?: number; owner_name?: string; }
export interface FileItem { id: string; owner_type: string; owner_id: string; parent_path: string; name: string; size_bytes: number; mime_type: string; checksum: string | null; status: string; created_at: string; updated_at: string; }
export interface AuditLog { id: string; action: string; resource_type: string; resource_id: string; result: string; ip: string | null; created_at: string; display_name?: string | null; }
export interface StorageStatus { total_bytes: number; used_bytes: number; free_bytes: number; usage_ratio: number; protection: string; mounted: boolean; expected_uuid_ok: boolean; io_ok: boolean; readonly: boolean; write_allowed: boolean; thresholds: { ratio: number; level: string }[]; }

export const WORK_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "待機", cls: "pill--muted" },
  planning: { label: "計画中", cls: "pill--info" },
  awaiting_review: { label: "確認待ち", cls: "pill--warn" },
  running: { label: "実行中", cls: "pill--running" },
  succeeded: { label: "完了", cls: "pill--success" },
  failed: { label: "失敗", cls: "pill--danger" },
  cancelled: { label: "中止", cls: "pill--muted" },
};

export function workPill(status: string): string {
  const m = WORK_STATUS[status] ?? { label: status, cls: "pill--muted" };
  return `<span class="pill ${m.cls}"><span class="dot"></span>${m.label}</span>`;
}

export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function fmtTiB(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const tib = bytes / 1099511627776;
  return tib >= 1 ? `${tib.toFixed(2)} TiB` : `${(bytes / 1073741824).toFixed(1)} GiB`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtRel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return fmtDateTime(iso);
}

export function detectType(name: string, mime?: string | null): string {
  const ext = (name || "").split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "PDF", csv: "CSV", xlsx: "Excel", xls: "Excel", docx: "Word", doc: "Word",
    pptx: "PowerPoint", ppt: "PowerPoint", md: "Markdown", html: "HTML", htm: "HTML",
    py: "Python", js: "JavaScript", ts: "TypeScript", json: "JSON", css: "CSS",
    sql: "SQL", sh: "Shell", zip: "圧縮", gz: "圧縮", tar: "圧縮",
    png: "画像", jpg: "画像", jpeg: "画像", gif: "画像", svg: "画像", webp: "画像", txt: "テキスト",
  };
  if (map[ext]) return map[ext];
  if (mime) {
    if (mime.startsWith("image/")) return "画像";
    if (mime.startsWith("text/")) return "テキスト";
    if (mime.includes("pdf")) return "PDF";
  }
  return "その他";
}

/** Markdown 簡易レンダリング (安全な範囲のみ。リンク等はエスケープ) */
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc(md).split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^[-*] /.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (/^#{1,3} /.test(line)) {
      const level = line.match(/^(#{1,3}) /)![1].length;
      out.push(`<h${level + 2} style="margin:14px 0 6px;font-size:${level === 1 ? 15 : 13.5}px">${line.slice(level + 1)}</h${level + 2}>`);
    } else if (/^```/.test(line)) {
      out.push('<div class="code">');
    } else if (line === "") {
      out.push("");
    } else {
      out.push(`<p>${line}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}
