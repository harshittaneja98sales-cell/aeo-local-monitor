import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

let pool;
let schemaReadyFor = "";

const SCHEMA_SQL = `
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

CREATE INDEX IF NOT EXISTS monitor_configs_next_run_idx
  ON monitor_configs (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS monitor_alerts_business_created_idx
  ON monitor_alerts (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS monitor_alerts_business_status_idx
  ON monitor_alerts (business_id, status);
CREATE INDEX IF NOT EXISTS monitor_alerts_audit_run_idx
  ON monitor_alerts (audit_run_id);
`;

export function isDatabaseConfigured(env = process.env) {
  return Boolean(getDatabaseUrl(env));
}

export async function upsertBusinessFromAudit(request, env = process.env) {
  await ensureSchema(env);
  const client = getPool(env);
  const profile = request.profile || {};
  const businessType = request.businessType || {};
  const existingId = String(request.businessId || "").trim();
  const business = {
    id: existingId || crypto.randomUUID(),
    businessKey: buildBusinessKey(profile),
    name: String(profile.name || "Untitled business").trim(),
    businessTypeId: businessType.id || "",
    businessTypeLabel: businessType.label || profile.businessType || "",
    website: profile.website || "",
    market: profile.market || "",
    address: profile.address || "",
    phone: profile.phone || "",
    category: profile.category || "",
    profile,
    competitors: request.competitors || [],
    monitoredLocations: request.monitoredLocations || [],
  };

  if (existingId) {
    const updated = await updateBusinessById(client, business);
    if (updated) return serializeBusiness(updated);
  }

  const result = await client.query(
    `
    INSERT INTO businesses (
      id,
      business_key,
      name,
      business_type_id,
      business_type_label,
      website,
      market,
      address,
      phone,
      category,
      profile,
      competitors,
      monitored_locations
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11::jsonb, $12::jsonb, $13::jsonb
    )
    ON CONFLICT (business_key) DO UPDATE SET
      name = EXCLUDED.name,
      business_type_id = EXCLUDED.business_type_id,
      business_type_label = EXCLUDED.business_type_label,
      website = EXCLUDED.website,
      market = EXCLUDED.market,
      address = EXCLUDED.address,
      phone = EXCLUDED.phone,
      category = EXCLUDED.category,
      profile = EXCLUDED.profile,
      competitors = EXCLUDED.competitors,
      monitored_locations = EXCLUDED.monitored_locations,
      updated_at = now()
    RETURNING *
    `,
    [
      business.id,
      business.businessKey,
      business.name,
      business.businessTypeId,
      business.businessTypeLabel,
      business.website,
      business.market,
      business.address,
      business.phone,
      business.category,
      JSON.stringify(business.profile),
      JSON.stringify(business.competitors),
      JSON.stringify(business.monitoredLocations),
    ]
  );

  return serializeBusiness(result.rows[0]);
}

export async function saveAuditRun({ businessId, audit, request }, env = process.env) {
  await ensureSchema(env);
  const client = getPool(env);
  const result = await client.query(
    `
    INSERT INTO audit_runs (
      id,
      business_id,
      mode,
      summary,
      website_scan,
      entity_gaps,
      results,
      prompts,
      competitor_share,
      input_warnings,
      provider_status,
      profile_snapshot,
      request_payload
    )
    VALUES (
      $1, $2, $3,
      $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
      $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb
    )
    RETURNING *
    `,
    [
      crypto.randomUUID(),
      businessId,
      audit.mode || "unknown",
      JSON.stringify(audit.summary || {}),
      JSON.stringify(audit.websiteScan || null),
      JSON.stringify(audit.entityGaps || []),
      JSON.stringify(audit.results || []),
      JSON.stringify(audit.prompts || []),
      JSON.stringify(audit.competitorShare || []),
      JSON.stringify(audit.inputWarnings || []),
      JSON.stringify(audit.providerStatus || []),
      JSON.stringify(request.profile || {}),
      JSON.stringify(request),
    ]
  );

  return serializeAuditRun(result.rows[0]);
}

