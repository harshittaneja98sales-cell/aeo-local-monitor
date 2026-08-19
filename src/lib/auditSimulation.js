export const auditEngines = [
  {
    id: "chatgpt-search",
    name: "ChatGPT with Search",
    shortName: "ChatGPT",
    citationBias: 8,
    mentionBias: 9,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    shortName: "Perplexity",
    citationBias: 14,
    mentionBias: 4,
  },
  {
    id: "gemini",
    name: "Gemini",
    shortName: "Gemini",
    citationBias: 2,
    mentionBias: -4,
  },
  {
    id: "google-ai-overviews",
    name: "Google AI Overviews",
    shortName: "Google AI",
    citationBias: -3,
    mentionBias: -12,
  },
];

export function runLocalAiAudit({
  profile,
  businessType,
  competitors,
  monitoredLocations,
  sourceCompletion,
}) {
  const inputWarnings = detectInputWarnings(profile, businessType);
  const prompts = buildHyperLocalPrompts({
    profile,
    businessType,
    monitoredLocations,
  });
  const entityGaps = detectEntityGaps(profile);
  const normalizedCompetitors = normalizeCompetitors(
    competitors,
    businessType,
    profile
  );
  const results = prompts.flatMap((prompt, promptIndex) =>
    auditEngines.map((engine, engineIndex) =>
      simulateEngineResult({
        engine,
        engineIndex,
        prompt,
        promptIndex,
        profile,
        businessType,
        competitors: normalizedCompetitors,
        sourceCompletion,
        entityGaps,
      })
    )
  );

  return {
    mode: "local-simulation",
    prompts,
    inputWarnings,
    entityGaps,
    results,
    summary: summarizeAuditResults(results),
    competitorShare: summarizeCompetitorShare(results),
    websiteScan: null,
    generatedAt: new Date().toISOString(),
  };
}

export function buildHyperLocalPrompts({ profile, businessType, monitoredLocations }) {
  const city = cleanPromptLocation(extractCity(profile.market));
  const primaryLocation =
    cleanPromptLocation(monitoredLocations.find(Boolean)) || city;
  const secondaryLocation =
    cleanPromptLocation(monitoredLocations.filter(Boolean)[1]) ||
    primaryLocation ||
    city;
  const localArea = primaryLocation || city || "the local service area";
  const service = firstService(profile.services) || businessType.highIntentService;
  const businessName = cleanBusinessName(profile.name);

  return [
    {
      id: "highest-rated",
      intent: "Discovery",
      priority: "High",
      query: `Who is the highest-rated ${businessType.serviceNoun} in ${localArea} that offers ${service}?`,
    },
    {
      id: "open-now",
      intent: "Urgent Need",
      priority: "High",
      query: `Best ${businessType.serviceNoun} near ${secondaryLocation || localArea} open now`,
    },
    {
      id: "problem-solution",
      intent: "Service",
      priority: "High",
      query: `Who should I call for ${businessType.urgentNeed} in ${city || localArea}?`,
    },
    {
      id: "brand-check",
      intent: "Fact Check",
      priority: "Medium",
      query: `Is ${businessName} a good option for ${businessType.categoryTerm} in ${city || localArea}?`,
    },
    {
      id: "competitor-list",
      intent: "Comparison",
      priority: "Medium",
      query: `Top local businesses for ${businessType.highIntentService} near ${localArea}`,
    },
    {
      id: "fastest-response",
      intent: "Decision",
      priority: "Medium",
      query: `Which ${businessType.serviceNoun} has the fastest response in ${city || localArea}?`,
    },
  ];
}

