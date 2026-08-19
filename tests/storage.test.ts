// ============================================================================
// ストレージサービスのテスト (Quota判定・保護モード・マウント安全)
// ============================================================================
import { describe, expect, it } from "vitest";
import {
  buildStorageStatus, checkWriteAllowed, checkQuota, checkGlobalProtection, protectionLevel,
} from "../worker/src/storage";

const baseEnv = {
  STORAGE_TOTAL_BYTES: "10000000000000", // 10TB
  STORAGE_EXPECTED_UUID: "mirai-storage-test",
  STORAGE_MOUNT_OK: "true",
  STORAGE_IO_OK: "true",
  STORAGE_READONLY: "false",
};

describe("buildStorageStatus", () => {
  it("正常時の状態を返す", () => {
    const s = buildStorageStatus(baseEnv, 10_000_000_000); // 10GB
    expect(s.mounted).toBe(true);
    expect(s.io_ok).toBe(true);
    expect(s.readonly).toBe(false);
    expect(s.write_allowed).toBe(true);
    expect(s.usage_ratio).toBeCloseTo(0.001, 5);
    expect(s.protection).toBe("normal");
  });

  it("未マウント時は書込み不可 (OSルートへの誤書込み防止)", () => {
    const s = buildStorageStatus({ ...baseEnv, STORAGE_MOUNT_OK: "false" }, 0);
    const check = checkWriteAllowed(s);
    expect(check.ok).toBe(false);
    expect(check.code).toBe("STORAGE_NOT_MOUNTED");
  });

  it("I/O異常時は書込み不可", () => {
    const s = buildStorageStatus({ ...baseEnv, STORAGE_IO_OK: "false" }, 0);
    expect(checkWriteAllowed(s).code).toBe("STORAGE_IO_ERROR");
  });

  it("read-only時は書込み不可", () => {
    const s = buildStorageStatus({ ...baseEnv, STORAGE_READONLY: "true" }, 0);
    expect(checkWriteAllowed(s).code).toBe("STORAGE_READ_ONLY");
  });
});

describe("protectionLevel / しきい値", () => {
  it("70%で注意、80%で拡張計画、85%で管理者警告、90%で制限、95%で緊急保護", () => {
    expect(protectionLevel(0.69)).toBe("normal");
    expect(protectionLevel(0.70)).toBe("warning");
    expect(protectionLevel(0.80)).toBe("plan");
    expect(protectionLevel(0.85)).toBe("admin_warning");
    expect(protectionLevel(0.90)).toBe("limited");
    expect(protectionLevel(0.95)).toBe("emergency");
  });

  it("制限・緊急保護時は書込み不可", () => {
    const s90 = buildStorageStatus(baseEnv, 9_000_000_000_000);
    expect(s90.write_allowed).toBe(false);
    const s95 = buildStorageStatus(baseEnv, 9_600_000_000_000);
    expect(s95.write_allowed).toBe(false);
  });
});

describe("checkQuota", () => {
  it("上限内は許可", () => {
    expect(checkQuota(50 * 1024 ** 3, 10 * 1024 ** 3, 100 * 1024 ** 3).ok).toBe(true);
  });
  it("上限超過は拒否 (現在使用量 + 新規サイズ)", () => {
    const r = checkQuota(95 * 1024 ** 3, 10 * 1024 ** 3, 100 * 1024 ** 3);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("QUOTA_EXCEEDED");
  });
  it("ちょうど上限は許可", () => {
    expect(checkQuota(90 * 1024 ** 3, 10 * 1024 ** 3, 100 * 1024 ** 3).ok).toBe(true);
  });
  it("負のサイズは拒否", () => {
    expect(checkQuota(0, -1, 100).ok).toBe(false);
  });
});

describe("checkGlobalProtection", () => {
  it("空き容量を超えるサイズは拒否", () => {
    const s = buildStorageStatus(baseEnv, 9_999_999_999_000);
    expect(checkGlobalProtection(s, 2_000_000_000).ok).toBe(false);
  });
  it("空き容量以内は許可", () => {
    const s = buildStorageStatus(baseEnv, 100_000_000_000);
    expect(checkGlobalProtection(s, 2_000_000_000).ok).toBe(true);
  });
});
