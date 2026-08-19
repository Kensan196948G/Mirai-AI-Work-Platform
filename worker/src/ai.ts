// ============================================================================
// Mirai AI Work Platform — worker/src/ai.ts
// AI提供者層 (Provider 抽象化): DeepSeek API / demo (決定的ローカル応答)
// 正本: doc/12_人工知能エージェント設計.md §5, doc/09_インターフェース仕様 §7
// APIキーは Secret からのみ読み込む。ログ・DBへ平文保存しない。
// ============================================================================

import type { Env } from "./types";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiResult {
  content: string;
  model: string;
  token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface AiProvider {
  name: string;
  model: string;
  enabled: boolean;
  chat(messages: AiMessage[], opts: { maxChars?: number }): Promise<AiResult>;
}

// ---------------------------------------------------------------------------
// DeepSeek API (chat completions, OpenAI互換)
// ---------------------------------------------------------------------------
export class DeepSeekProvider implements AiProvider {
  name = "deepseek";
  model: string;
  enabled: boolean;
  private apiKey: string;

  constructor(env: Env, apiKeyOverride?: string) {
    this.model = env.AI_MODEL ?? "deepseek-chat";
    // Admin画面で保存された暗号化キー (apiKeyOverride) を env より優先する
    this.apiKey = (apiKeyOverride && apiKeyOverride.trim() !== "") ? apiKeyOverride : (env.DEEPSEEK_API_KEY ?? "");
    this.enabled = env.AI_ENABLED === "true" && this.apiKey !== "";
  }

  async chat(messages: AiMessage[], _opts: { maxChars?: number } = {}): Promise<AiResult> {
    if (!this.enabled) {
      throw new Error("AI_PROVIDER は deepseek ですが DEEPSEEK_API_KEY が未設定のため実行できません。");
    }
    const timeoutMs = 120_000;
    const body = {
      model: this.model,
      messages: messages.slice(-20),
      max_tokens: 2048,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      return { content, model: this.model, token_usage: usage };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// demo provider: 決定的ローカル応答 (検証・Preview用、課金なし・外部通信なし)
// ---------------------------------------------------------------------------
const DEMO_REPLIES = [
  "ご質問を承りました。前処理の観点では、まず対象列の型と欠損率を確認し、その後に重複除去・外れ値の扱いを決めるのが安全です。具体的なファイルを添付いただければ、より踏み込んだ案を提示できます。",
  "確認しました。Project領域の文脈で、以下の手順を提案します。\n1. 入力データの検証（列型・欠損・重複）\n2. 集計キーの確定\n3. 成果物形式（HTML/Markdown）の生成\n4. レビューと保存\n\nこの回答は demo プロバイダーによるサンプル応答です。実際の応答は DeepSeek API が生成します。",
  "了解しました。制約（保存先・成果物形式・外部送信なし）を確認の上、実行計画を整理しました。\n\n- Task 1: データ検証\n- Task 2: 集計表の生成\n- Task 3: 成果物の生成と保存\n\n計画を承認いただければ実行を開始します。",
];

export class DemoAiProvider implements AiProvider {
  name = "demo";
  model: string;
  enabled = true;

  constructor(env: Env) {
    this.model = env.AI_MODEL ?? "demo-local";
  }

  async chat(messages: AiMessage[], opts: { maxChars?: number } = {}): Promise<AiResult> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const content = last?.content ?? "";
    // 入力から決定的な応答を選ぶ (インデックス = 文字数 % 件数)
    const idx = content.length % DEMO_REPLIES.length;
    const maxChars = opts.maxChars ?? 4000;
    let reply = DEMO_REPLIES[idx];
    if (reply.length > maxChars) reply = reply.slice(0, maxChars);
    const promptTokens = Math.max(1, Math.floor(content.length / 4));
    const completionTokens = Math.max(1, Math.floor(reply.length / 4));
    return {
      content: reply,
      model: this.model,
      token_usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 提供者選択
// ---------------------------------------------------------------------------
export function createProvider(env: Env, apiKeyOverride?: string): AiProvider {
  const provider = (env.AI_PROVIDER ?? "demo").toLowerCase();
  if (provider === "deepseek") {
    return new DeepSeekProvider(env, apiKeyOverride);
  }
  return new DemoAiProvider(env);
}

/** 接続テスト (Admin AI設定用) */
export async function testAiConnection(env: Env, apiKeyOverride?: string): Promise<{ ok: boolean; message: string; provider: string; model: string }> {
  const provider = createProvider(env, apiKeyOverride);
  if (provider.name === "deepseek" && !provider.enabled) {
    return { ok: false, message: "DEEPSEEK_API_KEY が未設定です。Secret に登録してください。", provider: provider.name, model: provider.model };
  }
  try {
    const res = await provider.chat([{ role: "user", content: "接続テスト" }], { maxChars: 50 });
    return { ok: true, message: `接続成功（応答 ${res.content.length} 文字）`, provider: provider.name, model: provider.model };
  } catch (e) {
    return { ok: false, message: `接続失敗: ${(e as Error).message}`, provider: provider.name, model: provider.model };
  }
}

/** プロンプト長の上限チェック */
export function checkInputLength(content: string, env: Env): { ok: boolean; maxChars: number } {
  const maxChars = Number(env.MAX_INPUT_CHARS ?? 8000);
  return { ok: content.length <= maxChars, maxChars };
}

// ---------------------------------------------------------------------------
// APIキー暗号化保存 (AES-GCM)。鍵は Secret AI_KEY_ENC_KEY (hex 32byte) から取得。
// DBには iv:ct 形式で保存し、平文・復号可能形式で保持しない。
// ---------------------------------------------------------------------------
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function hasEncryptionKey(env: Env): boolean {
  const key = env.AI_KEY_ENC_KEY ?? "";
  return /^[0-9a-f]{64}$/i.test(key);
}

export async function encryptApiKey(env: Env, plain: string): Promise<string> {
  if (!hasEncryptionKey(env)) {
    throw new Error("AI_KEY_ENC_KEY (Secret) が設定されていないためAPIキーを保存できません。");
  }
  const key = await crypto.subtle.importKey("raw", hexToBytes(env.AI_KEY_ENC_KEY!), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `v1:${toHex(iv.buffer)}:${toHex(ct)}`;
}

export async function decryptApiKey(env: Env, stored: string): Promise<string> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("保存形式が不正です。");
  const key = await crypto.subtle.importKey("raw", hexToBytes(env.AI_KEY_ENC_KEY!), "AES-GCM", false, ["decrypt"]);
  const iv = hexToBytes(parts[1]);
  const ct = hexToBytes(parts[2]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
