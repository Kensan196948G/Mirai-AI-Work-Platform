// ============================================================================
// 検証DBの整合性チェック (scripts/verify-db.mjs)
// 使い方: DATABASE_URL=... node scripts/verify-db.mjs
// マイグレーション適用後・Seed投入後の状態を機械的に検証する。
// ============================================================================
import { fileURLToPath } from "node:url";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FATAL: DATABASE_URL が設定されていません。");
  process.exit(1);
}
const { neon } = await import("@neondatabase/serverless");
const sql = neon(dbUrl);

const checks = [];
async function check(name, fn) {
  try {
    const r = await fn();
    checks.push({ name, ok: true, detail: r ?? "" });
  } catch (e) {
    checks.push({ name, ok: false, detail: String(e).slice(0, 200) });
  }
}

await check("テーブル存在 (users/projects/files/conversations/works/agent_runs/tasks/artifacts/audit_logs)",
  async () => {
    const rows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN
        ('users','projects','project_members','files','conversations','messages',
         'works','agent_runs','tasks','artifacts','audit_logs','ai_settings','sessions')`;
    const names = rows.map((r) => r.table_name);
    const missing = ["users","projects","project_members","files","conversations","messages","works","agent_runs","tasks","artifacts","audit_logs"].filter((n) => !names.includes(n));
    if (missing.length) throw new Error("不足テーブル: " + missing.join(","));
    return `${rows.length}テーブル`;
  });

await check("users seed (10名・管理者1名含む)", async () => {
  const rows = await sql`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE role='admin')::int AS admins FROM users`;
  if (rows[0].n < 10) throw new Error(`users=${rows[0].n}`);
  if (rows[0].admins < 1) throw new Error("管理者不在");
  return `users=${rows[0].n} admins=${rows[0].admins}`;
});

await check("パスワードハッシュ形式 (pbkdf2$)", async () => {
  const rows = await sql`SELECT password_hash FROM users LIMIT 1`;
  if (!rows[0].password_hash.startsWith("pbkdf2$")) throw new Error("ハッシュ形式不正");
  return "ok";
});

await check("projects seed (4件・owner紐付き)", async () => {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM projects`;
  if (rows[0].n < 4) throw new Error(`projects=${rows[0].n}`);
  return `projects=${rows[0].n}`;
});

await check("project_members (各Projectにowner)", async () => {
  const rows = await sql`
    SELECT COUNT(*)::int AS orphan FROM project_members pm
    LEFT JOIN projects p ON p.id = pm.project_id WHERE p.id IS NULL`;
  if (rows[0].orphan > 0) throw new Error("孤立メンバーあり");
  return "ok";
});

await check("files seed (実体メタデータ)", async () => {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM files WHERE deleted_at IS NULL`;
  if (rows[0].n < 5) throw new Error(`files=${rows[0].n}`);
  return `files=${rows[0].n}`;
});

await check("conversations + messages", async () => {
  const rows = await sql`
    SELECT COUNT(DISTINCT c.id)::int AS convs, COUNT(m.id)::int AS msgs
    FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id`;
  if (rows[0].convs < 3) throw new Error(`convs=${rows[0].convs}`);
  if (rows[0].msgs < 5) throw new Error(`msgs=${rows[0].msgs}`);
  return `convs=${rows[0].convs} msgs=${rows[0].msgs}`;
});

await check("works + agent_runs + tasks + artifacts", async () => {
  const rows = await sql`
    SELECT COUNT(DISTINCT w.id)::int AS works, COUNT(DISTINCT r.id)::int AS runs,
           COUNT(t.id)::int AS tasks, COUNT(a.id)::int AS artifacts
    FROM works w
    LEFT JOIN agent_runs r ON r.work_id = w.id
    LEFT JOIN tasks t ON t.agent_run_id = r.id
    LEFT JOIN artifacts a ON a.agent_run_id = r.id`;
  if (rows[0].works < 4) throw new Error(`works=${rows[0].works}`);
  if (rows[0].runs < 4) throw new Error(`runs=${rows[0].runs}`);
  if (rows[0].tasks < 10) throw new Error(`tasks=${rows[0].tasks}`);
  return `works=${rows[0].works} runs=${rows[0].runs} tasks=${rows[0].tasks} artifacts=${rows[0].artifacts}`;
});

await check("work状態遷移の整合 (succeeded/failedにfinish時刻)", async () => {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM works
    WHERE status IN ('succeeded','failed','cancelled') AND finished_at IS NULL`;
  if (rows[0].n > 0) throw new Error(`finish欠落=${rows[0].n}`);
  return "ok";
});

await check("audit_logs seed", async () => {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM audit_logs`;
  if (rows[0].n < 8) throw new Error(`audit=${rows[0].n}`);
  return `audit=${rows[0].n}`;
});

await check("ai_settings 単一行", async () => {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM ai_settings`;
  if (rows[0].n !== 1) throw new Error(`ai_settings=${rows[0].n}`);
  return "ok";
});

// 結果出力
let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (!c.ok) failed++;
}
if (failed > 0) {
  console.error(`\n検証失敗: ${failed}/${checks.length} 件`);
  process.exit(1);
}
console.log(`\n検証DB 整合性チェック: 全${checks.length}件 PASS ✓`);
