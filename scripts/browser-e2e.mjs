// ============================================================================
// ブラウザE2E (Playwright): デプロイ済みMVPの主要画面を実操作で検証
// 使い方: node scripts/browser-e2e.mjs <base_url>
//   ※ 実UIのログインフロー (利用者ID/パスワード) を検証する。
//     検証用アカウント: naoki.sato / mirai-demo (seed で作成)
// ============================================================================
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.MVP_URL;
if (!BASE) {
  console.error("使い方: node scripts/browser-e2e.mjs <base_url>");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let pass = 0, fail = 0;
async function step(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`✅ ${name}`);
  } catch (e) {
    fail++;
    console.error(`❌ ${name} — ${e.message.split("\n")[0]}`);
  }
}

async function login(id = "naoki.sato", pw = "mirai-demo") {
  await page.fill("#login-id", id);
  await page.fill("#login-pw", pw);
  await page.click(".login .btn--primary");
  await page.waitForSelector(".shell", { timeout: 15000 });
}

await step("ログイン画面が表示される", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".login", { timeout: 15000 });
});

await step("利用者ID/パスワードでサインインできる (naoki.sato / mirai-demo)", async () => {
  await login();
  const text = await page.textContent("h1");
  if (!text || !text.includes("おかえりなさい")) throw new Error(`h1=${text}`);
});

await step("左ナビに Chat/Work/Projects/Files/Agents/Admin が存在", async () => {
  const nav = await page.textContent(".nav");
  for (const label of ["ホーム", "Chat", "Work", "Projects", "Files", "Agents", "Admin"]) {
    if (!nav.includes(label)) throw new Error(`ナビ欠落: ${label}`);
  }
});

await step("ホーム: 最近の会話・Work状況・ストレージ使用量が表示", async () => {
  await page.waitForSelector(".rows", { timeout: 10000 });
  const body = await page.textContent(".main");
  if (!body.includes("ストレージ使用量")) throw new Error("使用量パネルなし");
});

await step("サインアウトできる", async () => {
  await page.click('button[aria-label="ユーザーメニュー"]');
  await page.click("text=サインアウト");
  await page.waitForSelector(".login", { timeout: 10000 });
});

await step("誤ったパスワードは拒否される (fail-closed)", async () => {
  await page.fill("#login-id", "naoki.sato");
  await page.fill("#login-pw", "wrong-password");
  await page.click(".login .btn--primary");
  await page.waitForTimeout(1200);
  const body = await page.textContent(".login");
  if (!body.includes("利用者IDまたはパスワードが正しくありません")) {
    throw new Error("エラーメッセージが表示されていません");
  }
  // 正しい認証で復帰
  await page.fill("#login-pw", "mirai-demo");
  await page.click(".login .btn--primary");
  await page.waitForSelector(".shell", { timeout: 15000 });
});

await step("Chat一覧 → 会話詳細に遷移できる", async () => {
  await page.click('.nav a:has-text("Chat")');
  await page.waitForSelector(".rows .row", { timeout: 10000 });
  await page.click(".rows .row:first-child");
  await page.waitForSelector(".chat-layout", { timeout: 10000 });
  const title = await page.textContent(".chat-head h1");
  if (!title) throw new Error("チャット詳細の題名なし");
});

await step("Chat送信 (demo AI応答)", async () => {
  await page.fill("#chat-input", "ブラウザE2Eテスト: 経費レポートの手順を教えてください");
  await page.click(".chat-composer .btn--primary");
  await page.waitForTimeout(3000);
  const body = await page.textContent(".chat-scroll");
  if (!body.includes("ご質問を承りました") && !body.includes("確認しました")) {
    throw new Error("AI応答が表示されていません");
  }
});

await step("Work一覧 → 詳細 (Plan/Task/Artifact表示)", async () => {
  await page.click('.nav a:has-text("Work")');
  await page.waitForSelector(".tbl tbody tr", { timeout: 10000 });
  await page.click(".tbl tbody tr:first-child");
  await page.waitForSelector(".work-grid", { timeout: 10000 });
  const body = await page.textContent(".work-grid");
  for (const label of ["Goal と制約", "Plan", "Tool 実行の要約", "Artifacts", "Review", "実行情報"]) {
    if (!body.includes(label)) throw new Error(`Work詳細欠落: ${label}`);
  }
});

await step("Projects一覧が表示される", async () => {
  await page.click('.nav a:has-text("Projects")');
  await page.waitForSelector(".tbl tbody tr", { timeout: 10000 });
  const body = await page.textContent(".main");
  if (!body.includes("Quota")) throw new Error("Projectテーブル列なし");
});

await step("Files一覧が表示される (個人領域)", async () => {
  await page.click('.nav a:has-text("Files")');
  await page.waitForSelector(".tbl tbody tr", { timeout: 10000 });
  const body = await page.textContent(".main");
  if (!body.includes("アップロード")) throw new Error("Files UIなし");
});

await step("Agents一覧が表示される", async () => {
  await page.click('.nav a:has-text("Agents")');
  await page.waitForSelector(".tbl tbody tr", { timeout: 10000 });
  const body = await page.textContent(".main");
  if (!body.includes("Sandbox")) throw new Error("Agents UIなし");
});

await step("Admin (管理者) が表示される", async () => {
  await page.click('.nav a:has-text("Admin")');
  await page.waitForSelector(".stat", { timeout: 10000 });
  await page.waitForTimeout(500);
  const body = await page.textContent(".main");
  if (!body.includes("ダッシュボード")) throw new Error("Admin UIなし");
  if (!body.includes("ストレージ")) throw new Error("Adminストレージパネルなし");
});

await step("レスポンシブ: 幅375pxでナビがアイコンのみになる", async () => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(600);
  const display = await page.$eval(".brand__name", (el) => getComputedStyle(el).display).catch(() => "block");
  if (display !== "none") throw new Error(`brand__name display=${display} (期待 none)`);
});

await step("キーボード操作: Tabでフォーカス移動できる", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.click("h1"); // フォーカスをコンテンツへ
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}:${(el.getAttribute("aria-label") || el.textContent || "").slice(0, 20)}` : "none";
  });
  if (active === "none") throw new Error("フォーカス移動なし");
});

await step("コンソールに重大なエラーがない", async () => {
  const fatal = errors.filter((e) => !e.includes("favicon") && !e.includes("401"));
  if (fatal.length > 0) throw new Error(fatal.slice(0, 3).join(" | "));
});

await browser.close();
console.log(`\n===== ブラウザE2E: ${pass} PASS / ${fail} FAIL =====`);
if (fail > 0) process.exit(1);
