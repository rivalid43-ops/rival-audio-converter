-- Rival Dev persistence schema. Apply with PostgreSQL or adapt UUID syntax for SQLite.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  roblox_user_id VARCHAR(64) UNIQUE,
  roblox_username VARCHAR(120),
  email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS credits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audio_files (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(120),
  size_bytes BIGINT,
  duration_seconds NUMERIC(12,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS conversions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  source_audio_id UUID REFERENCES audio_files(id),
  output_format VARCHAR(10) NOT NULL,
  quality VARCHAR(20),
  status VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
  output_storage_key VARCHAR(512),
  output_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS roblox_assets (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  conversion_id UUID REFERENCES conversions(id),
  roblox_asset_id VARCHAR(64) UNIQUE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
  moderation_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS upload_history (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  audio_file_id UUID REFERENCES audio_files(id),
  conversion_id UUID REFERENCES conversions(id),
  roblox_asset_id UUID REFERENCES roblox_assets(id),
  event_type VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  label VARCHAR(120),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  provider VARCHAR(40),
  provider_reference VARCHAR(255) UNIQUE,
  package_name VARCHAR(120) NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  amount_minor INTEGER,
  currency CHAR(3),
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS upload_history_user_created_idx ON upload_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversions_user_created_idx ON conversions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS roblox_assets_user_status_idx ON roblox_assets(user_id, status);
