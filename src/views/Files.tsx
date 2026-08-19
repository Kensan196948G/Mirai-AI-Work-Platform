// Files (G09): 個人/Project領域のファイル管理
import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtSize, fmtDateTime, detectType, ApiError, type FileItem, type Project } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Loading, EmptyState, Alert } from "../components/ui";

export function Files() {
  const { user, projects, currentProjectId, showToast } = useApp();
  const [scope, setScope] = useState<"user" | "project">("user");
  const [projectId, setProjectId] = useState<string>("");
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setErr(null);
    try {
      const data = scope === "project"
        ? await api.get<{ files: FileItem[] }>(`/files?scope=project&project_id=${projectId}`)
        : await api.get<{ files: FileItem[] }>("/files?scope=user");
      setFiles(data.files);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "読み込みに失敗しました。");
      setFiles([]);
    }
  };
  useEffect(() => { void load(); }, [scope, projectId]);
  useEffect(() => {
    if (currentProjectId && projects.length > 0) setProjectId(currentProjectId);
  }, [currentProjectId, projects]);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      for (const f of Array.from(list)) {
        const form = new FormData();
        form.append("file", f);
        const qs = scope === "project" ? `?scope=project&project_id=${projectId}` : "?scope=user";
        await api.upload(`/files${qs}`, form);
      }
      showToast("アップロードしました");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "アップロードに失敗しました。");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (f: FileItem) => {
    if (!window.confirm(`ファイル「${f.name}」を削除します。この操作は取り消せません。`)) return;
    try {
      await api.delete(`/files/${f.id}`);
      showToast("ファイルを削除しました");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "削除に失敗しました。");
    }
  };

  const download = async (f: FileItem) => {
    try {
      const data = await api.get<{ url: string }>(`/files/${f.id}/download`);
      showToast("メタデータを取得しました（実体はストレージに保存）");
      window.open(data.url, "_blank");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "取得に失敗しました。");
    }
  };

  const filtered = (files ?? []).filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Files</h1>
          <p className="sub">個人領域とProject領域のファイル管理</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Icon name="upload" />{uploading ? "アップロード中…" : "アップロード"}
          </button>
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => void upload(e.target.files)} aria-label="アップロードファイル選択" />
        </div>
      </div>
      <div className="toolbar">
        <select className="select" aria-label="保存先" value={scope} onChange={(e) => setScope(e.target.value as "user" | "project")}>
          <option value="user">個人領域（{user?.display_name}）</option>
          {projects.map((p: Project) => <option key={p.id} value="project">{p.name}</option>)}
        </select>
        {scope === "project" && (
          <select className="select" aria-label="Project選択" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p: Project) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="spacer" />
        <div className="search" style={{ maxWidth: 240 }}>
          <Icon name="search" />
          <input type="search" placeholder="ファイルを検索" aria-label="ファイルを検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {err && <Alert kind="danger">{err}</Alert>}
      <div className="card">
        <div className="table-wrap">
          {files === null ? <Loading /> : filtered.length === 0 ? (
            <EmptyState text="ファイルがありません。右上の「アップロード」から追加してください。" />
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>名前</th><th>種別</th><th>サイズ</th><th>所有者</th><th>更新日時</th><th>状態</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id}>
                    <td><div className="cell-title"><Icon name="file" size={13} style={{ marginRight: 6, verticalAlign: -2 }} />{f.name}</div></td>
                    <td>{detectType(f.name, f.mime_type)}</td>
                    <td className="num">{fmtSize(f.size_bytes)}</td>
                    <td>{f.owner_type === "project" ? "Project" : user?.display_name}</td>
                    <td className="num">{fmtDateTime(f.updated_at)}</td>
                    <td><Pill status={f.status} /></td>
                    <td>
                      <span className="row-actions">
                        <button className="iconbtn" aria-label="ダウンロード" onClick={() => void download(f)}><Icon name="download" size={14} /></button>
                        <button className="iconbtn iconbtn--danger" aria-label="削除" onClick={() => void remove(f)}><Icon name="trash" size={14} /></button>
                      </span>
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
