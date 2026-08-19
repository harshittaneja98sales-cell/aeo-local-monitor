import { buildWidgetScript } from "../server/answerHub.js";
import {
  getLatestAnswerHub,
  isDatabaseConfigured,
} from "../server/database.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");

  try {
    const businessId = String(req.query.businessId || "").trim();
    if (!businessId || !isDatabaseConfigured()) {
      return res.status(200).send("console.warn('AEO answer hub is not configured.');");
    }

    const answerHub = await getLatestAnswerHub({ businessId });
    if (!answerHub) {
      return res.status(200).send("console.warn('AEO answer hub has no approved content yet.');");
    }

    return res.status(200).send(buildWidgetScript({ answerHub }));
  } catch {
    return res.status(200).send("console.warn('AEO answer hub could not be loaded.');");
  }
}
