// Chat詳細 (G04): メッセージ表示 + AI送信 + コンテキストパネル
import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { api, fmtDateTime, ApiError, type Conversation, type Message } from "../lib/api";
import { Icon } from "../components/Icon";
import { Loading } from "../components/ui";

interface ConvDetail {
  conversation: Conversation;
  messages: Message[];
}

export function ChatDetail({ convId }: { convId: string }) {
  const { goto, viewParam, showToast, user } = useApp();
  const id = convId ?? viewParam ?? "";
  const [data, setData] = useState<ConvDetail | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setData(await api.get<ConvDetail>(`/conversations/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "読み込みに失敗しました。");
    }
  };
  useEffect(() => { if (id) void load(); }, [id]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [data]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !data) return;
    setInput("");
    setSending(true);
    setError(null);
    // 楽観的追加
    const optimistic: Message = {
      id: `tmp-${Date.now()}`, conversation_id: id, role: "user", content: text,
      model: null, token_usage: null, created_at: new Date().toISOString(),
    };
    setData({ ...data, messages: [...data.messages, optimistic] });
    try {
      const res = await api.post<{ reply: { content: string; model: string; token_usage: { total_tokens?: number } }; request_id: string }>(
        `/conversations/${id}/messages`, { content: text },
      );
      const reply: Message = {
        id: `ai-${Date.now()}`, conversation_id: id, role: "assistant", content: res.reply.content,
        model: res.reply.model, token_usage: res.reply.token_usage, created_at: new Date().toISOString(),
      };
      setData((prev) => prev ? { ...prev, messages: [...prev.messages, reply] } : prev);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(err ? `${err.message}${err.requestId ? `（追跡ID: ${err.requestId}）` : ""}` : "送信に失敗しました。");
      setInput(text); // 入力内容を失わない (要件 3.2)
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("この会話を削除します。この操作は取り消せません。")) return;
    await api.delete(`/conversations/${id}`);
    showToast("会話を削除しました");
    goto("chat-list");
  };

  const rename = async () => {
    if (!newTitle.trim()) return;
    await api.patch(`/conversations/${id}`, { title: newTitle.trim() });
    setRenaming(false);
    showToast("題名を変更しました");
    await load();
  };

  if (!data) return error ? <div className="errorbox" style={{ margin: 20 }}>{error}</div> : <Loading />;

  const totalTokens = data.messages.reduce((s, m) => s + (m.token_usage?.total_tokens ?? 0), 0);
  const attachments = data.messages.length;

  return (
    <div className="chat-layout">
      <div className="chat-main">
        <div className="chat-head">
          <button className="iconbtn" onClick={() => goto("chat-list")} aria-label="Chat一覧に戻る"><Icon name="back" /></button>
          {renaming ? (
            <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }}
              style={{ flex: 1, height: 30 }} autoFocus />
          ) : (
            <h1>{data.conversation.title}</h1>
          )}
          <button className="iconbtn" aria-label="題名を変更" onClick={() => { setNewTitle(data.conversation.title); setRenaming(true); }}><Icon name="edit" /></button>
          <button className="iconbtn" aria-label="会話を削除" style={{ color: "var(--danger)" }} onClick={() => void remove()}><Icon name="trash" /></button>
        </div>
        <div className="chat-scroll" ref={scrollRef} aria-live="polite">
          {data.messages.length === 0 && (
            <div className="msg msg--ai">
              <div className="avatar">AI</div>
              <div className="msg__body"><div className="msg__content"><p className="muted">新しい会話です。質問や依頼を入力してください。</p></div></div>
            </div>
          )}
          {data.messages.map((m) => (
            <div className={`msg ${m.role === "assistant" ? "msg--ai" : "msg--user"}`} key={m.id}>
              <div className="avatar">{m.role === "assistant" ? "AI" : (user?.display_name?.slice(0, 1) ?? "U")}</div>
              <div className="msg__body">
                <div className="msg__meta">
                  {m.role === "assistant" ? `Assistant · ${m.model ?? "demo"} · ` : `${user?.display_name} · `}
                  <span className="num">{fmtDateTime(m.created_at)}</span>
                </div>
                <div className="msg__content prose" style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                {m.token_usage?.total_tokens ? <div className="usage-chip">{m.token_usage.total_tokens.toLocaleString()} tokens</div> : null}
              </div>
            </div>
          ))}
          {sending && (
            <div className="msg msg--ai msg--typing">
              <div className="avatar">AI</div>
              <div className="msg__body"><div className="msg__content"><p className="muted"><span className="spinner" />回答を生成しています…</p></div></div>
            </div>
          )}
        </div>
        {error && <div className="errorbox" style={{ margin: "0 16px" }}>{error}</div>}
        <div className="chat-composer">
          <div className="ctx">
            送信先コンテキスト：<b style={{ color: "var(--accent-text)" }}>{data.conversation.project_name ?? "個人ワークスペース"}</b> · 添付は許可されたファイルのみ
          </div>
          <div className="composer-box">
            <textarea id="chat-input" rows={2} placeholder="質問や依頼を入力してください。送信には Ctrl + Enter を使用できます。"
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void send(); }} />
            <div className="composer-tools">
              <div className="left">
                <span className="hint">AI回答は人が検証してください</span>
              </div>
              <button className="btn btn--primary" onClick={() => void send()} disabled={sending || !input.trim()}>
                <Icon name="send" />送信
              </button>
            </div>
          </div>
        </div>
      </div>
      <aside className="chat-aside">
        <h3>プロジェクト文脈</h3>
        <div className="aside-project"><Icon name="projects" /><span>{data.conversation.project_name ?? "個人ワークスペース"}</span></div>
        <h3>モデル</h3>
        <div className="kv"><span className="k">モデル</span><span className="v">deepseek-chat / demo</span></div>
        <div className="kv"><span className="k">Provider</span><span className="v">DeepSeek API</span></div>
        <h3>利用量（この会話）</h3>
        <div className="kv"><span className="k">合計トークン</span><span className="v num">{totalTokens.toLocaleString()}</span></div>
        <div className="kv"><span className="k">メッセージ数</span><span className="v num">{data.messages.length}</span></div>
        <h3>添付ファイル</h3>
        <div className="kv"><span className="k">件数</span><span className="v num">{attachments}</span></div>
      </aside>
    </div>
  );
}
