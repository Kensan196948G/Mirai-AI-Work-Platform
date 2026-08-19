// ============================================================================
// MVPデプロイ後スモークテスト (scripts/mvp-smoke.mjs)
// 使い方: node scripts/mvp-smoke.mjs <base_url>
//   例: node scripts/mvp-smoke.mjs https://mirai-ai-mvp.mirai-dx-platform.com
// ALLOW_LOCAL_AUTH_BYPASS=true 環境向け (X-Demo-User ヘッダー)
// ============================================================================
const BASE = process.argv[2] || process.env.MVP_URL;
if (!BASE) {
  console.error("使い方: node scripts/mvp-smoke.mjs <base_url>");
  process.exit(1);
}

const DEMO_USER = process.env.DEMO_USER || "naoki.sato";
const headers = { "Content-Type": "application/json", "X-Demo-User": DEMO_USER };
let pass = 0;
let fail = 0;

async function step(name, fn) {
  try {
    const detail = await fn();
    pass++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    fail++;
    console.error(`❌ ${name} — ${e.message}`);
  }
}

async function j(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return data;
}

// 1. ヘルスチェック
await step("GET /api/v1/health → 200 + db:true", async () => {
  const res = await fetch(`${BASE}/api/v1/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.db) throw new Error(`db=${data.db}`);
  return `db=${data.db}`;
});

// 2. 認証バイパスで /auth/me
await step("GET /api/v1/auth/me → ユーザー取得成功", async () => {
  const d = await j("GET", "/auth/me");
  if (!d.user || !d.user.login_id) throw new Error("user missing");
  return d.user.login_id;
});

// 3. 未認証アクセスは拒否 (fail-closed)
await step("未認証 GET /api/v1/dashboard → 401", async () => {
  const res = await fetch(`${BASE}/api/v1/dashboard`);
  if (res.status !== 401) throw new Error(`HTTP ${res.status} (期待 401)`);
  return "401";
});

// 4. ダッシュボード
await step("GET /api/v1/dashboard → 最近の会話・Work", async () => {
  const d = await j("GET", "/dashboard");
  if (!Array.isArray(d.recent_conversations)) throw new Error("recent_conversations missing");
  return `convs=${d.recent_conversations.length}`;
});

// 5. Chat: 会話一覧 → 送信 (demo AI) → 応答確認
let convId = null;
await step("POST /api/v1/conversations → 作成", async () => {
  const d = await j("POST", "/conversations", { title: "smokeテスト会話" });
  convId = d.conversation.id;
  return convId.slice(0, 8);
});
await step("POST /api/v1/conversations/:id/messages → AI応答", async () => {
  const d = await j("POST", `/conversations/${convId}/messages`, { content: "経費レポートの作り方を教えてください" });
  if (!d.reply?.content) throw new Error("reply missing");
  return `${d.reply.model}: ${d.reply.content.slice(0, 30)}…`;
});
await step("GET /api/v1/conversations/:id → メッセージ履歴", async () => {
  const d = await j("GET", `/conversations/${convId}`);
  if (d.messages.length < 2) throw new Error(`messages=${d.messages.length}`);
  return `messages=${d.messages.length}`;
});

// 6. Work: 作成 → 計画 → 承認 → 実行 → 完了 → Artifact
let workId = null;
await step("POST /api/v1/works → 作成 (awaiting_review)", async () => {
  const d = await j("POST", "/works", { goal: "スモークテスト用レポートをHTMLで生成する" });
  workId = d.work.id;
  if (d.work.status !== "awaiting_review") throw new Error(`status=${d.work.status}`);
  return `status=${d.work.status} plan=${(d.plan ?? []).length}件`;
});
await step("POST /api/v1/works/:id/approve → 実行開始", async () => {
  const d = await j("POST", `/works/${workId}/approve`);
  if (d.work.status !== "running") throw new Error(`status=${d.work.status}`);
  return "running";
});
// 実行完了を待つ (最大30秒)
await step("GET /api/v1/works/:id → 完了状態 (succeeded)", async () => {
  for (let i = 0; i < 30; i++) {
    const d = await j("GET", `/works/${workId}`);
    if (d.work.status === "succeeded") {
      const tasks = d.work.tasks ?? [];
      const artifacts = d.work.artifacts ?? [];
      return `tasks=${tasks.length} artifacts=${artifacts.length}`;
    }
    if (d.work.status === "failed") throw new Error("実行失敗");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("30秒以内に完了しませんでした");
});
await step("POST /api/v1/works/:id/adopt → 成果物採用", async () => {
  await j("POST", `/works/${workId}/adopt`);
  return "adopted";
});

// 7. Projects
let projId = null;
await step("GET /api/v1/projects → 一覧", async () => {
  const d = await j("GET", "/projects");
  if (!d.projects.length) throw new Error("projects empty");
  projId = d.projects[0].id;
  return `${d.projects.length}件`;
});
await step("GET /api/v1/projects/:id → メンバー・Files・Artifacts", async () => {
  const d = await j("GET", `/projects/${projId}`);
  if (!Array.isArray(d.members)) throw new Error("members missing");
  return `members=${d.members.length} files=${d.files.length} artifacts=${d.artifacts.length}`;
});

// 8. Files: アップロード → 一覧 → 削除
await step("POST /api/v1/files (アップロード) → 201", async () => {
  const form = new FormData();
  form.append("file", new Blob(["smoke-test-content"], { type: "text/plain" }), "smoke_test.txt");
  const res = await fetch(`${BASE}/api/v1/files?scope=user`, { method: "POST", headers: { "X-Demo-User": DEMO_USER }, body: form });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  return `${d.file.name} (${d.file.size_bytes}B)`;
});
await step("GET /api/v1/files → アップロード済みファイル確認", async () => {
  const d = await j("GET", "/files?scope=user");
  if (!d.files.some((f) => f.name === "smoke_test.txt")) throw new Error("smoke_test.txt not found");
  return `${d.files.length}件`;
});

// 9. 権限差: 一般ユーザーで Admin API → 403
await step("非管理者で GET /api/v1/admin/stats → 403", async () => {
  const res = await fetch(`${BASE}/api/v1/admin/stats`, { headers: { ...headers, "X-Demo-User": "k.tanaka" } });
  if (res.status !== 403) throw new Error(`HTTP ${res.status} (期待 403)`);
  return "403";
});

// 10. Admin (管理者): stats / users / audit
await step("GET /api/v1/admin/stats (管理者) → 200", async () => {
  const d = await j("GET", "/admin/stats");
  if (!d.stats || d.stats.users < 1) throw new Error("stats missing");
  return `users=${d.stats.users}`;
});
await step("GET /api/v1/admin/users → 一覧", async () => {
  const d = await j("GET", "/admin/users");
  if (d.users.length < 5) throw new Error(`users=${d.users.length}`);
  return `${d.users.length}名`;
});
await step("GET /api/v1/admin/audit-logs → 監査ログ", async () => {
  const d = await j("GET", "/admin/audit-logs?limit=20");
  if (!d.logs.length) throw new Error("logs empty");
  return `${d.logs.length}件`;
});
await step("GET /api/v1/storage-status → マウント・使用率", async () => {
  const d = await j("GET", "/storage-status");
  if (!d.storage.mounted) throw new Error("not mounted");
  return `ratio=${(d.storage.usage_ratio * 100).toFixed(1)}%`;
});

console.log(`\n===== MVPスモーク: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
