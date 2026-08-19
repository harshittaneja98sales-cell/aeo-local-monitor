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

CREATE TABLE IF NOT EXISTS schema_patches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ready',
  title TEXT NOT NULL,
  schema_type TEXT,
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  install_snippet TEXT NOT NULL,
  fixed_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_coverage JSONB NOT NULL DEFAULT '[]'::jsonb,
  install_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_url TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitor_configs (
  id TEXT PRIMARY KEY,
  business_id TEXT UNIQUE NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL DEFAULT 'weekly',
  alert_email TEXT,
  watch_hallucinations BOOLEAN NOT NULL DEFAULT true,
  watch_citations BOOLEAN NOT NULL DEFAULT true,
  watch_competitors BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitor_alerts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  audit_run_id TEXT REFERENCES audit_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  prompt TEXT,
  provider TEXT,
  source_url TEXT,
  competitor TEXT,
  fingerprint TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS businesses_updated_at_idx ON businesses (updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_runs_business_created_idx
  ON audit_runs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS schema_patches_business_created_idx
  ON schema_patches (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS answer_hubs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ready',
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'local-answer-builder',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  visual_html TEXT NOT NULL DEFAULT '',
  schema_type TEXT NOT NULL DEFAULT 'FAQPage',
  schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  embed_code TEXT NOT NULL DEFAULT '',
  widget_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  intent_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_status JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS answer_hubs_business_created_idx
  ON answer_hubs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS monitor_configs_next_run_idx
  ON monitor_configs (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS monitor_alerts_business_created_idx
  ON monitor_alerts (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monitor_alerts_business_status_idx
  ON monitor_alerts (business_id, status);
CREATE INDEX IF NOT EXISTS monitor_alerts_audit_run_idx
  ON monitor_alerts (audit_run_id);

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_patches ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_hubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_alerts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON answer_hubs TO aeo_local_app;
GRANT SELECT, INSERT, UPDATE ON monitor_configs TO aeo_local_app;
GRANT SELECT, INSERT, UPDATE ON monitor_alerts TO aeo_local_app;

CREATE POLICY aeo_local_app_answer_hubs_access
  ON answer_hubs
  FOR ALL
  TO aeo_local_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY aeo_local_app_monitor_configs_access
  ON monitor_configs
  FOR ALL
  TO aeo_local_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY aeo_local_app_monitor_alerts_access
  ON monitor_alerts
  FOR ALL
  TO aeo_local_app
  USING (true)
  WITH CHECK (true);
