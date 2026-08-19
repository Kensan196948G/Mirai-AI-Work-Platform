# Mirai AI Work Platform — 本番デプロイ手順

**状態: 準備済み（本PR承認後に実行）**

## 1. 前提

- GitHub: `Kensan196948G/Mirai-AI-Work-Platform`（本リポジトリ）
- Cloudflare: アカウント `Kensan1969@gmail.com's Account`、ゾーン `mirai-dx-platform.com`
- Neon: `mirai_ai_work_platform`（本番DB、マイグレーション適用済み・Seed済み）
- ドメイン: 本番 `ai-work.mirai-dx-platform.com` / MVP `ai-work-mvp.mirai-dx-platform.com`

## 2. デプロイ手順

### Step 1: リリースPRの承認とマージ

```bash
# 必須チェック (CI) の成功を確認してから
gh pr merge <PR番号> --squash --delete-branch
git checkout main && git pull
```

### Step 2: Neon マイグレーション（本番DB）

```bash
export DATABASE_URL="postgresql://.../mirai_ai_work_platform?sslmode=require"
npm run db:migrate
npm run verify:db
```

### Step 3: Secret 登録（本番環境）

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
printf '%s' "$DATABASE_URL" | npx wrangler secret put DATABASE_URL
printf '%s' "$DEEPSEEK_API_KEY" | npx wrangler secret put DEEPSEEK_API_KEY   # AI有効化時のみ
```

### Step 4: 本番デプロイ

```bash
npm run build:production-api   # VITE_USE_MOCK_API=false でビルド
npx wrangler deploy            # 本番 Worker (ai-work.mirai-dx-platform.com)
```

### Step 5: リリース後確認

```bash
# ヘルスチェック
curl -s https://ai-work.mirai-dx-platform.com/api/v1/health
# API E2E (X-Demo-User は本番では無効のため、ログインセッションで確認)
node scripts/mvp-smoke.mjs https://ai-work.mirai-dx-platform.com
# ブラウザE2E (実ログイン)
node scripts/browser-e2e.mjs https://ai-work.mirai-dx-platform.com
```

確認項目: 主要画面表示 / API応答 / 認証・認可（未認証401・権限差403）/ DB接続（health db:true）/ 監査ログ記録 / ストレージ状態表示 / エラー率（`wrangler tail`）

## 3. ロールバック手順

異常を検知した場合、追加変更を重ねずに安全なロールバックを優先する。

1. **Worker**: 前回正常版へロールバック
   ```bash
   npx wrangler rollback   # 直前のデプロイへ戻す
   ```
2. **DB**: 破壊的変更を適用していない限りデータは保持される。
   マイグレーションに問題がある場合は `_migrations` の記録を確認し、
   影響範囲を特定してから修正マイグレーションを適用する。
3. **DNS/ドメイン**: カスタムドメインの切り替えは Cloudflare ダッシュボードで実施可能。
4. 原因、影響範囲、復旧内容、再発防止策を `doc/24_障害対応手順.md` と Issue に記録する。

## 4. 本番環境の相違点（MVP環境との対比）

| 項目 | MVP (`ai-work-mvp`) | 本番 (`ai-work`) |
|---|---|---|
| ALLOW_LOCAL_AUTH_BYPASS | `true`（X-Demo-User バイパス） | `false`（実認証のみ） |
| AI_PROVIDER | `demo` | `deepseek`（キー登録後に有効） |
| DB | `mirai_ai_work_platform`（Seed済み） | 同DBを本番として使用（初回は Seed を空から適用） |
| ドメイン | `ai-work-mvp.mirai-dx-platform.com` | `ai-work.mirai-dx-platform.com` |
