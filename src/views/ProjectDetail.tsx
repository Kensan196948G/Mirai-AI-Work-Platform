// Project詳細 (G08): 概要 / メンバー / Files / Knowledge / Artifacts
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtSize, fmtDateTime, type Project, type FileItem, type Artifact } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Loading, Meter, EmptyState } from "../components/ui";

interface Member { id: string; login_id: string; display_name: string; status: string; role: string; joined_at: string; }
interface ProjDetail extends Project {
  members: Member[];
  files: FileItem[];
  artifacts: (Artifact & { file_name?: string | null })[];
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { goto, viewParam, showToast } = useApp();
  const id = projectId ?? viewParam ?? "";
  const [data, setData] = useState<ProjDetail | null>(null);
  const [tab, setTab] = useState("overview");
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [selUser, setSelUser] = useState("");
  const [selRole, setSelRole] = useState("member");

  const load = async () => {
    try {
      setData(await api.get<ProjDetail>(`/projects/${id}`));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "読み込みに失敗しました。");
    }
  };
  useEffect(() => { if (id) void load(); }, [id]);

  const addMember = async () => {
    if (!selUser) return;
    await api.post(`/projects/${id}/members`, { user_id: selUser, role: selRole });
    setAdding(false);
    setSelUser("");
    showToast("メンバーを追加しました");
    await load();
  };

  const removeMember = async (userId: string, name: string) => {
    if (!window.confirm(`メンバー「${name}」をこのProjectから削除します。`)) return;
    try {
      await api.delete(`/projects/${id}/members/${userId}`);
      showToast("メンバーを削除しました");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "削除に失敗しました。");
    }
  };

  const openAdd = async () => {
    setAdding(true);
    try {
      const d = await api.get<{ users: { id: string; display_name: string; login_id: string }[] }>("/admin/users");
      setUsers(d.users.map((u) => ({ id: u.id, display_name: `${u.display_name}（${u.login_id}）` })));
    } catch { setUsers([]); }
  };

  if (err) return <div className="errorbox" style={{ margin: 20 }}>{err}</div>;
  if (!data) return <Loading />;

  return (
    <>
      <div className="work-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <button className="iconbtn" onClick={() => goto("projects")} aria-label="Projects一覧に戻る" style={{ marginLeft: -4 }}><Icon name="back" /></button>
            <span className="kicker">Project</span>
            <Pill status={data.status === "active" ? "active" : "ended"} />
          </div>
          <h1>{data.name}</h1>
          <div className="sub">
            <span>メンバー {data.members.length}名</span>
            <span className="num">作成 {fmtDateTime(data.created_at)}</span>
          </div>
        </div>
        <div className="work-head__actions">
          <button className="btn btn--secondary" onClick={() => void openAdd()}><Icon name="user" />メンバー追加</button>
          <button className="btn btn--primary" onClick={() => goto("work-list")}><Icon name="plus" />新しいWork</button>
        </div>
      </div>

      <div className="tabs">
        {(["overview", "members", "files", "artifacts"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "overview" ? "概要" : t === "members" ? "メンバー" : t === "files" ? "Files" : "Artifacts"}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid2">
          <div className="card">
            <div className="card__head"><h2>概要</h2></div>
            <div className="card__body">
              <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>{data.description || "説明はありません。"}</p>
            </div>
          </div>
          <div className="card">
            <div className="card__head"><h2>容量</h2></div>
            <div className="card__body">
              <Meter label="Project使用量" used={data.usage_bytes ?? 0} quota={data.storage_quota_bytes} />
              <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                保存先: projects/{data.folder_name}/
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "members" && (
        <div className="card">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>利用者</th><th>役割</th><th>状態</th><th>参加日</th><th></th></tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td><div className="cell-title">{m.display_name}</div><div className="cell-sub">{m.login_id}</div></td>
                    <td>{m.role === "owner" ? "所有者" : m.role === "member" ? "メンバー" : "閲覧者"}</td>
                    <td><Pill status={m.status} /></td>
                    <td className="num">{fmtDateTime(m.joined_at)}</td>
                    <td>
                      {m.role !== "owner" && (
                        <span className="row-actions">
                          <button className="iconbtn iconbtn--danger" aria-label="削除" onClick={() => void removeMember(m.id, m.display_name)}><Icon name="trash" size={14} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "files" && (
        <div className="card">
          {data.files.length === 0 ? <EmptyState text="ファイルがありません。" /> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>名前</th><th>サイズ</th><th>状態</th><th>更新日時</th></tr></thead>
                <tbody>
                  {data.files.map((f) => (
                    <tr key={f.id}>
                      <td><div className="cell-title">{f.name}</div><div className="cell-sub">{f.mime_type}</div></td>
                      <td className="num">{fmtSize(f.size_bytes)}</td>
                      <td><Pill status={f.status} /></td>
                      <td className="num">{fmtDateTime(f.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "artifacts" && (
        <div className="card">
          {data.artifacts.length === 0 ? <EmptyState text="成果物がありません。" /> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>名前</th><th>種別</th><th>Review</th><th>作成日時</th></tr></thead>
                <tbody>
                  {data.artifacts.map((a) => (
                    <tr key={a.id}>
                      <td><div className="cell-title">{a.name}</div></td>
                      <td>{a.artifact_type}</td>
                      <td><Pill status={a.review_status} /></td>
                      <td className="num">{fmtDateTime(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {adding && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal__head">
              <h3>メンバー追加</h3>
              <button className="iconbtn" onClick={() => setAdding(false)} aria-label="閉じる"><Icon name="x" /></button>
            </div>
            <div className="modal__body">
              <div className="field">
                <label htmlFor="sel-user">利用者</label>
                <select id="sel-user" className="input" value={selUser} onChange={(e) => setSelUser(e.target.value)}>
                  <option value="">選択してください</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sel-role">役割</label>
                <select id="sel-role" className="input" value={selRole} onChange={(e) => setSelRole(e.target.value)}>
                  <option value="member">メンバー</option>
                  <option value="viewer">閲覧者</option>
                </select>
              </div>
            </div>
            <div className="modal__foot">
              <button className="btn btn--secondary" onClick={() => setAdding(false)}>キャンセル</button>
              <button className="btn btn--primary" onClick={() => void addMember()} disabled={!selUser}>追加</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
