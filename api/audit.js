import { runServerAudit } from "../server/auditCore.js";
import {
  getDatabaseStatus,
  isDatabaseConfigured,
  saveAuditRun,
  upsertBusinessFromAudit,
} from "../server/database.js";

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
    const audit = await runServerAudit(body);
    const persistence = getDatabaseStatus();
    let business = null;
    let auditRun = null;

    if (isDatabaseConfigured()) {
      try {
        business = await upsertBusinessFromAudit(body);
        auditRun = await saveAuditRun({
          businessId: business.id,
          audit,
          request: { ...body, businessId: business.id },
        });
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
