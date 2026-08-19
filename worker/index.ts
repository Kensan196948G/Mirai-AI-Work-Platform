// ============================================================================
// Mirai AI Work Platform — worker/index.ts
// Cloudflare Workers + Hono API (同一オリジン: SPA資産 + /api/* ルート)
// 正本: doc/06_機能仕様.md, doc/09_インターフェース仕様.md, doc/13_認証認可設計.md
// ============================================================================

import { Hono } from "hono";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Env, AppContext } from "./src/types";
import {
  hashPassword, verifyPassword, generateSessionToken, sha256Hex,
  sessionCookie, clearSessionCookie, getSessionToken, getBypassLoginId, isAdmin,
} from "./src/auth";
import {
  buildStorageStatus, checkWriteAllowed, checkQuota, checkGlobalProtection,
} from "./src/storage";
import { createProvider, testAiConnection, checkInputLength } from "./src/ai";
import {
  normalizeRelativePath, isSafeFileName, type User, type Work,
  type AgentRun, type TaskItem, type Artifact, type FileItem,
} from "./src/shared";

const app = new Hono<{ Bindings: Env; Variables: import("./src/types").AppVars }>();

// ---------------------------------------------------------------------------
// ミドルウェア
// ---------------------------------------------------------------------------
app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS ?? "";
  if (allowed) {
    return cors({ origin: allowed.split(",").map((s) => s.trim()), credentials: true })(c, next);
  }
  return next();
});
app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
});

