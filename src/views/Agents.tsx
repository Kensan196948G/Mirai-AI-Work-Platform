// Agents (G10): AIエージェント実行状態・履歴
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtDateTime, type AgentRun } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Loading, EmptyState } from "../components/ui";

interface RunRow extends AgentRun {
  project_name?: string | null;
  work_goal?: string | null;
}

export function Agents() {
  const { goto } = useApp();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const data = await api.get<{ runs: RunRow[] }>("/agent-runs");
      setRuns(data.runs);
    })();
  }, []);

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
          <button className="btn btn--primary" onClick={() => goto("work-list")}><Icon name="plus" />新しいWork</button>
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
            <EmptyState text="Agent実行がありません。「新しいWork」からAgent実行を作成できます。" />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Goal</th><th>Project</th><th>状態</th><th>モデル</th><th>タスク</th><th>最終実行</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} onClick={() => r.work_id ? goto("work-detail", r.work_id) : undefined}>
                    <td>
                      <div className="cell-title">{r.goal.slice(0, 44)}</div>
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
    </>
  );
}