export function detectEntityGaps(profile) {
  const gaps = [];
  const services = splitCsv(profile.services);

  if (!profile.name) {
    gaps.push({
      id: "business-name",
      severity: "High",
      title: "Business name missing",
      detail:
        "Mention detection needs the exact brand name before the audit can decide whether an answer recommends the business.",
      fix: "Enter the exact business name as it appears on Google Business Profile and the website.",
    });
  }

  if (!profile.website) {
    gaps.push({
      id: "website",
      severity: "High",
      title: "Website URL missing",
      detail:
        "AI answers need a crawlable owned source before the business can be cited directly.",
      fix: "Add the canonical website URL and make sure key service pages are indexable.",
    });
  } else if (!isUrlLike(profile.website)) {
    gaps.push({
      id: "website-format",
      severity: "Medium",
      title: "Website URL may be incomplete",
      detail:
        "The website should be stored as a crawlable canonical URL so the audit can scan owned pages and detect citations.",
      fix: "Use a full URL such as https://example.com.",
    });
  }

  const websiteCategory = inferCategoryFromWebsite(profile.website);
  if (
    websiteCategory &&
    profile.businessType &&
    websiteCategory.toLowerCase() !== String(profile.businessType).toLowerCase()
  ) {
    gaps.push({
      id: "category-website-mismatch",
      severity: "High",
      title: "Website and business type do not match",
      detail: `The website appears related to ${websiteCategory}, but the selected business type is ${profile.businessType}.`,
      fix: "Select the correct business type or enter the website for the selected business.",
    });
  }

  if (!profile.address) {
    gaps.push({
      id: "address",
      severity: "High",
      title: "Address missing",
      detail:
        "Local engines need a precise address or verified service-area signal to connect the entity to nearby prompts.",
      fix: "Add the full address or verified service-area configuration.",
    });
  }

  if (!profile.hours) {
    gaps.push({
      id: "hours",
      severity: "High",
      title: "Opening hours missing",
      detail:
        "Open-now and urgent-intent prompts are difficult to answer when openingHours data is absent.",
      fix: "Add openingHoursSpecification to LocalBusiness JSON-LD and keep listings aligned.",
    });
  }

  if (services.length < 4) {
    gaps.push({
      id: "services",
      severity: "Medium",
      title: "Service coverage is thin",
      detail:
        "The business may be skipped when AI engines cannot map specific user problems to explicit service pages.",
      fix: "Add clear service entities, FAQs, and examples for the top commercial intents.",
    });
  }

  if (!profile.credential) {
    gaps.push({
      id: "credential",
      severity: "Medium",
      title: "Credential signal missing",
      detail:
        "Licenses, professional identifiers, and trust markers help answer engines distinguish the business from generic directories.",
      fix: "Add license, certification, or professional membership fields to the profile and website.",
    });
  }

  gaps.push({
    id: "geo",
    severity: "Medium",
    title: "Geo coordinates not verified",
    detail:
      "The audit has an address, but no verified latitude/longitude pair from Google, Apple, or Bing yet.",
    fix: "Connect Google Places, Apple Maps, or Azure Maps to verify coordinates.",
  });

  gaps.push({
    id: "qa",
    severity: "Low",
    title: "Direct Q&A blocks not detected",
    detail:
      "Conversational engines prefer concise answers to pricing, availability, timing, and service-area questions.",
    fix: "Add FAQPage or Q&A sections for the highest-intent prompts.",
  });

  return gaps;
}

function simulateEngineResult({
  engine,
  engineIndex,
  prompt,
      promptIndex,
      profile,
  businessType,
  competitors,
  sourceCompletion,
  entityGaps,
}) {
  const businessName = cleanBusinessName(profile.name);
  const isBrandPrompt =
    Boolean(String(profile.name || "").trim()) &&
    prompt.query.toLowerCase().includes(String(profile.name).toLowerCase());
  const highSeverityGaps = entityGaps.filter((gap) => gap.severity === "High")
    .length;
  const promptPenalty = [0, -8, -5, 10, -11, -14][promptIndex] || 0;
  const gapPenalty = highSeverityGaps * 9 + entityGaps.length * 2;
  const missingNamePenalty = profile.name ? 0 : 38;
  const mismatchPenalty = entityGaps.some(
    (gap) => gap.id === "category-website-mismatch"
  )
    ? 22
    : 0;
  const signalScore =
    sourceCompletion +
    engine.mentionBias +
    promptPenalty +
    (isBrandPrompt ? 16 : 0) -
    gapPenalty +
    -missingNamePenalty +
    -mismatchPenalty +
    deterministicJitter(promptIndex, engineIndex);
  const mentioned = signalScore >= 54;
  const cited = mentioned && signalScore + engine.citationBias >= 68;
  const rank = mentioned
    ? Math.max(1, Math.min(5, 6 - Math.floor(signalScore / 18)))
    : null;
  const source = cited ? getBestSource(profile, promptIndex) : null;
  const competitorRecommendations = getCompetitorRecommendations(
    competitors,
    promptIndex,
    engineIndex,
    mentioned
  );

  return {
    id: `${prompt.id}-${engine.id}`,
    promptId: prompt.id,
    query: prompt.query,
    intent: prompt.intent,
    priority: prompt.priority,
    engine: engine.name,
    engineId: engine.id,
    mentioned,
    cited,
    rank,
    source,
    competitorRecommendations,
    confidence: Math.max(36, Math.min(94, signalScore)),
    finding: buildFinding({
      engine,
      mentioned,
      cited,
      source,
    profile,
    businessName,
      businessType,
      competitors: competitorRecommendations,
    }),
  };
}

