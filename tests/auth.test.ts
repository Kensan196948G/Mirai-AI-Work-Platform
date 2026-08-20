// ============================================================================
// 認証ロジックのテスト (PBKDF2 ハッシュ・照合・セッショントークン)
// ============================================================================
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, generateSessionToken, sha256Hex, getBypassLoginId } from "../worker/src/auth";

describe("hashPassword / verifyPassword", () => {
  it("生成したハッシュでパスワードを照合できる", async () => {
    const hash = await hashPassword("mirai-demo");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("mirai-demo", hash)).toBe(true);
  });

  it("誤ったパスワードを拒否する", async () => {
    const hash = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("不正な形式のハッシュを拒否する", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$abc")).toBe(false);
  });

  it("同一パスワードでもソルトにより異なるハッシュになる", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });
});

describe("generateSessionToken / sha256Hex", () => {
  it("トークンとハッシュが生成され、ハッシュで照合できる", () => {
    const { token, tokenHash } = generateSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(sha256Hex(token)).toBe(tokenHash);
    expect(sha256Hex(token)).not.toBe(sha256Hex(token + "x"));
  });

  it("トークンは毎回異なる", () => {
    const a = generateSessionToken().token;
    const b = generateSessionToken().token;
    expect(a).not.toBe(b);
  });
});

// ============================================================================
// MVP 公開デモ用のログイン認証バイパス (getBypassLoginId)
// ============================================================================
describe("getBypassLoginId", () => {
  /** ReqCtx の最小スタブ (ヘッダー取得のみ利用される) */
  const ctx = (headers: Record<string, string> = {}) =>
    ({ req: { header: (name: string) => headers[name] } }) as unknown as Parameters<typeof getBypassLoginId>[0];

  it("ALLOW_LOCAL_AUTH_BYPASS が true でなければ常に null", () => {
    const env = { ALLOW_LOCAL_AUTH_BYPASS: "false", DEMO_DEFAULT_LOGIN_ID: "naoki.sato" } as never;
    expect(getBypassLoginId(ctx({ "X-Demo-User": "naoki.sato" }), env)).toBe(null);
  });

  it("バイパス有効かつ X-Demo-User 指定時はそのユーザー", () => {
    const env = { ALLOW_LOCAL_AUTH_BYPASS: "true" } as never;
    expect(getBypassLoginId(ctx({ "X-Demo-User": "m.suzuki" }), env)).toBe("m.suzuki");
  });

  it("ヘッダー未指定でも DEMO_DEFAULT_LOGIN_ID があれば既定利用者になる", () => {
    const env = { ALLOW_LOCAL_AUTH_BYPASS: "true", DEMO_DEFAULT_LOGIN_ID: "naoki.sato" } as never;
    expect(getBypassLoginId(ctx(), env)).toBe("naoki.sato");
  });

  it("ヘッダーも既定利用者も無ければ null (従来どおりログインが必要)", () => {
    const env = { ALLOW_LOCAL_AUTH_BYPASS: "true" } as never;
    expect(getBypassLoginId(ctx(), env)).toBe(null);
  });

  it("ADMIN_LOGIN_IDS で許可リストが指定されていれば既定利用者にも適用される", () => {
    const env = {
      ALLOW_LOCAL_AUTH_BYPASS: "true",
      DEMO_DEFAULT_LOGIN_ID: "k.tanaka",
      ADMIN_LOGIN_IDS: "naoki.sato",
    } as never;
    expect(getBypassLoginId(ctx(), env)).toBe(null);
  });
});
