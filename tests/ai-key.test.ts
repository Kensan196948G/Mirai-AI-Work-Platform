// ============================================================================
// AI APIキー暗号化 (AES-GCM) のテスト
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  encryptApiKey, decryptApiKey, hasEncryptionKey, createProvider,
} from "../worker/src/ai";

const envWithKey = { AI_KEY_ENC_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };

describe("hasEncryptionKey", () => {
  it("64桁hexの鍵を認識する", () => {
    expect(hasEncryptionKey(envWithKey)).toBe(true);
  });
  it("不正な鍵を拒否する", () => {
    expect(hasEncryptionKey({})).toBe(false);
    expect(hasEncryptionKey({ AI_KEY_ENC_KEY: "short" })).toBe(false);
    expect(hasEncryptionKey({ AI_KEY_ENC_KEY: "zzzz".repeat(16) })).toBe(false);
  });
});

describe("encryptApiKey / decryptApiKey", () => {
  it("保存→復号で元のキーに戻る", async () => {
    const enc = await encryptApiKey(envWithKey, "sk-test-123456");
    expect(enc.startsWith("v1:")).toBe(true);
    const dec = await decryptApiKey(envWithKey, enc);
    expect(dec).toBe("sk-test-123456");
  });

  it("暗号文は平文を含まない (暗号化されている)", async () => {
    const enc = await encryptApiKey(envWithKey, "sk-super-secret-key");
    expect(enc.includes("sk-super-secret-key")).toBe(false);
  });

  it("同一キーでも毎回異なる暗号文になる (IVランダム)", async () => {
    const a = await encryptApiKey(envWithKey, "sk-same");
    const b = await encryptApiKey(envWithKey, "sk-same");
    expect(a).not.toBe(b);
  });

  it("鍵が未設定だと保存できない (fail-closed)", async () => {
    await expect(encryptApiKey({}, "sk-x")).rejects.toThrow("AI_KEY_ENC_KEY");
  });

  it("不正な保存形式は復号できない", async () => {
    await expect(decryptApiKey(envWithKey, "plaintext")).rejects.toThrow();
    await expect(decryptApiKey(envWithKey, "v1:abc:def")).rejects.toThrow();
  });
});

describe("createProvider のキー上書き", () => {
  it("apiKeyOverride が env より優先される", () => {
    const p = createProvider({ AI_PROVIDER: "deepseek", AI_ENABLED: "true", DEEPSEEK_API_KEY: "sk-env" }, "sk-db");
    expect((p as { enabled: boolean }).enabled).toBe(true);
  });
  it("上書きキーが空でも env キーで有効になる", () => {
    const p = createProvider({ AI_PROVIDER: "deepseek", AI_ENABLED: "true", DEEPSEEK_API_KEY: "sk-env" }, "");
    expect((p as { enabled: boolean }).enabled).toBe(true);
  });
  it("キーなしだと deepseek は無効 (fail-closed)", () => {
    const p = createProvider({ AI_PROVIDER: "deepseek", AI_ENABLED: "true" });
    expect((p as { enabled: boolean }).enabled).toBe(false);
  });
});
