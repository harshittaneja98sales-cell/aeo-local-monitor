import {
  getDatabaseStatus,
  isDatabaseConfigured,
  listBusinesses,
} from "../server/database.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const persistence = getDatabaseStatus();
  if (!isDatabaseConfigured()) {
    return res.status(200).json({ businesses: [], persistence });
  }

  try {
    const businesses = await listBusinesses();
    return res.status(200).json({ businesses, persistence });
  } catch (error) {
    return res.status(200).json({
      businesses: [],
      persistence: {
        mode: "error",
        detail:
          error instanceof Error ? error.message : "Businesses could not be loaded.",
      },
    });
  }
}
