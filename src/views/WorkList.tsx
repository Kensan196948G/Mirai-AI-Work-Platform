// Work一覧 (G05) + 新規Work作成 (G06 作成部)
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtDateTime, type WorkItem } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Modal, Loading, EmptyState, Alert } from "../components/ui";

export function WorkList() {
  const { goto, showToast, projects, currentProjectId } = useApp();
  const [works, setWorks] = useState<WorkItem[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [goal, setGoal] = useState("");
  const [constraints, setConstraints] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const data = await api.get<{ works: WorkItem[] }>(`/works?filter=${filter}`);
    setWorks(data.works);
  };
  useEffect(() => { void load(); }, [filter]);

  const create = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/works", { goal: goal.trim(), constraints: constraints.trim(), project_id: projectId || null });
      setCreating(false);
      setGoal("");
      setConstraints("");
      showToast("Workを作成し、計画を生成しました");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "作成に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const filtered = (works ?? []).filter((w) => w.goal.toLowerCase().includes(q.toLowerCase()));
  const FILTERS = [
    { key: "all", label: "すべて" }, { key: "awaiting_review", label: "確認待ち" },
    { key: "running", label: "実行中" }, { key: "succeeded", label: "完了" }, { key: "failed", label: "失敗" },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Work</h1>
          <p className="sub">Goal → Plan → Task → Artifact → Review</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => { setProjectId(currentProjectId ?? ""); setCreating(true); }}>
            <Icon name="plus" />新しいWork
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-chips">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <div className="spacer" />
        <div className="search" style={{ maxWidth: 220 }}>
          <Icon name="search" />
          <input type="search" placeholder="Workを検索" aria-label="Workを検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          {works === null ? <Loading /> : filtered.length === 0 ? (
            <EmptyState text="Workがありません。「新しいWork」からGoalを入力してください。" />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>目標</th><th>Project</th><th>状態</th><th>開始日時</th><th>更新日時</th></tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr key={w.id} onClick={() => goto("work-detail", w.id)}>
                    <td><div className="cell-title">{w.goal.slice(0, 48)}</div></td>
                    <td>{w.project_name ?? "個人"}</td>
                    <td><Pill status={w.status} /></td>
                    <td className="num">{fmtDateTime(w.started_at)}</td>
                    <td className="num">{fmtDateTime(w.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating && (
        <Modal title="新しいWork" onClose={() => setCreating(false)}
          footer={<>
            <button className="btn btn--secondary" onClick={() => setCreating(false)}>キャンセル</button>
            <button className="btn btn--primary" onClick={() => void create()} disabled={busy || !goal.trim()}>
              {busy ? "作成中…" : "Goalを送信して計画生成"}
            </button>
          </>}>
          {err && <Alert kind="danger">{err}</Alert>}
          <div className="field">
            <label htmlFor="work-goal">Goal（目的と成果物）</label>
            <textarea id="work-goal" className="input" rows={4} placeholder="例：経費データから四半期レポートをHTMLで生成する。部門別・月別の集計を含める。"
              value={goal} onChange={(e) => setGoal(e.target.value)} />
            <div className="hint">3〜4000文字。実行前にPlanを確認できます。</div>
          </div>
          <div className="field">
            <label htmlFor="work-constraints">制約（任意）</label>
            <textarea id="work-constraints" className="input" rows={2} placeholder="例：保存先はProject領域、外部送信なし"
              value={constraints} onChange={(e) => setConstraints(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="work-project">保存先Project</label>
            <select id="work-project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">個人ワークスペース</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </>
  );
}
