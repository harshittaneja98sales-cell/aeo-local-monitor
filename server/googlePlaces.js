const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const DEFAULT_REGION_CODE = "US";
const DEFAULT_TIMEOUT_MS = 9000;
const TARGET_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.regularOpeningHours",
].join(",");
const DETAIL_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "businessStatus",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "rating",
  "userRatingCount",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours",
].join(",");

export function isGooglePlacesConfigured(env = process.env) {
  return Boolean(getGooglePlacesApiKey(env));
}

export async function buildGooglePlacesSnapshot(payload = {}, env = process.env) {
  const request = normalizePlacesPayload(payload);
  const apiKey = getGooglePlacesApiKey(env);

  if (!apiKey) {
    return buildUnavailableSnapshot({
      request,
      mode: "not_configured",
      detail: "Set GOOGLE_MAPS_API_KEY on the server to enable Google Places lookup.",
    });
  }

  const targetQuery = buildTargetSearchQuery(request);
  const competitorQuery = buildCompetitorSearchQuery(request);

  if (!targetQuery) {
    return buildUnavailableSnapshot({
      request,
      mode: "missing_query",
      detail: "Enter a business name, address, website, or market before running Places lookup.",
    });
  }

  try {
    const [targetSearch, competitorSearch] = await Promise.all([
      runTextSearch({
        apiKey,
        textQuery: targetQuery,
        pageSize: 5,
        env,
      }),
      competitorQuery
        ? runTextSearch({
            apiKey,
            textQuery: competitorQuery,
            pageSize: 8,
            env,
          })
        : Promise.resolve([]),
    ]);
    const candidates = targetSearch.map((place) =>
      scorePlaceCandidate(normalizeGooglePlace(place), request.profile)
    );
    const target = selectBestCandidate(candidates);
    const competitors = competitorSearch
      .map(normalizeGooglePlace)
      .filter((place) => place.id && place.id !== target?.id)
      .slice(0, 6);
    const fieldComparison = target
      ? buildFieldComparison(request.profile, target)
      : [];

    return {
      mode: "google-places",
      configured: true,
      status: target ? "matched" : "not_found",
      generatedAt: new Date().toISOString(),
      query: {
        target: targetQuery,
        competitors: competitorQuery,
      },
      target,
      candidates,
      competitors,
      fieldComparison,
      summary: buildPlacesSummary({ target, competitors, fieldComparison }),
      providerStatus: [
        {
          provider: "Google Places API",
          status: "live",
          detail: target
            ? "Verified Google place fields were returned for this business lookup."
            : "Google Places responded, but no confident business match was found.",
        },
      ],
    };
  } catch (error) {
    return buildUnavailableSnapshot({
      request,
      mode: "error",
      detail:
        error instanceof Error
          ? error.message
          : "Google Places lookup failed.",
    });
  }
}

export async function getGooglePlaceDetails(placeId, env = process.env) {
  const id = String(placeId || "").trim();
  const apiKey = getGooglePlacesApiKey(env);

  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }

  if (!id) {
    throw new Error("placeId is required.");
  }

  const place = await runPlaceDetails({ apiKey, placeId: id, env });
  return normalizeGooglePlace(place);
}

function buildUnavailableSnapshot({ request, mode, detail }) {
  return {
    mode,
    configured: mode !== "not_configured",
    status: mode === "error" ? "error" : "unavailable",
    generatedAt: new Date().toISOString(),
    query: {
      target: buildTargetSearchQuery(request),
      competitors: buildCompetitorSearchQuery(request),
    },
    target: null,
    candidates: [],
    competitors: [],
    fieldComparison: [],
    summary: {
      matchedFields: 0,
      missingFields: 0,
      differentFields: 0,
      competitorCount: 0,
    },
    providerStatus: [
      {
        provider: "Google Places API",
        status: mode,
        detail,
      },
    ],
  };
}

