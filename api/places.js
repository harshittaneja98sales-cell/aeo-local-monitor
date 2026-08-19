import {
  buildGooglePlacesSnapshot,
  getGooglePlaceDetails,
  isGooglePlacesConfigured,
} from "../server/googlePlaces.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (req.method === "GET") {
      const placeId = String(req.query.placeId || "").trim();

      if (!placeId) {
        return res.status(400).json({ error: "placeId is required" });
      }

      const place = await getGooglePlaceDetails(placeId);
      return res.status(200).json({
        configured: isGooglePlacesConfigured(),
        mode: "google-place-details",
        place,
      });
    }

    const body = parseBody(req);
    const googlePlaces = await buildGooglePlacesSnapshot(body);

    return res.status(200).json({
      configured: isGooglePlacesConfigured(),
      mode: googlePlaces.mode,
      googlePlaces,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Google Places lookup failed",
      detail: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}

function parseBody(req) {
  return typeof req.body === "string" && req.body.length > 0
    ? JSON.parse(req.body)
    : req.body || {};
}