export async function saveSchemaPatch(
  { businessId, schemaPatch, request },
  env = process.env
) {
  await ensureSchema(env);
  const client = getPool(env);
  const result = await client.query(
    `
    INSERT INTO schema_patches (
      id,
      business_id,
      status,
      title,
      schema_type,
      schema_json,
      install_snippet,
      fixed_signals,
      field_coverage,
      install_targets,
      validation_url,
      request_payload
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb
    )
    RETURNING *
    `,
    [
      crypto.randomUUID(),
      businessId,
      schemaPatch.status || "ready",
      schemaPatch.title || "Entity schema fix",
      schemaPatch.schemaType || "",
      JSON.stringify(schemaPatch.schemaJson || {}),
      schemaPatch.installSnippet || "",
      JSON.stringify(schemaPatch.fixedSignals || []),
      JSON.stringify(schemaPatch.fieldCoverage || []),
      JSON.stringify(schemaPatch.installTargets || []),
      schemaPatch.validationUrl || "",
      JSON.stringify(request || {}),
    ]
  );

  return serializeSchemaPatch(result.rows[0]);
}

export async function saveAnswerHub(
  { businessId, answerHub, request },
  env = process.env
) {
  await ensureSchema(env);
  const client = getPool(env);
  const id = answerHub.id || crypto.randomUUID();
  const result = await client.query(
    `
    INSERT INTO answer_hubs (
      id,
      business_id,
      status,
      title,
      mode,
      items,
      visual_html,
      schema_type,
      schema_json,
      embed_code,
      widget_payload,
      intent_summary,
      provider_status,
      profile_snapshot,
      request_payload
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6::jsonb, $7, $8, $9::jsonb, $10,
      $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      title = EXCLUDED.title,
      mode = EXCLUDED.mode,
      items = EXCLUDED.items,
      visual_html = EXCLUDED.visual_html,
      schema_type = EXCLUDED.schema_type,
      schema_json = EXCLUDED.schema_json,
      embed_code = EXCLUDED.embed_code,
      widget_payload = EXCLUDED.widget_payload,
      intent_summary = EXCLUDED.intent_summary,
      provider_status = EXCLUDED.provider_status,
      profile_snapshot = EXCLUDED.profile_snapshot,
      request_payload = EXCLUDED.request_payload,
      updated_at = now()
    RETURNING *
    `,
    [
      id,
      businessId,
      answerHub.status || "ready",
      answerHub.title || "Direct-answer hub",
      answerHub.mode || "local-answer-builder",
      JSON.stringify(answerHub.items || []),
      answerHub.visualHtml || "",
      answerHub.schemaType || "FAQPage",
      JSON.stringify(answerHub.schemaJson || {}),
      answerHub.embedCode || "",
      JSON.stringify(answerHub.widgetPayload || {}),
      JSON.stringify(answerHub.intentSummary || []),
      JSON.stringify(answerHub.providerStatus || []),
      JSON.stringify(answerHub.profileSnapshot || request?.profile || {}),
      JSON.stringify(request || {}),
    ]
  );

  return serializeAnswerHub(result.rows[0]);
}

export async function listBusinesses(env = process.env) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `
    SELECT *
    FROM businesses
    ORDER BY updated_at DESC
    LIMIT 50
    `
  );
  return result.rows.map(serializeBusiness);
}

