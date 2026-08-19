// ホーム画面 (G02)
import { useEffect, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtRel, fmtTiB, type Conversation, type WorkItem } from "../lib/api";
import { Icon } from "../components/Icon";
import { Pill, Meter, Loading, EmptyState } from "../components/ui";

interface DashboardData {
  user: { display_name: string };
  recent_conversations: Conversation[];
  works: (WorkItem & { project_name?: string | null })[];
  projects: { id: string; name: string; usage_bytes: number; storage_quota_bytes: number }[];
  storage: { quota_bytes: number; used_bytes: number; ratio: number; global: { usage_ratio: number } };
  notifications: { action: string; created_at: string }[];
}

export function Home() {
  const { user, goto, currentProjectId, projects, storage } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setData(await api.get<DashboardData>("/dashboard"));
      } catch { /* keep null */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Loading />;

  const awaiting = data?.works.filter((w) => w.status === "awaiting_review").length ?? 0;
  const failed = data?.works.filter((w) => w.status === "failed").length ?? 0;
  const curProject = projects.find((p) => p.id === currentProjectId);
  const myUsage = data?.storage.used_bytes ?? 0;
  const myQuota = data?.storage.quota_bytes ?? 0;

  return (
    <>
      <div className="home-hero">
        <div>
          <h1>おかえりなさい、{user?.display_name ?? "さん"}</h1>
          <p className="sub">
            現在のコンテキスト：<b style={{ color: "var(--accent-text)" }}>{curProject?.name ?? "個人ワークスペース"}</b>
          </p>
        </div>
        <div className="home-hero__actions">
          <button className="btn btn--secondary" onClick={() => goto("chat-list")}><Icon name="chat" />新しいChat</button>
          <button className="btn btn--primary" onClick={() => goto("work-list")}><Icon name="plus" />新しいWork</button>
        </div>
      </div>

      <div className="attention">
        <Icon name="alert" />
        <div className="att-items">
          {awaiting > 0 && <span><b>確認待ちのWork {awaiting}件</b> — <a href="#" onClick={(e) => { e.preventDefault(); goto("work-list"); }}>一覧を確認</a></span>}
          {failed > 0 && <span><b>失敗したWork {failed}件</b> — <a href="#" onClick={(e) => { e.preventDefault(); goto("work-list"); }}>詳細を見る</a></span>}
          {awaiting === 0 && failed === 0 && <span>現在、対応が必要な項目はありません。</span>}
        </div>
      </div>

      <div className="home-grid">
        <div className="stack">
          <div className="card">
            <div className="card__head">
              <h2>最近の会話</h2>
              <a href="#" onClick={(e) => { e.preventDefault(); goto("chat-list"); }} style={{ fontSize: 12.5, fontWeight: 550 }}>すべて見る</a>
            </div>
            {data?.recent_conversations.length ? (
              <ul className="rows">
                {data.recent_conversations.map((c) => (
                  <li className="row" key={c.id} onClick={() => goto("chat-detail", c.id)}>
                    <span className="row__ic"><Icon name="chat" /></span>
                    <span className="row__main">
                      <span className="row__title">{c.title}</span>
                      <span className="row__meta">{(c.last_message ?? "").slice(0, 60)}</span>
                    </span>
                    <span className="row__side">
                      <span className="row__project">{c.project_name ?? "個人"}</span>
                      <div className="row__time">{fmtRel(c.updated_at)}</div>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState text="会話がありません。「新しいChat」から作成してください。" />}
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Work の状況</h2>
              <a href="#" onClick={(e) => { e.preventDefault(); goto("work-list"); }} style={{ fontSize: 12.5, fontWeight: 550 }}>すべて見る</a>
            </div>
            {data?.works.length ? (
              <ul className="rows">
                {data.works.map((w) => (
                  <li className="row" key={w.id} onClick={() => goto("work-detail", w.id)}>
                    <span className="row__ic"><Icon name="work" /></span>
                    <span className="row__main">
                      <span className="row__title">{(w.goal ?? "").slice(0, 40)}</span>
                      <span className="row__meta">{w.project_name ?? "個人"} · 更新 {fmtRel(w.updated_at)}</span>
                    </span>
                    <span className="row__side"><Pill status={w.status} /></span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState text="Workはまだありません。" />}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head"><h2>ストレージ使用量</h2></div>
            <div className="card__body">
              <Meter label={`個人領域（${(myQuota / 1073741824).toFixed(0)} GB 上限）`} used={myUsage} quota={myQuota} />
              {curProject && (
                <div style={{ marginTop: 12 }}>
                  <Meter label={`${curProject.name}（${(curProject.storage_quota_bytes / 1073741824).toFixed(0)} GB 上限）`} used={curProject.usage_bytes ?? 0} quota={curProject.storage_quota_bytes} />
                </div>
              )}
              <p className="muted" style={{ fontSize: 11.5, margin: "12px 0 0" }}>
                システム全体 {storage ? `${(storage.usage_ratio * 100).toFixed(1)}%` : "—"} 使用（{storage ? fmtTiB(storage.used_bytes) : ""} / {storage ? fmtTiB(storage.total_bytes) : ""}）
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2>通知</h2></div>
            <ul className="rows">
              {(data?.notifications ?? []).slice(0, 3).map((n, i) => (
                <li className="row" key={i}>
                  <span className="row__ic" style={{ background: "var(--info-bg)", color: "var(--info)" }}><Icon name="db" /></span>
                  <span className="row__main">
                    <span className="row__title">{n.action}</span>
                    <span className="row__meta">{fmtRel(n.created_at)}</span>
                  </span>
                </li>
              ))}
              {!data?.notifications?.length && <li className="row"><span className="row__main"><span className="row__meta">通知はありません。</span></span></li>}
            </ul>
          </div>

          <div className="card">
            <div className="card__head"><h2>はじめての方へ</h2></div>
            <div className="card__body">
              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
                保存先（個人／Project）と利用上限を確認してから AI を使い始めましょう。機密情報や個人情報は入力しないでください。
              </p>
              <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 12.5, fontWeight: 550 }}>利用者ガイドを読む →</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