export function summarizeAuditResults(results) {
  const total = results.length;
  const mentions = results.filter((result) => result.mentioned).length;
  const citations = results.filter((result) => result.cited).length;
  const rankedResults = results.filter((result) => result.rank);
  const averageRank =
    rankedResults.length === 0
      ? null
      : rankedResults.reduce((sum, result) => sum + result.rank, 0) /
        rankedResults.length;
  const rankScore = averageRank ? Math.max(0, 100 - (averageRank - 1) * 18) : 0;
  const shareOfVoice = Math.round((mentions / total) * 100);
  const citationRate = Math.round((citations / total) * 100);
  const mentionScore = Math.round(
    shareOfVoice * 0.62 + citationRate * 0.25 + rankScore * 0.13
  );

  return {
    total,
    mentions,
    citations,
    shareOfVoice,
    citationRate,
    mentionScore,
    averageRank: averageRank ? averageRank.toFixed(1) : "N/A",
  };
}

export function summarizeCompetitorShare(results) {
  const counts = results
    .flatMap((result) => result.competitorRecommendations)
    .reduce((summary, competitor) => {
      summary[competitor] = (summary[competitor] || 0) + 1;
      return summary;
    }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));
}

function normalizeCompetitors(competitors, businessType, profile) {
  const city = extractCity(profile.market);
  const fallback = [
    businessType.competitorA,
    businessType.competitorB,
    `${city} Local ${businessType.label}`,
  ];
  const unique = [...competitors, ...fallback]
    .map((competitor) => String(competitor || "").trim())
    .filter(Boolean)
    .filter((competitor) => competitor !== profile.name);

  return [...new Set(unique)].slice(0, 5);
}

function getCompetitorRecommendations(
  competitors,
  promptIndex,
  engineIndex,
  mentioned
) {
  const offset = (promptIndex + engineIndex) % competitors.length;
  const ordered = [...competitors.slice(offset), ...competitors.slice(0, offset)];
  return ordered.slice(0, mentioned ? 2 : 3);
}

function getBestSource(profile, promptIndex) {
  const website = normalizeWebsite(profile.website);
  const sources = [
    website,
    "Google Business Profile",
    `${website}/services`,
    "Local directory citation",
  ];

  return sources[promptIndex % sources.length];
}

function buildFinding({
  engine,
  mentioned,
  cited,
  source,
  profile,
  businessName,
  businessType,
  competitors,
}) {
  if (mentioned && cited) {
    return `${engine.shortName} recommends ${businessName} and cites ${source}.`;
  }

  if (mentioned) {
    return `${engine.shortName} mentions ${businessName}, but does not cite a direct owned source.`;
  }

  return `${engine.shortName} recommends ${competitors
    .slice(0, 2)
    .join(" and ")} instead because ${businessType.categoryTerm} signals look stronger.`;
}

function deterministicJitter(promptIndex, engineIndex) {
  return ((promptIndex + 1) * 7 + (engineIndex + 2) * 11) % 13;
}

