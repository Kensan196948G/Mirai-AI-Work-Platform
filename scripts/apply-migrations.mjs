// ============================================================================
// Mirai AI Work Platform — scripts/apply-migrations.mjs
// マイグレーション適用 (Neon)。migrations/*.sql を番号順に適用する。
// Neon serverless driver は複数文を1回で実行できないため、
// ステートメント分割 ($$ ... $$ 対応) して1文ずつ実行する。
// 使い方: DATABASE_URL=... node scripts/apply-migrations.mjs
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FATAL: DATABASE_URL が設定されていません。");
  process.exit(1);
}

// DDL は Neon プーラーでは複数文を正しく処理できないことがあるため、
// 直接接続 (非プーラー) エンドポイントを使用する。
const directUrl = dbUrl.includes("-pooler") ? dbUrl.replace("-pooler", "") : dbUrl;
const { neon } = await import("@neondatabase/serverless");
const sql = neon(directUrl);

await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

/** SQL をステートメント分割 (シングルクォート / $$ドル引用 / 行コメント対応) */
function splitStatements(body) {
  const statements = [];
  let current = "";
  let i = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i];
    const next = body[i + 1];
    // 行コメント
    if (ch === "-" && next === "-") {
      while (i < n && body[i] !== "\n") { current += body[i]; i++; }
      continue;
    }
    // シングルクォート文字列
    if (ch === "'") {
      current += ch; i++;
      while (i < n) {
        current += body[i];
        if (body[i] === "\\" && i + 1 < n) { current += body[i + 1]; i += 2; continue; }
        if (body[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    // ドル引用 ($$ ... $$ または $tag$ ... $tag$)
    if (ch === "$") {
      const m = body.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (m) {
        const tag = m[0];
        current += tag;
        i += tag.length;
        const endIdx = body.indexOf(tag, i);
        if (endIdx === -1) { current += body.slice(i); i = n; }
        else {
          current += body.slice(i, endIdx + tag.length);
          i = endIdx + tag.length;
        }
        continue;
      }
    }
    // 文末 (セミコロン)
    if (ch === ";") {
      current += ";";
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const rest = current.trim();
  if (rest) statements.push(rest);
  return statements;
}

const dir = join(__dirname, "..", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const f of files) {
  const applied = await sql`SELECT name FROM _migrations WHERE name = ${f}`;
  if (applied.length > 0) {
    console.log(`  - skip ${f} (applied)`);
    continue;
  }
  const body = readFileSync(join(dir, f), "utf-8");
  const statements = splitStatements(body);
  console.log(`  - apply ${f} (${statements.length} statements) ...`);
  for (const stmt of statements) {
    try {
      // unsafe はテンプレート補間で使用して実行する (Neon serverless driver v1)
      await sql`${sql.unsafe(stmt)}`;
    } catch (e) {
      console.error(`    FAILED statement: ${stmt.slice(0, 120)}...`);
      throw e;
    }
  }
  await sql`INSERT INTO _migrations (name) VALUES (${f})`;
  console.log(`    done`);
}
console.log("マイグレーション完了 ✓");
