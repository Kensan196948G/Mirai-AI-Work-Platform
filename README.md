# 🏗️ Mirai AI Work Platform

> **社内向け AI ワークプラットフォーム** — Chat / Work / Projects / Files / Agents / Admin を統合した AI 業務基盤

[![CI](https://github.com/Kensan196948G/Mirai-AI-Work-Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Kensan196948G/Mirai-AI-Work-Platform/actions/workflows/ci.yml)
![Infra](https://img.shields.io/badge/infra-Cloudflare%20%2B%20Neon-orange)
![Stack](https://img.shields.io/badge/stack-Workers%20%2B%20Hono%20%2B%20React-blue)
![AI](https://img.shields.io/badge/AI-DeepSeek%20API-purple)

DeepSeek API を中核とし、社内業務における **AIチャット、タスク実行（Goal→Plan→Tool→Artifact→Review）、プロジェクト管理、ファイル処理、成果物生成、AIエージェント実行** を統合する Web ベースの AI ワークプラットフォームです。

> **正本**: [企画書](01_企画書.html) / [要件定義書](02_要件定義書.html) / [詳細設計書](03_詳細設計書.html) / [OpenDesign画面設計](mirai-ai-work-platform.html) / [doc/ 設計文書一覧](doc/00_ドキュメント一覧.md)

---

## 🚦 現在の実装ステータス

| 項目 | 状態 |
|---|---|
| **MVP/Preview** | 🎉 **https://ai-work-mvp.mirai-dx-platform.com**（2026-08-21 デプロイ済み） |
| 本番 | ✅ **https://ai-work.mirai-dx-platform.com**（デプロイ済み・Cloudflare Access で保護） |
| DB | Neon PostgreSQL（`mirai_ai_work_platform`、検証用 `mirai_ai_work_platform_verify`） |
| ダミーデータ | 10ユーザー / 4Project / 5Work / 8ファイル / 4会話 / 10監査ログ（パスワード: `mirai-demo`） |
| AI | MVP環境・本番とも `demo` プロバイダー（決定的ローカル応答・課金なし）。本番は `DEEPSEEK_API_KEY` 設定で有効化 |
| 認証 | ローカル認証（PBKDF2-SHA256 パスワードハッシュ + HttpOnly Cookie セッション）。MVP環境は `X-Demo-User` バイパスに加え、ヘッダー無しでも `DEMO_DEFAULT_LOGIN_ID` の既定利用者として自動認証（RBACはサーバー側で実施）。本番は Cloudflare Access（owner-only）+ ローカル認証の二重防御 |
| 検証 | ✅ vitest 75件 / lint / tsc / build / security-scan PASS<br/>✅ APIスモーク **23/23 PASS**（デプロイ後E2E・viewer権限403含む）<br/>✅ ブラウザE2E **19/19 PASS**（MVPバイパス・Chat・Work・Files・Admin Project編集/削除・AI設定APIキー保存/テスト/クリア・レスポンシブ・キーボード・条件待機で安定化）<br/>✅ 空DBでの Migration→Seed→Verify **11/11 PASS**（再実行実証済み）<br/>✅ レート制限（KVベース）: ログイン10回/minで 429 + Retry-After を実環境実証 |

**検証用ログイン**: 利用者ID `naoki.sato` / パスワード `mirai-demo`（IT・DX管理者）。`k.tanaka`（一般利用者）等も同パスワードでサインインでき、権限差を確認できます。**MVP はヘッダー無しブラウザアクセスでも `naoki.sato` として自動ログインされます**（公開デモ用。復旧は `wrangler.toml` の `[env.mvp.vars]` から `DEMO_DEFAULT_LOGIN_ID` 行を削除して再デプロイ）。

---

## 🧭 画面構成（OpenDesign準拠）

| 画面 | 内容 | 権限 |
|---|---|---|
| サインイン | 利用者ID/パスワード認証 | 全員 |
| ホーム | 最近の会話 / Work状況 / ストレージ使用量 / 通知 | 全員 |
| Chat | 会話一覧・詳細、DeepSeek/demo AI応答、利用量表示 | 全員 |
| Work | Goal→Plan→承認→Task実行→Tool要約→Artifact→Review | 全員 |
| Projects | 作成・メンバー管理・Quota・Files・Artifacts | 所有者/管理者 |
| Files | アップロード・ダウンロード・削除（個人/Project領域） | 全員 |
| Agents | 実行状態・履歴・資源利用 | 全員 |
| Admin | ダッシュボード / 利用者 / Project（編集・削除可）/ AI設定（APIキー保存・接続テスト・クリア）/ 監査ログ | 管理者のみ |

## 🏛️ アーキテクチャ

```text
Browser
  ↓ HTTPS
Cloudflare Workers (同一オリジン)
  ├─ SPA (React + Vite)          ← dist/ を静的アセット配信
  └─ Hono API (/api/v1/*)
       ├─ 認証・認可 (PBKDF2セッション / RBAC)
       ├─ Chat / Work / Projects / Files / Agents
       ├─ 監査ログ / ストレージ状態 / Quota判定
       ├─ AI Provider層 (DeepSeek / demo)
       └─ Neon PostgreSQL (serverless driver)
```

## 🛠️ 技術スタック

- **Frontend**: React 19 + Vite 8 + TypeScript（OpenDesign のデザイントークン・画面構成を移植）
- **Backend**: Cloudflare Workers + Hono 4 + zod（入力検証）
- **DB**: Neon PostgreSQL 16（`@neondatabase/serverless`、マイグレーション管理）
- **Auth**: PBKDF2-SHA256 (WebCrypto) / HttpOnly・Secure・SameSite Cookie セッション
- **AI**: Provider 抽象化（DeepSeek API / demo 決定的応答）。APIキーは Secret 管理
- **CI**: GitHub Actions（lint / test / build / security-scan / deploy dry-run）
- **ドメイン**: `mirai-dx-platform.com`（本番 `ai-work`、MVP `ai-work-mvp`）

## 🚀 ローカル開発

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173, /api は 8787 へプロキシ)
```

Worker 単体:
```bash
npm run worker:dev   # wrangler dev worker/index.ts
```

## ✅ 検証コマンド

| コマンド | 内容 |
|---|---|
| `npm run verify` | lint + vitest + build + security-scan（CI と同一） |
| `npm run worker:deploy:dry-run` | Worker デプロイ事前チェック |
| `npm run mvp:dry-run` / `mvp:deploy` | MVP ビルド + デプロイ事前チェック / デプロイ |
| `DATABASE_URL=... npm run db:migrate` | Neon マイグレーション適用（`migrations/*.sql`） |
| `DATABASE_URL=... npm run db:seed` | 検証用ダミーデータ投入 |
| `DATABASE_URL=... npm run verify:db` | DB 整合性チェック（11項目） |
| `node scripts/mvp-smoke.mjs <url>` | デプロイ後 API E2E（20チェック） |
| `node scripts/browser-e2e.mjs <url>` | Playwright ブラウザE2E（16チェック） |

> 注意: Neon serverless driver は複数文の一括実行に対応しないため、マイグレーションはステートメント分割（`$$` ドル引用対応）で1文ずつ適用します。

## 🔐 セキュリティ設計

- すべての非公開 API で認証必須（fail-closed）。認可はサーバー側で判定
- パスワードは PBKDF2-SHA256（100,000反復・ソルト付き）で保存、平文・復号可能形式は不使用
- パストラバーサル対策（`..`・絶対パス・シンボリックリンク脱出を拒否）
- Quota 判定は保存前に実施（現在使用量 + 新規サイズ ≦ 上限）
- ストレージ保護モード（70/80/85/90/95% しきい値・緊急保護で書込み停止）
- 監査ログは成功・失敗・拒否を追記方式で記録（要求ID対応）
- APIキー・接続文字列は Secret 管理（`security-scan` で混入防止）

## 🗂️ ディレクトリ構成

```text
worker/            Hono Worker API（認証/CRUD/監査/ストレージ/AI）
src/               React SPA（画面・コンポーネント）
migrations/        Neon SQL マイグレーション
scripts/           マイグレーション/シード/検証/スモーク/E2E
tests/             vitest ユニットテスト
doc/               要件・設計・運用文書（正本）
docs/design/       OpenDesign 仕様抽出（実装用）
```

## 📚 文書

- [企画書](01_企画書.html) / [要件定義書](02_要件定義書.html) / [詳細設計書](03_詳細設計書.html)
- [ドキュメント一覧](doc/00_ドキュメント一覧.md)（36文書：機能仕様・画面設計・データ設計・認証認可・セキュリティ・監査・運用・復旧ほか）
- [OpenDesign 画面設計](mirai-ai-work-platform.html)

## ⚠️ 技術的制約・残存リスク

1. **物理ストレージ（/mnt/storage 10TB HDD）**: 要件は on-prem Linux Pilot 向け。クラウド MVP ではマウント状態・UUID照合・I/O状態を env でシミュレーションし、DB 使用量で容量判定する。物理導入時に Storage Monitor を実装する。
2. **Agent Sandbox（一時コンテナ）**: Workers 上では実行不可のため、Tool 実行は決定的シミュレーション。on-prem 導入時にコンテナ Sandbox を実装する。
3. **DeepSeek API キー**: 未設定のため MVP は demo プロバイダー。本番有効化には `DEEPSEEK_API_KEY` Secret 登録が必要。
4. **ファイル実体**: MVP はメタデータ管理（実体はストレージ層）。ダウンロードはメタデータ応答のみ。
5. **SSO / MFA / OneDrive / SharePoint**: スコープ外（保留事項）。
6. **Cloudflare Access**: MVP はローカル認証。本番で Access 適用する場合は JWT 検証を追加する。

詳細は [doc/32_リスク台帳.md](doc/32_リスク台帳.md) と [doc/35_未決事項一覧.md](doc/35_未決事項一覧.md) を参照。
