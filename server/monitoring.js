import { businessTypes } from "../src/data/mockData.js";
import { runServerAudit } from "./auditCore.js";
import {
  getBusinessById,
  getMonitorConfig,
  listAuditRuns,
  listDueMonitorTargets,
  listMonitorAlerts,
  markMonitorRunComplete,
  saveAuditRun,
  saveMonitorAlerts,
  upsertBusinessFromAudit,
  upsertMonitorConfig,
} from "./database.js";

export async function getMonitorSnapshot({ businessId }, env = process.env) {
  const [config, alerts] = await Promise.all([
    getMonitorConfig(businessId, env),
    listMonitorAlerts({ businessId, limit: 30 }, env),
  ]);

  return {
    config,
    alerts,
    summary: summarizeMonitorAlerts(alerts),
  };
}

export async function saveMonitorSettings(
  { businessId, config },
  env = process.env
) {
  const savedConfig = await upsertMonitorConfig({ businessId, config }, env);
  const alerts = await listMonitorAlerts({ businessId, limit: 30 }, env);

  return {
    config: savedConfig,
    alerts,
    summary: summarizeMonitorAlerts(alerts),
  };
}

export async function runMonitorForRequest(payload = {}, env = process.env) {
  const request = normalizeMonitorRequest(payload);
  const business = await upsertBusinessFromAudit(request, env);
  const config = await upsertMonitorConfig(
    { businessId: business.id, config: payload.monitorConfig || {} },
    env
  );
  const previousRuns = await listAuditRuns(
    { businessId: business.id, limit: 3 },
    env
  );
  const audit = await runServerAudit(
    { ...request, businessId: business.id },
    env
  );
  const auditRun = await saveAuditRun(
    {
      businessId: business.id,
      audit,
      request: { ...request, businessId: business.id, monitorRun: true },
    },
    env
  );
  const alerts = buildMonitorAlerts({
    business,
    config,
    audit,
    previousAuditRun: previousRuns[0],
  });
  const savedAlerts = await saveMonitorAlerts(
    { businessId: business.id, auditRunId: auditRun.id, alerts },
    env
  );
  const updatedConfig = await markMonitorRunComplete(
    { businessId: business.id, frequency: config.frequency },
    env
  );

  return {
    business,
    config: updatedConfig,
    audit,
    auditRun,
    alerts: savedAlerts,
    summary: summarizeMonitorAlerts(savedAlerts),
  };
}

export async function runDueMonitors({ limit = 5 } = {}, env = process.env) {
  const targets = await listDueMonitorTargets({ limit }, env);
  const runs = [];

  for (const target of targets) {
    const business = await getBusinessById(target.business.id, env);
    if (!business) continue;

    runs.push(
      await runMonitorForRequest(
        {
          businessId: business.id,
          profile: business.profile,
          selectedBusinessType: business.businessTypeId,
          businessType: buildBusinessTypeFromSavedBusiness(business),
          competitors: business.competitors,
          monitoredLocations: business.monitoredLocations,
          monitorConfig: target.config,
        },
        env
      )
    );
  }

  return {
    checked: targets.length,
    completed: runs.length,
    runs: runs.map((run) => ({
      businessId: run.business.id,
      businessName: run.business.name,
      auditRunId: run.auditRun.id,
      alertCount: run.alerts.length,
      nextRunAt: run.config.nextRunAt,
    })),
  };
}

function buildBusinessTypeFromSavedBusiness(business) {
  const template =
    businessTypes.find((type) => type.id === business.businessTypeId) ||
    businessTypes[0];

  return {
    ...template,
    id: business.businessTypeId || template.id,
    label:
      business.businessTypeLabel ||
      business.profile?.businessType ||
      template.label,
  };
}

export function buildMonitorAlerts({
  business,
  config,
  audit,
  previousAuditRun,
}) {
  const alerts = [];
  const previousResultsById = new Map(
    (previousAuditRun?.results || []).map((result) => [result.id, result])
  );

  for (const result of audit.results || []) {
    if (config.watchCitations) {
      alerts.push(...detectCitationAlerts({ business, result }));
    }
    if (config.watchHallucinations) {
      alerts.push(...detectHallucinationAlerts({ business, audit, result }));
    }
    if (config.watchCompetitors) {
      alerts.push(
        ...detectCompetitorAlerts({
          business,
          result,
          previousResult: previousResultsById.get(result.id),
        })
      );
    }
  }

  if (config.watchCompetitors) {
    alerts.push(
      ...detectCompetitorShareAlerts({
        audit,
        previousAuditRun,
        business,
      })
    );
  }

  return dedupeAlerts(alerts).slice(0, 40);
}

