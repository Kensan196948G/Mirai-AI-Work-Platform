// ============================================================================
// Mirai AI Work Platform — worker/src/ratelimit.ts
// レート制限（固定窓）
// 正本: doc/14_セキュリティ設計.md, doc/13_認証認可設計.md
//
// 実装方針:
// - 本番: Cloudflare KV ベース（アイソレート間で状態を共有するため、
//   in-memory では複数アイソレートに分散されたリクエストを数えられない）
// - テスト/フォールバック: FixedWindowRateLimiter (in-memory)
// KV は「最終書き込みが勝つ」ため同時実行時のカウント欠落はあり得る。
// 固定窓のベストエフォート実装であり、完全な遮断を保証するものではない
// （高精度な分散レート制限は Cloudflare Rate Limiting / DO 導入時に強化）。
// ============================================================================

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number; // 429 時にリトライ可能になるまでの秒数
}

interface WindowEntry {
  windowStart: number; // 窓開始エポックms
  count: number;
}

/**
 * 固定窓レートリミッタ (in-memory)。単一アイソレート内でのみ有効。
 * key ごとに windowMs 内で max 回まで許可する。
 * エントリは最終アクセスから maxIdleMs 経過で破棄される。
 */
export class FixedWindowRateLimiter {
  private entries = new Map<string, WindowEntry>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly maxIdleMs = 10 * 60_000,
  ) {}

  /** カウントを消費して判定。429 時は追加消費しない（再試行しても減らない） */
  check(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);
    const entry = this.entries.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.entries.set(key, { windowStart: now, count: 1 });
      return { ok: true, remaining: this.max - 1, retryAfterSec: 0 };
    }
    if (entry.count >= this.max) {
      const retryAfterSec = Math.max(1, Math.ceil((this.windowStartMs(entry) + this.windowMs - now) / 1000));
      return { ok: false, remaining: 0, retryAfterSec };
    }
    entry.count += 1;
    return { ok: true, remaining: this.max - entry.count, retryAfterSec: 0 };
  }

  /** 現在のカウントを参照（消費しない） */
  peek(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) return 0;
    return entry.count;
  }

  /** 指定キーをリセット（テスト用・明示的解除用） */
  reset(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private windowStartMs(entry: WindowEntry): number {
    return entry.windowStart;
  }

  private sweep(now: number): void {
    if (this.entries.size === 0) return;
    for (const [k, v] of this.entries) {
      if (now - v.windowStart >= this.windowMs || now - v.windowStart >= this.maxIdleMs) {
        this.entries.delete(k);
      }
    }
  }
}

/** KV の get 結果（文字列または null）を表す最小形状 */
export interface KvLike {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/**
 * 固定窓レートリミッタ (Cloudflare KV ベース)。
 * 窓キー = `${key}:${floor(now/windowMs)}` で、KV に count を保持する。
 * 窓の TTL は windowMs を少し上回る値に設定し、自然失効させる。
 */
export class KvRateLimiter {
  constructor(
    private readonly kv: KvLike,
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  async check(key: string, now = Date.now()): Promise<RateLimitResult> {
    const windowKey = `${key}:${Math.floor(now / this.windowMs)}`;
    const raw = await this.kv.get(windowKey, "text").catch(() => null);
    const prev = raw ? Number(raw) : 0;
    const count = (Number.isFinite(prev) ? prev : 0) + 1;
    if (count > this.max) {
      const elapsed = now % this.windowMs;
      const retryAfterSec = Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000));
      return { ok: false, remaining: 0, retryAfterSec };
    }
    const ttlSec = Math.ceil(this.windowMs / 1000) + 60; // 窓+1分の余裕
    await this.kv.put(windowKey, String(count), { expirationTtl: ttlSec }).catch(() => undefined);
    return { ok: true, remaining: this.max - count, retryAfterSec: 0 };
  }
}

/** IP 取得（CF ヘッダー優先、無ければフォールバック） */
export function clientIp(headers: { get(name: string): string | null }): string {
  return headers.get("CF-Connecting-IP") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** レート制限ヘッダー文字列（RFC 6585 / Retry-After） */
export function rateLimitHeaders(limiterName: string, result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limiterName),
    "X-RateLimit-Remaining": String(result.remaining),
    ...(result.retryAfterSec > 0 ? { "Retry-After": String(result.retryAfterSec) } : {}),
  };
}