async function runTextSearch({ apiKey, textQuery, pageSize, env }) {
  const response = await fetchWithTimeout(
    GOOGLE_PLACES_TEXT_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": TARGET_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        pageSize,
        languageCode: "en",
        regionCode: env.GOOGLE_PLACES_REGION_CODE || DEFAULT_REGION_CODE,
      }),
    },
    env
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google Places HTTP ${response.status}: ${truncateText(detail, 500)}`
    );
  }

  const data = await response.json();
  return Array.isArray(data.places) ? data.places : [];
}

async function runPlaceDetails({ apiKey, placeId, env }) {
  const response = await fetchWithTimeout(
    `${GOOGLE_PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": DETAIL_FIELD_MASK,
      },
    },
    env
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google Place Details HTTP ${response.status}: ${truncateText(detail, 500)}`
    );
  }

  return response.json();
}

async function fetchWithTimeout(url, options, env) {
  const timeoutMs = parseIntegerEnv(
    env.GOOGLE_PLACES_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    3000,
    30000
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Google Places timed out after ${Math.round(timeoutMs / 1000)} seconds.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePlacesPayload(payload) {
  const profile =
    payload.profile && typeof payload.profile === "object" ? payload.profile : {};
  const businessType =
    payload.businessType && typeof payload.businessType === "object"
      ? payload.businessType
      : {};

  return {
    profile,
    businessType,
    selectedBusinessType: payload.selectedBusinessType || businessType.id || "",
    competitors: Array.isArray(payload.competitors) ? payload.competitors : [],
    monitoredLocations: Array.isArray(payload.monitoredLocations)
      ? payload.monitoredLocations
      : [],
  };
}

function buildTargetSearchQuery(request) {
  const profile = request.profile;
  const parts = [
    profile.name,
    profile.address,
    profile.market,
    profile.website && !profile.name ? profile.website : "",
  ];

  return parts.map(cleanQueryPart).filter(Boolean).join(" ");
}

function buildCompetitorSearchQuery(request) {
  const profile = request.profile;
  const businessType = request.businessType || {};
  const category =
    businessType.categoryTerm ||
    profile.category ||
    businessType.serviceNoun ||
    profile.businessType;
  const market =
    profile.market ||
    request.monitoredLocations.find(Boolean) ||
    profile.address;

  if (!category || !market) return "";
  return `${cleanQueryPart(category)} near ${cleanQueryPart(market)}`;
}

function normalizeGooglePlace(place = {}) {
  const weekdayDescriptions = Array.isArray(
    place.regularOpeningHours?.weekdayDescriptions
  )
    ? place.regularOpeningHours.weekdayDescriptions
    : [];

  return {
    id: place.id || "",
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
    website: place.websiteUri || "",
    mapsUrl: place.googleMapsUri || "",
    rating: Number.isFinite(place.rating) ? place.rating : null,
    userRatingCount: Number.isFinite(place.userRatingCount)
      ? place.userRatingCount
      : null,
    businessStatus: place.businessStatus || "",
    primaryType: place.primaryType || "",
    primaryTypeLabel: place.primaryTypeDisplayName?.text || "",
    types: Array.isArray(place.types) ? place.types : [],
    location: place.location
      ? {
          latitude: place.location.latitude,
          longitude: place.location.longitude,
        }
      : null,
    hours: weekdayDescriptions.join("; "),
  };
}

function scorePlaceCandidate(place, profile) {
  const profileName = normalizeComparable(profile.name);
  const placeName = normalizeComparable(place.name);
  const profileHost = getHostname(profile.website);
  const placeHost = getHostname(place.website);
  const profileAddress = normalizeComparable(profile.address);
  const placeAddress = normalizeComparable(place.address);
  let score = 0;
  const reasons = [];

  if (profileName && placeName) {
    if (placeName === profileName) {
      score += 52;
      reasons.push("Exact name match");
    } else if (placeName.includes(profileName) || profileName.includes(placeName)) {
      score += 36;
      reasons.push("Close name match");
    } else {
      const overlap = tokenOverlap(profileName, placeName);
      score += Math.round(overlap * 24);
      if (overlap >= 0.45) reasons.push("Partial name match");
    }
  }

  if (profileHost && placeHost) {
    if (profileHost === placeHost || profileHost.endsWith(`.${placeHost}`)) {
      score += 35;
      reasons.push("Website domain match");
    } else if (
      profileHost.replace(/^www\./, "") === placeHost.replace(/^www\./, "")
    ) {
      score += 35;
      reasons.push("Website domain match");
    }
  }

  if (profileAddress && placeAddress) {
    if (placeAddress.includes(profileAddress) || profileAddress.includes(placeAddress)) {
      score += 22;
      reasons.push("Address match");
    } else {
      const overlap = tokenOverlap(profileAddress, placeAddress);
      score += Math.round(overlap * 16);
      if (overlap >= 0.35) reasons.push("Partial address match");
    }
  }

  if (profile.market && place.address?.toLowerCase().includes(profile.market.toLowerCase())) {
    score += 8;
    reasons.push("Market match");
  }

  return {
    ...place,
    matchScore: Math.min(100, score),
    matchReasons: reasons,
  };
}

function selectBestCandidate(candidates) {
  const [best] = [...candidates].sort((left, right) => {
    if (right.matchScore !== left.matchScore) {
      return right.matchScore - left.matchScore;
    }
    return (right.userRatingCount || 0) - (left.userRatingCount || 0);
  });

  if (!best || best.matchScore < 28) return null;
  return best;
}

function buildFieldComparison(profile, place) {
  const rows = [
    compareField({
      field: "name",
      label: "Business name",
      profileValue: profile.name,
      placeValue: place.name,
      matchType: "text",
    }),
    compareField({
      field: "address",
      label: "Address",
      profileValue: profile.address,
      placeValue: place.address,
      matchType: "text",
    }),
    compareField({
      field: "phone",
      label: "Phone",
      profileValue: profile.phone,
      placeValue: place.phone,
      matchType: "phone",
    }),
    compareField({
      field: "website",
      label: "Website",
      profileValue: profile.website,
      placeValue: place.website,
      matchType: "host",
    }),
    compareField({
      field: "category",
      label: "Category",
      profileValue: profile.category,
      placeValue: place.primaryTypeLabel || place.primaryType,
      matchType: "text",
    }),
    {
      field: "rating",
      label: "Google rating",
      profileValue: "",
      placeValue:
        place.rating && place.userRatingCount
          ? `${place.rating} (${place.userRatingCount} reviews)`
          : "",
      status: place.rating ? "google-only" : "missing",
    },
    {
      field: "hours",
      label: "Opening hours",
      profileValue: profile.hours || "",
      placeValue: place.hours || "",
      status: place.hours
        ? profile.hours
          ? "available"
          : "google-only"
        : "missing",
    },
  ];

  return rows;
}

function compareField({ field, label, profileValue, placeValue, matchType }) {
  const profileText = String(profileValue || "").trim();
  const placeText = String(placeValue || "").trim();

  if (!profileText && !placeText) {
    return { field, label, profileValue: "", placeValue: "", status: "missing" };
  }

  if (!profileText && placeText) {
    return {
      field,
      label,
      profileValue: "",
      placeValue: placeText,
      status: "google-only",
    };
  }

  if (profileText && !placeText) {
    return {
      field,
      label,
      profileValue: profileText,
      placeValue: "",
      status: "profile-only",
    };
  }

  const matched =
    matchType === "host"
      ? getHostname(profileText) === getHostname(placeText)
      : matchType === "phone"
        ? normalizePhone(profileText) === normalizePhone(placeText)
        : textLooksEquivalent(profileText, placeText);

  return {
    field,
    label,
    profileValue: profileText,
    placeValue: placeText,
    status: matched ? "matched" : "different",
  };
}

function buildPlacesSummary({ target, competitors, fieldComparison }) {
  const count = (status) =>
    fieldComparison.filter((field) => field.status === status).length;

  return {
    matchedFields: count("matched") + count("available"),
    missingFields: count("missing") + count("profile-only"),
    differentFields: count("different"),
    googleOnlyFields: count("google-only"),
    competitorCount: competitors.length,
    matchScore: target?.matchScore || 0,
  };
}

function getGooglePlacesApiKey(env) {
  return (
    env.GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_PLACES_API_KEY ||
    env.GOOGLE_API_KEY ||
    ""
  ).trim();
}

function cleanQueryPart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeComparable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/www\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textLooksEquivalent(left, right) {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return true;
  }

  return tokenOverlap(normalizedLeft, normalizedRight) >= 0.62;
}

function tokenOverlap(left, right) {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));

  if (!leftTokens.size || !rightTokens.size) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  return intersection.length / Math.max(leftTokens.size, rightTokens.size);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").replace(/^1/, "");
}

function getHostname(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normalizeComparable(raw).split(" ")[0] || "";
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function parseIntegerEnv(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
