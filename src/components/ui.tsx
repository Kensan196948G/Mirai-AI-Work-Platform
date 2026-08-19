// 共通UI部品: Modal / Confirm / Toast / Pill
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function Pill({ status, label, cls }: { status?: string; label?: string; cls?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    awaiting_review: { label: "確認待ち", cls: "pill--warn" },
    running: { label: "実行中", cls: "pill--running" },
    succeeded: { label: "完了", cls: "pill--success" },
    failed: { label: "失敗", cls: "pill--danger" },
    cancelled: { label: "中止", cls: "pill--muted" },
    queued: { label: "待機", cls: "pill--muted" },
    planning: { label: "計画中", cls: "pill--info" },
    active: { label: "有効", cls: "pill--success" },
    disabled: { label: "停止", cls: "pill--muted" },
    warned: { label: "警告", cls: "pill--warn" },
    available: { label: "利用可能", cls: "pill--success" },
    uploading: { label: "アップロード中", cls: "pill--running" },
    scanning: { label: "検査中", cls: "pill--info" },
    deleting: { label: "削除待ち", cls: "pill--muted" },
    success: { label: "成功", cls: "pill--success" },
    failure: { label: "失敗", cls: "pill--danger" },
    denied: { label: "拒否", cls: "pill--danger" },
    pending: { label: "確認中", cls: "pill--warn" },
    adopted: { label: "採用", cls: "pill--success" },
    rejected: { label: "却下", cls: "pill--muted" },
    rerun: { label: "再実行", cls: "pill--info" },
    ended: { label: "終了", cls: "pill--muted" },
    archived: { label: "アーカイブ", cls: "pill--muted" },
  };
  const m = status ? map[status] : null;
  const finalCls = cls ?? m?.cls ?? "pill--muted";
  const finalLabel = label ?? m?.label ?? status ?? "";
  return (
    <span className={`pill ${finalCls}`}>
      <span className="dot" />
      {finalLabel}
    </span>
  );
}

export function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLInputElement>("input,textarea,select")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div className="modal__head">
          <h3 id="modal-title">{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="閉じる"><Icon name="x" /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, body, okLabel = "削除", danger = true, onOk, onCancel }: {
  title: string; body: React.ReactNode; okLabel?: string; danger?: boolean; onOk: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal modal--sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal__head"><h3 id="confirm-title">{title}</h3></div>
        <div className="modal__body"><p>{body}</p></div>
        <div className="modal__foot">
          <button className="btn btn--secondary" onClick={onCancel}>キャンセル</button>
          <button className={`btn ${danger ? "btn--danger" : "btn--primary"}`} onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast show" role="status">
      <Icon name="check" />
      <span>{message}</span>
    </div>
  );
}

export function Alert({ kind, children }: { kind: "danger" | "warn" | "info"; children: React.ReactNode }) {
  return (
    <div className={`alert alert--${kind}`}>
      <Icon name={kind === "info" ? "db" : "alert"} />
      <span>{children}</span>
    </div>
  );
}

export function Meter({ label, used, quota, cls = "acc" }: { label: string; used: number; quota: number; cls?: string }) {
  const ratio = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const barCls = ratio >= 90 ? "danger" : ratio >= 70 ? "warn" : cls;
  return (
    <div className="meter">
      <div className="meter__head">
        <span>{label}</span>
        <span className="num">{used >= 1073741824 ? `${(used / 1073741824).toFixed(1)} GB` : `${(used / 1048576).toFixed(1)} MB`} / {quota >= 1073741824 ? `${(quota / 1073741824).toFixed(0)} GB` : `${(quota / 1048576).toFixed(0)} MB`}</span>
      </div>
      <div className="meter__bar"><i className={barCls} style={{ width: `${ratio}%` }} /></div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span className="row__ic"><Icon name="db" /></span>
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}

export function Loading({ text = "読み込んでいます…" }: { text?: string }) {
  return (
    <div className="loading-row">
      <span className="spinner" />
      {text}
    </div>
  );
}
