import {
  getDatabaseStatus,
  isDatabaseConfigured,
  upsertBusinessFromAudit,
} from "../server/database.js";
import {
  getMonitorSnapshot,
  saveMonitorSettings,
} from "../server/monitoring.js";
import { businessTypes } from "../src/data/mockData.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const persistence = getDatabaseStatus();
  if (!isDatabaseConfigured()) {
    return res.status(200).json({
      config: null,
      alerts: [],
      summary: emptySummary(),
      persistence,
    });
  }

  try {
    if (req.method === "GET") {
      const businessId = String(req.query.businessId || "").trim();
      if (!businessId) {
        return res.status(400).json({ error: "businessId is required" });
      }

      const snapshot = await getMonitorSnapshot({ businessId });
      return res.status(200).json({ ...snapshot, persistence });
    }

    const body = parseBody(req);
    const request = normalizeBusinessRequest(body);
    const business = await upsertBusinessFromAudit(request);
    const snapshot = await saveMonitorSettings({
      businessId: business.id,
      config: body.config || {},
    });

    return res.status(200).json({
      business,
      ...snapshot,
      persistence,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Monitor settings failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}

function parseBody(req) {
  return typeof req.body === "string" && req.body.length > 0
    ? JSON.parse(req.body)
    : req.body || {};
}

function normalizeBusinessRequest(body) {
  const businessType =
    body.businessType ||
    businessTypes.find((type) => type.id === body.selectedBusinessType) ||
    businessTypes[0];

  return {
    profile: body.profile || {},
    businessId: body.businessId || null,
    businessType,
    competitors: Array.isArray(body.competitors) ? body.competitors : [],
    monitoredLocations: Array.isArray(body.monitoredLocations)
      ? body.monitoredLocations
      : [],
    sourceCompletion: Number.isFinite(body.sourceCompletion)
      ? body.sourceCompletion
      : 0,
  };
}

function emptySummary() {
  return {
    total: 0,
    high: 0,
    hallucinations: 0,
    citations: 0,
    competitors: 0,
  };
}
