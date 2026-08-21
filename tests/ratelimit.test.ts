// ============================================================================
// レート制限のテスト (FixedWindowRateLimiter)
// ============================================================================
import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter, clientIp } from "../worker/src/ratelimit";

describe("FixedWindowRateLimiter", () => {
  it("上限までは許可し、超過は拒否する", () => {
    const rl = new FixedWindowRateLimiter(60_000, 3);
    expect(rl.check("k").ok).toBe(true);
    expect(rl.check("k").ok).toBe(true);
    expect(rl.check("k").ok).toBe(true);
    const fourth = rl.check("k");
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("キーごとに独立してカウントする", () => {
    const rl = new FixedWindowRateLimiter(60_000, 2);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(false);
    expect(rl.check("b").ok).toBe(true);
  });

  it("窓が経過するとリセットされる", () => {
    const rl = new FixedWindowRateLimiter(1_000, 2);
    const t0 = 1_000_000;
    expect(rl.check("k", t0).ok).toBe(true);
    expect(rl.check("k", t0).ok).toBe(true);
    expect(rl.check("k", t0).ok).toBe(false);
    // 1秒後の新窓
    expect(rl.check("k", t0 + 1_000).ok).toBe(true);
  });

  it("peek はカウントを消費しない", () => {
    const rl = new FixedWindowRateLimiter(60_000, 2);
    rl.check("k");
    expect(rl.peek("k")).toBe(1);
    expect(rl.peek("k")).toBe(1);
    expect(rl.check("k").ok).toBe(true); // 2回目も許可される
  });

  it("reset でカウントが消える", () => {
    const rl = new FixedWindowRateLimiter(60_000, 1);
    expect(rl.check("k").ok).toBe(true);
    expect(rl.check("k").ok).toBe(false);
    rl.reset("k");
    expect(rl.check("k").ok).toBe(true);
  });

  it("古いエントリは自動掃除される (size が増え続けない)", () => {
    const rl = new FixedWindowRateLimiter(1_000, 100, 2_000);
    rl.check("x", 0);
    rl.check("y", 1_000);
    rl.check("z", 3_000); // sweep で x は窓期限切れ、y は idle 期限切れ
    expect(rl.size).toBeLessThanOrEqual(2);
  });
});

describe("clientIp", () => {
  it("CF-Connecting-IP を優先する", () => {
    const h = { get: (n: string) => (n === "CF-Connecting-IP" ? "203.0.113.1" : "10.0.0.1") };
    expect(clientIp(h)).toBe("203.0.113.1");
  });
  it("x-forwarded-for から先頭 IP を取る", () => {
    const h = { get: (n: string) => (n === "x-forwarded-for" ? "198.51.100.7, 10.0.0.1" : null) };
    expect(clientIp(h)).toBe("198.51.100.7");
  });
  it("どちらも無ければ unknown", () => {
    const h = { get: () => null };
    expect(clientIp(h)).toBe("unknown");
  });
});
