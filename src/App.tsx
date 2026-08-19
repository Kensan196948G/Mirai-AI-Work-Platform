// アプリルート: 認証状態 → Login / Shell+ビュー
import { AppProvider, useApp } from "./lib/app-context";
import { Toast } from "./components/ui";
import { Shell } from "./components/Shell";
import { Login } from "./views/Login";
import { Home } from "./views/Home";
import { ChatList } from "./views/ChatList";
import { ChatDetail } from "./views/ChatDetail";
import { WorkList } from "./views/WorkList";
import { WorkDetail } from "./views/WorkDetail";
import { Projects } from "./views/Projects";
import { ProjectDetail } from "./views/ProjectDetail";
import { Files } from "./views/Files";
import { Agents } from "./views/Agents";
import { Admin } from "./views/Admin";

const DEMO_BANNER = import.meta.env.VITE_DEMO_BANNER === "true";

function Router() {
  const { user, loading, view, viewParam } = useApp();
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="spinner" style={{ width: 22, height: 22 }} />
        <span style={{ marginLeft: 10, color: "var(--muted)", fontSize: 13 }}>読み込んでいます…</span>
      </div>
    );
  }
  if (!user) return <Login />;

  let content: React.ReactNode;
  switch (view) {
    case "chat-list": content = <ChatList />; break;
    case "chat-detail": content = <ChatDetail convId={viewParam ?? ""} />; break;
    case "work-list": content = <WorkList />; break;
    case "work-detail": content = <WorkDetail workId={viewParam ?? ""} />; break;
    case "projects": content = <Projects />; break;
    case "project-detail": content = <ProjectDetail projectId={viewParam ?? ""} />; break;
    case "files": content = <Files />; break;
    case "agents": content = <Agents />; break;
    case "admin": content = <Admin />; break;
    default: content = <Home />;
  }
  return <Shell>{content}</Shell>;
}

function Root() {
  const { toast } = useApp();
  return (
    <>
      {DEMO_BANNER && (
        <div className="demo-banner" role="note">デモ環境 — 検証用ダミーデータで動作しています</div>
      )}
      <Router />
      <Toast message={toast} />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