function normalizeMonitorRequest(payload) {
  const selectedBusinessType = payload.selectedBusinessType;
  const fallbackType =
    businessTypes.find((type) => type.id === selectedBusinessType) ||
    businessTypes.find((type) => type.id === payload.businessType?.id) ||
    businessTypes[0];
  const businessType =
    payload.businessType && typeof payload.businessType === "object"
      ? { ...fallbackType, ...payload.businessType }
      : fallbackType;

  return {
    profile: payload.profile || {},
    businessId: payload.businessId || null,
    businessType,
    competitors: Array.isArray(payload.competitors) ? payload.competitors : [],
    monitoredLocations: Array.isArray(payload.monitoredLocations)
      ? payload.monitoredLocations
      : [],
    sourceCompletion: Number.isFinite(payload.sourceCompletion)
      ? payload.sourceCompletion
      : 0,
  };
}

function detectCitationAlerts({ business, result }) {
  const alerts = [];
  const ownedHost = getHost(business.website);
  const sourceHost = getHost(result.source);

  if (result.mentioned && !result.cited) {
    alerts.push(
      buildAlert({
        type: "citation_gap",
        severity: result.priority === "High" ? "High" : "Medium",
        title: "AI answer mentions the business without a citation",
        detail: `${result.engine} mentioned ${business.name}, but no direct source URL was parsed for this prompt.`,
        result,
        fingerprintParts: ["citation-gap", result.id],
      })
    );
  }

  if (
    result.mentioned &&
    result.cited &&
    sourceHost &&
    ownedHost &&
    sourceHost !== ownedHost &&
    !sourceHost.endsWith(`.${ownedHost}`)
  ) {
    alerts.push(
      buildAlert({
        type: "third_party_citation",
        severity: "Medium",
        title: "AI answer cites a third-party source instead of the website",
        detail: `${result.engine} cited ${sourceHost}, not the owned website ${ownedHost}.`,
        result,
        sourceUrl: result.source,
        fingerprintParts: ["third-party-source", result.id, sourceHost],
      })
    );
  }

  return alerts;
}

function detectHallucinationAlerts({ business, audit, result }) {
  const alerts = [];
  const profile = business.profile || {};
  const text = `${result.responseExcerpt || ""} ${result.finding || ""}`;

  const phoneMismatch = findPhoneMismatch(text, profile.phone);
  if (phoneMismatch) {
    alerts.push(
      buildAlert({
        type: "hallucinated_phone",
        severity: "High",
        title: "AI answer may be showing the wrong phone number",
        detail: `${result.engine} surfaced ${phoneMismatch}, which does not match the saved business phone ${profile.phone}.`,
        result,
        fingerprintParts: ["phone", result.id, phoneMismatch],
        metadata: { expected: profile.phone, observed: phoneMismatch },
      })
    );
  }

  const hoursMismatch = findHoursMismatch(text, profile.hours);
  if (hoursMismatch) {
    alerts.push(
      buildAlert({
        type: "hallucinated_hours",
        severity: result.query?.toLowerCase().includes("open now")
          ? "High"
          : "Medium",
        title: "AI answer may be showing incorrect hours",
        detail: `${result.engine} mentioned ${hoursMismatch}, which is not present in the saved hours: ${profile.hours}.`,
        result,
        fingerprintParts: ["hours", result.id, hoursMismatch],
        metadata: { expected: profile.hours, observed: hoursMismatch },
      })
    );
  }

  const needsHoursProtection =
    result.query?.toLowerCase().includes("open now") &&
    result.mentioned &&
    audit.websiteScan &&
    audit.websiteScan.status === "scanned" &&
    !audit.websiteScan.hasOpeningHoursSchema;
  if (needsHoursProtection) {
    alerts.push(
      buildAlert({
        type: "hours_source_gap",
        severity: "High",
        title: "Open-now answers are not protected by hours schema",
        detail:
          "The business appeared for an open-now prompt, but the crawler did not find opening-hours structured data on owned pages.",
        result,
        fingerprintParts: ["hours-schema-gap", result.id],
      })
    );
  }

  return alerts;
}

