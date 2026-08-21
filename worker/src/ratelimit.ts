// ============================================================================
// Mirai AI Work Platform — worker/src/ratelimit.ts
// レート制限（固定窓・in-memory）
// 正本: doc/14_セキュリティ設計.md, doc/13_認証認可設計.md
//
// 注意: Workers の in-memory 実装は単一アイソレート内で有効なベストエフォート
// 方式です。複数エッジロケーション・複数インスタンスでの完全な一貫性は
// 保証されません（Cloudflare の Rate Limiting / Durable Objects 導入時に
// 強化する）。ログイン総当たり対策と異常トラフィックの大幅削減を目的とし、
// 完全な遮断を保証するものではありません。
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
 * 固定窓レートリミッタ。
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
