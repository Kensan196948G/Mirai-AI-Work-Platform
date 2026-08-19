// Admin (G12-G16): ダッシュボード / 利用者管理 / Project管理 / AI設定 / 監査ログ
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtDateTime, fmtSize, fmtTiB, type StorageStatus, type User, type AuditLog, type Project } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Loading, Alert, EmptyState, Modal } from "../components/ui";

interface AdminStats {
  users: number;
  projects: number;
  running_runs: number;
  storage: StorageStatus;
}

export function Admin() {
  const { showToast } = useApp();
  const [tab, setTab] = useState("dashboard");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get<{ user: User }>("/auth/me");
        setIsAdmin(me.user.role === "admin");
      } catch { setIsAdmin(false); }
    })();
  }, []);

  if (!isAdmin) {
    return <div className="errorbox" style={{ margin: 20 }}>管理者権限が必要です。</div>;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="sub">システム・容量・実行・利用者・監査の管理</p>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>ダッシュボード</button>
        <button className={`tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>利用者管理</button>
        <button className={`tab ${tab === "projects" ? "active" : ""}`} onClick={() => setTab("projects")}>Project管理</button>
        <button className={`tab ${tab === "ai" ? "active" : ""}`} onClick={() => setTab("ai")}>AI設定</button>
        <button className={`tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>監査ログ</button>
      </div>
      {tab === "dashboard" && <AdminDashboard />}
      {tab === "users" && <AdminUsers onToast={showToast} />}
      {tab === "projects" && <AdminProjects />}
      {tab === "ai" && <AdminAi />}
      {tab === "audit" && <AdminAudit />}
    </>
  );
}

