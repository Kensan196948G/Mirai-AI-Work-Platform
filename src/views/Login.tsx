// サインイン画面 (G01)
import { useState } from "react";
import { useApp } from "../lib/app-context";
import { ApiError } from "../lib/api";
import { Icon } from "../components/Icon";
import { Alert } from "../components/ui";

export function Login() {
  const { login } = useApp();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(loginId.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("サインインに失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <div className="brand__mark"><Icon name="logo" size={19} /></div>
          <div>
            <div className="brand__name">Mirai AI Work Platform</div>
            <div className="brand__sub">社内向け AI ワークプラットフォーム</div>
          </div>
        </div>
        <form className="card login__card" onSubmit={submit}>
          <h1>サインイン</h1>
          <p className="sub">利用者IDとパスワードを入力してください。</p>
          {error && <Alert kind="danger">{error}</Alert>}
          <div className="field">
            <label htmlFor="login-id">利用者ID</label>
            <input id="login-id" type="text" autoComplete="username" placeholder="例：naoki.sato"
              value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="login-pw">パスワード</label>
            <input id="login-pw" type="password" autoComplete="current-password" placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn--primary" disabled={busy} style={{ width: "100%", height: 38, justifyContent: "center", fontSize: 14 }}>
            {busy ? "サインイン中…" : "サインイン"}
          </button>
          <div className="login__foot">
            <p style={{ margin: "0 0 8px" }}>本システムは社内業務用です。AIへの入力・添付は許可された情報のみとしてください。</p>
            <span style={{ color: "var(--muted)" }}>利用規約 · プライバシー · セキュリティ方針</span>
          </div>
        </form>
      </div>
    </div>
  );
}
