import {
  getDatabaseStatus,
  isDatabaseConfigured,
} from "../server/database.js";
import { runMonitorForRequest } from "../server/monitoring.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const persistence = getDatabaseStatus();
  if (!isDatabaseConfigured()) {
    return res.status(200).json({
      error: "database_not_configured",
      detail: "Set DATABASE_URL before monitor runs can be saved.",
      persistence,
    });
  }

  try {
    const body =
      typeof req.body === "string" && req.body.length > 0
        ? JSON.parse(req.body)
        : req.body || {};
    const monitorRun = await runMonitorForRequest(body);

    return res.status(200).json({
      ...monitorRun,
      persistence,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Monitor run failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}
