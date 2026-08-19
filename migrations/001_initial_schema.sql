-- ============================================================================
-- Mirai AI Work Platform — 001_initial_schema.sql
-- 正本: doc/10_データ設計.md, doc/03_詳細設計書.html §4 データモデル
-- 適用対象: Neon PostgreSQL (mirai_ai_work_platform)
-- ============================================================================

-- 拡張 (checksum 用)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users: 利用者
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id           TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user'
                     CHECK (role IN ('admin', 'project_owner', 'user', 'service_account')),
  storage_quota_bytes BIGINT NOT NULL DEFAULT 107374182400, -- 100GB (Pilot初期候補)
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'disabled', 'warned')),
  password_hash      TEXT NOT NULL,   -- pbkdf2$iter$salt$hash (平文・復号可能形式は禁止)
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions: ログインセッション
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,          -- SHA-256(session token) のみ保存
  ip           TEXT,
  user_agent   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- projects: プロジェクト
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  folder_name        TEXT NOT NULL UNIQUE,   -- 保存先フォルダ名 (正規化済み)
  description        TEXT NOT NULL DEFAULT '',
  owner_id           UUID NOT NULL REFERENCES users(id),
  storage_quota_bytes BIGINT NOT NULL DEFAULT 53687091200, -- 50GB (50/100/500GB可変)
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'ended', 'archived')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

-- ---------------------------------------------------------------------------
-- project_members: プロジェクトメンバー
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
             CHECK (role IN ('owner', 'member', 'viewer')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_user ON project_members(user_id);

-- ---------------------------------------------------------------------------
-- files: ファイルメタデータ (実体はストレージ)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('user', 'project')),
  owner_id      UUID NOT NULL,
  parent_path   TEXT NOT NULL DEFAULT '',    -- 正規化済み相対パス (絶対パス禁止)
  name          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
  checksum      TEXT,                        -- SHA-256
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'uploading', 'scanning', 'failed', 'deleting')),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_type, owner_id, parent_path);
CREATE INDEX IF NOT EXISTS idx_files_checksum ON files(checksum);

-- ---------------------------------------------------------------------------
-- conversations / messages: Chat
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  title       TEXT NOT NULL DEFAULT '新しい会話',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL,
  model            TEXT,
  token_usage      JSONB,                    -- {prompt_tokens, completion_tokens, total_tokens}
  error_code       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- works / agent_runs / tasks / artifacts: Work実行
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS works (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  goal         TEXT NOT NULL,
  constraints  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'planning', 'awaiting_review', 'running',
                                 'succeeded', 'failed', 'cancelled')),
  version      INTEGER NOT NULL DEFAULT 1,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id      UUID REFERENCES works(id) ON DELETE SET NULL,
  user_id      UUID NOT NULL REFERENCES users(id),
  project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
  goal         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'planning', 'awaiting_review', 'running',
                                 'succeeded', 'failed', 'cancelled')),
  plan         JSONB,                        -- Plan/Task分解
  model        TEXT,
  token_usage  JSONB,
  error_code   TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_work ON agent_runs(work_id);
CREATE INDEX IF NOT EXISTS idx_runs_user ON agent_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id  UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  sequence      INTEGER NOT NULL DEFAULT 0,
  tool_log      JSONB,                       -- Tool実行要約
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(agent_run_id, sequence);

CREATE TABLE IF NOT EXISTS artifacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id   UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  file_id        UUID REFERENCES files(id) ON DELETE SET NULL,
  artifact_type  TEXT NOT NULL DEFAULT 'markdown'
                 CHECK (artifact_type IN ('html', 'markdown', 'pdf', 'office', 'text', 'other')),
  name           TEXT NOT NULL,
  review_status  TEXT NOT NULL DEFAULT 'pending'
                 CHECK (review_status IN ('pending', 'adopted', 'rejected', 'rerun')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_art_run ON artifacts(agent_run_id);

-- ---------------------------------------------------------------------------
-- audit_logs: 監査ログ (追記のみを原則)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id   TEXT NOT NULL DEFAULT '',
  result        TEXT NOT NULL DEFAULT 'success'
                CHECK (result IN ('success', 'failure', 'denied')),
  ip            TEXT,
  request_id    TEXT,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- ---------------------------------------------------------------------------
-- ai_settings: AI提供者設定 (APIキー実値は Secret 管理)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),  -- 単一行
  provider       TEXT NOT NULL DEFAULT 'deepseek',
  model          TEXT NOT NULL DEFAULT 'deepseek-chat',
  enabled        BOOLEAN NOT NULL DEFAULT false,
  has_api_key    BOOLEAN NOT NULL DEFAULT false,
  max_input_chars INTEGER NOT NULL DEFAULT 8000,
  timeout_ms     INTEGER NOT NULL DEFAULT 120000,
  max_retries    INTEGER NOT NULL DEFAULT 2,
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 更新時刻の自動更新
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated ON projects;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_files_updated ON files;
CREATE TRIGGER trg_files_updated BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated ON conversations;
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_works_updated ON works;
CREATE TRIGGER trg_works_updated BEFORE UPDATE ON works
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
