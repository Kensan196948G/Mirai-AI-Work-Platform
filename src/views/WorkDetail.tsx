// Work詳細 (G06): Goal / Plan / Task / Tool要約 / Artifacts / Review / 実行情報
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtDateTime, ApiError, type WorkItem, type AgentRun, type TaskItem, type Artifact } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Modal, Loading, Alert } from "../components/ui";

interface WorkDetail extends WorkItem {
  run: AgentRun | null;
  tasks: TaskItem[];
  artifacts: Artifact[];
}

export function WorkDetail({ workId }: { workId: string }) {
  const { goto, viewParam, showToast } = useApp();
  const id = workId ?? viewParam ?? "";
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState("");
  const [constraints, setConstraints] = useState("");

  const load = useCallback(async () => {
    try {
      setWork(await api.get<WorkDetail>(`/works/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "読み込みに失敗しました。");
    }
  }, [id]);
  useEffect(() => { if (id) void load(); }, [id, load]);

  // 実行中はポーリングで状態更新
  useEffect(() => {
    if (!work || !["running", "planning", "queued"].includes(work.status)) return;
    const t = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(t);
  }, [work?.status, load]);

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/works/${id}/approve`);
      showToast("実行を開始しました");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "実行を開始できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm("このWorkの実行を中止します。実行済みの成果物は保持されます。")) return;
    await api.post(`/works/${id}/cancel`);
    showToast("Workを中止しました");
    await load();
  };

  const adopt = async () => {
    if (!window.confirm("成果物を採用します。Review状態が「採用」になります。")) return;
    await api.post(`/works/${id}/adopt`);
    showToast("成果物を採用しました");
    await load();
  };

  const remove = async () => {
    if (!window.confirm("このWorkを削除します。関連する実行履歴も削除されます。この操作は取り消せません。")) return;
    await api.delete(`/works/${id}`);
    showToast("Workを削除しました");
    goto("work-list");
  };

  const saveEdit = async () => {
    await api.patch(`/works/${id}`, { goal: goal.trim(), constraints: constraints.trim() });
    setEditing(false);
    showToast("Goalを更新しました");
    await load();
  };

  if (error) return <div className="errorbox" style={{ margin: 20 }}>{error}</div>;
  if (!work) return <Loading />;

  const running = work.status === "running" || work.status === "planning" || work.status === "queued";
  const plan = work.run?.plan ?? [];

  return (
    <>
      <div className="work-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <button className="iconbtn" onClick={() => goto("work-list")} aria-label="Work一覧に戻る" style={{ marginLeft: -4 }}><Icon name="back" /></button>
            <span className="kicker">Work #{(work.id ?? "").slice(0, 8)}</span>
            <Pill status={work.status} />
          </div>
          <h1>{(work.goal ?? "").slice(0, 60)}</h1>
          <div className="sub">
            <span className="row__project">{work.project_name ?? "個人ワークスペース"}</span>
            <span>{work.run?.model ?? "deepseek-chat"}</span>
            <span className="num">開始 {fmtDateTime(work.started_at)}</span>
          </div>
        </div>
        <div className="work-head__actions">
          {!running && work.status !== "succeeded" && work.status !== "cancelled" && (
            <button className="btn btn--secondary" onClick={() => { setGoal(work.goal); setConstraints(work.constraints); setEditing(true); }}><Icon name="edit" />Goal編集</button>
          )}
          <button className="btn btn--danger" onClick={() => void remove()}><Icon name="trash" />削除</button>
          {work.status === "awaiting_review" && (
            <button className="btn btn--primary" onClick={() => void approve()} disabled={busy}><Icon name="check" />計画を承認して実行</button>
          )}
          {running && <button className="btn btn--secondary" onClick={() => void cancel()}>中止</button>}
        </div>
      </div>

      {error && <Alert kind="danger">{error}</Alert>}

      <div className="work-grid">
        <div className="stack">
          <div className="card">
            <div className="card__head"><h2>Goal と制約</h2></div>
            <div className="card__body">
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>{work.goal}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <span className="tag"><Icon name="file" />保存先: {work.project_name ?? "個人領域"}</span>
                {work.constraints && <span className="tag"><Icon name="alert" />{work.constraints}</span>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Plan</h2>
              <Pill status={work.status === "awaiting_review" ? "pending" : work.status === "running" ? "running" : work.status === "succeeded" ? "adopted" : work.status} />
            </div>
            <div className="card__body">
              {plan.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>計画がまだ生成されていません。</p>
              ) : (
                <ol className="timeline">
                  {plan.map((title, i) => {
                    const task = (work.tasks ?? []).find((t) => t.sequence === i);
                    const state = task?.status ?? "pending";
                    const cls = state === "succeeded" ? "done" : state === "running" ? "active" : state === "failed" ? "err" : "";
                    return (
                      <li className={`tl-item ${cls}`} key={i}>
                        <span className="tl-node">
                          {state === "succeeded" ? <Icon name="check" size={12} /> : state === "failed" ? <Icon name="x" size={12} /> : <span style={{ fontSize: 11 }}>{i + 1}</span>}
                        </span>
                        <div>
                          <div className="tl-title">{title}</div>
                          <div className="tl-sub">{task?.tool_log?.map((l) => `${l.tool}: ${l.summary}`).join("\n") ?? ""}</div>
                          <div className="tl-meta">{task?.finished_at ? `完了 ${fmtDateTime(task.finished_at)}` : ""}</div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2>Tool 実行の要約</h2></div>
            <div className="card__body">
              {(work.tasks ?? []).some((t) => t.tool_log?.length) ? (
                <ul className="rows">
                  {(work.tasks ?? []).filter((t) => t.tool_log?.length).map((t) => (
                    <li className="row" key={t.id}>
                      <span className="row__ic"><Icon name="work" /></span>
                      <span className="row__main">
                        <span className="row__title">{t.tool_log?.[0]?.tool}</span>
                        <span className="row__meta">{t.tool_log?.[0]?.summary}</span>
                      </span>
                      <span className="row__side"><Pill status={t.status === "succeeded" ? "succeeded" : "failed"} /></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                  実行開始後に、Sandbox内で許可されたToolの実行結果がここに表示されます。危険操作は実行前に確認を求めます。
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head"><h2>Artifacts</h2></div>
            <div className="card__body">
              {(work.artifacts ?? []).length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>まだ成果物はありません。実行完了後にここへ生成されます。</p>
              ) : (
                (work.artifacts ?? []).map((a) => (
                  <div className="artifact" key={a.id}>
                    <span className={`artifact__ic artifact__ic--${a.artifact_type === "html" ? "html" : "md"}`}><Icon name="file" /></span>
                    <div style={{ flex: 1 }}>
                      <div className="artifact__name">{a.name}</div>
                      <div className="artifact__meta">{a.artifact_type} · {fmtDateTime(a.created_at)}</div>
                    </div>
                    <Pill status={a.review_status} />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2>Review</h2></div>
            <div className="card__body">
              <div className="review-box">
                <p>実行が完了すると、成果物の内容・形式・保存先を確認し、採用・再実行・終了を選択できます。</p>
                <div className="btns">
                  <button className="btn btn--secondary" disabled={work.status !== "succeeded"} onClick={() => void adopt()}><Icon name="check" />採用</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2>実行情報</h2></div>
            <div className="card__body">
              <div className="kv"><span className="k">実行ID</span><span className="v mono">{work.run?.id ? work.run.id.slice(0, 12) : "—"}…</span></div>
              <div className="kv"><span className="k">Sandbox</span><span className="v">一時コンテナ（/workspace のみ）</span></div>
              <div className="kv"><span className="k">モデル</span><span className="v">{work.run?.model ?? "—"}</span></div>
              <div className="kv"><span className="k">利用トークン</span><span className="v num">{work.run?.token_usage?.total_tokens?.toLocaleString() ?? "—"}</span></div>
              {work.run?.error_code && <div className="kv"><span className="k">エラー</span><span className="v" style={{ color: "var(--danger)" }}>{work.run.error_code}</span></div>}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <Modal title="Goal編集" onClose={() => setEditing(false)}
          footer={<>
            <button className="btn btn--secondary" onClick={() => setEditing(false)}>キャンセル</button>
            <button className="btn btn--primary" onClick={() => void saveEdit()}>保存</button>
          </>}>
          <div className="field">
            <label htmlFor="edit-goal">Goal</label>
            <textarea id="edit-goal" className="input" rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="edit-constraints">制約</label>
            <textarea id="edit-constraints" className="input" rows={2} value={constraints} onChange={(e) => setConstraints(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  );
}
