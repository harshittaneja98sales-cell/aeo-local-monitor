import {
  generateAnswerHub,
  prepareAnswerHubForSave,
} from "../server/answerHub.js";
import {
  getDatabaseStatus,
  getLatestAnswerHub,
  isDatabaseConfigured,
  saveAnswerHub,
  upsertBusinessFromAudit,
} from "../server/database.js";
import { businessTypes } from "../src/data/mockData.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const persistence = getDatabaseStatus();

  try {
    if (req.method === "GET") {
      if (!isDatabaseConfigured()) {
        return res.status(200).json({ answerHub: null, persistence });
      }

      const businessId = String(req.query.businessId || "").trim();
      if (!businessId) {
        return res.status(400).json({ error: "businessId is required" });
      }

      const answerHub = await getLatestAnswerHub({ businessId });
      return res.status(200).json({ answerHub, persistence });
    }

    const body = parseBody(req);
    const request = normalizeBusinessRequest(body);
    let business = null;

    if (isDatabaseConfigured()) {
      business = await upsertBusinessFromAudit(request);
      request.businessId = business.id;
    }

    const answerHub =
      body.action === "save" && body.answerHub
        ? prepareAnswerHubForSave(body.answerHub, request)
        : await generateAnswerHub(request);
    const finalHub = {
      ...answerHub,
      businessId: business?.id || answerHub.businessId || request.businessId || "",
    };
    let savedHub = null;

    if (isDatabaseConfigured() && business?.id) {
      savedHub = await saveAnswerHub({
        businessId: business.id,
        answerHub: finalHub,
        request,
      });
    }

    return res.status(200).json({
      answerHub: savedHub || finalHub,
      business,
      savedHub,
      persistence,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Answer hub generation failed",
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
    selectedBusinessType: body.selectedBusinessType || businessType.id,
    competitors: Array.isArray(body.competitors) ? body.competitors : [],
    monitoredLocations: Array.isArray(body.monitoredLocations)
      ? body.monitoredLocations
      : [],
    sourceCompletion: Number.isFinite(body.sourceCompletion)
      ? body.sourceCompletion
      : 0,
    auditReport:
      body.auditReport && typeof body.auditReport === "object"
        ? body.auditReport
        : null,
  };
}
