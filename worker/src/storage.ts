// ============================================================================
// Mirai AI Work Platform — worker/src/storage.ts
// ストレージサービス: 容量・Quota判定・マウント/I/O状態
// 正本: doc/03_詳細設計書 §2/§5/§10, doc/06_機能仕様 §11
// 物理 /mnt/storage (10TB HDD) は on-prem Pilot 要件。
// クラウドMVPでは env による状態シミュレーション + DB使用量で実装する。
// ============================================================================

import type { Env } from "./types";
import { STORAGE_THRESHOLDS } from "./shared";

export interface StorageStatus {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  usage_ratio: number;
  level: string;
  protection: "normal" | "warning" | "plan" | "admin_warning" | "limited" | "emergency";
  mounted: boolean;
  expected_uuid_ok: boolean;
  io_ok: boolean;
  readonly: boolean;
  write_allowed: boolean;
  thresholds: { ratio: number; level: string }[];
}

export interface QuotaCheck {
  ok: boolean;
  reason?: string;
  code?: string;
}

export function storageConfig(env: Env) {
  const total = Number(env.STORAGE_TOTAL_BYTES ?? 10_000_000_000_000);
  return {
    totalBytes: Number.isFinite(total) && total > 0 ? total : 10_000_000_000_000,
    expectedUuid: env.STORAGE_EXPECTED_UUID ?? "",
    mounted: env.STORAGE_MOUNT_OK !== "false",
    ioOk: env.STORAGE_IO_OK !== "false",
    readonly: env.STORAGE_READONLY === "true",
  };
}

/** 使用率に応じた保護レベル判定 (70/80/85/90/95%) */
export function protectionLevel(ratio: number): StorageStatus["protection"] {
  if (ratio >= 0.95) return "emergency";
  if (ratio >= 0.9) return "limited";
  if (ratio >= 0.85) return "admin_warning";
  if (ratio >= 0.8) return "plan";
  if (ratio >= 0.7) return "warning";
  return "normal";
}

export function buildStorageStatus(env: Env, usedBytes: number): StorageStatus {
  const cfg = storageConfig(env);
  const ratio = cfg.totalBytes > 0 ? usedBytes / cfg.totalBytes : 0;
  const level = protectionLevel(ratio);
  const writeAllowed = cfg.mounted && cfg.ioOk && !cfg.readonly && level !== "emergency" && level !== "limited";
  return {
    total_bytes: cfg.totalBytes,
    used_bytes: usedBytes,
    free_bytes: Math.max(0, cfg.totalBytes - usedBytes),
    usage_ratio: ratio,
    level,
    protection: level,
    mounted: cfg.mounted,
    expected_uuid_ok: true, // クラウドMVP: UUID照合はシミュレーション (on-premで実装)
    io_ok: cfg.ioOk,
    readonly: cfg.readonly,
    write_allowed: writeAllowed,
    thresholds: [...STORAGE_THRESHOLDS],
  };
}

/** 書込み可否の事前チェック (マウント/I/O/保護モード) */
export function checkWriteAllowed(status: StorageStatus): QuotaCheck {
  if (!status.mounted) {
    return { ok: false, code: "STORAGE_NOT_MOUNTED", reason: "ストレージがマウントされていません。" };
  }
  if (!status.io_ok) {
    return { ok: false, code: "STORAGE_IO_ERROR", reason: "ストレージにI/Oエラーが発生しています。" };
  }
  if (status.readonly) {
    return { ok: false, code: "STORAGE_READ_ONLY", reason: "ストレージが読み取り専用です。現在は新しいファイルを保存できません。" };
  }
  if (status.protection === "emergency" || status.protection === "limited") {
    return { ok: false, code: "STORAGE_PROTECTION", reason: "ストレージ使用率が上限に達しているため、新しい保存は停止されています。" };
  }
  return { ok: true };
}

/** Quota判定: current + incoming が上限を超えないか (詳細設計書 §5) */
export function checkQuota(currentBytes: number, incomingBytes: number, quotaBytes: number): QuotaCheck {
  if (incomingBytes < 0) return { ok: false, code: "INVALID_SIZE", reason: "サイズが不正です。" };
  if (currentBytes + incomingBytes > quotaBytes) {
    return {
      ok: false,
      code: "QUOTA_EXCEEDED",
      reason: `保存先の容量上限を超えます（現在 ${formatGb(currentBytes)} / 上限 ${formatGb(quotaBytes)}）。`,
    };
  }
  return { ok: true };
}

export function checkGlobalProtection(status: StorageStatus, incomingBytes: number): QuotaCheck {
  const free = status.free_bytes;
  if (incomingBytes > free) {
    return { ok: false, code: "STORAGE_FULL", reason: "ストレージの空き容量が不足しています。" };
  }
  return { ok: true };
}

function formatGb(bytes: number): string {
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}
