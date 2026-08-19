// ============================================================================
// セキュリティスキャン: ソース/設定内の秘密情報の混入を防止
//   - 疑わしいパターン (APIキー実値・接続文字列の平文) を検出
//   - .env.local などローカル秘密ファイルが git 管理対象でないこと
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".wrangler", "doc", "docs"]);
const SKIP_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".html"]);

const patterns = [
  { re: /(sk-[A-Za-z0-9]{20,}|napi_[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g, name: "APIキー実値" },
  { re: /postgres(ql)?:\/\/[^:]+:[^@\s]+@[^\s]+/g, name: "DB接続文字列(パスワード付き)" },
  { re: /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/g, name: "秘密鍵" },
  { re: /AIza[0-9A-Za-z_-]{20,}/g, name: "Google APIキー" },
  { re: /AKIA[0-9A-Z]{16}/g, name: "AWS Access Key" },
];

let failures = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
      continue;
    }
    const ext = name.slice(name.lastIndexOf("."));
    if (SKIP_EXTS.has(ext) || name === "package-lock.json") continue;
    let text;
    try {
      text = readFileSync(p, "utf-8");
    } catch { continue; }
    for (const { re, name: pname } of patterns) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) {
        console.error(`SECURITY: ${pname} を検出 — ${p}`);
        failures++;
      }
    }
  }
}

walk(ROOT);

// .env が git 管理されていないこと
try {
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf-8" });
  for (const line of tracked.split("\n")) {
    if (/^\.env($|\.)/.test(line.trim())) {
      console.error(`SECURITY: 秘密ファイル ${line.trim()} がgit管理されています`);
      failures++;
    }
  }
} catch { /* git 未初期化 */ }

if (failures > 0) {
  console.error(`\nセキュリティスキャン: ${failures} 件の問題を検出`);
  process.exit(1);
}
console.log("セキュリティスキャン: PASS (秘密情報の混入なし)");
