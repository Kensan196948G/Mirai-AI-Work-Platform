// ============================================================================
// 共有ユーティリティのテスト (パス検証・フォーマット・状態定義)
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  normalizeRelativePath, isSafeFileName, fmtSize, fmtTiB, detectType,
  WORK_STATUS_META, STORAGE_THRESHOLDS,
} from "../worker/src/shared";

describe("normalizeRelativePath", () => {
  it("正規の相対パスは正規化される", () => {
    expect(normalizeRelativePath("workspace/経費データ/file.csv")).toBe("workspace/経費データ/file.csv");
    expect(normalizeRelativePath("a//b/./c")).toBe("a/b/c");
    expect(normalizeRelativePath("")).toBe("");
    expect(normalizeRelativePath("folder")).toBe("folder");
  });
  it("パストラバーサルを拒否する", () => {
    expect(normalizeRelativePath("../secret")).toBeNull();
    expect(normalizeRelativePath("a/../../etc/passwd")).toBeNull();
    expect(normalizeRelativePath("../../etc/passwd")).toBeNull();
    expect(normalizeRelativePath("..")).toBeNull();
  });
  it("絶対パスを拒否する", () => {
    expect(normalizeRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeRelativePath("C:\\Windows\\system32")).toBeNull();
    expect(normalizeRelativePath("\\server\\share")).toBeNull();
  });
  it("過度に深いパスを拒否する", () => {
    const deep = Array.from({ length: 20 }, () => "a").join("/");
    expect(normalizeRelativePath(deep)).toBeNull();
  });
});

describe("isSafeFileName", () => {
  it("通常のファイル名を許可", () => {
    expect(isSafeFileName("report_2026Q3.csv")).toBe(true);
    expect(isSafeFileName("日本語 ファイル (1).pdf")).toBe(true);
  });
  it("危険なファイル名を拒否", () => {
    expect(isSafeFileName("../evil")).toBe(false);
    expect(isSafeFileName("a/b")).toBe(false);
    expect(isSafeFileName("a\\b")).toBe(false);
    expect(isSafeFileName("")).toBe(false);
    expect(isSafeFileName("a\0b")).toBe(false);
    expect(isSafeFileName("x".repeat(201))).toBe(false);
  });
});

describe("fmtSize / fmtTiB", () => {
  it("サイズ表示", () => {
    expect(fmtSize(512)).toBe("512 B");
    expect(fmtSize(2048)).toBe("2.0 KB");
    expect(fmtSize(5 * 1048576)).toBe("5.0 MB");
    expect(fmtSize(2 * 1073741824)).toBe("2.00 GB");
    expect(fmtSize(null)).toBe("—");
  });
  it("TiB表示", () => {
    expect(fmtTiB(1099511627776)).toBe("1.00 TiB");
    expect(fmtTiB(0)).toBe("0.0 GiB");
  });
});

describe("detectType", () => {
  it("拡張子から種別判定", () => {
    expect(detectType("a.pdf")).toBe("PDF");
    expect(detectType("b.csv")).toBe("CSV");
    expect(detectType("c.xlsx")).toBe("Excel");
    expect(detectType("d.md")).toBe("Markdown");
    expect(detectType("e.html")).toBe("HTML");
    expect(detectType("f.png")).toBe("画像");
    expect(detectType("g.txt")).toBe("テキスト");
    expect(detectType("h.xyz")).toBe("その他");
  });
  it("MIMEからフォールバック判定", () => {
    expect(detectType("noext", "image/jpeg")).toBe("画像");
    expect(detectType("noext", "text/plain")).toBe("テキスト");
  });
});

describe("状態定義", () => {
  it("Work状態は全状態を持つ", () => {
    expect(Object.keys(WORK_STATUS_META)).toEqual([
      "queued", "planning", "awaiting_review", "running", "succeeded", "failed", "cancelled",
    ]);
  });
  it("ストレージしきい値は 70/80/85/90/95%", () => {
    expect(STORAGE_THRESHOLDS.map((t) => t.ratio)).toEqual([0.7, 0.8, 0.85, 0.9, 0.95]);
  });
});
