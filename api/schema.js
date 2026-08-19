import { generateEntitySchemaPatch } from "../src/lib/schemaGenerator.js";
import {
  getDatabaseStatus,
  isDatabaseConfigured,
  saveSchemaPatch,
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
    const schemaPatch = generateEntitySchemaPatch({
      profile: body.profile,
      businessType: body.businessType,
      auditReport: body.auditReport,
    });
    const persistence = getDatabaseStatus();
    let business = null;
    let savedPatch = null;

    if (isDatabaseConfigured()) {
      try {
        business = await upsertBusinessFromAudit(body);
        savedPatch = await saveSchemaPatch({
          businessId: business.id,
          schemaPatch,
          request: { ...body, businessId: business.id },
        });
      } catch (error) {
        persistence.mode = "error";
        persistence.detail =
          error instanceof Error ? error.message : "Schema patch could not be saved.";
      }
    }

    return res.status(200).json({
      schemaPatch,
      business,
      savedPatch,
      persistence,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Schema generation failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}
