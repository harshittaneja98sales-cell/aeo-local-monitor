import {
  getDatabaseStatus,
  isDatabaseConfigured,
} from "../../server/database.js";
import { runDueMonitors } from "../../server/monitoring.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(req, process.env)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const persistence = getDatabaseStatus();
  if (!isDatabaseConfigured()) {
    return res.status(200).json({
      checked: 0,
      completed: 0,
      runs: [],
      persistence,
    });
  }

  try {
    const result = await runDueMonitors(
      { limit: Number(req.query.limit) || 5 },
      process.env
    );
    return res.status(200).json({ ...result, persistence });
  } catch (error) {
    return res.status(500).json({
      error: "Scheduled monitor failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}

function isAuthorized(req, env) {
  if (!env.CRON_SECRET) return true;
  const header = String(req.headers.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token === env.CRON_SECRET;
}
