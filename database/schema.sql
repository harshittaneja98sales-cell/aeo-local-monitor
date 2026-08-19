CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  business_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  business_type_id TEXT,
  business_type_label TEXT,
  website TEXT,
  market TEXT,
  address TEXT,
  phone TEXT,
  category TEXT,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
  monitored_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'complete',
  mode TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  website_scan JSONB,
  entity_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
  competitor_share JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_status JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS businesses_updated_at_idx ON businesses (updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_runs_business_created_idx
  ON audit_runs (business_id, created_at DESC);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;
