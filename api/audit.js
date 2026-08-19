import { runServerAudit } from "../server/auditCore.js";
import {
  getDatabaseStatus,
  isDatabaseConfigured,
  saveAuditRun,
  upsertBusinessFromAudit,
} from "../server/database.js";

const AUDIT_TIMEOUT_MS = 26000;
const AUDIT_SAVE_TIMEOUT_MS = 6000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string" && req.body.length > 0
        ? JSON.parse(req.body)
        : req.body || {};
    const audit = await withTimeout(
      runServerAudit(body),
      getIntegerEnv("AUDIT_TIMEOUT_MS", AUDIT_TIMEOUT_MS),
      "Audit timed out while checking live AI search results."
    );
    const persistence = getDatabaseStatus();
    let business = null;
    let auditRun = null;

    if (isDatabaseConfigured()) {
      try {
        const saved = await withTimeout(
          saveAuditHistory(body, audit),
          getIntegerEnv("AUDIT_SAVE_TIMEOUT_MS", AUDIT_SAVE_TIMEOUT_MS),
          "Audit completed, but saving history timed out."
        );
        business = saved.business;
        auditRun = saved.auditRun;
      } catch (error) {
        persistence.mode = "error";
        persistence.detail =
          error instanceof Error ? error.message : "Audit run could not be saved.";
      }
    }

    return res.status(200).json({
      audit,
      mode: audit.mode,
      business,
      auditRun,
      persistence,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Audit failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}

async function saveAuditHistory(body, audit) {
  const business = await upsertBusinessFromAudit(body);
  const auditRun = await saveAuditRun({
    businessId: business.id,
    audit,
    request: { ...body, businessId: business.id },
  });

  return { business, auditRun };
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function getIntegerEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
