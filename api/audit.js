import { runServerAudit } from "../server/auditCore.js";

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
    return res.status(200).json({ audit, mode: audit.mode });
  } catch (error) {
    return res.status(500).json({
      error: "Audit failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}
