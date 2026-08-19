// ============================================================================
// Mirai AI Work Platform — scripts/seed.mjs
// 検証用ダミーデータ投入 (OpenDesignプロトタイプのダミーデータを再現)
// 使い方: DATABASE_URL=... node scripts/seed.mjs
// 認証情報は環境変数からのみ取得。値は出力しない。
// ============================================================================
import { webcrypto as crypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FATAL: DATABASE_URL が設定されていません。");
  process.exit(1);
}

// ---- パスワードハッシュ (Worker側 auth.ts と同一アルゴリズム) ----
const PBKDF2_ITERATIONS = 100_000;
function toHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, saltHex) {
  const salt = hexToBytes(saltHex);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${toHex(bits)}`;
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---- Neon 接続 ----
const { neon } = await import("@neondatabase/serverless");
const sql = neon(dbUrl);

// ---- ダミーデータ定義 ----
const DEMO_PASSWORD = "mirai-demo"; // 検証用のみ。本番は別経路で設定。
const USERS = [
  { login_id: "naoki.sato", display_name: "佐藤 直樹", role: "admin", quota: 100, status: "active" },
  { login_id: "m.suzuki", display_name: "鈴木 美咲", role: "project_owner", quota: 100, status: "active" },
  { login_id: "k.tanaka", display_name: "田中 健太", role: "user", quota: 100, status: "active" },
  { login_id: "y.yamada", display_name: "山田 由紀", role: "user", quota: 100, status: "active" },
  { login_id: "a.kobayashi", display_name: "小林 明", role: "user", quota: 100, status: "warned" },
  { login_id: "r.ito", display_name: "伊藤 亮", role: "user", quota: 100, status: "disabled" },
  { login_id: "h.takahashi", display_name: "高橋 遥", role: "user", quota: 100, status: "active" },
  { login_id: "s.watanabe", display_name: "渡辺 翔太", role: "user", quota: 100, status: "active" },
  { login_id: "e.kato", display_name: "加藤 恵", role: "user", quota: 100, status: "active" },
  { login_id: "t.nakamura", display_name: "中村 岳", role: "user", quota: 100, status: "active" },
];

const PROJECTS = [
  {
    name: "経費精算レポート自動化", folder_name: "expense-report", owner: "naoki.sato", quota: 500, status: "active",
    desc: "経費データの集計・整形・四半期レポート生成を AI で自動化するプロジェクト。Pilot で効果測定中。",
    members: [
      { user: "naoki.sato", role: "owner" }, { user: "m.suzuki", role: "member" },
      { user: "k.tanaka", role: "member" }, { user: "y.yamada", role: "viewer" },
    ],
  },
  {
    name: "社内FAQ構築", folder_name: "company-faq", owner: "m.suzuki", quota: 100, status: "active",
    desc: "社内規程からよくある質問を抽出し体系化",
    members: [
      { user: "m.suzuki", role: "owner" }, { user: "naoki.sato", role: "member" }, { user: "y.yamada", role: "member" },
    ],
  },
  {
    name: "データ分析基盤 PoC", folder_name: "data-analytics-poc", owner: "k.tanaka", quota: 50, status: "ended",
    desc: "売上予測モデルの試作と精度評価",
    members: [
      { user: "k.tanaka", role: "owner" }, { user: "naoki.sato", role: "member" },
    ],
  },
  {
    name: "文書管理DX推進", folder_name: "document-dx", owner: "naoki.sato", quota: 100, status: "active",
    desc: "申請書・規程文書の生成とレビューを AI で支援する",
    members: [
      { user: "naoki.sato", role: "owner" }, { user: "h.takahashi", role: "member" }, { user: "e.kato", role: "member" },
    ],
  },
];

const FILES = [
  { owner_type: "user", name: "expense_2026Q3.csv", size: 2.4, mime: "text/csv", status: "available" },
  { owner_type: "user", name: "経費規程_2026.pdf", size: 1.8, mime: "application/pdf", status: "available" },
  { owner_type: "user", name: "部門コード表.csv", size: 0.012, mime: "text/csv", status: "available" },
  { owner_type: "user", name: "ドラフトメモ.md", size: 0.008, mime: "text/markdown", status: "available" },
  { owner_type: "project", name: "report_2026Q3.html", size: 0.128, mime: "text/html", status: "available" },
  { owner_type: "project", name: "clean_expense.py", size: 0.0042, mime: "text/x-python", status: "available" },
  { owner_type: "project", name: "summary_2026Q3.xlsx", size: 0.096, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", status: "available" },
  { owner_type: "project", name: "FAQ_ドラフト.md", size: 0.02, mime: "text/markdown", status: "available" },
];

const CONVERSATIONS = [
  { user: "naoki.sato", project: "expense-report", title: "経費データの前処理について", msgs: [
    { role: "user", content: "経費データの前処理で、重複行の判定はどうすれば良いですか？" },
    { role: "assistant", content: "重複行の判定は、業務上「同一経費」とみなすキーを決めるのが先です。取引ID・日付・金額・部門の組で判定するのが実務的です。金額は小数誤差を避けるため数値の四捨五入で比較します。" },
    { role: "user", content: "NULL値の扱いについても教えてください。" },
    { role: "assistant", content: "NULLは「欠損」と「意味のある空」を区別して扱います。必須項目の欠損はレコードごと除外または担当へ差し戻し、任意項目の空は集計時に無視します。集計前に欠損率を確認し、全体の5%超は原因を調査します。" },
  ]},
  { user: "naoki.sato", project: "expense-report", title: "Q3レポートの要約案", msgs: [
    { role: "user", content: "Q3のレポート構成を提案してください。" },
    { role: "assistant", content: "部門別・月別の集計、前四半期比の増減、費目別の傾向の3構成を提案します。まず集計表を生成し、その後に本文を生成する順序が安全です。" },
  ]},
  { user: "naoki.sato", project: null, title: "API利用量の確認方法", msgs: [
    { role: "user", content: "利用量メトリクスの見方と上限について教えてください。" },
    { role: "assistant", content: "管理画面の「AI設定 → 今月の利用状況」でリクエスト数・トークン・平均遅延を確認できます。" },
  ]},
  { user: "m.suzuki", project: "company-faq", title: "就業規則からのFAQ抽出", msgs: [
    { role: "user", content: "就業規則からFAQ候補を抽出してください。" },
    { role: "assistant", content: "勤務時間・休暇・評価の3区分で10件の質問候補を抽出しました。確認用ドラフトをMarkdownで生成します。" },
  ]},
];

const WORKS = [
  {
    user: "naoki.sato", project: "expense-report", goal: "経費精算レポート自動化プロジェクトの経費データ（expense_2026Q3.csv）から、四半期経費レポートを HTML と PDF の両形式で生成する。部門別・月別の集計と、前四半期比の増減を含める。",
    constraints: "成果物: HTML / PDF、保存先: Project領域、外部送信: なし",
    status: "awaiting_review", plan: ["入力データの検証と前処理", "部門別・月別の集計表を生成", "レポート本文（HTML）を生成", "PDF を生成", "成果物の検証と保存"],
  },
  {
    user: "m.suzuki", project: "company-faq", goal: "社内規程文書からよくある質問を抽出し、回答ドラフトを Markdown で生成する。",
    constraints: "保存先: Project領域",
    status: "running", plan: ["規程文書の取り込み", "質問候補の抽出", "回答ドラフトの生成", "レビュー用Markdown生成"],
  },
  {
    user: "naoki.sato", project: "expense-report", goal: "経費データの前処理（重複除去・NULL補完・金額正規化）を行う Python スクリプトを成果物として生成し、Project領域へ保存する。",
    constraints: "保存先: Project領域",
    status: "succeeded", plan: ["入力データの検証", "重複除去ロジックの実装", "NULL補完と金額正規化", "スクリプト成果物の生成と保存"],
  },
  {
    user: "k.tanaka", project: "data-analytics-poc", goal: "過去の売上実績から次期売上を予測するモデルを試作し、精度を評価する。",
    constraints: "外部送信: なし",
    status: "failed", plan: ["データ準備", "特徴量エンジニアリング", "モデル学習", "精度評価"],
  },
  {
    user: "naoki.sato", project: "document-dx", goal: "経費申請書のレビュー指摘事項をまとめ、改善案をMarkdownで生成する。",
    constraints: "保存先: Project領域",
    status: "succeeded", plan: ["申請書の取り込み", "指摘事項の整理", "改善案の生成"],
  },
];

const AUDIT_EVENTS = [
  { action: "FILE_UPLOAD", resource_type: "file", resource_id: "expense_2026Q3.csv", result: "success", user: "naoki.sato" },
  { action: "LOGIN", resource_type: "session", resource_id: "", result: "success", user: "naoki.sato" },
  { action: "WORK_START", resource_type: "work", resource_id: "Q3経費レポートの自動生成", result: "success", user: "naoki.sato" },
  { action: "FILE_DOWNLOAD", resource_type: "file", resource_id: "経費規程_2026.pdf", result: "success", user: "m.suzuki" },
  { action: "AGENT_START", resource_type: "agent_run", resource_id: "", result: "success", user: "k.tanaka" },
  { action: "PROJECT_UPDATE", resource_type: "project", resource_id: "社内FAQ構築", result: "denied", user: "y.yamada" },
  { action: "ARTIFACT_SAVE", resource_type: "artifact", resource_id: "clean_expense.py", result: "success", user: "naoki.sato" },
  { action: "AGENT_FAIL", resource_type: "agent_run", resource_id: "", result: "failure", user: "k.tanaka" },
  { action: "LOGIN", resource_type: "session", resource_id: "", result: "failure", user: "unknown" },
  { action: "USER_UPDATE", resource_type: "user", resource_id: "a.kobayashi", result: "success", user: "naoki.sato" },
];

// ---- 実行 ----
async function main() {
  console.log("Seeding Mirai AI Work Platform 検証DB ...");

  // 既存データを消さずに冪等にするため、login_id の衝突時はスキップする方式は採らず、
  // 検証DB専用スクリプトとして明示的に TRUNCATE する (検証用Branch DBのみで使用)。
  await sql`TRUNCATE audit_logs, sessions, messages, conversations, tasks, artifacts,
            agent_runs, works, files, project_members, projects, ai_settings, users RESTART IDENTITY CASCADE;`;
  console.log("  - 既存データを初期化 (検証用DB専用)");

  // users
  const userIds = {};
  for (const u of USERS) {
    const salt = randomHex(16);
    const hash = await hashPassword(DEMO_PASSWORD, salt);
    const rows = await sql`
      INSERT INTO users (login_id, display_name, role, storage_quota_bytes, status, password_hash)
      VALUES (${u.login_id}, ${u.display_name}, ${u.role}, ${u.quota * 1024 ** 3}, ${u.status}, ${hash})
      RETURNING id`;
    userIds[u.login_id] = rows[0].id;
  }
  console.log(`  - users: ${USERS.length} 件 (パスワードは全て "${DEMO_PASSWORD}")`);

  // projects + members
  const projectIds = {};
  for (const p of PROJECTS) {
    const rows = await sql`
      INSERT INTO projects (name, folder_name, description, owner_id, storage_quota_bytes, status)
      VALUES (${p.name}, ${p.folder_name}, ${p.desc}, ${userIds[p.owner]}, ${p.quota * 1024 ** 3}, ${p.status})
      RETURNING id`;
    projectIds[p.folder_name] = rows[0].id;
    for (const m of p.members) {
      await sql`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${rows[0].id}, ${userIds[m.user]}, ${m.role})`;
    }
  }
  console.log(`  - projects: ${PROJECTS.length} 件 + members`);

  // files (サイズは MB 値 → bytes)
  const fileIds = {};
  for (const f of FILES) {
    const owner = f.owner_type === "user" ? userIds["naoki.sato"] : projectIds[f.owner_type === "project" ? "expense-report" : ""];
    const rows = await sql`
      INSERT INTO files (owner_type, owner_id, parent_path, name, size_bytes, mime_type, checksum, status, created_by)
      VALUES (${f.owner_type}, ${owner}, '', ${f.name}, ${Math.round(f.size * 1024 * 1024)}, ${f.mime},
              ${"seed-" + randomHex(16)}, ${f.status}, ${userIds["naoki.sato"]})
      RETURNING id`;
    fileIds[f.name] = rows[0].id;
  }
  console.log(`  - files: ${FILES.length} 件`);

  // conversations + messages
  for (const c of CONVERSATIONS) {
    const rows = await sql`
      INSERT INTO conversations (user_id, project_id, title)
      VALUES (${userIds[c.user]}, ${c.project ? projectIds[c.project] : null}, ${c.title})
      RETURNING id`;
    for (const m of c.msgs) {
      await sql`
        INSERT INTO messages (conversation_id, role, content, model)
        VALUES (${rows[0].id}, ${m.role}, ${m.content}, 'deepseek-chat')`;
    }
  }
  console.log(`  - conversations: ${CONVERSATIONS.length} 件`);

  // works + agent_runs + tasks + artifacts
  let runIdx = 0;
  for (const w of WORKS) {
    const finishedAt = ["succeeded", "failed", "cancelled"].includes(w.status)
      ? new Date(Date.now() - 3600_000 * 20).toISOString()
      : null;
    const wrows = await sql`
      INSERT INTO works (user_id, project_id, goal, constraints, status, started_at, finished_at)
      VALUES (${userIds[w.user]}, ${w.project ? projectIds[w.project] : null}, ${w.goal}, ${w.constraints}, ${w.status},
              now() - interval '1 hour', ${finishedAt})
      RETURNING id`;
    const rrows = await sql`
      INSERT INTO agent_runs (work_id, user_id, project_id, goal, status, plan, model, started_at, finished_at)
      VALUES (${wrows[0].id}, ${userIds[w.user]}, ${w.project ? projectIds[w.project] : null}, ${w.goal},
              ${w.status === "queued" ? "queued" : w.status}, ${JSON.stringify(w.plan)}, 'deepseek-chat',
              now() - interval '1 hour', ${finishedAt})
      RETURNING id`;
    runIdx += 1;
    for (let i = 0; i < w.plan.length; i++) {
      const tstatus = w.status === "succeeded" ? (i < w.plan.length - 1 ? "succeeded" : "succeeded")
        : w.status === "failed" && i >= w.plan.length - 1 ? "failed"
        : w.status === "running" && i < 2 ? "succeeded" : w.status === "running" && i === 2 ? "running" : "pending";
      await sql`
        INSERT INTO tasks (agent_run_id, title, status, sequence)
        VALUES (${rrows[0].id}, ${w.plan[i]}, ${tstatus}, ${i})`;
    }
    // artifacts for succeeded works
    if (w.status === "succeeded" || w.status === "awaiting_review") {
      const artName = w.project === "expense-report"
        ? (w.goal.includes("Python") ? "clean_expense.py" : "report_2026Q3.html")
        : "FAQ_ドラフト.md";
      const fid = fileIds[artName];
      await sql`
        INSERT INTO artifacts (agent_run_id, file_id, artifact_type, name, review_status)
        VALUES (${rrows[0].id}, ${fid ?? null}, ${w.status === "succeeded" ? "markdown" : "html"},
                ${artName}, ${w.status === "succeeded" ? "adopted" : "pending"})`;
    }
  }
  console.log(`  - works/agent_runs: ${WORKS.length} 件 + tasks + artifacts`);

  // ai_settings
  await sql`
    INSERT INTO ai_settings (id, provider, model, enabled, has_api_key)
    VALUES (1, 'demo', 'demo-local', true, false)
    ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model,
      enabled = EXCLUDED.enabled, updated_at = now()`;
  console.log("  - ai_settings: 初期化");

  // audit_logs
  for (let i = 0; i < AUDIT_EVENTS.length; i++) {
    const ev = AUDIT_EVENTS[i];
    await sql`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, result, ip, request_id)
      VALUES (${userIds[ev.user] ?? null}, ${ev.action}, ${ev.resource_type}, ${ev.resource_id}, ${ev.result},
              ${"10.0.4." + (20 + i)}, ${"req-seed-" + i})`;
  }
  console.log(`  - audit_logs: ${AUDIT_EVENTS.length} 件`);

  console.log("Seed 完了 ✓");
}

main().catch((e) => {
  console.error("Seed 失敗:", e);
  process.exit(1);
});