export async function listAuditRuns({ businessId, limit = 10 }, env = process.env) {
  await ensureSchema(env);
  const parsedLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const result = await getPool(env).query(
    `
    SELECT *
    FROM audit_runs
    WHERE business_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [businessId, parsedLimit]
  );
  return result.rows.map(serializeAuditRun);
}

export async function getLatestAnswerHub({ businessId }, env = process.env) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `
    SELECT *
    FROM answer_hubs
    WHERE business_id = $1
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
    `,
    [businessId]
  );
  return result.rows[0] ? serializeAnswerHub(result.rows[0]) : null;
}

export async function getBusinessById(businessId, env = process.env) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `
    SELECT *
    FROM businesses
    WHERE id = $1
    LIMIT 1
    `,
    [businessId]
  );
  return result.rows[0] ? serializeBusiness(result.rows[0]) : null;
}

export async function getMonitorConfig(businessId, env = process.env) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `
    SELECT *
    FROM monitor_configs
    WHERE business_id = $1
    LIMIT 1
    `,
    [businessId]
  );
  return result.rows[0]
    ? serializeMonitorConfig(result.rows[0])
    : buildDefaultMonitorConfig(businessId);
}

export async function upsertMonitorConfig(
  { businessId, config = {} },
  env = process.env
) {
  await ensureSchema(env);
  const normalized = normalizeMonitorConfig(config);
  const result = await getPool(env).query(
    `
    INSERT INTO monitor_configs (
      id,
      business_id,
      enabled,
      frequency,
      alert_email,
      watch_hallucinations,
      watch_citations,
      watch_competitors,
      next_run_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (business_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      frequency = EXCLUDED.frequency,
      alert_email = EXCLUDED.alert_email,
      watch_hallucinations = EXCLUDED.watch_hallucinations,
      watch_citations = EXCLUDED.watch_citations,
      watch_competitors = EXCLUDED.watch_competitors,
      next_run_at = COALESCE(monitor_configs.next_run_at, EXCLUDED.next_run_at),
      updated_at = now()
    RETURNING *
    `,
    [
      crypto.randomUUID(),
      businessId,
      normalized.enabled,
      normalized.frequency,
      normalized.alertEmail,
      normalized.watchHallucinations,
      normalized.watchCitations,
      normalized.watchCompetitors,
      getNextRunDate(normalized.frequency),
    ]
  );
  return serializeMonitorConfig(result.rows[0]);
}

export async function markMonitorRunComplete(
  { businessId, frequency = "weekly" },
  env = process.env
) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `
    UPDATE monitor_configs
    SET
      last_run_at = now(),
      next_run_at = $2,
      updated_at = now()
    WHERE business_id = $1
    RETURNING *
    `,
    [businessId, getNextRunDate(frequency)]
  );
  return result.rows[0]
    ? serializeMonitorConfig(result.rows[0])
    : buildDefaultMonitorConfig(businessId);
}

export async function listMonitorAlerts(
  { businessId, limit = 25 },
  env = process.env
) {
  await ensureSchema(env);
  const parsedLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const result = await getPool(env).query(
    `
    SELECT *
    FROM monitor_alerts
    WHERE business_id = $1
    ORDER BY
      CASE severity
        WHEN 'High' THEN 1
        WHEN 'Medium' THEN 2
        ELSE 3
      END,
      last_seen_at DESC
    LIMIT $2
    `,
    [businessId, parsedLimit]
  );
  return result.rows.map(serializeMonitorAlert);
}

export async function saveMonitorAlerts(
  { businessId, auditRunId, alerts = [] },
  env = process.env
) {
  await ensureSchema(env);
  if (alerts.length === 0) return [];
  const saved = [];
  const client = getPool(env);

  for (const alert of alerts) {
    const result = await client.query(
      `
      INSERT INTO monitor_alerts (
        id,
        business_id,
        audit_run_id,
        type,
        severity,
        status,
        title,
        detail,
        prompt,
        provider,
        source_url,
        competitor,
        fingerprint,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14::jsonb
      )
      ON CONFLICT (business_id, fingerprint) DO UPDATE SET
        audit_run_id = EXCLUDED.audit_run_id,
        severity = EXCLUDED.severity,
        status = 'open',
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        prompt = EXCLUDED.prompt,
        provider = EXCLUDED.provider,
        source_url = EXCLUDED.source_url,
        competitor = EXCLUDED.competitor,
        metadata = EXCLUDED.metadata,
        last_seen_at = now()
      RETURNING *
      `,
      [
        crypto.randomUUID(),
        businessId,
        auditRunId || null,
        alert.type,
        alert.severity,
        alert.status || "open",
        alert.title,
        alert.detail,
        alert.prompt || "",
        alert.provider || "",
        alert.sourceUrl || "",
        alert.competitor || "",
        alert.fingerprint,
        JSON.stringify(alert.metadata || {}),
      ]
    );
    saved.push(serializeMonitorAlert(result.rows[0]));
  }

  return saved;
}

export async function listDueMonitorTargets({ limit = 5 } = {}, env = process.env) {
  await ensureSchema(env);
  const parsedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
  const result = await getPool(env).query(
    `
    SELECT
      businesses.*,
      monitor_configs.id AS monitor_config_id,
      monitor_configs.enabled AS monitor_enabled,
      monitor_configs.frequency AS monitor_frequency,
      monitor_configs.alert_email AS monitor_alert_email,
      monitor_configs.watch_hallucinations,
      monitor_configs.watch_citations,
      monitor_configs.watch_competitors,
      monitor_configs.last_run_at AS monitor_last_run_at,
      monitor_configs.next_run_at AS monitor_next_run_at
    FROM monitor_configs
    JOIN businesses ON businesses.id = monitor_configs.business_id
    WHERE monitor_configs.enabled = true
      AND (
        monitor_configs.next_run_at IS NULL
        OR monitor_configs.next_run_at <= now()
      )
    ORDER BY monitor_configs.next_run_at ASC NULLS FIRST
    LIMIT $1
    `,
    [parsedLimit]
  );

  return result.rows.map((row) => ({
    business: serializeBusiness(row),
    config: serializeMonitorConfig({
      id: row.monitor_config_id,
      business_id: row.id,
      enabled: row.monitor_enabled,
      frequency: row.monitor_frequency,
      alert_email: row.monitor_alert_email,
      watch_hallucinations: row.watch_hallucinations,
      watch_citations: row.watch_citations,
      watch_competitors: row.watch_competitors,
      last_run_at: row.monitor_last_run_at,
      next_run_at: row.monitor_next_run_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  }));
}

export function getDatabaseStatus(env = process.env) {
  return isDatabaseConfigured(env)
    ? {
        mode: "database",
        detail: "Audit runs are saved to Postgres.",
      }
    : {
        mode: "disabled",
        detail: "Set DATABASE_URL on the server to save businesses and audit runs.",
      };
}

async function ensureSchema(env) {
  const databaseUrl = getDatabaseUrl(env);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (schemaReadyFor === databaseUrl) return;
  try {
    await getPool(env).query(SCHEMA_SQL);
  } catch (error) {
    if (!isSchemaPermissionError(error)) {
      throw error;
    }
  }
  schemaReadyFor = databaseUrl;
}

function getPool(env) {
  const databaseUrl = getDatabaseUrl(env);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      ssl: shouldUseSsl(databaseUrl, env) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function updateBusinessById(client, business) {
  return client
    .query(
      `
      UPDATE businesses SET
        business_key = $2,
        name = $3,
        business_type_id = $4,
        business_type_label = $5,
        website = $6,
        market = $7,
        address = $8,
        phone = $9,
        category = $10,
        profile = $11::jsonb,
        competitors = $12::jsonb,
        monitored_locations = $13::jsonb,
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [
        business.id,
        business.businessKey,
        business.name,
        business.businessTypeId,
        business.businessTypeLabel,
        business.website,
        business.market,
        business.address,
        business.phone,
        business.category,
        JSON.stringify(business.profile),
        JSON.stringify(business.competitors),
        JSON.stringify(business.monitoredLocations),
      ]
    )
    .then((result) => result.rows[0] || null);
}

function buildBusinessKey(profile) {
  const websiteHost = getWebsiteHost(profile.website);
  const name = normalizeKeyPart(profile.name);
  const market = normalizeKeyPart(profile.market);
  return [websiteHost || name, market].filter(Boolean).join("|") || crypto.randomUUID();
}

function getDatabaseUrl(env) {
  return env.DATABASE_URL || env.POSTGRES_URL || "";
}

function isSchemaPermissionError(error) {
  return (
    error?.code === "42501" ||
    String(error?.message || "").includes("permission denied for schema")
  );
}

function shouldUseSsl(databaseUrl, env) {
  if (env.PGSSLMODE === "disable") return false;
  return (
    env.PGSSLMODE === "require" ||
    databaseUrl.includes("supabase") ||
    databaseUrl.includes("neon.tech") ||
    databaseUrl.includes("vercel-storage")
  );
}

function getWebsiteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return normalizeKeyPart(url.hostname.replace(/^www\./, ""));
  } catch {
    return "";
  }
}

function normalizeKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function serializeBusiness(row) {
  return {
    id: row.id,
    name: row.name,
    businessTypeId: row.business_type_id,
    businessTypeLabel: row.business_type_label,
    website: row.website,
    market: row.market,
    address: row.address,
    phone: row.phone,
    category: row.category,
    profile: row.profile || {},
    competitors: row.competitors || [],
    monitoredLocations: row.monitored_locations || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeAuditRun(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    status: row.status,
    mode: row.mode,
    summary: row.summary || {},
    websiteScan: row.website_scan,
    entityGaps: row.entity_gaps || [],
    results: row.results || [],
    prompts: row.prompts || [],
    competitorShare: row.competitor_share || [],
    inputWarnings: row.input_warnings || [],
    providerStatus: row.provider_status || [],
    profileSnapshot: row.profile_snapshot || {},
    createdAt: row.created_at,
  };
}

function serializeSchemaPatch(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    status: row.status,
    title: row.title,
    schemaType: row.schema_type,
    schemaJson: row.schema_json || {},
    installSnippet: row.install_snippet || "",
    fixedSignals: row.fixed_signals || [],
    fieldCoverage: row.field_coverage || [],
    installTargets: row.install_targets || [],
    validationUrl: row.validation_url,
    createdAt: row.created_at,
  };
}

