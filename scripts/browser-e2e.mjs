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

// MVP環境 (URLに mvp を含む) は ALLOW_LOCAL_AUTH_BYPASS=true のため、
// 初期ロード時にヘッダー無しでも既定利用者として自動認証される (PR #5)。
// 本番は従来どおりログイン画面からのサインインを検証する。
const isMvpEnv = /mvp/i.test(BASE);

if (isMvpEnv) {
  await step("MVPバイパス: ヘッダー無しで自動ログインされホームが表示される", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".shell", { timeout: 15000 });
    const body = await page.textContent(".main");
    if (!body.includes("おかえりなさい")) throw new Error("ホームの挨拶なし");
  });
} else {
  await step("ログイン画面が表示される", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".login", { timeout: 15000 });
  });

  await step("利用者ID/パスワードでサインインできる (naoki.sato / mirai-demo)", async () => {
    await login();
    const text = await page.textContent("h1");
    if (!text || !text.includes("おかえりなさい")) throw new Error(`h1=${text}`);
  });
}

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
  const before = await page.$$eval(".chat-scroll .msg", (els) => els.length);
  await page.fill("#chat-input", "ブラウザE2Eテスト: 経費レポートの手順を教えてください");
  await page.click(".chat-composer .btn--primary");
  // AI応答完了を待つ (最大15秒)
  let reply = "";
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const msgs = await page.$$eval(".chat-scroll .msg", (els) => els.map((e) => e.textContent ?? ""));
    const aiMsgs = msgs.filter((t) => t.includes("Assistant"));
    if (aiMsgs.length > 0 && aiMsgs[aiMsgs.length - 1] !== "Assistant") {
      reply = aiMsgs[aiMsgs.length - 1];
      break;
    }
  }
  const after = await page.$$eval(".chat-scroll .msg", (els) => els.length);
  if (!reply || after <= before) {
    throw new Error(`AI応答が生成されていません (msgs ${before}→${after})`);
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

await step("Agents一覧が表示される (新しいAgentボタン)", async () => {
  await page.click('.nav a:has-text("Agents")');
  await page.waitForSelector(".tbl tbody tr", { timeout: 10000 });
  const body = await page.textContent(".main");
  if (!body.includes("Sandbox")) throw new Error("Agents UIなし");
  if (!body.includes("新しいAgent")) throw new Error("「新しいAgent」ボタンなし");
});

await step("新しいAgent から Agentを作成できる (Work実行として登録)", async () => {
  await page.click('button:has-text("新しいAgent")');
  await page.waitForSelector("#agent-name", { timeout: 5000 });
  await page.fill("#agent-name", "E2E検証エージェント");
  await page.fill("#agent-goal", "ブラウザE2Eで作成した検証用エージェント");
  await page.click(".modal__foot .btn--primary");
  await page.waitForSelector(".work-grid", { timeout: 10000 });
  const goal = await page.textContent(".work-grid");
  if (!goal.includes("E2E検証エージェント")) throw new Error("AgentのGoalがWork詳細に表示されていません");
  // Work一覧へ戻り、一覧にも反映されていることを確認
  await page.click('.nav a:has-text("Agents")');
  await page.waitForSelector(".tbl tbody tr", { timeout: 10000 });
  const list = await page.textContent(".tbl");
  if (!list.includes("E2E検証エージェント")) throw new Error("Agent一覧に反映されていません");
});

await step("Admin (管理者) が表示される", async () => {
  await page.click('.nav a:has-text("Admin")');
  await page.waitForSelector(".stat", { timeout: 10000 });
  await page.waitForTimeout(500);
  const body = await page.textContent(".main");
  if (!body.includes("ダッシュボード")) throw new Error("Admin UIなし");
  if (!body.includes("ストレージ")) throw new Error("Adminストレージパネルなし");
});

await step("Admin Project管理: 編集できる", async () => {
  await page.click('.tab:has-text("Project管理")');
  await page.waitForSelector('.card .tbl tbody tr', { timeout: 15000 });
  // 編集対象の行を特定 (最初の行を編集し、元の名前に戻す)
  const firstName = await page.$eval(".card .tbl tbody tr:first-child .cell-title", (el) => el.textContent ?? "");
  await page.click('.card .tbl tbody tr:first-child button[aria-label="編集"]');
  await page.waitForSelector("#ap-name", { timeout: 8000 });
  await page.fill("#ap-name", firstName + " (E2E)");
  await page.click(".modal__foot .btn--primary");
  await page.waitForTimeout(1800);
  const edited = await page.textContent(".card .tbl");
  if (!edited.includes(firstName + " (E2E)")) throw new Error("編集が反映されていません");
  // 元に戻す
  await page.click('.card .tbl tbody tr:first-child button[aria-label="編集"]');
  await page.waitForSelector("#ap-name", { timeout: 8000 });
  await page.fill("#ap-name", firstName);
  await page.click(".modal__foot .btn--primary");
  await page.waitForTimeout(1500);
});

await step("Admin Project管理: 削除できる (検証用Projectを作成→削除)", async () => {
  // 削除対象の検証用ProjectをAPIで作成 (管理者セッション)
  const created = await page.evaluate(async () => {
    const res = await fetch("/api/v1/projects", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E削除検証", folder_name: "e2e-delete-check", description: "E2Eで削除検証用に作成", storage_quota_bytes: 53687091200 }),
    });
    return { ok: res.ok, body: await res.json() };
  });
  if (!created.ok) throw new Error("検証用Project作成失敗");
  await page.waitForTimeout(800);
  // 一覧を再読込 (タブ切替でリロード)
  await page.click('.tab:has-text("利用者管理")');
  await page.waitForTimeout(500);
  await page.click('.tab:has-text("Project管理")');
  await page.waitForSelector('.card .tbl tbody tr', { timeout: 15000 });
  // 該当行を削除
  const rowHandle = await page.$(`.card .tbl tbody tr:has-text("E2E削除検証")`);
  if (!rowHandle) throw new Error("削除対象行が見つかりません");
  page.once("dialog", (d) => d.accept());
  const delBtn = await rowHandle.$('button[aria-label="削除"]');
  if (!delBtn) throw new Error("削除ボタンが見つかりません");
  await delBtn.click();
  await page.waitForTimeout(2000);
  const after = await page.textContent(".card .tbl");
  if (after.includes("E2E削除検証")) throw new Error("削除が反映されていません");
});

await step("Admin AI設定: APIキー保存→テスト→クリアが機能する", async () => {
  await page.click('.tab:has-text("AI設定")');
  await page.waitForSelector("#ai-apikey", { timeout: 10000 });
  await page.fill("#ai-apikey", "sk-e2e-test-key-123456");
  await page.click("#ai-key-save");
  await page.waitForTimeout(1800);
  let body = await page.textContent(".main");
  if (!body.includes("暗号化して保存")) throw new Error("キー保存メッセージなし");
  if (!body.includes("設定済み")) throw new Error("保存状態が反映されていません");
  await page.click("#ai-key-test");
  await page.waitForTimeout(3000);
  body = await page.textContent(".main");
  if (!/接続成功|接続失敗/.test(body)) throw new Error("テスト接続結果が表示されていません");
  page.once("dialog", (d) => d.accept());
  await page.click("#ai-key-clear");
  await page.waitForTimeout(1800);
  body = await page.textContent(".main");
  if (!body.includes("クリアしました")) throw new Error("クリアメッセージなし");
  if (!body.includes("未設定")) throw new Error("クリア後も設定済みのまま");
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
