// アプリシェル: サイドバー / ヘッダー / フッター
import { useState } from "react";
import { useApp } from "../lib/app-context";
import { Icon } from "./Icon";
import { fmtTiB } from "../lib/api";
import type { Project } from "../lib/api";

const NAV = [
  { group: "メイン", items: [
    { view: "home", icon: "home", label: "ホーム" },
    { view: "chat-list", icon: "chat", label: "Chat" },
    { view: "work-list", icon: "work", label: "Work" },
  ]},
  { group: "作業領域", items: [
    { view: "projects", icon: "projects", label: "Projects" },
    { view: "files", icon: "files", label: "Files" },
    { view: "agents", icon: "agents", label: "Agents" },
  ]},
  { group: "管理", items: [
    { view: "admin", icon: "admin", label: "Admin" },
  ]},
];

const CRUMBS: Record<string, string> = {
  home: "ホーム", "chat-list": "Chat", "chat-detail": "Chat / 会話詳細",
  "work-list": "Work", "work-detail": "Work / 詳細",
  projects: "Projects", "project-detail": "Projects / 詳細",
  files: "Files", agents: "Agents", admin: "Admin",
};

function ProjectSelector() {
  const { projects, currentProjectId, setCurrentProjectId } = useApp();
  return (
    <select
      className="hdr-context__select"
      aria-label="現在のプロジェクト"
      value={currentProjectId ?? ""}
      onChange={(e) => setCurrentProjectId(e.target.value || null)}
      style={{ fontFamily: "inherit", fontSize: 13, fontWeight: 550, border: "1px solid var(--border)", borderRadius: "var(--radius)", height: 32, padding: "0 8px", background: "var(--surface)", color: "var(--fg)" }}
    >
      <option value="">個人ワークスペース</option>
      {projects.map((p: Project) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, goto, view, storage, showToast } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const activeNav = (v: string) => {
    if (v === "chat-list" && (view === "chat-list" || view === "chat-detail")) return true;
    if (v === "work-list" && (view === "work-list" || view === "work-detail")) return true;
    if (v === "projects" && (view === "projects" || view === "project-detail")) return true;
    return view === v;
  };

  const ratio = storage ? Math.round(storage.usage_ratio * 100) : 0;
  const initials = user?.display_name?.slice(0, 1) ?? "?";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark"><Icon name="logo" size={15} /></div>
          <div>
            <div className="brand__name">Mirai AI</div>
            <div className="brand__sub">Work Platform</div>
          </div>
        </div>
        <nav className="nav" aria-label="メインナビゲーション">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav__group">{g.group}</div>
              {g.items.map((item) => (
                <a key={item.view} href="#" className={activeNav(item.view) ? "active" : ""}
                  onClick={(e) => { e.preventDefault(); goto(item.view); }}>
                  <Icon name={item.icon} size={16} />
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="userchip">
            <div className="avatar">{initials}</div>
            <div>
              <div className="userchip__name">{user?.display_name}</div>
              <div className="userchip__role">{user?.role === "admin" ? "IT・DX管理者" : user?.role === "project_owner" ? "プロジェクト所有者" : "利用者"}</div>
            </div>
          </div>
        </div>
      </aside>

      <header className="header">
        <div className="hdr-context">
          <span className="crumb">{CRUMBS[view] ?? "ホーム"}</span>
          <ProjectSelector />
        </div>
        <div className="hdr-actions">
          <div className="hdr-storage">
            <Icon name="db" size={13} />
            <span className="num">{storage ? `${fmtTiB(storage.used_bytes)} / ${fmtTiB(storage.total_bytes)}` : "—"}</span>
            <span className="bar"><i style={{ width: `${Math.min(100, ratio)}%` }} /></span>
          </div>
          <div className={`dropdown ${notifOpen ? "open" : ""}`}>
            <button className="iconbtn" aria-label="通知" aria-expanded={notifOpen} onClick={() => { setNotifOpen(!notifOpen); setUserOpen(false); }}>
              <Icon name="bell" />
            </button>
            {notifOpen && (
              <div className="dropdown__menu" role="menu">
                <div className="dropdown__label">通知</div>
                <a href="#" onClick={(e) => { e.preventDefault(); setNotifOpen(false); goto("work-list"); }}>
                  <Icon name="work" /><span>Work の確認待ちは「Work」画面で確認できます</span>
                </a>
                <a href="#" onClick={(e) => { e.preventDefault(); setNotifOpen(false); goto("admin"); }}>
                  <Icon name="db" /><span>ストレージ状態は Admin で確認できます</span>
                </a>
              </div>
            )}
          </div>
          <div className={`dropdown ${userOpen ? "open" : ""}`}>
            <button className="iconbtn" aria-label="ユーザーメニュー" aria-expanded={userOpen} onClick={() => { setUserOpen(!userOpen); setNotifOpen(false); }}>
              <span className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{initials}</span>
              <Icon name="chevD" size={13} />
            </button>
            {userOpen && (
              <div className="dropdown__menu" role="menu">
                <div className="dropdown__label">{user?.login_id}（{user?.display_name}）</div>
                <button onClick={() => { setUserOpen(false); goto("files"); }}><Icon name="db" /><span>容量・利用状況</span></button>
                <div className="dd-sep" />
                <button onClick={() => { setUserOpen(false); void logout(); showToast("サインアウトしました"); }}>
                  <Icon name="logout" /><span>サインアウト</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main" id="main">{children}</main>

      <footer className="footer">
        <div className="f-storage">
          <Icon name="db" size={13} />
          <span className="num">{storage ? `10TB · ${ratio}%` : "—"}</span>
          <span className="bar">
            <i style={{ width: `${Math.min(100, ratio)}%` }} />
            <span className="tick" style={{ left: "70%" }} />
            <span className="tick" style={{ left: "90%" }} />
          </span>
        </div>
        <div className="f-item">
          <span className="conn"><span className="dot" style={{ background: storage?.mounted ? "var(--success)" : "var(--danger)" }} /></span>
          {storage?.mounted ? "ストレージ 正常" : "ストレージ 異常"}
        </div>
        <span className="sep">|</span>
        <div className="f-item"><Icon name="work" /><span>実行中は Work 画面で確認</span></div>
        <div className="f-grow" />
        <div className="f-item"><Icon name="check" /><span>バックアップ: 別系統保存</span></div>
        <span className="sep">|</span>
        <a href="#" className="f-item" onClick={(e) => e.preventDefault()}><Icon name="help" /><span>ヘルプ</span></a>
      </footer>
    </div>
  );
}
