import {
  getDatabaseStatus,
  isDatabaseConfigured,
  listAuditRuns,
} from "../server/database.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const persistence = getDatabaseStatus();
  const businessId = String(req.query.businessId || "").trim();
  if (!isDatabaseConfigured()) {
    return res.status(200).json({ auditRuns: [], persistence });
  }
  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }

  try {
    const auditRuns = await listAuditRuns({
      businessId,
      limit: req.query.limit,
    });
    return res.status(200).json({ auditRuns, persistence });
  } catch (error) {
    return res.status(200).json({
      auditRuns: [],
      persistence: {
        mode: "error",
        detail:
          error instanceof Error ? error.message : "Audit runs could not be loaded.",
      },
    });
  }
}
