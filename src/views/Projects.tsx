// Projects一覧 (G07) + 新規Project
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtSize, fmtRel, type Project } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Modal, Loading, EmptyState, Alert } from "../components/ui";

export function Projects() {
  const { goto, showToast, user } = useApp();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [desc, setDesc] = useState("");
  const [quotaGb, setQuotaGb] = useState("100");
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const data = await api.get<{ projects: Project[] }>("/projects");
    setProjects(data.projects);
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    setErr(null);
    if (!name.trim() || !folder.trim()) return;
    try {
      await api.post("/projects", {
        name: name.trim(), folder_name: folder.trim().toLowerCase(), description: desc.trim(),
        storage_quota_bytes: Number(quotaGb) * 1073741824,
      });
      setCreating(false);
      setName(""); setFolder(""); setDesc("");
      showToast("Projectを作成しました");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "作成に失敗しました。");
    }
  };

  const filtered = (projects ?? []).filter((p) => {
    if (filter === "active" && p.status !== "active") return false;
    if (filter === "owner" && p.owner_id !== user?.id) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">共同作業のメンバー・ファイル・成果物をまとめる領域</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" />新しいProject</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-chips">
          <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>すべて</button>
          <button className={`chip ${filter === "active" ? "active" : ""}`} onClick={() => setFilter("active")}>進行中</button>
          <button className={`chip ${filter === "owner" ? "active" : ""}`} onClick={() => setFilter("owner")}>所有</button>
        </div>
        <div className="spacer" />
        <div className="search" style={{ maxWidth: 240 }}>
          <Icon name="search" />
          <input type="search" placeholder="Projectを検索" aria-label="Projectを検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          {projects === null ? <Loading /> : filtered.length === 0 ? (
            <EmptyState text="Projectがありません。参加中のProjectがここに表示されます。" />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Project</th><th>メンバー</th><th>使用量</th><th>Quota</th><th>状態</th><th>更新日時</th></tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} onClick={() => goto("project-detail", p.id)}>
                    <td>
                      <div className="cell-title">{p.name}</div>
                      <div className="cell-sub">{p.folder_name}</div>
                    </td>
                    <td>{p.member_count ?? 0}名</td>
                    <td className="num">{fmtSize(p.usage_bytes ?? 0)}</td>
                    <td className="num">{(p.storage_quota_bytes / 1073741824).toFixed(0)} GB</td>
                    <td><Pill status={p.status === "active" ? "active" : "ended"} /></td>
                    <td className="num">{fmtRel(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating && (
        <Modal title="新しいProject" onClose={() => setCreating(false)}
          footer={<>
            <button className="btn btn--secondary" onClick={() => setCreating(false)}>キャンセル</button>
            <button className="btn btn--primary" onClick={() => void create()} disabled={!name.trim() || !folder.trim()}>作成</button>
          </>}>
          {err && <Alert kind="danger">{err}</Alert>}
          <div className="field">
            <label htmlFor="proj-name">Project名</label>
            <input id="proj-name" className="input" value={name} placeholder="例：経費精算レポート自動化" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="proj-folder">保存先フォルダ名（英小文字・数字・ハイフン）</label>
            <input id="proj-folder" className="input" value={folder} placeholder="例：expense-report" onChange={(e) => setFolder(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="proj-desc">説明</label>
            <textarea id="proj-desc" className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="proj-quota">Quota（GB）</label>
            <select id="proj-quota" className="input" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)}>
              <option value="50">50 GB</option>
              <option value="100">100 GB</option>
              <option value="500">500 GB</option>
            </select>
          </div>
        </Modal>
      )}
    </>
  );
}
