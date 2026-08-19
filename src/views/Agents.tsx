// Agents (G10): AIエージェント実行状態・履歴
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtDateTime, type AgentRun } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Modal, Loading, EmptyState, Alert } from "../components/ui";

interface RunRow extends AgentRun {
  project_name?: string | null;
  work_goal?: string | null;
}

export function Agents() {
  const { goto, showToast, projects } = useApp();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const data = await api.get<{ runs: RunRow[] }>("/agent-runs");
    setRuns(data.runs);
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      // Agent は Work 実行 (agent_runs) として作成する (OpenDesign: エージェント名 + 目的/Goal)
      const workGoal = goal.trim() ? `${name.trim()} — ${goal.trim()}` : name.trim();
      const data = await api.post<{ work: { id: string } }>("/works", {
        goal: workGoal,
        constraints: "",
        project_id: projectId || null,
      });
      setCreating(false);
      setName("");
      setGoal("");
      showToast("Agentを作成しました（計画確認待ち）");
      goto("work-detail", data.work.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "作成に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const filtered = (runs ?? []).filter((r) => {
    if (filter === "running" && !["running", "queued", "planning", "awaiting_review"].includes(r.status)) return false;
    if (filter === "succeeded" && r.status !== "succeeded") return false;
    if (filter === "failed" && r.status !== "failed") return false;
    if (q && !r.goal.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p className="sub">あなたが作成したAIエージェントの実行状態・履歴・資源利用</p>
        </div>
        <div className="page-head__actions">
          <span className="pill pill--info"><span className="dot" />Sandbox 隔離有効</span>
          <button className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" />新しいAgent</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-chips">
          <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>すべて</button>
          <button className={`chip ${filter === "running" ? "active" : ""}`} onClick={() => setFilter("running")}>実行中</button>
          <button className={`chip ${filter === "succeeded" ? "active" : ""}`} onClick={() => setFilter("succeeded")}>完了</button>
          <button className={`chip ${filter === "failed" ? "active" : ""}`} onClick={() => setFilter("failed")}>失敗</button>
        </div>
        <div className="spacer" />
        <div className="search" style={{ maxWidth: 240 }}>
          <Icon name="search" />
          <input type="search" placeholder="Agentを検索" aria-label="Agentを検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          {runs === null ? <Loading /> : filtered.length === 0 ? (
            <EmptyState text="Agent実行がありません。「新しいAgent」から作成してください。" />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Agent / Goal</th><th>Project</th><th>状態</th><th>モデル</th><th>タスク</th><th>最終実行</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} onClick={() => r.work_id ? goto("work-detail", r.work_id) : undefined}>
                    <td>
                      <div className="cell-title">{(r.goal ?? "").slice(0, 44)}</div>
                      <div className="cell-sub">{r.id.slice(0, 12)}…</div>
                    </td>
                    <td>{r.project_name ?? "個人"}</td>
                    <td><Pill status={r.status} /></td>
                    <td>{r.model ?? "—"}</td>
                    <td>{Array.isArray(r.plan) ? r.plan.length : 0}件</td>
                    <td className="num">{fmtDateTime(r.finished_at ?? r.created_at)}</td>
                    <td>
                      {r.work_id && (
                        <span className="row-actions">
                          <button className="iconbtn" aria-label="詳細" onClick={() => goto("work-detail", r.work_id!)}><Icon name="arrowR" size={14} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating && (
        <Modal title="新しいAgent" onClose={() => setCreating(false)}
          footer={<>
            <button className="btn btn--secondary" onClick={() => setCreating(false)}>キャンセル</button>
            <button className="btn btn--primary" onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? "作成中…" : "作成"}
            </button>
          </>}>
          {err && <Alert kind="danger">{err}</Alert>}
          <div className="field">
            <label htmlFor="agent-name">エージェント名</label>
            <input id="agent-name" className="input" value={name} placeholder="例：経費レポート生成エージェント"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          </div>
          <div className="field">
            <label htmlFor="agent-goal">目的・説明（Goal）</label>
            <textarea id="agent-goal" className="input" rows={3} placeholder="例：経費データから四半期レポートを自動生成する"
              value={goal} onChange={(e) => setGoal(e.target.value)} />
            <div className="hint">作成後にPlanを確認してから実行できます。</div>
          </div>
          <div className="field">
            <label htmlFor="agent-project">保存先Project</label>
            <select id="agent-project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">個人ワークスペース</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </>
  );
}
