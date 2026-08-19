// ============================================================================
// Mirai AI Work Platform — worker/src/shared.ts
// 共有型・状態定義・ユーティリティ (Worker / テスト共通)
// 正本: doc/06_機能仕様.md, doc/09_インターフェース仕様.md, doc/10_データ設計.md
// ============================================================================

export type UserRole = "admin" | "project_owner" | "user" | "service_account";
export type UserStatus = "active" | "disabled" | "warned";

export type WorkStatus =
  | "queued"
  | "planning"
  | "awaiting_review"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type FileStatus = "available" | "uploading" | "scanning" | "failed" | "deleting";
export type ReviewStatus = "pending" | "adopted" | "rejected" | "rerun";
export type ProjectStatus = "active" | "ended" | "archived";

export interface User {
  id: string;
  login_id: string;
  display_name: string;
  role: UserRole;
  storage_quota_bytes: number;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  folder_name: string;
  description: string;
  owner_id: string;
  storage_quota_bytes: number;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  member_count?: number;
  usage_bytes?: number;
}

export interface Conversation {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  last_message?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  token_usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  created_at: string;
}

export interface Work {
  id: string;
  user_id: string;
  project_id: string | null;
  goal: string;
  constraints: string;
  status: WorkStatus;
  version: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  run?: AgentRun | null;
  tasks?: TaskItem[];
  artifacts?: Artifact[];
}

export interface AgentRun {
  id: string;
  work_id: string | null;
  user_id: string;
  project_id: string | null;
  goal: string;
  status: WorkStatus;
  plan: string[] | null;
  model: string | null;
  token_usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface TaskItem {
  id: string;
  agent_run_id: string;
  title: string;
  status: TaskStatus;
  sequence: number;
  tool_log: { tool: string; summary: string; ok: boolean }[] | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface Artifact {
  id: string;
  agent_run_id: string;
  file_id: string | null;
  artifact_type: string;
  name: string;
  review_status: ReviewStatus;
  created_at: string;
}

export interface FileItem {
  id: string;
  owner_type: "user" | "project";
  owner_id: string;
  parent_path: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  checksum: string | null;
  status: FileStatus;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  result: "success" | "failure" | "denied";
  ip: string | null;
  request_id: string | null;
  created_at: string;
  display_name?: string | null;
}

// ---- 状態メタデータ ----
export const WORK_STATUS_META: Record<WorkStatus, { label: string; cls: string }> = {
  queued: { label: "待機", cls: "pill--muted" },
  planning: { label: "計画中", cls: "pill--info" },
  awaiting_review: { label: "確認待ち", cls: "pill--warn" },
  running: { label: "実行中", cls: "pill--running" },
  succeeded: { label: "完了", cls: "pill--success" },
  failed: { label: "失敗", cls: "pill--danger" },
  cancelled: { label: "中止", cls: "pill--muted" },
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待機", running: "実行中", succeeded: "完了", failed: "失敗", skipped: "スキップ",
};

export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  available: "利用可能", uploading: "アップロード中", scanning: "検査中", failed: "失敗", deleting: "削除待ち",
};

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "確認中", adopted: "採用", rejected: "却下", rerun: "再実行",
};

// ストレージ警告しきい値 (詳細設計書 §10)
export const STORAGE_THRESHOLDS = [
  { ratio: 0.7, level: "注意" },
  { ratio: 0.8, level: "拡張計画" },
  { ratio: 0.85, level: "管理者警告" },
  { ratio: 0.9, level: "制限" },
  { ratio: 0.95, level: "緊急保護" },
] as const;

// ---- パス検証 (doc/03_詳細設計書 §9 ファイル安全設計) ----
export function normalizeRelativePath(input: string): string | null {
  if (!input) return "";
  // 絶対パス・ドライブ文字を拒否
  if (/^[/\\]|[A-Za-z]:/.test(input)) return null;
  const parts = input.split(/[/\\]+/).filter((p) => p !== "" && p !== ".");
  // ".." を拒否 (Path Traversal 防止)
  if (parts.some((p) => p === "..")) return null;
  if (parts.length > 16) return null;
  return parts.join("/");
}

export function isSafeFileName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name === "." || name === "..") return false;
  return true;
}

// ---- 表示用フォーマッタ (フロントエンドと同一規則) ----
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

export function isAdminRole(role: string): boolean {
  return role === "admin";
}

export function isOwnerOrAdmin(role: string): boolean {
  return role === "admin" || role === "project_owner";
}