function detectCompetitorAlerts({ business, result, previousResult }) {
  const alerts = [];
  const competitor = result.competitorRecommendations?.[0] || "";

  if (!result.mentioned && competitor) {
    alerts.push(
      buildAlert({
        type: "competitor_incursion",
        severity: result.priority === "High" ? "High" : "Medium",
        title: "Competitor is being recommended instead",
        detail: `${result.engine} did not recommend ${business.name}; it favored ${competitor} for this prompt.`,
        result,
        competitor,
        fingerprintParts: ["competitor-current", result.id, competitor],
      })
    );
  }

  if (previousResult?.mentioned && !result.mentioned && competitor) {
    alerts.push(
      buildAlert({
        type: "competitor_overtake",
        severity: "High",
        title: "Competitor overtook a previously visible prompt",
        detail: `${business.name} was visible in the previous run, but ${result.engine} now favors ${competitor}.`,
        result,
        competitor,
        fingerprintParts: ["competitor-overtake", result.id, competitor],
      })
    );
  }

  if (
    previousResult?.rank &&
    result.rank &&
    result.rank > previousResult.rank &&
    competitor
  ) {
    alerts.push(
      buildAlert({
        type: "rank_drop",
        severity: result.rank - previousResult.rank >= 2 ? "High" : "Medium",
        title: "AI recommendation rank dropped",
        detail: `${result.engine} moved ${business.name} from rank ${previousResult.rank} to rank ${result.rank}.`,
        result,
        competitor,
        fingerprintParts: ["rank-drop", result.id],
      })
    );
  }

  return alerts;
}

function detectCompetitorShareAlerts({ audit, previousAuditRun, business }) {
  const previousTop = previousAuditRun?.competitorShare?.[0];
  const currentTop = audit.competitorShare?.[0];
  if (!currentTop || !previousTop) return [];

  const delta = currentTop.count - previousTop.count;
  if (currentTop.name !== previousTop.name || delta < 3) return [];

  return [
    {
      type: "competitor_share_jump",
      severity: "Medium",
      status: "open",
      title: "Competitor share increased across monitored prompts",
      detail: `${currentTop.name} appeared in ${currentTop.count} competitor recommendations, up from ${previousTop.count} in the previous run for ${business.name}.`,
      prompt: "Prompt set",
      provider: "All monitored engines",
      sourceUrl: "",
      competitor: currentTop.name,
      fingerprint: normalizeFingerprint(
        `competitor-share:${business.id}:${currentTop.name}`
      ),
      metadata: { previousCount: previousTop.count, currentCount: currentTop.count },
    },
  ];
}

function buildAlert({
  type,
  severity,
  title,
  detail,
  result,
  sourceUrl,
  competitor,
  fingerprintParts,
  metadata,
}) {
  return {
    type,
    severity,
    status: "open",
    title,
    detail,
    prompt: result.query || "",
    provider: result.engine || "",
    sourceUrl: sourceUrl || result.source || "",
    competitor: competitor || result.competitorRecommendations?.[0] || "",
    fingerprint: normalizeFingerprint(fingerprintParts.join(":")),
    metadata: {
      promptId: result.promptId,
      engineId: result.engineId,
      rank: result.rank,
      mentioned: result.mentioned,
      cited: result.cited,
      ...metadata,
    },
  };
}

function summarizeMonitorAlerts(alerts) {
  return {
    total: alerts.length,
    high: alerts.filter((alert) => alert.severity === "High").length,
    hallucinations: alerts.filter((alert) =>
      alert.type?.includes("hallucinated") || alert.type === "hours_source_gap"
    ).length,
    citations: alerts.filter((alert) => alert.type?.includes("citation")).length,
    competitors: alerts.filter((alert) => alert.type?.includes("competitor")).length,
  };
}

function dedupeAlerts(alerts) {
  const seen = new Set();
  return alerts.filter((alert) => {
    if (seen.has(alert.fingerprint)) return false;
    seen.add(alert.fingerprint);
    return true;
  });
}

function findPhoneMismatch(text, expectedPhone) {
  if (!expectedPhone) return "";
  const expected = digitsOnly(expectedPhone);
  if (!expected) return "";
  const matches = String(text || "").match(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
  return matches.find((match) => digitsOnly(match).slice(-10) !== expected.slice(-10)) || "";
}

function findHoursMismatch(text, expectedHours) {
  if (!expectedHours) return "";
  const expected = normalizeText(expectedHours);
  if (!expected) return "";
  const matches =
    String(text || "").match(/\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s?(?:AM|PM|am|pm)\b/g) ||
    [];
  return matches.find((match) => !expected.includes(normalizeText(match))) || "";
}

function getHost(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "Google Business Profile" || raw.includes("directory")) {
    return "";
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeFingerprint(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9:.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
