// ============================================================================
// AI提供者層のテスト (demoプロバイダー: 決定的・課金なし)
// ============================================================================
import { describe, expect, it } from "vitest";
import { DemoAiProvider, DeepSeekProvider, createProvider, testAiConnection, checkInputLength } from "../worker/src/ai";

const demoEnv = { AI_PROVIDER: "demo", AI_MODEL: "demo-local", AI_ENABLED: "true" };

describe("DemoAiProvider", () => {
  it("決定的な応答を返す (同一入力 → 同一応答)", async () => {
    const p = new DemoAiProvider(demoEnv);
    const a = await p.chat([{ role: "user", content: "経費レポートを作成して" }]);
    const b = await p.chat([{ role: "user", content: "経費レポートを作成して" }]);
    expect(a.content).toBe(b.content);
    expect(a.model).toBe("demo-local");
    expect(a.token_usage.total_tokens).toBeGreaterThan(0);
  });

  it("APIキーなしで動作する (課金なし)", async () => {
    const p = new DemoAiProvider({ ...demoEnv, DEEPSEEK_API_KEY: "" });
    const res = await p.chat([{ role: "user", content: "テスト" }]);
    expect(res.content.length).toBeGreaterThan(0);
  });

  it("maxChars を尊重する", async () => {
    const p = new DemoAiProvider(demoEnv);
    const res = await p.chat([{ role: "user", content: "x".repeat(500) }], { maxChars: 60 });
    expect(res.content.length).toBeLessThanOrEqual(60);
  });
});

describe("DeepSeekProvider", () => {
  it("APIキー未設定時は enabled=false (fail-closed)", () => {
    const p = new DeepSeekProvider({ AI_PROVIDER: "deepseek", AI_ENABLED: "true", DEEPSEEK_API_KEY: "" });
    expect(p.enabled).toBe(false);
  });
  it("APIキー設定時は enabled=true", () => {
    const p = new DeepSeekProvider({ AI_PROVIDER: "deepseek", AI_ENABLED: "true", DEEPSEEK_API_KEY: "sk-test" });
    expect(p.enabled).toBe(true);
  });
  it("disabled のまま chat を呼ぶとエラー", async () => {
    const p = new DeepSeekProvider({ AI_PROVIDER: "deepseek", AI_ENABLED: "true", DEEPSEEK_API_KEY: "" });
    await expect(p.chat([{ role: "user", content: "hi" }])).rejects.toThrow();
  });
});

describe("createProvider / testAiConnection", () => {
  it("deepseek 指定 + キーなし → 接続テストは失敗を返す", async () => {
    const res = await testAiConnection({ AI_PROVIDER: "deepseek", AI_ENABLED: "true", DEEPSEEK_API_KEY: "" });
    expect(res.ok).toBe(false);
  });
  it("demo → 接続テストは成功を返す", async () => {
    const res = await testAiConnection({ AI_PROVIDER: "demo", AI_ENABLED: "true" });
    expect(res.ok).toBe(true);
  });
  it("createProvider は env に応じて選択する", () => {
    expect(createProvider(demoEnv).name).toBe("demo");
    expect(createProvider({ AI_PROVIDER: "deepseek" }).name).toBe("deepseek");
  });
});

describe("checkInputLength", () => {
  it("上限内は許可", () => {
    expect(checkInputLength("short", { MAX_INPUT_CHARS: "8000" }).ok).toBe(true);
  });
  it("上限超過は拒否", () => {
    expect(checkInputLength("x".repeat(8001), { MAX_INPUT_CHARS: "8000" }).ok).toBe(false);
  });
});