function serializeAnswerHub(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    status: row.status,
    title: row.title,
    mode: row.mode,
    items: row.items || [],
    visualHtml: row.visual_html || "",
    schemaType: row.schema_type || "FAQPage",
    schemaJson: row.schema_json || {},
    embedCode: row.embed_code || "",
    widgetPayload: row.widget_payload || {},
    intentSummary: row.intent_summary || [],
    providerStatus: row.provider_status || [],
    profileSnapshot: row.profile_snapshot || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMonitorConfig(config) {
  const frequency = ["daily", "weekly"].includes(config.frequency)
    ? config.frequency
    : "weekly";

  return {
    enabled: config.enabled !== false,
    frequency,
    alertEmail: String(config.alertEmail || config.alert_email || "").trim(),
    watchHallucinations: config.watchHallucinations !== false,
    watchCitations: config.watchCitations !== false,
    watchCompetitors: config.watchCompetitors !== false,
  };
}

function buildDefaultMonitorConfig(businessId) {
  return {
    id: null,
    businessId,
    enabled: true,
    frequency: "weekly",
    alertEmail: "",
    watchHallucinations: true,
    watchCitations: true,
    watchCompetitors: true,
    lastRunAt: null,
    nextRunAt: null,
  };
}

function serializeMonitorConfig(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    enabled: row.enabled,
    frequency: row.frequency,
    alertEmail: row.alert_email || "",
    watchHallucinations: row.watch_hallucinations,
    watchCitations: row.watch_citations,
    watchCompetitors: row.watch_competitors,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMonitorAlert(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    auditRunId: row.audit_run_id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    detail: row.detail,
    prompt: row.prompt || "",
    provider: row.provider || "",
    sourceUrl: row.source_url || "",
    competitor: row.competitor || "",
    fingerprint: row.fingerprint,
    metadata: row.metadata || {},
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function getNextRunDate(frequency) {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (frequency === "daily" ? 1 : 7));
  next.setUTCHours(6, 0, 0, 0);
  return next.toISOString();
}
