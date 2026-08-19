// ============================================================================
// Mirai AI Work Platform — worker/src/types.ts
// Worker 環境変数型定義
// ============================================================================

export type Env = {
  DATABASE_URL?: string;
  DEEPSEEK_API_KEY?: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_ENABLED?: string;
  MAX_INPUT_CHARS?: string;
  MAX_FILE_UPLOAD_BYTES?: string;
  APP_BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  ADMIN_LOGIN_IDS?: string;
  ALLOW_LOCAL_AUTH_BYPASS?: string;
  // ストレージシミュレーション (物理 /mnt/storage は on-prem Pilot 要件)
  STORAGE_TOTAL_BYTES?: string;
  STORAGE_EXPECTED_UUID?: string;
  STORAGE_MOUNT_OK?: string;
  STORAGE_IO_OK?: string;
  STORAGE_READONLY?: string;
  SESSION_TTL_HOURS?: string;
  RATE_LIMIT_PER_MIN?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_RETRIES?: string;
};

export type AppContext = import("hono").Context<{ Bindings: Env; Variables: AppVars }, any, any>;

export interface AppVars {
  requestId: string;
  user?: unknown;
}