// ---- ダッシュボード ----
function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  useEffect(() => {
    (async () => setStats((await api.get<{ stats: AdminStats }>("/admin/stats")).stats))();
  }, []);
  if (!stats) return <Loading />;
  const s = stats.storage;
  const pct = Math.round(s.usage_ratio * 1000) / 10;
  return (
    <>
      <div className="stats">
        <div className="card stat"><div className="k">利用者</div><div className="v">{stats.users}</div><div className="sub">Pilot 10名規模</div></div>
        <div className="card stat"><div className="k">進行中 Project</div><div className="v">{stats.projects}</div></div>
        <div className="card stat"><div className="k">実行中 Agent</div><div className="v">{stats.running_runs}</div></div>
        <div className={`card stat ${s.protection === "warning" ? "stat--warn" : ""}`}><div className="k">ストレージ使用率</div><div className="v">{pct}%</div><div className="sub">{fmtTiB(s.used_bytes)} / {fmtTiB(s.total_bytes)}</div></div>
      </div>
      <div className="grid2">
        <div className="card">
          <div className="card__head"><h2>ストレージ /mnt/storage</h2>
            <Pill status={s.mounted ? "active" : "failed"} label={s.mounted ? "マウント済み" : "未マウント"} />
          </div>
          <div className="card__body">
            <div className="meter">
              <div className="meter__head"><span>使用量</span><span className="num">{fmtTiB(s.used_bytes)} / {fmtTiB(s.total_bytes)}（{pct}%）</span></div>
              <div className="meter__bar" style={{ height: 12 }}>
                <i className={pct >= 90 ? "danger" : pct >= 70 ? "warn" : "acc"} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {s.thresholds.map((t) => <span className="tag" key={t.ratio}>{Math.round(t.ratio * 100)}% {t.level}</span>)}
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="kv"><span className="k">期待UUID</span><span className="v mono">{s.expected_uuid_ok ? "一致" : "不一致"}</span></div>
              <div className="kv"><span className="k">I/O 状態</span><span className="v">{s.io_ok ? "正常" : "異常"}</span></div>
              <div className="kv"><span className="k">読み取り専用</span><span className="v">{s.readonly ? "あり" : "なし"}</span></div>
              <div className="kv"><span className="k">書込み可否</span><span className="v">{s.write_allowed ? "許可" : "停止"}</span></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><h2>バックアップと運用</h2></div>
          <div className="card__body">
            <div className="kv"><span className="k">方針</span><span className="v">別媒体・別システムへ定期保存</span></div>
            <div className="kv"><span className="k">復元試験</span><span className="v">Pilot開始前に確定</span></div>
            <div className="kv"><span className="k">DeepSeek API</span><span className="v"><span className="conn"><span className="dot" style={{ background: "var(--success)" }} />正常（構成確認）</span></span></div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---- 利用者管理 ----
interface UserRow extends User { usage_bytes?: number; }
function AdminUsers({ onToast }: { onToast: (m: string) => void }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ login_id: "", display_name: "", password: "", role: "user", quota_gb: "100" });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => setUsers((await api.get<{ users: UserRow[] }>("/admin/users")).users);
  useEffect(() => { void load(); }, []);

  const create = async () => {
    setErr(null);
    try {
      await api.post("/admin/users", {
        login_id: form.login_id.trim(), display_name: form.display_name.trim(), password: form.password,
        role: form.role, storage_quota_bytes: Number(form.quota_gb) * 1073741824,
      });
      setCreating(false);
      setForm({ login_id: "", display_name: "", password: "", role: "user", quota_gb: "100" });
      onToast("利用者を追加しました");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "追加に失敗しました。");
    }
  };

  const toggleStatus = async (u: UserRow) => {
    const next = u.status === "disabled" ? "active" : "disabled";
    await api.patch(`/admin/users/${u.id}`, { status: next });
    onToast(`${u.display_name} を${next === "active" ? "有効化" : "停止"}しました`);
    await load();
  };

  return (
    <>
      <div className="toolbar">
        <div className="spacer" />
        <button className="btn btn--secondary" onClick={() => setCreating(true)}><Icon name="plus" />利用者を追加</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          {users === null ? <Loading /> : (
            <table className="tbl">
              <thead><tr><th>利用者</th><th>役割</th><th>Quota</th><th>使用量</th><th>状態</th><th>最終ログイン</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><div className="cell-title">{u.display_name}</div><div className="cell-sub">{u.login_id}</div></td>
                    <td>{u.role}</td>
                    <td className="num">{(u.storage_quota_bytes / 1073741824).toFixed(0)} GB</td>
                    <td className="num">{fmtSize(u.usage_bytes ?? 0)}</td>
                    <td><Pill status={u.status} /></td>
                    <td className="num">{fmtDateTime(u.last_login_at)}</td>
                    <td>
                      <span className="row-actions">
                        <button className="iconbtn" aria-label="有効/停止切替" onClick={() => void toggleStatus(u)}>
                          <Icon name={u.status === "disabled" ? "check" : "x"} size={14} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {creating && (
        <Modal title="利用者を追加" onClose={() => setCreating(false)}
          footer={<>
            <button className="btn btn--secondary" onClick={() => setCreating(false)}>キャンセル</button>
            <button className="btn btn--primary" onClick={() => void create()} disabled={!form.login_id || !form.display_name || form.password.length < 8}>追加</button>
          </>}>
          {err && <Alert kind="danger">{err}</Alert>}
          <div className="field"><label>利用者ID</label>
            <input className="input" value={form.login_id} onChange={(e) => setForm({ ...form, login_id: e.target.value })} placeholder="例：h.tanaka" /></div>
          <div className="field"><label>表示名</label>
            <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div className="field"><label>パスワード（8文字以上）</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="field"><label>役割</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">利用者</option><option value="project_owner">プロジェクト所有者</option><option value="admin">管理者</option>
            </select></div>
          <div className="field"><label>Quota（GB）</label>
            <input className="input" type="number" value={form.quota_gb} min={1} onChange={(e) => setForm({ ...form, quota_gb: e.target.value })} /></div>
        </Modal>
      )}
    </>
  );
}

// ---- Project管理 ----
function AdminProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => { (async () => setProjects((await api.get<{ projects: Project[] }>("/admin/projects")).projects))(); }, []);
  return (
    <div className="card">
      <div className="table-wrap">
        {projects === null ? <Loading /> : (
          <table className="tbl">
            <thead><tr><th>Project</th><th>所有者</th><th>メンバー</th><th>Quota</th><th>使用量</th><th>状態</th></tr></thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><div className="cell-title">{p.name}</div><div className="cell-sub">{p.folder_name}</div></td>
                  <td>{p.owner_name ?? "—"}</td>
                  <td>{p.member_count ?? 0}名</td>
                  <td className="num">{(p.storage_quota_bytes / 1073741824).toFixed(0)} GB</td>
                  <td className="num">{fmtSize(p.usage_bytes ?? 0)}</td>
                  <td><Pill status={p.status === "active" ? "active" : "ended"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---- AI設定 ----
function AdminAi() {
  const [rt, setRt] = useState<{ provider: string; model: string; enabled: boolean; has_api_key: boolean; max_input_chars: number; timeout_ms: number; max_retries: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      const d = await api.get<{ runtime: typeof rt }>("/admin/ai");
      setRt(d.runtime);
    })();
  }, []);

  const test = async () => {
    setTesting(true);
    try {
      setTestResult(await api.post<{ ok: boolean; message: string }>("/admin/ai/test"));
    } finally { setTesting(false); }
  };

  if (!rt) return <Loading />;
  return (
    <div className="grid2">
      <div className="card">
        <div className="card__head"><h2>AI プロバイダ</h2></div>
        <div className="card__body">
          <div className="kv"><span className="k">Provider</span><span className="v">{rt.provider === "deepseek" ? "DeepSeek API" : "demo（検証用ローカル応答）"}</span></div>
          <div className="kv"><span className="k">モデル</span><span className="v">{rt.model}</span></div>
          <div className="kv"><span className="k">有効</span><span className="v"><Pill status={rt.enabled ? "active" : "failed"} label={rt.enabled ? "有効" : "無効"} /></span></div>
          <div className="kv"><span className="k">APIキー</span><span className="v">{rt.has_api_key ? "設定済み（Secret管理）" : "未設定（Secret管理基盤）"}</span></div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn--primary" onClick={() => void test()} disabled={testing}>
              {testing ? "テスト中…" : "テスト接続"}
            </button>
          </div>
          {testResult && (
            <div className={`alert ${testResult.ok ? "alert--info" : "alert--danger"}`} style={{ marginTop: 12 }}>
              <Icon name={testResult.ok ? "check" : "alert"} />
              <span>{testResult.message}</span>
            </div>
          )}
          <div className="kv" style={{ marginTop: 12 }}><span className="k">Key の保存先</span><span className="v">Secret 管理基盤（DB・ソースへ平文保存しない）</span></div>
        </div>
      </div>
      <div className="card">
        <div className="card__head"><h2>利用制限</h2></div>
        <div className="card__body">
          <div className="kv"><span className="k">入力上限</span><span className="v num">{rt.max_input_chars} 文字</span></div>
          <div className="kv"><span className="k">タイムアウト</span><span className="v num">{(rt.timeout_ms / 1000).toFixed(0)} 秒</span></div>
          <div className="kv"><span className="k">再試行上限</span><span className="v num">{rt.max_retries} 回</span></div>
          <div className="kv"><span className="k">Sandbox ネットワーク</span><span className="v">既定拒否</span></div>
        </div>
      </div>
    </div>
  );
}

// ---- 監査ログ ----
function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [action, setAction] = useState("all");
  const [result, setResult] = useState("all");
  const [q, setQ] = useState("");

  const load = async () => {
    const qs = new URLSearchParams();
    if (action !== "all") qs.set("action", action);
    if (result !== "all") qs.set("result", result);
    if (q) qs.set("q", q);
    const d = await api.get<{ logs: AuditLog[] }>(`/admin/audit-logs?${qs.toString()}`);
    setLogs(d.logs);
  };
  useEffect(() => { void load(); }, [action, result]);

  return (
    <>
      <div className="toolbar">
        <select className="select" aria-label="アクション種別" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="all">すべてのアクション</option>
          <option>LOGIN</option><option>FILE_UPLOAD</option><option>FILE_DOWNLOAD</option><option>FILE_DELETE</option>
          <option>WORK_CREATE</option><option>WORK_APPROVE</option><option>WORK_CANCEL</option>
          <option>PROJECT_CREATE</option><option>PROJECT_UPDATE</option><option>USER_CREATE</option><option>USER_UPDATE</option>
          <option>ARTIFACT_ADOPT</option>
        </select>
        <select className="select" aria-label="結果" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="all">すべての結果</option>
          <option value="success">成功</option><option value="failure">失敗</option><option value="denied">拒否</option>
        </select>
        <div className="search" style={{ maxWidth: 220 }}>
          <Icon name="search" />
          <input type="search" placeholder="対象を検索" aria-label="対象を検索" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(); }} />
        </div>
        <div className="spacer" />
      </div>
      <div className="card">
        <div className="table-wrap">
          {logs === null ? <Loading /> : logs.length === 0 ? <EmptyState text="監査ログがありません。" /> : (
            <table className="tbl">
              <thead><tr><th>時刻</th><th>利用者</th><th>アクション</th><th>対象</th><th>結果</th><th>IP</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{fmtDateTime(l.created_at)}</td>
                    <td>{l.display_name ?? "—"}</td>
                    <td><span className="mono">{l.action}</span></td>
                    <td>{l.resource_id || "—"}</td>
                    <td><Pill status={l.result} /></td>
                    <td className="mono">{l.ip ?? "—"}</td>
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
