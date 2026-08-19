// アプリコンテキスト: 認証状態・現在Project・通知・トースト
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type Project, type StorageStatus, type User } from "../lib/api";

export interface AppCtx {
  user: User | null;
  loading: boolean;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  projects: Project[];
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;
  storage: StorageStatus | null;
  toast: string | null;
  showToast: (m: string) => void;
  goto: (view: string, param?: string) => void;
  view: string;
  viewParam: string | null;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AppContext not found");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState("home");
  const [viewParam, setViewParam] = useState<string | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const goto = useCallback((v: string, param?: string) => {
    setView(v);
    setViewParam(param ?? null);
    window.scrollTo(0, 0);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api.get<{ projects: Project[] }>("/projects");
      setProjects(data.projects);
      setCurrentProjectId((prev) => prev ?? data.projects[0]?.id ?? null);
    } catch { /* ignore */ }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const data = await api.get<{ storage: StorageStatus }>("/storage-status");
      setStorage(data.storage);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<{ user: User; storage: { global: StorageStatus } }>("/auth/me");
        setUser(data.user);
        setStorage(data.storage.global);
        await refreshProjects();
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshProjects]);

  const login = useCallback(async (loginId: string, password: string) => {
    const data = await api.post<{ user: User }>("/auth/login", { login_id: loginId, password });
    setUser(data.user);
    setView("home");
    await refreshProjects();
    await loadStorage();
  }, [refreshProjects, loadStorage]);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    setUser(null);
    setProjects([]);
    setView("home");
  }, []);

  return (
    <Ctx.Provider value={{
      user, loading, login, logout, projects, currentProjectId, setCurrentProjectId,
      refreshProjects, storage, toast, showToast, goto, view, viewParam,
    }}>
      {children}
    </Ctx.Provider>
  );
}
