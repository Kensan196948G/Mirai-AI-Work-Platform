-- ============================================================================
-- Mirai AI Work Platform — 002_ai_api_key_enc.sql
-- AI設定にAPIキー暗号化保存列を追加 (AES-GCM、鍵は Secret AI_KEY_ENC_KEY)
-- 正本: doc/14_セキュリティ設計.md (秘密情報はSecret管理・DBへ平文保存しない)
-- ============================================================================

ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
