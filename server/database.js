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