// ヘルパー
function db(c: AppContext): NeonQueryFunction<false, false> {
  const url = c.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

function requestId(c: AppContext): string {
  return c.get("requestId") as string;
}

import type { ContentfulStatusCode } from "hono/utils/http-status";

function jsonError(c: AppContext, status: ContentfulStatusCode, code: string, message: string, retryable = false) {
  return c.json({ error: { code, message, request_id: requestId(c), retryable } }, status);
}

// 認証コンテキスト
interface AuthUser extends User {
  password_hash?: string;
}
async function loadUserByLogin(c: AppContext, loginId: string): Promise<AuthUser | null> {
  const rows = await db(c)`SELECT * FROM users WHERE login_id = ${loginId} LIMIT 1`;
  return (rows[0] as AuthUser) ?? null;
}
async function loadUserById(c: AppContext, id: string): Promise<AuthUser | null> {
  const rows = await db(c)`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return (rows[0] as AuthUser) ?? null;
}

/** 認証ミドルウェア: セッション or ローカルバイパス。fail-closed。 */
app.use("/api/v1/*", async (c, next) => {
  const ctx = c as AppContext;
  if (ctx.req.path === "/api/v1/auth/login" || ctx.req.path === "/api/v1/health") return next();
  const bypass = getBypassLoginId(ctx, ctx.env);
  if (bypass) {
    const user = await loadUserByLogin(ctx, bypass);
    if (!user || user.status === "disabled") return jsonError(ctx, 401, "AUTH_DENIED", "認証に失敗しました。", false);
    ctx.set("user", user);
    return next();
  }
  const token = getSessionToken(ctx);
  if (!token) return jsonError(ctx, 401, "AUTH_REQUIRED", "サインインが必要です。", false);
  const tokenHash = sha256Hex(token);
  const rows = await db(ctx)`
    SELECT s.id AS session_id, s.expires_at, u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL LIMIT 1`;
  const row = rows[0];
  if (!row) return jsonError(ctx, 401, "AUTH_INVALID", "セッションが無効です。再度サインインしてください。", false);
  if (new Date(row.expires_at) < new Date()) {
    return jsonError(ctx, 401, "AUTH_EXPIRED", "セッションの有効期限が切れました。再度サインインしてください。", true);
  }
  if (row.status === "disabled") return jsonError(ctx, 403, "ACCOUNT_DISABLED", "このアカウントは停止されています。", false);
  ctx.set("user", row as AuthUser);
  await next();
});

/** 監査記録 (fire-and-forget) */
async function audit(
  c: AppContext,
  action: string,
  opts: { resourceType?: string; resourceId?: string; result?: "success" | "failure" | "denied"; detail?: unknown } = {},
) {
  const user = c.get("user") as AuthUser | undefined;
  try {
    await db(c)`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, result, ip, request_id, detail)
      VALUES (${user?.id ?? null}, ${action}, ${opts.resourceType ?? ""}, ${opts.resourceId ?? ""},
              ${opts.result ?? "success"}, ${c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? null},
              ${requestId(c)}, ${opts.detail ? JSON.stringify(opts.detail) : null})`;
  } catch {
    // 監査記録失敗は操作を止めない (重要度別の停止は運用判断)
  }
}

function publicUser(u: AuthUser): Omit<AuthUser, "password_hash"> {
  const { password_hash: _ph, ...rest } = u;
  return rest;
}

// ---------------------------------------------------------------------------
// ヘルスチェック
// ---------------------------------------------------------------------------
app.get("/api/v1/health", async (c) => {
  let dbOk = false;
  let dbError = "";
  try {
    await db(c)`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbError = (e as Error).message.slice(0, 120);
  }
  return c.json({
    status: dbOk ? "ok" : "degraded",
    db: dbOk,
    db_error: dbError || undefined,
    request_id: requestId(c),
    time: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// 認証
// ---------------------------------------------------------------------------
const loginSchema = z.object({
  login_id: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

app.post("/api/v1/auth/login", zValidator("json", loginSchema), async (c) => {
  const { login_id, password } = c.req.valid("json");
  const user = await loadUserByLogin(c, login_id);
  if (!user) {
    await audit(c, "LOGIN", { resourceId: login_id, result: "failure" });
    // 識別子の存在を推測しにくくするため同一メッセージ
    return jsonError(c, 401, "AUTH_FAILED", "利用者IDまたはパスワードが正しくありません。", true);
  }
  const ok = await verifyPassword(password, user.password_hash!);
  if (!ok) {
    await audit(c, "LOGIN", { resourceId: login_id, result: "failure" });
    return jsonError(c, 401, "AUTH_FAILED", "利用者IDまたはパスワードが正しくありません。", true);
  }
  if (user.status === "disabled") {
    await audit(c, "LOGIN", { resourceId: login_id, result: "denied" });
    return jsonError(c, 403, "ACCOUNT_DISABLED", "このアカウントは停止されています。", false);
  }
  const { token, tokenHash } = generateSessionToken();
  const ttlHours = Number(c.env.SESSION_TTL_HOURS ?? 12);
  await db(c)`
    INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
    VALUES (${user.id}, ${tokenHash},
            ${c.req.header("CF-Connecting-IP") ?? null}, ${(c.req.header("User-Agent") ?? "").slice(0, 300)},
            now() + make_interval(hours => ${ttlHours}))`;
  await db(c)`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  await audit(c, "LOGIN", { resourceId: login_id, result: "success" });
  const secure = c.req.url.startsWith("https://");
  c.header("Set-Cookie", sessionCookie(token, ttlHours * 3600, secure));
  return c.json({ user: publicUser(user) });
});

app.post("/api/v1/auth/logout", async (c) => {
  const token = getSessionToken(c);
  if (token) {
    await db(c)`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${sha256Hex(token)}`;
  }
  await audit(c, "LOGOUT");
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

app.get("/api/v1/auth/me", async (c) => {
  const user = c.get("user") as AuthUser;
  // ストレージ使用量 (個人領域)
  const usage = await db(c)`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files
    WHERE owner_type = 'user' AND owner_id = ${user.id} AND deleted_at IS NULL`;
  const status = buildStorageStatus(c.env, Number(usage[0].used));
  return c.json({ user: publicUser(user), storage: {
    quota_bytes: user.storage_quota_bytes,
    used_bytes: Number(usage[0].used),
    ratio: user.storage_quota_bytes > 0 ? Number(usage[0].used) / user.storage_quota_bytes : 0,
    global: status,
  }});
});

// ---------------------------------------------------------------------------
// ダッシュボード (ホーム)
// ---------------------------------------------------------------------------
app.get("/api/v1/dashboard", async (c) => {
  const user = c.get("user") as AuthUser;
  const [recent, works, projects, usageRows, notifications] = await Promise.all([
    db(c)`
      SELECT c.id, c.title, c.updated_at, p.name AS project_name,
        (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
      FROM conversations c LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.user_id = ${user.id}
      ORDER BY c.updated_at DESC LIMIT 5`,
    db(c)`
      SELECT w.id, w.goal, w.status, w.updated_at, p.name AS project_name
      FROM works w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.user_id = ${user.id} AND w.status <> 'succeeded'
      ORDER BY w.updated_at DESC LIMIT 5`,
    db(c)`
      SELECT p.id, p.name, p.storage_quota_bytes, p.status,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
        (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f WHERE f.owner_type = 'project' AND f.owner_id = p.id AND f.deleted_at IS NULL) AS usage_bytes
      FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ${user.id} ORDER BY p.updated_at DESC LIMIT 5`,
    db(c)`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files
      WHERE owner_type = 'user' AND owner_id = ${user.id} AND deleted_at IS NULL`,
    db(c)`
      SELECT action, created_at FROM audit_logs WHERE user_id = ${user.id}
      ORDER BY created_at DESC LIMIT 3`,
  ]);
  const userUsed = Number(usageRows[0].used);
  const global = buildStorageStatus(c.env, userUsed);
  return c.json({
    user: publicUser(user),
    recent_conversations: recent,
    works: works,
    projects: projects,
    storage: {
      quota_bytes: user.storage_quota_bytes,
      used_bytes: userUsed,
      ratio: user.storage_quota_bytes > 0 ? userUsed / user.storage_quota_bytes : 0,
      global,
    },
    notifications: notifications.map((n) => ({ action: n.action, created_at: n.created_at })),
  });
});

// ---------------------------------------------------------------------------
// Conversations / Messages (Chat)
// ---------------------------------------------------------------------------
const convCreateSchema = z.object({ title: z.string().min(1).max(120).optional(), project_id: z.string().uuid().nullable().optional() });

app.get("/api/v1/conversations", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`
    SELECT c.*, p.name AS project_name,
      (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
    FROM conversations c LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.user_id = ${user.id} ORDER BY c.updated_at DESC`;
  return c.json({ conversations: rows });
});

app.post("/api/v1/conversations", zValidator("json", convCreateSchema), async (c) => {
  const user = c.get("user") as AuthUser;
  const body = c.req.valid("json");
  const title = body.title?.trim() || "新しい会話";
  const rows = await db(c)`
    INSERT INTO conversations (user_id, project_id, title) VALUES (${user.id}, ${body.project_id ?? null}, ${title})
    RETURNING *`;
  await audit(c, "CONVERSATION_CREATE", { resourceType: "conversation", resourceId: rows[0].id });
  return c.json({ conversation: rows[0] }, 201);
});

app.get("/api/v1/conversations/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`SELECT * FROM conversations WHERE id = ${c.req.param("id")} AND user_id = ${user.id} LIMIT 1`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "会話が見つかりません。", false);
  const msgs = await db(c)`
    SELECT * FROM messages WHERE conversation_id = ${rows[0].id} ORDER BY created_at`;
  return c.json({ conversation: rows[0], messages: msgs });
});

app.patch("/api/v1/conversations/:id", zValidator("json", z.object({ title: z.string().min(1).max(120) })), async (c) => {
  const user = c.get("user") as AuthUser;
  const { title } = c.req.valid("json");
  const rows = await db(c)`
    UPDATE conversations SET title = ${title}, updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id} RETURNING *`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "会話が見つかりません。", false);
  await audit(c, "CONVERSATION_RENAME", { resourceType: "conversation", resourceId: rows[0].id });
  return c.json({ conversation: rows[0] });
});

app.delete("/api/v1/conversations/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`
    DELETE FROM conversations WHERE id = ${c.req.param("id")} AND user_id = ${user.id} RETURNING id`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "会話が見つかりません。", false);
  await audit(c, "CONVERSATION_DELETE", { resourceType: "conversation", resourceId: rows[0].id });
  return c.json({ ok: true });
});

const messageSchema = z.object({ content: z.string().min(1).max(8000) });

/** Chat送信: ユーザーメッセージ保存 → AI応答生成 → 保存 */
app.post("/api/v1/conversations/:id/messages", zValidator("json", messageSchema), async (c) => {
  const user = c.get("user") as AuthUser;
  const { content } = c.req.valid("json");
  const conv = await db(c)`SELECT * FROM conversations WHERE id = ${c.req.param("id")} AND user_id = ${user.id} LIMIT 1`;
  if (!conv[0]) return jsonError(c, 404, "NOT_FOUND", "会話が見つかりません。", false);

  const lenCheck = checkInputLength(content, c.env);
  if (!lenCheck.ok) {
    return jsonError(c, 413, "INPUT_TOO_LONG", `入力は ${lenCheck.maxChars} 文字以内にしてください。`, false);
  }

  const provider = createProvider(c.env);
  const history = await db(c)`
    SELECT role, content FROM messages WHERE conversation_id = ${conv[0].id} ORDER BY created_at DESC LIMIT 10`;
  const historyMsgs = history.reverse().map((m) => ({ role: m.role as "user" | "assistant" | "system", content: String(m.content) }));

  await db(c)`
    INSERT INTO messages (conversation_id, role, content) VALUES (${conv[0].id}, 'user', ${content})`;

  let reply: { content: string; model: string; token_usage: object } | null = null;
  let errorCode: string | null = null;
  try {
    reply = await provider.chat([...historyMsgs, { role: "user", content }], { maxChars: 4000 });
  } catch (e) {
    errorCode = "AI_ERROR";
    // エラー内容は内部ログ用 (要求IDで対応付け)。利用者には追跡IDのみ。
  }

  if (reply) {
    await db(c)`
      INSERT INTO messages (conversation_id, role, content, model, token_usage)
      VALUES (${conv[0].id}, 'assistant', ${reply.content}, ${reply.model}, ${JSON.stringify(reply.token_usage)})`;
  }
  await db(c)`UPDATE conversations SET updated_at = now() WHERE id = ${conv[0].id}`;
  await audit(c, "MESSAGE_SEND", { resourceType: "conversation", resourceId: conv[0].id, result: reply ? "success" : "failure" });

  if (!reply) {
    return jsonError(c, 502, "AI_ERROR", "AI応答を生成できませんでした。しばらくしてから再試行してください。", true);
  }
  return c.json({ reply, error_code: errorCode, request_id: requestId(c) }, 201);
});

// ---------------------------------------------------------------------------
// Works (Goal → Plan → Task → Artifact → Review)
// ---------------------------------------------------------------------------
const workCreateSchema = z.object({
  goal: z.string().min(3).max(4000),
  constraints: z.string().max(1000).optional(),
  project_id: z.string().uuid().nullable().optional(),
});

/** Project権限: メンバー or 管理者 */
async function canAccessProject(c: AppContext, userId: string, projectId: string | null): Promise<boolean> {
  if (!projectId) return true;
  const user = c.get("user") as AuthUser;
  if (isAdmin(user.role)) return true;
  const rows = await db(c)`SELECT 1 FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

app.get("/api/v1/works", async (c) => {
  const user = c.get("user") as AuthUser;
  const filter = c.req.query("filter") ?? "all";
  const rows = await db(c)`
    SELECT w.*, p.name AS project_name FROM works w
    LEFT JOIN projects p ON p.id = w.project_id
    WHERE w.user_id = ${user.id}
    ORDER BY w.updated_at DESC`;
  let list = rows as Work[];
  if (filter !== "all") list = list.filter((w) => w.status === filter);
  return c.json({ works: list });
});

app.post("/api/v1/works", zValidator("json", workCreateSchema), async (c) => {
  const user = c.get("user") as AuthUser;
  const { goal, constraints, project_id } = c.req.valid("json");
  if (project_id && !(await canAccessProject(c, user.id, project_id))) {
    await audit(c, "WORK_CREATE", { resourceId: goal.slice(0, 60), result: "denied" });
    return jsonError(c, 403, "PROJECT_DENIED", "このProjectへのアクセス権がありません。", false);
  }
  const lenCheck = checkInputLength(goal, c.env);
  if (!lenCheck.ok) return jsonError(c, 413, "INPUT_TOO_LONG", `Goalは ${lenCheck.maxChars} 文字以内にしてください。`, false);

  // Work 作成 → 即時 Plan 生成 (awaiting_review)
  const wrows = await db(c)`
    INSERT INTO works (user_id, project_id, goal, constraints, status)
    VALUES (${user.id}, ${project_id ?? null}, ${goal}, ${constraints ?? ""}, 'awaiting_review')
    RETURNING *`;

  const plan = generatePlan(goal);
  const rrows = await db(c)`
    INSERT INTO agent_runs (work_id, user_id, project_id, goal, status, plan, model)
    VALUES (${wrows[0].id}, ${user.id}, ${project_id ?? null}, ${goal}, 'awaiting_review',
            ${JSON.stringify(plan)}, 'deepseek-chat')
    RETURNING *`;
  for (let i = 0; i < plan.length; i++) {
    await db(c)`INSERT INTO tasks (agent_run_id, title, status, sequence) VALUES (${rrows[0].id}, ${plan[i]}, 'pending', ${i})`;
  }
  await audit(c, "WORK_CREATE", { resourceType: "work", resourceId: wrows[0].id });
  return c.json({ work: wrows[0], run: rrows[0], plan }, 201);
});

/** デフォルトPlan生成 (MVP: 決定的。将来はAI Plannerと置換) */
export function generatePlan(goal: string): string[] {
  if (goal.includes("レポート") || goal.includes("report")) {
    return ["入力データの検証と前処理", "部門別・月別の集計表を生成", "レポート本文（HTML）を生成", "成果物の検証と保存"];
  }
  if (goal.includes("FAQ") || goal.includes("規程")) {
    return ["規程文書の取り込み", "質問候補の抽出", "回答ドラフトの生成", "レビュー用Markdown生成"];
  }
  if (goal.includes("スクリプト") || goal.includes("Python") || goal.includes("script")) {
    return ["入力データの検証", "処理ロジックの実装", "動作確認", "スクリプト成果物の生成と保存"];
  }
  if (goal.includes("予測") || goal.includes("モデル")) {
    return ["データ準備", "特徴量エンジニアリング", "モデル学習", "精度評価"];
  }
  return ["入力データの確認", "処理方針の設計", "実装と実行", "成果物の生成と保存"];
}

app.get("/api/v1/works/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const wrows = await db(c)`
    SELECT w.*, p.name AS project_name FROM works w LEFT JOIN projects p ON p.id = w.project_id
    WHERE w.id = ${c.req.param("id")} AND w.user_id = ${user.id} LIMIT 1`;
  if (!wrows[0]) return jsonError(c, 404, "NOT_FOUND", "Workが見つかりません。", false);
  const run = await db(c)`SELECT * FROM agent_runs WHERE work_id = ${wrows[0].id} ORDER BY created_at DESC LIMIT 1`;
  const tasks = run[0] ? await db(c)`SELECT * FROM tasks WHERE agent_run_id = ${run[0].id} ORDER BY sequence` : [];
  const artifacts = run[0] ? await db(c)`SELECT * FROM artifacts WHERE agent_run_id = ${run[0].id} ORDER BY created_at` : [];
  const work = wrows[0] as Work;
  work.run = run[0] as AgentRun | undefined;
  work.tasks = tasks as TaskItem[];
  work.artifacts = artifacts as Artifact[];
  return c.json({ work });
});

/** Plan承認 → 実行 (Tool実行シミュレーション → Artifact生成) */
app.post("/api/v1/works/:id/approve", async (c) => {
  const user = c.get("user") as AuthUser;
  const wrows = await db(c)`SELECT * FROM works WHERE id = ${c.req.param("id")} AND user_id = ${user.id} LIMIT 1`;
  if (!wrows[0]) return jsonError(c, 404, "NOT_FOUND", "Workが見つかりません。", false);
  const work = wrows[0] as Work;
  if (work.status !== "awaiting_review") {
    return jsonError(c, 409, "INVALID_STATE", "このWorkは承認可能な状態ではありません。", false);
  }
  const rrows = await db(c)`SELECT * FROM agent_runs WHERE work_id = ${work.id} ORDER BY created_at DESC LIMIT 1`;
  if (!rrows[0]) return jsonError(c, 409, "INVALID_STATE", "実行計画が見つかりません。", false);
  const run = rrows[0] as AgentRun;

  await db(c)`UPDATE works SET status = 'running', started_at = now(), updated_at = now() WHERE id = ${work.id}`;
  await db(c)`UPDATE agent_runs SET status = 'running', started_at = now() WHERE id = ${run.id}`;
  await audit(c, "WORK_APPROVE", { resourceType: "work", resourceId: work.id });

  // 実行は非同期 (waitUntil) — Tool実行ログをタスクへ書き、Artifactを生成
  c.executionCtx.waitUntil(runWork(c, work, run));
  return c.json({ work: { ...work, status: "running" }, run: { ...run, status: "running" } });
});

async function runWork(c: AppContext, work: Work, run: AgentRun) {
  try {
    const tasks = await db(c)`SELECT * FROM tasks WHERE agent_run_id = ${run.id} ORDER BY sequence`;
    const logs: { tool: string; summary: string; ok: boolean }[] = [];
    for (const t of tasks as TaskItem[]) {
      await db(c)`UPDATE tasks SET status = 'running', started_at = now() WHERE id = ${t.id}`;
      const log = simulateToolRun(t.title);
      logs.push(log);
      await db(c)`
        UPDATE tasks SET status = ${log.ok ? "succeeded" : "failed"}, finished_at = now(),
          tool_log = ${JSON.stringify([log])}
        WHERE id = ${t.id}`;
      if (!log.ok) throw new Error(`task_failed: ${t.title}`);
    }
    // Artifact生成 (保存先: Project or User)
    const artifactName = pickArtifactName(work);
    const ownerType = work.project_id ? "project" : "user";
    const ownerId = work.project_id ?? work.user_id;
    const frows = await db(c)`
      INSERT INTO files (owner_type, owner_id, parent_path, name, size_bytes, mime_type, checksum, status, created_by)
      VALUES (${ownerType}, ${ownerId}, 'artifacts', ${artifactName}, ${2000 + Math.floor(Math.random() * 4000)},
              ${artifactName.endsWith(".html") ? "text/html" : "text/markdown"}, ${"gen-" + sha256Hex(work.id).slice(0, 32)},
              'available', ${work.user_id})
      RETURNING *`;
    await db(c)`
      INSERT INTO artifacts (agent_run_id, file_id, artifact_type, name, review_status)
      VALUES (${run.id}, ${frows[0].id}, ${artifactName.endsWith(".html") ? "html" : "markdown"}, ${artifactName}, 'pending')`;
    await db(c)`UPDATE agent_runs SET status = 'succeeded', finished_at = now() WHERE id = ${run.id}`;
    await db(c)`UPDATE works SET status = 'succeeded', finished_at = now(), updated_at = now() WHERE id = ${work.id}`;
    await audit(c, "WORK_SUCCEEDED", { resourceType: "work", resourceId: work.id });
  } catch (e) {
    await db(c)`UPDATE agent_runs SET status = 'failed', finished_at = now(), error_code = ${(e as Error).message.slice(0, 120)} WHERE id = ${run.id}`;
    await db(c)`UPDATE works SET status = 'failed', finished_at = now(), updated_at = now() WHERE id = ${work.id}`;
    await audit(c, "WORK_FAILED", { resourceType: "work", resourceId: work.id, result: "failure" });
  }
}

function simulateToolRun(taskTitle: string): { tool: string; summary: string; ok: boolean } {
  if (taskTitle.includes("検証") || taskTitle.includes("確認")) {
    return { tool: "file:validate", summary: "入力データの型・欠損・重複を検査し、問題なしを確認しました。", ok: true };
  }
  if (taskTitle.includes("集計") || taskTitle.includes("抽出")) {
    return { tool: "shell:aggregate", summary: "集計処理を実行し、結果テーブルを生成しました（12行 × 6列）。", ok: true };
  }
  if (taskTitle.includes("生成") || taskTitle.includes("レポート") || taskTitle.includes("Markdown")) {
    return { tool: "artifact:generate", summary: "成果物を生成し、Project領域の artifacts/ へ保存しました。", ok: true };
  }
  if (taskTitle.includes("実装")) {
    return { tool: "shell:run", summary: "処理ロジックを実装・実行し、正常終了を確認しました。", ok: true };
  }
  if (taskTitle.includes("学習") || taskTitle.includes("評価")) {
    return { tool: "shell:train", summary: "モデル学習と精度評価を実行しました。", ok: true };
  }
  return { tool: "file:process", summary: "タスクを実行しました。", ok: true };
}

function pickArtifactName(work: Work): string {
  const g = work.goal;
  if (g.includes("レポート") || g.includes("report")) return "report_" + new Date().toISOString().slice(0, 10) + ".html";
  if (g.includes("FAQ") || g.includes("規程")) return "faq_draft.md";
  if (g.includes("スクリプト") || g.includes("Python")) return "processing_script.py";
  return "work_artifact.md";
}

app.post("/api/v1/works/:id/cancel", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`
    UPDATE works SET status = 'cancelled', finished_at = now(), updated_at = now()
    WHERE id = ${c.req.param("id")} AND user_id = ${user.id} AND status IN ('queued','planning','awaiting_review','running')
    RETURNING *`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "Workが見つからないか、中止できません。", false);
  await db(c)`UPDATE agent_runs SET status = 'cancelled', finished_at = now() WHERE work_id = ${rows[0].id}`;
  await audit(c, "WORK_CANCEL", { resourceType: "work", resourceId: rows[0].id });
  return c.json({ work: rows[0] });
});

/** Review: 成果物採用 */
app.post("/api/v1/works/:id/adopt", async (c) => {
  const user = c.get("user") as AuthUser;
  const wrows = await db(c)`SELECT * FROM works WHERE id = ${c.req.param("id")} AND user_id = ${user.id} LIMIT 1`;
  if (!wrows[0]) return jsonError(c, 404, "NOT_FOUND", "Workが見つかりません。", false);
  const rrows = await db(c)`SELECT * FROM agent_runs WHERE work_id = ${wrows[0].id} ORDER BY created_at DESC LIMIT 1`;
  if (rrows[0]) {
    await db(c)`UPDATE artifacts SET review_status = 'adopted' WHERE agent_run_id = ${rrows[0].id}`;
  }
  await audit(c, "ARTIFACT_ADOPT", { resourceType: "work", resourceId: wrows[0].id });
  return c.json({ ok: true });
});

app.delete("/api/v1/works/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`
    DELETE FROM works WHERE id = ${c.req.param("id")} AND user_id = ${user.id} RETURNING id`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "Workが見つかりません。", false);
  await audit(c, "WORK_DELETE", { resourceType: "work", resourceId: rows[0].id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
const projectSchema = z.object({
  name: z.string().min(1).max(120),
  folder_name: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "フォルダ名は英小文字・数字・ハイフンのみ"),
  description: z.string().max(2000).optional(),
  storage_quota_bytes: z.number().int().positive().optional(),
  status: z.enum(["active", "ended", "archived"]).optional(),
});

app.get("/api/v1/projects", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
      (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f WHERE f.owner_type = 'project' AND f.owner_id = p.id AND f.deleted_at IS NULL) AS usage_bytes
    FROM project_members pm JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = ${user.id} ORDER BY p.updated_at DESC`;
  return c.json({ projects: rows });
});

app.post("/api/v1/projects", zValidator("json", projectSchema), async (c) => {
  const user = c.get("user") as AuthUser;
  if (!isAdmin(user.role) && user.role !== "project_owner") {
    return jsonError(c, 403, "ROLE_DENIED", "Project作成には所有者または管理者権限が必要です。", false);
  }
  const body = c.req.valid("json");
  const rows = await db(c)`
    INSERT INTO projects (name, folder_name, description, owner_id, storage_quota_bytes)
    VALUES (${body.name}, ${body.folder_name}, ${body.description ?? ""}, ${user.id},
            ${body.storage_quota_bytes ?? 53687091200})
    RETURNING *`;
  await db(c)`INSERT INTO project_members (project_id, user_id, role) VALUES (${rows[0].id}, ${user.id}, 'owner')`;
  await audit(c, "PROJECT_CREATE", { resourceType: "project", resourceId: rows[0].id });
  return c.json({ project: rows[0] }, 201);
});

app.get("/api/v1/projects/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const prows = await db(c)`SELECT * FROM projects WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!prows[0]) return jsonError(c, 404, "NOT_FOUND", "Projectが見つかりません。", false);
  if (!(await canAccessProject(c, user.id, prows[0].id))) {
    return jsonError(c, 403, "PROJECT_DENIED", "このProjectへのアクセス権がありません。", false);
  }
  const [members, files, artifacts] = await Promise.all([
    db(c)`
      SELECT u.id, u.login_id, u.display_name, u.status, pm.role, pm.joined_at
      FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ${prows[0].id} ORDER BY pm.joined_at`,
    db(c)`SELECT * FROM files WHERE owner_type = 'project' AND owner_id = ${prows[0].id} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50`,
    db(c)`
      SELECT a.*, f.name AS file_name FROM artifacts a
      JOIN agent_runs r ON r.id = a.agent_run_id
      LEFT JOIN files f ON f.id = a.file_id
      WHERE r.project_id = ${prows[0].id} ORDER BY a.created_at DESC LIMIT 50`,
  ]);
  return c.json({ project: prows[0], members, files, artifacts });
});

app.patch("/api/v1/projects/:id", zValidator("json", projectSchema.partial()), async (c) => {
  const user = c.get("user") as AuthUser;
  const body = c.req.valid("json");
  const prows = await db(c)`SELECT * FROM projects WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!prows[0]) return jsonError(c, 404, "NOT_FOUND", "Projectが見つかりません。", false);
  const mem = await db(c)`
    SELECT role FROM project_members WHERE project_id = ${prows[0].id} AND user_id = ${user.id} LIMIT 1`;
  const role = mem[0]?.role ?? null;
  if (!isAdmin(user.role) && role !== "owner") {
    return jsonError(c, 403, "PROJECT_DENIED", "Projectの変更には所有者または管理者権限が必要です。", false);
  }
  const rows = await db(c)`
    UPDATE projects SET
      name = COALESCE(${body.name ?? null}, name),
      description = COALESCE(${body.description ?? null}, description),
      storage_quota_bytes = COALESCE(${body.storage_quota_bytes ?? null}, storage_quota_bytes),
      status = COALESCE(${body.status ?? null}, status),
      updated_at = now()
    WHERE id = ${prows[0].id} RETURNING *`;
  await audit(c, "PROJECT_UPDATE", { resourceType: "project", resourceId: rows[0].id });
  return c.json({ project: rows[0] });
});

const memberSchema = z.object({ user_id: z.string().uuid(), role: z.enum(["owner", "member", "viewer"]) });

app.post("/api/v1/projects/:id/members", zValidator("json", memberSchema), async (c) => {
  const user = c.get("user") as AuthUser;
  const prows = await db(c)`SELECT * FROM projects WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!prows[0]) return jsonError(c, 404, "NOT_FOUND", "Projectが見つかりません。", false);
  const mem = await db(c)`SELECT role FROM project_members WHERE project_id = ${prows[0].id} AND user_id = ${user.id} LIMIT 1`;
  const role = mem[0]?.role ?? null;
  if (!isAdmin(user.role) && role !== "owner") {
    return jsonError(c, 403, "PROJECT_DENIED", "メンバー管理には所有者または管理者権限が必要です。", false);
  }
  const body = c.req.valid("json");
  const target = await loadUserById(c, body.user_id);
  if (!target) return jsonError(c, 404, "NOT_FOUND", "利用者が見つかりません。", false);
  await db(c)`
    INSERT INTO project_members (project_id, user_id, role) VALUES (${prows[0].id}, ${body.user_id}, ${body.role})
    ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
  await audit(c, "PROJECT_MEMBER_ADD", { resourceType: "project", resourceId: prows[0].id, detail: { user: body.user_id, role: body.role } });
  return c.json({ ok: true });
});

app.delete("/api/v1/projects/:id/members/:userId", async (c) => {
  const user = c.get("user") as AuthUser;
  const prows = await db(c)`SELECT * FROM projects WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!prows[0]) return jsonError(c, 404, "NOT_FOUND", "Projectが見つかりません。", false);
  const mem = await db(c)`SELECT role FROM project_members WHERE project_id = ${prows[0].id} AND user_id = ${user.id} LIMIT 1`;
  const role = mem[0]?.role ?? null;
  if (!isAdmin(user.role) && role !== "owner") {
    return jsonError(c, 403, "PROJECT_DENIED", "メンバー管理には所有者または管理者権限が必要です。", false);
  }
  const targetId = c.req.param("userId");
  // 自己ロックアウト防止 (詳細設計 §6)
  if (targetId === user.id) return jsonError(c, 400, "SELF_LOCKOUT", "自分自身をメンバーから削除できません。", false);
  // Owner不在防止: 最後のownerは削除不可
  const owners = await db(c)`SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = ${prows[0].id} AND role = 'owner'`;
  const targetRole = await db(c)`SELECT role FROM project_members WHERE project_id = ${prows[0].id} AND user_id = ${targetId} LIMIT 1`;
  if (targetRole[0]?.role === "owner" && Number(owners[0].n) <= 1) {
    return jsonError(c, 400, "LAST_OWNER", "最後の所有者は削除できません。先に所有者を移管してください。", false);
  }
  await db(c)`DELETE FROM project_members WHERE project_id = ${prows[0].id} AND user_id = ${targetId}`;
  await audit(c, "PROJECT_MEMBER_REMOVE", { resourceType: "project", resourceId: prows[0].id, detail: { user: targetId } });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
app.get("/api/v1/files", async (c) => {
  const user = c.get("user") as AuthUser;
  const scope = c.req.query("scope") ?? "user";
  const projectId = c.req.query("project_id") ?? null;
  const path = normalizeRelativePath(c.req.query("path") ?? "");

  if (scope === "project") {
    if (!projectId) return jsonError(c, 400, "BAD_REQUEST", "project_id が必要です。", false);
    if (!(await canAccessProject(c, user.id, projectId))) {
      return jsonError(c, 403, "PROJECT_DENIED", "このProjectへのアクセス権がありません。", false);
    }
    const rows = await db(c)`
      SELECT * FROM files WHERE owner_type = 'project' AND owner_id = ${projectId}
        AND parent_path = ${path} AND deleted_at IS NULL ORDER BY name`;
    return c.json({ files: rows as FileItem[] });
  }
  const rows = await db(c)`
    SELECT * FROM files WHERE owner_type = 'user' AND owner_id = ${user.id}
      AND parent_path = ${path} AND deleted_at IS NULL ORDER BY name`;
  return c.json({ files: rows as FileItem[] });
});

// アップロード (multipart/form-data)
app.post("/api/v1/files", async (c) => {
  const user = c.get("user") as AuthUser;
  const scope = c.req.query("scope") ?? "user";
  const projectId = c.req.query("project_id") ?? null;
  const path = normalizeRelativePath(c.req.query("path") ?? "");
  if (path === null) return jsonError(c, 400, "BAD_PATH", "パスが不正です。", false);

  // ストレージ状態チェック (詳細設計 §2.2 マウント安全設計)
  const myUsage = await db(c)`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files
    WHERE owner_type = 'user' AND owner_id = ${user.id} AND deleted_at IS NULL`;
  const status = buildStorageStatus(c.env, Number(myUsage[0].used));
  const writeCheck = checkWriteAllowed(status);
  if (!writeCheck.ok) {
    await audit(c, "FILE_UPLOAD", { resourceType: "file", resourceId: "", result: "denied", detail: { code: writeCheck.code } });
    return jsonError(c, 503, writeCheck.code ?? "STORAGE_DENIED", writeCheck.reason ?? "保存できません。", false);
  }

  let ownerType: "user" | "project" = "user";
  let ownerId = user.id;
  let quotaBytes = user.storage_quota_bytes;
  let usageBytes = Number(myUsage[0].used);
  if (scope === "project") {
    if (!projectId || !(await canAccessProject(c, user.id, projectId))) {
      return jsonError(c, 403, "PROJECT_DENIED", "このProjectへのアクセス権がありません。", false);
    }
    const prows = await db(c)`SELECT * FROM projects WHERE id = ${projectId} LIMIT 1`;
    if (!prows[0]) return jsonError(c, 404, "NOT_FOUND", "Projectが見つかりません。", false);
    ownerType = "project";
    ownerId = prows[0].id;
    quotaBytes = prows[0].storage_quota_bytes;
    const pusage = await db(c)`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files
      WHERE owner_type = 'project' AND owner_id = ${ownerId} AND deleted_at IS NULL`;
    usageBytes = Number(pusage[0].used);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(c, 400, "BAD_REQUEST", "file が必要です。", false);
  const maxBytes = Number(c.env.MAX_FILE_UPLOAD_BYTES ?? 104857600);
  if (file.size > maxBytes) {
    return jsonError(c, 413, "FILE_TOO_LARGE", `ファイルサイズは ${(maxBytes / 1048576).toFixed(0)} MB 以下にしてください。`, false);
  }
  if (!isSafeFileName(file.name)) {
    return jsonError(c, 400, "BAD_FILENAME", "ファイル名が不正です。", false);
  }

  // Quota判定 (保存前: 現在使用量 + 新規サイズ)
  const q1 = checkQuota(usageBytes, file.size, quotaBytes);
  if (!q1.ok) {
    await audit(c, "FILE_UPLOAD", { resourceType: "file", resourceId: file.name, result: "denied", detail: { code: q1.code } });
    return jsonError(c, 409, q1.code ?? "QUOTA_EXCEEDED", q1.reason ?? "容量上限を超えます。", false);
  }
  const q2 = checkGlobalProtection(status, file.size);
  if (!q2.ok) {
    await audit(c, "FILE_UPLOAD", { resourceType: "file", resourceId: file.name, result: "denied", detail: { code: q2.code } });
    return jsonError(c, 503, q2.code ?? "STORAGE_FULL", q2.reason ?? "空き容量が不足しています。", false);
  }

  // チェックサム (SHA-256)
  const buf = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const checksum = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const rows = await db(c)`
    INSERT INTO files (owner_type, owner_id, parent_path, name, size_bytes, mime_type, checksum, status, created_by)
    VALUES (${ownerType}, ${ownerId}, ${path}, ${file.name}, ${file.size}, ${file.type || "application/octet-stream"},
            ${checksum}, 'available', ${user.id})
    RETURNING *`;
  await audit(c, "FILE_UPLOAD", { resourceType: "file", resourceId: file.name, result: "success", detail: { size: file.size, checksum: checksum.slice(0, 12) } });
  return c.json({ file: rows[0] }, 201);
});

app.get("/api/v1/files/:id/download", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`SELECT * FROM files WHERE id = ${c.req.param("id")} AND deleted_at IS NULL LIMIT 1`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "ファイルが見つかりません。", false);
  const f = rows[0] as FileItem;
  // 認可: 本人 or Projectメンバー (DBの所有関係から判定 — パスから推測しない)
  let allowed = false;
  if (f.owner_type === "user" && f.owner_id === user.id) allowed = true;
  if (f.owner_type === "project") allowed = await canAccessProject(c, user.id, f.owner_id);
  if (isAdmin(user.role)) allowed = true;
  if (!allowed) {
    await audit(c, "FILE_DOWNLOAD", { resourceType: "file", resourceId: f.name, result: "denied" });
    return jsonError(c, 403, "FILE_DENIED", "このファイルへのアクセス権がありません。", false);
  }
  await audit(c, "FILE_DOWNLOAD", { resourceType: "file", resourceId: f.name, result: "success" });
  return c.json({ file: f, note: "実体はストレージ (/mnt/storage) に保存され、APIはメタデータを返します。", url: `/api/v1/files/${f.id}/content` });
});

app.delete("/api/v1/files/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`SELECT * FROM files WHERE id = ${c.req.param("id")} AND deleted_at IS NULL LIMIT 1`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "ファイルが見つかりません。", false);
  const f = rows[0] as FileItem;
  let allowed = false;
  if (f.owner_type === "user" && f.owner_id === user.id) allowed = true;
  if (f.owner_type === "project") allowed = await canAccessProject(c, user.id, f.owner_id);
  if (!allowed) {
    await audit(c, "FILE_DELETE", { resourceType: "file", resourceId: f.name, result: "denied" });
    return jsonError(c, 403, "FILE_DENIED", "このファイルへのアクセス権がありません。", false);
  }
  await db(c)`UPDATE files SET deleted_at = now(), status = 'deleting', updated_at = now() WHERE id = ${f.id}`;
  await audit(c, "FILE_DELETE", { resourceType: "file", resourceId: f.name, result: "success" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------
app.get("/api/v1/agent-runs", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`
    SELECT r.*, p.name AS project_name, w.goal AS work_goal
    FROM agent_runs r LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN works w ON w.id = r.work_id
    WHERE r.user_id = ${user.id} ORDER BY r.created_at DESC LIMIT 100`;
  return c.json({ runs: rows });
});

app.get("/api/v1/agent-runs/:id", async (c) => {
  const user = c.get("user") as AuthUser;
  const rows = await db(c)`SELECT * FROM agent_runs WHERE id = ${c.req.param("id")} AND user_id = ${user.id} LIMIT 1`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "Agent実行が見つかりません。", false);
  const tasks = await db(c)`SELECT * FROM tasks WHERE agent_run_id = ${rows[0].id} ORDER BY sequence`;
  const artifacts = await db(c)`SELECT * FROM artifacts WHERE agent_run_id = ${rows[0].id} ORDER BY created_at`;
  return c.json({ run: rows[0], tasks, artifacts });
});

// ---------------------------------------------------------------------------
// Storage status
// ---------------------------------------------------------------------------
app.get("/api/v1/storage-status", async (c) => {
  const usage = await db(c)`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files WHERE deleted_at IS NULL`;
  const status = buildStorageStatus(c.env, Number(usage[0].used));
  return c.json({ storage: status });
});

// ---------------------------------------------------------------------------
// Admin API (管理者限定)
// ---------------------------------------------------------------------------
app.use("/api/v1/admin/*", async (c, next) => {
  const ctx = c as AppContext;
  const user = ctx.get("user") as AuthUser;
  if (!isAdmin(user.role)) {
    await audit(ctx, "ADMIN_DENIED", { resourceType: "admin", resourceId: ctx.req.path, result: "denied" });
    return jsonError(ctx, 403, "ADMIN_REQUIRED", "管理者権限が必要です。", false);
  }
  await next();
});

app.get("/api/v1/admin/stats", async (c) => {
  const [users, projects, runs, usage] = await Promise.all([
    db(c)`SELECT COUNT(*)::int AS n FROM users`,
    db(c)`SELECT COUNT(*)::int AS n FROM projects WHERE status = 'active'`,
    db(c)`SELECT COUNT(*)::int AS n FROM agent_runs WHERE status IN ('running','queued','planning')`,
    db(c)`SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used FROM files WHERE deleted_at IS NULL`,
  ]);
  const status = buildStorageStatus(c.env, Number(usage[0].used));
  return c.json({
    stats: {
      users: users[0].n,
      projects: projects[0].n,
      running_runs: runs[0].n,
      storage: status,
    },
  });
});

app.get("/api/v1/admin/users", async (c) => {
  const rows = await db(c)`
    SELECT u.*, (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f WHERE f.owner_type='user' AND f.owner_id = u.id AND f.deleted_at IS NULL) AS usage_bytes
    FROM users u ORDER BY u.created_at`;
  return c.json({ users: rows.map((r) => {
    const { password_hash: _ph, ...u } = r;
    return u;
  }) });
});

const adminUserSchema = z.object({
  login_id: z.string().min(1).max(64).optional(),
  display_name: z.string().min(1).max(120).optional(),
  role: z.enum(["admin", "project_owner", "user", "service_account"]).optional(),
  storage_quota_bytes: z.number().int().positive().optional(),
  status: z.enum(["active", "disabled", "warned"]).optional(),
  password: z.string().min(8).max(256).optional(),
});

app.post("/api/v1/admin/users", zValidator("json", adminUserSchema), async (c) => {
  const body = c.req.valid("json");
  if (!body.login_id || !body.display_name || !body.password) {
    return jsonError(c, 400, "BAD_REQUEST", "login_id / display_name / password は必須です。", false);
  }
  const hash = await hashPassword(body.password);
  try {
    const rows = await db(c)`
      INSERT INTO users (login_id, display_name, role, storage_quota_bytes, status, password_hash)
      VALUES (${body.login_id}, ${body.display_name}, ${body.role ?? "user"},
              ${body.storage_quota_bytes ?? 107374182400}, ${body.status ?? "active"}, ${hash})
      RETURNING id, login_id, display_name, role, storage_quota_bytes, status, created_at`;
    await audit(c, "USER_CREATE", { resourceType: "user", resourceId: body.login_id });
    return c.json({ user: rows[0] }, 201);
  } catch {
    return jsonError(c, 409, "LOGIN_ID_TAKEN", "この利用者IDは既に使用されています。", false);
  }
});

app.patch("/api/v1/admin/users/:id", zValidator("json", adminUserSchema), async (c) => {
  const body = c.req.valid("json");
  const rows = await db(c)`SELECT * FROM users WHERE id = ${c.req.param("id")} LIMIT 1`;
  if (!rows[0]) return jsonError(c, 404, "NOT_FOUND", "利用者が見つかりません。", false);
  const hash = body.password ? await hashPassword(body.password) : null;
  const updated = await db(c)`
    UPDATE users SET
      display_name = COALESCE(${body.display_name ?? null}, display_name),
      role = COALESCE(${body.role ?? null}, role),
      storage_quota_bytes = COALESCE(${body.storage_quota_bytes ?? null}, storage_quota_bytes),
      status = COALESCE(${body.status ?? null}, status),
      password_hash = COALESCE(${hash}, password_hash)
    WHERE id = ${c.req.param("id")}
    RETURNING id, login_id, display_name, role, storage_quota_bytes, status`;
  if (!updated[0]) return jsonError(c, 404, "NOT_FOUND", "利用者が見つかりません。", false);
  await audit(c, "USER_UPDATE", { resourceType: "user", resourceId: c.req.param("id") });
  return c.json({ user: updated[0] });
});

app.get("/api/v1/admin/projects", async (c) => {
  const rows = await db(c)`
    SELECT p.*, u.display_name AS owner_name,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
      (SELECT COALESCE(SUM(f.size_bytes), 0) FROM files f WHERE f.owner_type='project' AND f.owner_id = p.id AND f.deleted_at IS NULL) AS usage_bytes
    FROM projects p JOIN users u ON u.id = p.owner_id ORDER BY p.updated_at DESC`;
  return c.json({ projects: rows });
});

app.get("/api/v1/admin/audit-logs", async (c) => {
  const action = c.req.query("action") ?? "all";
  const result = c.req.query("result") ?? "all";
  const q = c.req.query("q") ?? "";
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  let rows;
  if (action !== "all" || result !== "all" || q) {
    rows = await db(c)`
      SELECT a.*, u.display_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE (${action === "all"} OR a.action = ${action})
        AND (${result === "all"} OR a.result = ${result})
        AND (${q === ""} OR a.resource_id ILIKE ${"%" + q + "%"} OR a.action ILIKE ${"%" + q + "%"})
      ORDER BY a.created_at DESC LIMIT ${limit}`;
  } else {
    rows = await db(c)`
      SELECT a.*, u.display_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT ${limit}`;
  }
  return c.json({ logs: rows });
});

// AI設定 (Admin): 状態参照・テスト接続・保存 (APIキー実値は Secret)
app.get("/api/v1/admin/ai", async (c) => {
  const rows = await db(c)`SELECT * FROM ai_settings WHERE id = 1 LIMIT 1`;
  const provider = createProvider(c.env);
  return c.json({
    settings: rows[0] ?? null,
    runtime: {
      provider: provider.name,
      model: provider.model,
      enabled: provider.enabled,
      has_api_key: provider.name === "deepseek" ? (c.env.DEEPSEEK_API_KEY ?? "") !== "" : true,
      max_input_chars: Number(c.env.MAX_INPUT_CHARS ?? 8000),
      timeout_ms: Number(c.env.AI_TIMEOUT_MS ?? 120000),
      max_retries: Number(c.env.AI_MAX_RETRIES ?? 2),
    },
  });
});

app.post("/api/v1/admin/ai/test", async (c) => {
  const result = await testAiConnection(c.env);
  await audit(c, "AI_TEST", { resourceType: "ai_settings", resourceId: result.provider, result: result.ok ? "success" : "failure" });
  return c.json(result);
});

const aiSettingsSchema = z.object({
  provider: z.enum(["deepseek", "demo"]).optional(),
  model: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
});

app.post("/api/v1/admin/ai/save", zValidator("json", aiSettingsSchema), async (c) => {
  const body = c.req.valid("json");
  const rows = await db(c)`
    INSERT INTO ai_settings (id, provider, model, enabled, updated_by)
    VALUES (1, COALESCE(${body.provider ?? null}, 'deepseek'), COALESCE(${body.model ?? null}, 'deepseek-chat'),
            COALESCE(${body.enabled ?? null}, false), ${(c.get("user") as AuthUser).id})
    ON CONFLICT (id) DO UPDATE SET
      provider = COALESCE(EXCLUDED.provider, ai_settings.provider),
      model = COALESCE(EXCLUDED.model, ai_settings.model),
      enabled = COALESCE(EXCLUDED.enabled, ai_settings.enabled),
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING *`;
  await audit(c, "AI_SETTINGS_SAVE", { resourceType: "ai_settings", resourceId: "1" });
  return c.json({ settings: rows[0] });
});

// ---------------------------------------------------------------------------
// 404 フォールバック
// ---------------------------------------------------------------------------
app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "指定されたAPIは存在しません。", false));

export default app;
