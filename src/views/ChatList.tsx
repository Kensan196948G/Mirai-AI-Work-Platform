// Chat一覧 (G03) + 会話作成
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtRel, type Conversation } from "../lib/api";
import { Icon } from "../components/Icon";
import { Modal, Loading, EmptyState } from "../components/ui";

export function ChatList() {
  const { goto, showToast, projects } = useApp();
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");

  const load = async () => {
    const data = await api.get<{ conversations: Conversation[] }>("/conversations");
    setConvs(data.conversations);
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    await api.post("/conversations", { title: title.trim() || undefined, project_id: projectId || null });
    setCreating(false);
    setTitle("");
    showToast("会話を作成しました");
    await load();
  };

  const remove = async (id: string) => {
    if (!window.confirm("この会話を削除します。この操作は取り消せません。")) return;
    await api.delete(`/conversations/${id}`);
    showToast("会話を削除しました");
    await load();
  };

  const filtered = (convs ?? []).filter((c) => c.title.includes(q) || (c.last_message ?? "").includes(q));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chat</h1>
          <p className="sub">AIとの対話と会話履歴</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" />新しいChat</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder="会話を検索" aria-label="会話を検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card">
        {convs === null ? <Loading /> : filtered.length === 0 ? (
          <EmptyState text="会話がありません。「新しいChat」から作成してください。" />
        ) : (
          <ul className="rows">
            {filtered.map((c) => (
              <li className="row" key={c.id} onClick={() => goto("chat-detail", c.id)}>
                <span className="row__ic"><Icon name="chat" /></span>
                <span className="row__main">
                  <span className="row__title">{c.title}</span>
                  <span className="row__meta">{(c.last_message ?? "").slice(0, 70)}</span>
                </span>
                <span className="row__side">
                  <span className="row__project">{c.project_name ?? "個人"}</span>
                  <div className="row__time">{fmtRel(c.updated_at)}</div>
                </span>
                <span className="row-actions">
                  <button className="iconbtn iconbtn--danger" aria-label="削除" onClick={(e) => { e.stopPropagation(); void remove(c.id); }}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <Modal title="新しいChat" onClose={() => setCreating(false)}
          footer={<>
            <button className="btn btn--secondary" onClick={() => setCreating(false)}>キャンセル</button>
            <button className="btn btn--primary" onClick={() => void create()}>作成</button>
          </>}>
          <div className="field">
            <label htmlFor="conv-title">会話の題名</label>
            <input id="conv-title" className="input" value={title} placeholder="例：経費データの前処理について"
              onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
          </div>
          <div className="field">
            <label htmlFor="conv-project">Project文脈</label>
            <select id="conv-project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">個人ワークスペース</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </>
  );
}
