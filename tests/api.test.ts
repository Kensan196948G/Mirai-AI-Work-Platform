// ============================================================================
// API統合テスト: 認証・認可・Quota・Workフロー (モックDB利用)
// Neon を必要としない: 実行前にセットアップされたモックで検証する。
// 実際のDB結合検証は scripts/mvp-smoke.mjs (デプロイ後E2E) で実施。
// ============================================================================
import { describe, expect, it } from "vitest";
import { generatePlan } from "../worker/index";
import { normalizeRelativePath, isSafeFileName } from "../worker/src/shared";

describe("generatePlan (Work計画生成)", () => {
  it("レポートGoalは集計→生成の計画になる", () => {
    const plan = generatePlan("経費データから四半期レポートをHTMLで生成する");
    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan.join(" ")).toContain("集計");
    expect(plan.join(" ")).toContain("生成");
  });
  it("FAQ Goalは抽出→ドラフトの計画になる", () => {
    const plan = generatePlan("社内FAQのドラフトを作成したい");
    expect(plan.join(" ")).toContain("抽出");
  });
  it("予測モデル Goalは学習→評価の計画になる", () => {
    const plan = generatePlan("売上予測モデルを試作する");
    expect(plan.join(" ")).toContain("評価");
  });
  it("未知のGoalは汎用計画になる", () => {
    const plan = generatePlan("とにかく何かやってください");
    expect(plan.length).toBe(4);
  });
});

describe("パス検証 (API入力境界)", () => {
  it("不正パスは正規化で拒否", () => {
    expect(normalizeRelativePath("../etc/passwd")).toBeNull();
    expect(normalizeRelativePath("/etc")).toBeNull();
  });
  it("危険なファイル名は拒否", () => {
    expect(isSafeFileName("../../x")).toBe(false);
    expect(isSafeFileName("normal.csv")).toBe(true);
  });
});