function firstService(services) {
  return splitCsv(services)[0];
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractCity(market) {
  return String(market || "your market").split(",")[0].trim();
}

function cleanPromptLocation(value) {
  const location = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  const county = cleanCountyPromptLocation(location);
  const rejected =
    /\b(?:believe|cleaning|core values|customer wants|drain|highest quality|plumber|plumbing|ready to work|repair|same day|service|services|skilled technicians|water heater)\b/i;

  if (county) return county;

  if (!location || location === "your market") return "";
  if (location.length > 48 || /[.!?]/.test(location) || rejected.test(location)) {
    return "";
  }

  return location;
}

function cleanCountyPromptLocation(value) {
  const countyMatches = [
    ...String(value || "").matchAll(
      /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,7}\s+County)\b/g
    ),
  ];
  const rejectedWords = new Set([
    "Best",
    "Cleaning",
    "County",
    "Drain",
    "Emergency",
    "Heater",
    "Local",
    "Near",
    "Plumber",
    "Plumbing",
    "Repair",
    "Service",
    "Services",
    "Top",
    "Water",
  ]);

  for (const match of countyMatches) {
    const words = match[1]
      .split(/\s+/)
      .map((word) => word.replace(/[^A-Za-z'-]/g, ""))
      .filter(Boolean);

    for (let index = 0; index < words.length; index += 1) {
      const candidateWords = words.slice(index);
      const endsWithCounty = candidateWords[candidateWords.length - 1] === "County";
      const lengthLooksRight =
        candidateWords.length >= 2 && candidateWords.length <= 4;
      const containsServiceWord = candidateWords
        .slice(0, -1)
        .some((word) => rejectedWords.has(word));

      if (endsWithCounty && lengthLooksRight && !containsServiceWord) {
        return candidateWords.join(" ");
      }
    }
  }

  return "";
}

function cleanBusinessName(name) {
  return String(name || "").trim() || "the entered business";
}

function detectInputWarnings(profile, businessType) {
  const warnings = [];

  if (!String(profile.name || "").trim()) {
    warnings.push({
      id: "missing-name",
      label: "Business name is missing",
      detail: "Mention scoring will be conservative until the exact brand name is entered.",
    });
  }

  if (!String(profile.website || "").trim()) {
    warnings.push({
      id: "missing-website",
      label: "Brand website is missing",
      detail: "Citation and entity-gap checks need the canonical website URL.",
    });
  } else if (!isUrlLike(profile.website)) {
    warnings.push({
      id: "weak-website",
      label: "Website URL looks incomplete",
      detail: "Use a full URL such as https://example.com.",
    });
  }

  const websiteCategory = inferCategoryFromWebsite(profile.website);
  if (
    websiteCategory &&
    businessType?.label &&
    websiteCategory.toLowerCase() !== businessType.label.toLowerCase()
  ) {
    warnings.push({
      id: "category-mismatch",
      label: "Website and selected category may not match",
      detail: `The URL looks like ${websiteCategory}, but the audit is set to ${businessType.label}.`,
    });
  }

  return warnings;
}

function inferCategoryFromWebsite(website) {
  const value = String(website || "").toLowerCase();
  const checks = [
    ["plumb", "Plumbing"],
    ["hvac", "HVAC"],
    ["heating", "HVAC"],
    ["air", "HVAC"],
    ["dental", "Dentistry"],
    ["dentist", "Dentistry"],
    ["restaurant", "Restaurant"],
    ["kitchen", "Restaurant"],
    ["salon", "Salon"],
    ["hair", "Salon"],
    ["law", "Law Firm"],
    ["legal", "Law Firm"],
    ["motor", "Automotive"],
    ["auto", "Automotive"],
    ["car", "Automotive"],
    ["dealer", "Automotive"],
    ["vehicle", "Automotive"],
  ];
  const match = checks.find(([needle]) => value.includes(needle));
  return match ? match[1] : null;
}

function isUrlLike(value) {
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(value || "").trim());
}

function normalizeWebsite(value) {
  const website = String(value || "").trim();
  if (!website) return "Owned website";
  if (/^https?:\/\//i.test(website)) return website.replace(/\/$/, "");
  return `https://${website.replace(/\/$/, "")}`;
}
