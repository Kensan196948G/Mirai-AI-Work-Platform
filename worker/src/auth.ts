// ============================================================================
// Mirai AI Work Platform — worker/src/auth.ts
// 認証: PBKDF2パスワードハッシュ + セッションCookie
// 正本: doc/13_認証認可設計.md (ローカル認証、パスワードは一方向ハッシュ)
// ============================================================================

import type { Context } from "hono";
import type { Env } from "./types";

// ヘルパーで使う最小限のコンテキスト形状 (Hono Context の構造的互換)
export type ReqCtx = Context<{ Bindings: Env }> | { req: { header: (n: string) => string | undefined } };

const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE = "mirai_session";
const SESSION_TOKEN_BYTES = 32;

function toHex(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf.buffer);
}

/** PBKDF2-SHA256 ハッシュ生成 (WebCrypto は Workers / Node 両対応) */
export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(bits)}`;
}

/** 保存ハッシュとパスワードを照合 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  const candidate = await hashPasswordWith(password, salt, iterations);
  return candidate === expected;
}

async function hashPasswordWith(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
    key,
    256,
  );
  return toHex(bits);
}

/** セッショントークン生成 + ハッシュ化 (DBにはハッシュのみ保存) */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomHex(SESSION_TOKEN_BYTES);
  return { token, tokenHash: sha256Hex(token) };
}

export function sha256Hex(text: string): string {
  return toHex(new TextEncoder().encode(text));
}

/** Cookie のセキュリティ属性付与 */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/** 要求からセッショントークン取得 */
export function getSessionToken(c: ReqCtx): string | null {
  const header = c.req.header("Authorization");
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  const cookie = c.req.header("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

/** ローカル検証専用バイパス (ALLOW_LOCAL_AUTH_BYPASS=true 時のみ)。
 *  既存ユーザー (DB内) としての認証代行のみを行い、RBAC判定は通常どおり
 *  サーバー側で行うため、権限差の検証も可能。 */
export function getBypassLoginId(c: ReqCtx, env: Env): string | null {
  if (env.ALLOW_LOCAL_AUTH_BYPASS !== "true") return null;
  const loginId = c.req.header("X-Demo-User");
  if (!loginId) return null;
  const allowed = (env.ADMIN_LOGIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // バイパス時は指定ユーザーのみ許可 (未指定なら既存ユーザー全員を許可)
  if (allowed.length > 0 && !allowed.includes(loginId)) return null;
  return loginId;
}

/** ユーザー種別ヘルパ */
export function isAdmin(role: string): boolean {
  return role === "admin";
}
