import OpenAI from "openai";
import * as cheerio from "cheerio";
import { businessTypes } from "../src/data/mockData.js";
import {
  auditEngines,
  runLocalAiAudit,
  summarizeAuditResults,
  summarizeCompetitorShare,
} from "../src/lib/auditSimulation.js";

const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";
const DEFAULT_OPENROUTER_PERPLEXITY_MODEL = "perplexity/sonar";
const DEFAULT_OPENROUTER_GEMINI_MODEL = "google/gemini-3-flash-preview";
const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const MAX_EXTRA_PAGES = 3;
const FETCH_TIMEOUT_MS = 9000;
const OPENROUTER_PROMPT_TIMEOUT_MS = 12000;
const openRouterLiveEngineConfigs = [
  {
    engineId: "chatgpt-search",
    provider: "OpenRouter ChatGPT-style search",
    providerLabel: "OpenRouter GPT Search",
    modelEnvKey: "OPENROUTER_CHATGPT_MODEL",
    defaultModel: DEFAULT_OPENROUTER_MODEL,
  },
  {
    engineId: "perplexity",
    provider: "OpenRouter Perplexity Sonar",
    providerLabel: "OpenRouter Sonar",
    modelEnvKey: "OPENROUTER_PERPLEXITY_MODEL",
    defaultModel: DEFAULT_OPENROUTER_PERPLEXITY_MODEL,
  },
  {
    engineId: "gemini",
    provider: "OpenRouter Gemini",
    providerLabel: "OpenRouter Gemini",
    modelEnvKey: "OPENROUTER_GEMINI_MODEL",
    defaultModel: DEFAULT_OPENROUTER_GEMINI_MODEL,
  },
];
const businessTypeInferenceSignals = [
  {
    id: "pest-control",
    keywords: [
      "orkin",
      "terminix",
      "pest control",
      "pests",
      "termite",
      "exterminator",
      "extermination",
      "mosquito",
      "rodent",
      "bed bug",
      "cockroach",
      "ant control",
      "wildlife control",
    ],
  },
  {
    id: "plumbing",
    keywords: [
      "plumbing",
      "plumber",
      "water heater",
      "drain cleaning",
      "leak repair",
      "sewer line",
    ],
  },
  {
    id: "hvac",
    keywords: [
      "hvac",
      "ac repair",
      "air conditioning",
      "heating repair",
      "furnace",
    ],
  },
  {
    id: "automotive",
    keywords: [
      "used cars",
      "auto sales",
      "car dealership",
      "vehicle financing",
      "pre-owned",
    ],
  },
  {
    id: "dentistry",
    keywords: ["dentist", "dentistry", "dental", "orthodontic", "teeth"],
  },
  {
    id: "restaurant",
    keywords: ["restaurant", "dining", "reservations", "menu", "catering"],
  },
  {
    id: "salon",
    keywords: ["salon", "haircut", "balayage", "hair color", "stylist"],
  },
  {
    id: "law",
    keywords: ["law firm", "attorney", "lawyer", "legal", "personal injury"],
  },
];

export async function runServerAudit(payload = {}, env = process.env) {
  let request = normalizeAuditPayload(payload);
  const websiteScan = await crawlWebsite(request.profile.website, request);
  request = enrichRequestFromWebsite(request, websiteScan);
  const simulatedAudit = {
    ...runLocalAiAudit(request),
    profileSnapshot: request.profile,
    businessTypeSnapshot: request.businessType,
  };
  const openRouterApiKey = getOpenRouterApiKey(env);
  const openAiApiKey = getOpenAiApiKey(env);
  const entityGaps = mergeEntityGaps(
    simulatedAudit.entityGaps,
    buildWebsiteScanGaps(websiteScan)
  );
  const providerAttempts = [];

  if (openRouterApiKey) {
    try {
      const openRouterBatch = await runOpenRouterSearchAudit({
        request,
        simulatedResults: simulatedAudit.results,
        websiteScan,
        env,
        openRouterApiKey,
      });
      const openRouterStatus =
        openRouterBatch.failedCount === 0
          ? "live"
          : openRouterBatch.failedCount === openRouterBatch.results.length
            ? "fallback"
            : "partial";
      const openRouterSuccessCount =
        openRouterBatch.results.length - openRouterBatch.failedCount;

      return buildLiveAudit({
        simulatedAudit,
        liveResults: openRouterBatch.results,
        websiteScan,
        entityGaps,
        mode: "openrouter-multi-model-search",
        providerStatus: [
          {
            provider: "OpenRouter multi-model search",
            status: openRouterStatus,
            detail:
              openRouterBatch.failedCount > 0
                ? `${openRouterSuccessCount}/${openRouterBatch.results.length} rows returned raw OpenRouter output; failed rows used simulator fallback.`
                : "ChatGPT-style, Perplexity/Sonar, and Gemini rows use OpenRouter with web search.",
          },
          ...buildOpenRouterProviderStatus(openRouterBatch),
          {
            provider: "Google AI Overviews",
            status: "estimated",
            detail:
              "Actual Google AI Overview SERP output needs a SERP provider such as DataForSEO; this row is still estimated.",
          },
        ],
      });
    } catch (error) {
      providerAttempts.push({
        provider: "OpenRouter web search",
        status: "error",
        detail: getErrorMessage(error, "OpenRouter request failed."),
      });
    }
  } else {
    providerAttempts.push({
      provider: "OpenRouter web search",
      status: "not_configured",
      detail:
        "Set OPENROUTER_API_KEY on the server to use OpenRouter before OpenAI.",
    });
  }

  if (openAiApiKey) {
    try {
      const openAiResults = await runOpenAiSearchAudit({
        request,
        simulatedResults: simulatedAudit.results,
        websiteScan,
        env,
        openAiApiKey,
      });

      return buildLiveAudit({
        simulatedAudit,
        liveResults: openAiResults,
        websiteScan,
        entityGaps,
        mode: "openai-web-search",
        providerStatus: [
          ...providerAttempts.filter((attempt) => attempt.status === "error"),
          {
            provider: "OpenAI web search",
            status: "live",
            detail: "ChatGPT with Search rows use real grounded provider output.",
          },
          {
            provider: "Perplexity, Gemini, Google AI Overviews",
            status: "simulated",
            detail:
              "Provider connectors are not enabled yet, so those rows remain modeled.",
          },
        ],
      });
    } catch (error) {
      providerAttempts.push({
        provider: "OpenAI web search",
        status: "error",
        detail: getErrorMessage(error, "OpenAI request failed."),
      });
    }
  } else {
    providerAttempts.push({
      provider: "OpenAI web search",
      status: "not_configured",
      detail:
        "Set OPENAI_API_KEY on the server to replace simulated ChatGPT results.",
    });
  }

  return {
    ...simulatedAudit,
    mode:
      providerAttempts.some((attempt) => attempt.status === "error")
        ? "live-provider-error-fallback"
        : "server-crawler-simulation",
    providerStatus:
      providerAttempts.length > 0
        ? providerAttempts
        : [
            {
              provider: "OpenAI web search",
              status: "not_configured",
              detail:
                "Set OPENAI_API_KEY on the server to replace simulated ChatGPT results.",
            },
          ],
    websiteScan,
    entityGaps,
    generatedAt: new Date().toISOString(),
  };
}

function buildLiveAudit({
  simulatedAudit,
  liveResults,
  websiteScan,
  entityGaps,
  mode,
  providerStatus,
}) {
  const results = simulatedAudit.results.map((result) => {
    return liveResults.find((liveResult) => liveResult.id === result.id) || result;
  });

  return {
    ...simulatedAudit,
    mode,
    providerStatus,
    websiteScan,
    entityGaps,
    results,
    summary: summarizeAuditResults(results),
    competitorShare: summarizeCompetitorShare(results),
    generatedAt: new Date().toISOString(),
  };
}

function normalizeAuditPayload(payload) {
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : {};
  const selectedType = businessTypes.find(
    (type) => type.id === payload.selectedBusinessType
  );
  const businessType =
    payload.businessType && typeof payload.businessType === "object"
      ? payload.businessType
      : selectedType || {};

  return {
    profile,
    businessType: {
      id: businessType.id || "local-business",
      label: businessType.label || profile.businessType || "Local Business",
      serviceNoun: businessType.serviceNoun || "local business",
      categoryTerm: businessType.categoryTerm || profile.category || "local service",
      urgentNeed: businessType.urgentNeed || "urgent service",
      highIntentService: businessType.highIntentService || firstCsv(profile.services) || "same day service",
      competitorA: businessType.competitorA || "Local competitor",
      competitorB: businessType.competitorB || "Nearby competitor",
    },
    competitors: Array.isArray(payload.competitors) ? payload.competitors : [],
    monitoredLocations: Array.isArray(payload.monitoredLocations)
      ? payload.monitoredLocations
      : [],
    sourceCompletion: Number.isFinite(payload.sourceCompletion)
      ? payload.sourceCompletion
      : 0,
    smartInputMode: payload.smartInputMode || "",
  };
}

async function crawlWebsite(website, request) {
  const normalizedUrl = normalizeUrl(website);
  if (!normalizedUrl) {
    return {
      status: "missing",
      url: "",
      pagesScanned: 0,
      notes: ["No brand website was entered."],
    };
  }

  try {
    const homepage = await fetchPage(normalizedUrl);
    const links = findInternalCrawlTargets(homepage.html, homepage.url, request).slice(
      0,
      MAX_EXTRA_PAGES
    );
    const extraPages = [];

    for (const link of links) {
      try {
        extraPages.push(await fetchPage(link));
      } catch {
        // A blocked internal page should not fail the whole audit.
      }
    }

    return analyzeWebsitePages([homepage, ...extraPages], normalizedUrl, request);
  } catch (error) {
    return {
      status: "failed",
      url: normalizedUrl,
      pagesScanned: 0,
      error: error instanceof Error ? error.message : "Website crawl failed.",
      notes: ["The website could not be fetched from the server."],
    };
  }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "AEO Local Monitor/0.1 (+https://github.com/harshittaneja98sales-cell/aeo-local-monitor)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${url}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error(`Unsupported content type ${contentType || "unknown"}`);
    }

    return {
      url: response.url || url,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findInternalCrawlTargets(html, baseUrl, request) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set([stripUrlNoise(base.href)]);
  const serviceTerms = splitCsv(request.profile.services)
    .concat([
      request.businessType.highIntentService,
      request.businessType.categoryTerm,
      request.businessType.serviceNoun,
      "service",
      "services",
      "about",
      "contact",
      "location",
      "areas",
      "faq",
      "reviews",
      "pest",
      "pests",
      "termite",
      "exterminator",
      "mosquito",
      "rodent",
      "bed-bug",
    ])
    .map((term) => term.toLowerCase())
    .filter(Boolean);

  return $("a[href]")
    .map((_, element) => $(element).attr("href"))
    .get()
    .map((href) => {
      try {
        return new URL(href, base).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map(stripUrlNoise)
    .filter((href) => {
      if (seen.has(href)) return false;
      seen.add(href);
      const url = new URL(href);
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) {
        return false;
      }
      if (!["http:", "https:"].includes(url.protocol)) return false;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?)$/i.test(url.pathname)) {
        return false;
      }
      const haystack = decodeURIComponent(`${url.pathname} ${url.search}`).toLowerCase();
      return serviceTerms.some((term) => haystack.includes(term));
    });
}

function analyzeWebsitePages(pages, startUrl, request) {
  const pageSummaries = pages.map((page) => {
    const $ = cheerio.load(page.html);
    $("script, style, noscript, svg, iframe").remove();
    return {
      url: page.url,
      title: $("title").first().text().trim(),
      metaDescription: $('meta[name="description"]').attr("content") || "",
      jsonLd: $('script[type="application/ld+json"]')
        .map((_, element) => $(element).html() || "")
        .get()
        .join("\n/* AEO_JSON_LD_BLOCK */\n"),
      text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 50000),
    };
  });
  const combinedJsonLd = pageSummaries
    .map((page) => page.jsonLd)
    .join("\n/* AEO_JSON_LD_BLOCK */\n");
  const combinedRawText = pageSummaries.map((page) => page.text).join(" ");
  const combinedText = combinedRawText.toLowerCase();
  const detectedBusinessType = inferBusinessTypeFromWebsiteContent({
    startUrl,
    pageSummaries,
    combinedRawText,
    combinedJsonLd,
  });
  const extractedProfile = extractWebsiteProfile({
    pageSummaries,
    combinedJsonLd,
    combinedText: combinedRawText,
    startUrl,
  });
  const serviceTerms = splitCsv(request.profile.services);
  const detectedServices = serviceTerms.filter((service) =>
    combinedText.includes(service.toLowerCase())
  );
  const hasPhone =
    /tel:/i.test(pages.map((page) => page.html).join(" ")) ||
    /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(combinedText);

  return {
    status: "scanned",
    url: startUrl,
    pagesScanned: pages.length,
    pages: pageSummaries.map(({ url, title, metaDescription }) => ({
      url,
      title,
      metaDescription,
    })),
    title: pageSummaries[0]?.title || "",
    metaDescription: pageSummaries[0]?.metaDescription || "",
    hasLocalBusinessSchema:
      /LocalBusiness|Plumber|Dentist|Restaurant|HairSalon|HVACBusiness|LegalService|HomeAndConstructionBusiness|ProfessionalService|Pest/i.test(
        combinedJsonLd
      ),
    hasFAQSchema: /FAQPage|Question|acceptedAnswer/i.test(combinedJsonLd),
    hasOpeningHoursSchema: /openingHours|openingHoursSpecification/i.test(combinedJsonLd),
    hasGeoSchema: /"geo"|"latitude"|"longitude"|GeoCoordinates/i.test(combinedJsonLd),
    hasSameAs: /"sameAs"/i.test(combinedJsonLd),
    hasPhone,
    detectedServices,
    detectedBusinessTypeId: detectedBusinessType?.id || "",
    detectedBusinessTypeLabel: detectedBusinessType?.label || "",
    extractedProfile,
    notes: buildWebsiteScanNotes({
      pagesScanned: pages.length,
      detectedServices,
      serviceTerms,
      detectedBusinessType,
    }),
  };
}

function buildWebsiteScanNotes({
  pagesScanned,
  detectedServices,
  serviceTerms,
  detectedBusinessType,
}) {
  const notes = [`Scanned ${pagesScanned} owned page${pagesScanned === 1 ? "" : "s"}.`];
  if (detectedBusinessType) {
    notes.push(`Detected business type: ${detectedBusinessType.label}.`);
  }
  if (serviceTerms.length > 0) {
    notes.push(
      `${detectedServices.length}/${serviceTerms.length} entered service terms were found in page text.`
    );
  }
  return notes;
}

function inferBusinessTypeFromWebsiteContent({
  startUrl,
  pageSummaries,
  combinedRawText,
  combinedJsonLd,
}) {
  const homepage = pageSummaries[0] || {};
  const weightedSources = [
    { value: startUrl, weight: 5 },
    { value: homepage.title, weight: 4 },
    { value: homepage.metaDescription, weight: 4 },
    { value: combinedJsonLd, weight: 3 },
    { value: String(combinedRawText || "").slice(0, 16000), weight: 1 },
  ];
  const scores = businessTypeInferenceSignals.map((signal) => {
    const score = weightedSources.reduce((total, source) => {
      const haystack = normalizeWhitespace(source.value).toLowerCase();
      const matches = signal.keywords.filter((keyword) =>
        haystack.includes(keyword.toLowerCase())
      ).length;
      return total + matches * source.weight;
    }, 0);

    return { id: signal.id, score };
  });
  const sortedScores = scores.sort((left, right) => right.score - left.score);
  const [best, second] = sortedScores;

  if (!best || best.score < 4 || best.score <= (second?.score || 0)) {
    return null;
  }

  return businessTypes.find((type) => type.id === best.id) || null;
}

function shouldReplaceTypedField(value, detectedBusinessTypeId) {
  const field = String(value || "").trim();
  if (!field) return true;

  return businessTypeInferenceSignals.some((signal) => {
    if (signal.id === detectedBusinessTypeId) return false;
    const haystack = field.toLowerCase();
    return signal.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  });
}

function enrichRequestFromWebsite(request, websiteScan) {
  if (websiteScan.status !== "scanned") return request;

  const extracted = websiteScan.extractedProfile || {};
  const websiteOnly = request.smartInputMode === "website-only";
  const detectedBusinessType = businessTypes.find(
    (type) => type.id === websiteScan.detectedBusinessTypeId
  );
  const profile = request.profile || {};
  const nextProfile = {
    ...profile,
    website: websiteScan.url || profile.website,
  };
  const nextBusinessType = detectedBusinessType || request.businessType;
  const fillableFields = [
    "name",
    "phone",
    "address",
    "hours",
    "market",
    "serviceArea",
    "bookingUrl",
  ];

  for (const field of fillableFields) {
    if (extracted[field] && (websiteOnly || !String(nextProfile[field] || "").trim())) {
      nextProfile[field] = extracted[field];
    }
  }

  if (extracted.services && (websiteOnly || !String(nextProfile.services || "").trim())) {
    nextProfile.services = extracted.services;
  }

  if (detectedBusinessType) {
    nextProfile.businessType = detectedBusinessType.label;
    nextProfile.category = shouldReplaceTypedField(
      nextProfile.category,
      detectedBusinessType.id
    )
      ? detectedBusinessType.categoryTerm
      : nextProfile.category;
    nextProfile.services = shouldReplaceTypedField(
      nextProfile.services,
      detectedBusinessType.id
    )
      ? detectedBusinessType.highIntentService
      : nextProfile.services;
  }

  if (!String(nextProfile.name || "").trim()) {
    nextProfile.name = inferNameFromUrl(nextProfile.website);
  }

  return {
    ...request,
    businessType: nextBusinessType,
    profile: nextProfile,
    sourceCompletion: Math.max(
      request.sourceCompletion || 0,
      calculateServerSourceCompletion({
        profile: nextProfile,
        competitors: request.competitors,
        monitoredLocations: request.monitoredLocations,
      })
    ),
  };
}

function extractWebsiteProfile({ pageSummaries, combinedJsonLd, combinedText, startUrl }) {
  const structured = extractStructuredBusinessProfile(combinedJsonLd);
  const homepage = pageSummaries[0] || {};
  const titleName = cleanTitleForBusiness(homepage.title);
  const searchableText = [
    homepage.title,
    homepage.metaDescription,
    combinedText,
  ]
    .filter(Boolean)
    .join(" ");
  const phone = structured.phone || extractPhoneFromText(searchableText);
  const address = structured.address || extractAddressFromText(searchableText);
  const market =
    structured.market ||
    extractMarketFromAddress(address) ||
    extractMarketFromText(searchableText);
  const services = extractServicesFromMetadata(homepage, searchableText);

  return removeEmptyValues({
    name: structured.name || titleName || inferNameFromUrl(startUrl),
    phone,
    address,
    market,
    hours: structured.hours,
    serviceArea: structured.serviceArea || market,
    services,
    bookingUrl: structured.bookingUrl || startUrl,
  });
}

function extractStructuredBusinessProfile(jsonLd) {
  const items = parseJsonLdItems(jsonLd);
  const business = items.find((item) => {
    const type = Array.isArray(item["@type"]) ? item["@type"].join(" ") : item["@type"];
    return /LocalBusiness|Organization|Dentist|Plumber|Restaurant|Store|AutomotiveBusiness|AutoDealer|LegalService|HairSalon|HVACBusiness|HomeAndConstructionBusiness|ProfessionalService|Pest/i.test(
      String(type || "")
    );
  });

  if (!business) return {};

  const address = formatStructuredAddress(business.address);
  const market = extractMarketFromStructuredAddress(business.address);

  return removeEmptyValues({
    name: stringValue(business.name),
    phone: stringValue(business.telephone),
    address,
    market,
    hours: formatStructuredHours(
      business.openingHoursSpecification || business.openingHours
    ),
    serviceArea: formatAreaServed(business.areaServed),
    bookingUrl:
      stringValue(business.url) ||
      stringValue(business.sameAs) ||
      stringValue(business["@id"]),
  });
}

function parseJsonLdItems(jsonLd) {
  const blocks = String(jsonLd || "")
    .split("/* AEO_JSON_LD_BLOCK */")
    .map((block) => block.trim())
    .filter(Boolean);
  const parsedItems = [];

  for (const block of blocks) {
    try {
      collectJsonLdItems(JSON.parse(block), parsedItems);
    } catch {
      // Invalid third-party JSON-LD should not fail the website audit.
    }
  }

  return parsedItems;
}

function collectJsonLdItems(value, target) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdItems(item, target));
    return;
  }
  if (typeof value !== "object") return;
  target.push(value);
  if (Array.isArray(value["@graph"])) {
    value["@graph"].forEach((item) => collectJsonLdItems(item, target));
  }
}

function formatStructuredAddress(address) {
  if (!address) return "";
  if (typeof address === "string") return address;
  if (Array.isArray(address)) return formatStructuredAddress(address[0]);

  return [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join(", ");
}

function extractMarketFromStructuredAddress(address) {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  return [address.addressLocality, address.addressRegion]
    .map(stringValue)
    .filter(Boolean)
    .join(", ");
}

function formatStructuredHours(hours) {
  if (!hours) return "";
  if (typeof hours === "string") return hours;
  if (Array.isArray(hours)) {
    return hours
      .map((item) => {
        if (typeof item === "string") return item;
        const days = Array.isArray(item.dayOfWeek)
          ? item.dayOfWeek.map((day) => String(day).split("/").pop()).join(", ")
          : String(item.dayOfWeek || "").split("/").pop();
        const opens = item.opens || "";
        const closes = item.closes || "";
        return [days, opens && closes ? `${opens}-${closes}` : ""]
          .filter(Boolean)
          .join(" ");
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function formatAreaServed(areaServed) {
  if (!areaServed) return "";
  if (typeof areaServed === "string") return areaServed;
  if (Array.isArray(areaServed)) {
    return areaServed
      .map((area) => stringValue(area?.name || area))
      .filter(Boolean)
      .join(", ");
  }
  return stringValue(areaServed.name);
}

function cleanTitleForBusiness(title) {
  return String(title || "")
    .split(/\s[-|–—]\s/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((left, right) => left.length - right.length)[0] || "";
}

function extractPhoneFromText(text) {
  return String(text || "").match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0] || "";
}

function extractAddressFromText(text) {
  const match = String(text || "").match(
    /\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,7}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|circle|cir\.?|parkway|pkwy\.?)\b[^.|\n]{0,90}\b[a-z .'-]+,\s*[a-z]{2}\s*\d{0,5}/i
  );
  return match ? normalizeWhitespace(match[0]) : "";
}

function extractMarketFromAddress(address) {
  const match = String(address || "").match(
    /\b([A-Za-z][A-Za-z .'-]{1,38}?),\s*([A-Z]{2})\b/
  );
  if (!match || !isUsStateCode(match[2])) return "";
  return formatMarket(match[1], match[2]);
}

function extractMarketFromText(text) {
  const source = normalizeWhitespace(text);
  const patterns = [
    /\b(?:serving|serves|service area|located in|based in|near|in)\s+([A-Z][A-Za-z .'-]{1,38}?),\s*([A-Z]{2})\b/g,
    /\b([A-Z][A-Za-z .'-]{1,38}?),\s*([A-Z]{2})\s+(?:plumber|plumbing|pest|exterminator|termite|dentist|dental|restaurant|lawyer|attorney|hvac|salon|auto|cars|dealer|dealership)\b/g,
  ];

  for (const pattern of patterns) {
    const matches = [...source.matchAll(pattern)];
    const market = matches
      .map((match) => formatMarket(match[1], match[2]))
      .find(isCleanMarket);
    if (market) return market;
  }

  const county = extractCountyLocation(source);
  if (county) return county;

  return "";
}

function extractServicesFromMetadata(homepage, text) {
  const source = `${homepage.title || ""} ${homepage.metaDescription || ""} ${String(
    text || ""
  ).slice(0, 2000)}`;
  const serviceWords = [
    "plumbing",
    "water heater",
    "drain cleaning",
    "pest control",
    "termite treatment",
    "mosquito control",
    "rodent removal",
    "bed bug treatment",
    "exterminator",
    "dentist",
    "dental",
    "emergency dental",
    "used cars",
    "auto sales",
    "financing",
    "hvac",
    "ac repair",
    "restaurant",
    "reservations",
    "hair salon",
    "personal injury",
  ];

  return serviceWords
    .filter((service) => source.toLowerCase().includes(service))
    .slice(0, 6)
    .join(", ");
}

function calculateServerSourceCompletion({ profile, competitors, monitoredLocations }) {
  const fields = [
    "name",
    "category",
    "market",
    "website",
    "phone",
    "address",
    "hours",
    "serviceArea",
    "services",
    "credential",
    "bookingUrl",
  ];
  const completed = fields.filter((field) => String(profile[field] || "").trim()).length;
  const profileScore = (completed / fields.length) * 78;
  const competitorScore = competitors.filter(Boolean).length >= 2 ? 12 : 0;
  const locationScore = monitoredLocations.filter(Boolean).length >= 1 ? 10 : 0;

  return Math.round(profileScore + competitorScore + locationScore);
}

function inferNameFromUrl(value) {
  try {
    const host = new URL(normalizeUrl(value)).hostname.replace(/^www\./, "");
    return host
      .split(".")[0]
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "";
  }
}

function removeEmptyValues(values) {
  return Object.entries(values).reduce((summary, [key, value]) => {
    if (String(value || "").trim()) summary[key] = normalizeWhitespace(value);
    return summary;
  }, {});
}

function stringValue(value) {
  if (Array.isArray(value)) return stringValue(value[0]);
  if (value && typeof value === "object") return stringValue(value.name || value["@id"]);
  return String(value || "").trim();
}

function formatMarket(city, state) {
  const stateCode = String(state || "").trim().toUpperCase();
  if (!isUsStateCode(stateCode)) return "";
  const county = cleanCountyLocation(city);
  if (county) return county;
  const cityName = titleCase(
    String(city || "")
      .replace(/\b(?:serving|serves|service area|located in|based in|near|in)\b/gi, "")
      .trim()
  );

  return isCleanMarket(`${cityName}, ${stateCode}`) ? `${cityName}, ${stateCode}` : "";
}

function isCleanMarket(value) {
  const market = String(value || "").trim();
  const [city = "", state = ""] = market.split(",").map((part) => part.trim());
  const rejectedWords =
    /\b(?:about|blog|call|cleaning|contact|core|customer|drain|emergency|exterminator|fast|heater|home|hours|mosquito|pest|plumber|plumbing|quality|reliable|repair|review|rodent|same|service|services|termite|values|water|work)\b/i;

  return (
    city.length >= 3 &&
    city.length <= 42 &&
    !/\d/.test(city) &&
    !/[.!?]/.test(city) &&
    !rejectedWords.test(city) &&
    isUsStateCode(state)
  );
}

function extractCountyLocation(text) {
  const countyMatches = [
    ...normalizeWhitespace(text).matchAll(
      /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,7}\s+County)\b/g
    ),
  ];

  return (
    countyMatches
      .map((match) => cleanCountyLocation(match[1]))
      .find(Boolean) || ""
  );
}

function cleanCountyLocation(value) {
  const words = titleCase(value)
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);
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

  return "";
}

function isUsStateCode(value) {
  return new Set([
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "IA",
    "ID",
    "IL",
    "IN",
    "KS",
    "KY",
    "LA",
    "MA",
    "MD",
    "ME",
    "MI",
    "MN",
    "MO",
    "MS",
    "MT",
    "NC",
    "ND",
    "NE",
    "NH",
    "NJ",
    "NM",
    "NV",
    "NY",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VA",
    "VT",
    "WA",
    "WI",
    "WV",
    "WY",
    "DC",
  ]).has(String(value || "").trim().toUpperCase());
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return String(value || "").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function buildWebsiteScanGaps(scan) {
  if (scan.status === "missing") return [];
  if (scan.status === "failed") {
    return [
      {
        id: "website-crawl-failed",
        severity: "High",
        title: "Website could not be crawled",
        detail:
          "The audit endpoint could not fetch the brand website, so owned-source citation checks are incomplete.",
        fix: "Confirm the website URL, SSL configuration, robots rules, and bot protection settings.",
      },
    ];
  }

  const gaps = [];
  if (!scan.hasLocalBusinessSchema) {
    gaps.push({
      id: "website-localbusiness-schema",
      severity: "High",
      title: "LocalBusiness schema not detected",
      detail:
        "The crawler did not find clear LocalBusiness-style JSON-LD on scanned owned pages.",
      fix: "Add LocalBusiness JSON-LD with name, address, phone, category, URL, and sameAs fields.",
    });
  }
  if (!scan.hasOpeningHoursSchema) {
    gaps.push({
      id: "website-opening-hours-schema",
      severity: "Medium",
      title: "Opening hours schema not detected",
      detail:
        "Open-now prompts need openingHours or openingHoursSpecification in structured data.",
      fix: "Add openingHoursSpecification and keep it aligned with Google Business Profile.",
    });
  }
  if (!scan.hasGeoSchema) {
    gaps.push({
      id: "website-geo-schema",
      severity: "Medium",
      title: "Geo schema not detected",
      detail:
        "The crawler did not find latitude and longitude structured data on owned pages.",
      fix: "Add GeoCoordinates to the LocalBusiness schema after validating the listing coordinates.",
    });
  }
  if (!scan.hasFAQSchema) {
    gaps.push({
      id: "website-faq-schema",
      severity: "Low",
      title: "FAQ schema not detected on crawled pages",
      detail:
        "Question-answer markup helps answer engines resolve pricing, timing, and service-area prompts.",
      fix: "Add FAQPage markup to high-intent service pages.",
    });
  }

  return gaps;
}

async function runOpenAiSearchAudit({
  request,
  simulatedResults,
  websiteScan,
  env,
  openAiApiKey,
}) {
  const client = new OpenAI({ apiKey: openAiApiKey });
  const prompts = simulatedResults
    .filter((result) => result.engineId === "chatgpt-search")
    .map((result) => ({
      prompt: {
        id: result.promptId,
        query: result.query,
        intent: result.intent,
        priority: result.priority,
      },
      fallback: result,
    }));

  const results = [];
  for (const item of prompts) {
    results.push(
      await runOpenAiPrompt({
        client,
        env,
        request,
        prompt: item.prompt,
        fallback: item.fallback,
        websiteScan,
      })
    );
  }
  return results;
}

async function runOpenRouterSearchAudit({
  request,
  simulatedResults,
  websiteScan,
  env,
  openRouterApiKey,
}) {
  const configByEngineId = new Map(
    openRouterLiveEngineConfigs.map((config) => [
      config.engineId,
      {
        ...config,
        model:
          env[config.modelEnvKey] ||
          (config.engineId === "chatgpt-search" ? env.OPENROUTER_MODEL : "") ||
          config.defaultModel,
      },
    ])
  );
  const prompts = simulatedResults
    .filter((result) => configByEngineId.has(result.engineId))
    .map((result) => ({
      engineConfig: configByEngineId.get(result.engineId),
      prompt: {
        id: result.promptId,
        query: result.query,
        intent: result.intent,
        priority: result.priority,
      },
      fallback: result,
    }));

  const settled = await Promise.all(
    prompts.map(async (item) => {
      try {
        return {
          status: "fulfilled",
          value: await runOpenRouterPrompt({
            env,
            openRouterApiKey,
            request,
            prompt: item.prompt,
            fallback: item.fallback,
            websiteScan,
            engineConfig: item.engineConfig,
          }),
          engineConfig: item.engineConfig,
        };
      } catch (error) {
        return {
          status: "rejected",
          value: buildPromptFallbackResult({
            fallback: item.fallback,
            providerLabel: item.engineConfig.providerLabel,
            providerModel: item.engineConfig.model,
            error,
          }),
          engineConfig: item.engineConfig,
        };
      }
    })
  );
  const failedCount = settled.filter((item) => item.status === "rejected").length;
  const providerTotals = openRouterLiveEngineConfigs.map((config) => {
    const attempts = settled.filter(
      (item) => item.engineConfig.engineId === config.engineId
    );
    const failures = attempts.filter((item) => item.status === "rejected").length;
    return {
      provider: config.provider,
      providerLabel: config.providerLabel,
      model: configByEngineId.get(config.engineId)?.model || config.defaultModel,
      total: attempts.length,
      failedCount: failures,
      successCount: attempts.length - failures,
    };
  });

  return {
    results: settled.map((item) => item.value),
    failedCount,
    providerTotals,
  };
}

function buildOpenRouterProviderStatus(batch) {
  return batch.providerTotals.map((total) => {
    const status =
      total.failedCount === 0
        ? "live"
        : total.successCount > 0
          ? "partial"
          : "fallback";
    return {
      provider: total.provider,
      status,
      detail:
        total.failedCount > 0
          ? `${total.successCount}/${total.total} prompt rows returned raw answers via ${total.model}; failed rows used estimates.`
          : `${total.total}/${total.total} prompt rows returned raw answers via ${total.model}.`,
    };
  });
}

function buildPromptFallbackResult({
  fallback,
  providerLabel,
  providerModel,
  error,
}) {
  return {
    ...fallback,
    providerMode: "live-provider-prompt-fallback",
    providerLabel,
    providerModel,
    responseExcerpt: "",
    finding: `${providerLabel} did not return a usable answer for this prompt, so this row used simulator scoring. ${fallback.finding}`,
    providerError: getErrorMessage(error, "Provider prompt failed."),
  };
}

async function runOpenRouterPrompt({
  env,
  openRouterApiKey,
  request,
  prompt,
  fallback,
  websiteScan,
  engineConfig,
}) {
  const response = await createOpenRouterChatCompletion(env, openRouterApiKey, {
    model: engineConfig.model,
    messages: [
      {
        role: "system",
        content: [
          "You audit local AI answer visibility.",
          `You are producing the ${engineConfig.providerLabel} row for this SaaS audit.`,
          "Answer naturally with current web evidence. Include source URLs when available.",
          "Do not force the target business into the answer unless the evidence supports it.",
        ].join(" "),
      },
      {
        role: "user",
        content: buildOpenAiAuditPrompt(request, prompt, websiteScan),
      },
    ],
    temperature: 0.2,
  });
  const outputText = extractChatCompletionText(response);
  return buildLivePromptResult({
    response,
    outputText,
    request,
    fallback,
    providerMode: `live-openrouter-${engineConfig.engineId}`,
    providerLabel: engineConfig.providerLabel,
    providerModel: engineConfig.model,
  });
}

async function runOpenAiPrompt({ client, env, request, prompt, fallback, websiteScan }) {
  const response = await createOpenAiResponse(client, env, {
    model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    input: buildOpenAiAuditPrompt(request, prompt, websiteScan),
  });
  const outputText = extractOutputText(response);
  return buildLivePromptResult({
    response,
    outputText,
    request,
    fallback,
    providerMode: "live-openai-web-search",
    providerLabel: "OpenAI web search",
  });
}

function buildLivePromptResult({
  response,
  outputText,
  request,
  fallback,
  providerMode,
  providerLabel,
  providerModel,
}) {
  const urls = extractUrlsFromResponse(response).concat(extractUrlsFromText(outputText));
  const uniqueUrls = [...new Set(urls)];
  const businessName = String(request.profile.name || "").trim();
  const ownedHost = getHostname(request.profile.website);
  const mentioned = isBusinessMentioned(outputText, businessName, ownedHost);
  const source = findBestSource(uniqueUrls, ownedHost);
  const cited = mentioned && Boolean(source);
  const competitorRecommendations = extractCompetitorsFromText(
    outputText,
    request.competitors,
    fallback.competitorRecommendations
  );
  const rank = mentioned
    ? estimateMentionRank(outputText, businessName, competitorRecommendations)
    : null;

  return {
    ...fallback,
    mentioned,
    cited,
    rank,
    source,
    competitorRecommendations,
    confidence: cited ? 88 : mentioned ? 76 : 62,
    providerMode,
    providerLabel,
    providerModel,
    responseExcerpt: outputText.slice(0, 700),
    finding: buildLiveFinding({
      mentioned,
      cited,
      source,
      businessName,
      competitorRecommendations,
      providerLabel,
    }),
  };
}

async function createOpenAiResponse(client, env, request) {
  const toolType = env.OPENAI_WEB_SEARCH_TOOL_TYPE || "web_search";
  try {
    return await client.responses.create({
      ...request,
      tools: [{ type: toolType }],
      include: ["web_search_call.action.sources"],
    });
  } catch (error) {
    if (toolType !== "web_search") throw error;
    return client.responses.create({
      ...request,
      tools: [{ type: "web_search_preview" }],
      include: ["web_search_call.action.sources"],
    });
  }
}

async function createOpenRouterChatCompletion(env, apiKey, request) {
  const timeoutMs = parseIntegerEnv(
    env.OPENROUTER_PROMPT_TIMEOUT_MS,
    OPENROUTER_PROMPT_TIMEOUT_MS,
    5000,
    60000
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const body = {
    ...request,
    tools: [
      {
        type: "openrouter:web_search",
        parameters: {
          engine: env.OPENROUTER_SEARCH_ENGINE || "auto",
          max_results: parseIntegerEnv(env.OPENROUTER_SEARCH_RESULTS, 4, 1, 8),
          search_context_size: env.OPENROUTER_SEARCH_CONTEXT_SIZE || "medium",
        },
      },
    ],
  };

  try {
    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(env, apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${truncateText(detail, 500)}`
      );
    }

    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `OpenRouter prompt timed out after ${Math.round(timeoutMs / 1000)} seconds.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildOpenRouterHeaders(env, apiKey) {
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-title": "AEO Local Monitor",
  };
  const referer = getOpenRouterReferer(env);
  if (referer) headers["http-referer"] = referer;
  return headers;
}

function getOpenRouterReferer(env) {
  if (env.OPENROUTER_SITE_URL) return env.OPENROUTER_SITE_URL;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "";
}

function buildOpenAiAuditPrompt(request, prompt, websiteScan) {
  const profile = request.profile;
  const competitors = request.competitors.filter(Boolean).join(", ") || "Unknown";
  const scannedPages =
    websiteScan.status === "scanned"
      ? websiteScan.pages.map((page) => page.url).join(", ")
      : "Website not crawled";

  return [
    "You are auditing local AI answer visibility for a business.",
    "Answer the customer query naturally using current web evidence.",
    "Do not force the target business into the answer unless the evidence supports it.",
    "When possible, include source URLs in the answer.",
    "",
    `Target business: ${profile.name || "Unknown"}`,
    `Business type: ${request.businessType.label}`,
    `Website: ${profile.website || "Unknown"}`,
    `Address: ${profile.address || "Unknown"}`,
    `Market: ${profile.market || "Unknown"}`,
    `Services: ${profile.services || "Unknown"}`,
    `Known competitors: ${competitors}`,
    `Owned pages scanned by this SaaS: ${scannedPages}`,
    "",
    `Customer query: ${prompt.query}`,
  ].join("\n");
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";

  return response.output
    .flatMap((item) => item.content || [])
    .map((content) => content.text || content.output_text || "")
    .filter(Boolean)
    .join("\n");
}

function extractChatCompletionText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => item.text || item.content || "")
    .filter(Boolean)
    .join("\n");
}

function extractUrlsFromResponse(response) {
  const urls = [];
  collectUrls(response, urls);
  return urls;
}

function collectUrls(value, urls) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /url|uri|link/i.test(key) && /^https?:\/\//i.test(child)) {
      urls.push(child);
    } else if (child && typeof child === "object") {
      collectUrls(child, urls);
    }
  }
}

function extractUrlsFromText(text) {
  return String(text || "").match(/https?:\/\/[^\s)\]}>"']+/g) || [];
}

function isBusinessMentioned(text, businessName, ownedHost) {
  const haystack = normalizeText(text);
  if (businessName && haystack.includes(normalizeText(businessName))) return true;
  return Boolean(ownedHost && haystack.includes(ownedHost.replace(/^www\./, "")));
}

function extractCompetitorsFromText(text, competitors, fallback) {
  const haystack = normalizeText(text);
  const found = competitors
    .map((competitor) => String(competitor || "").trim())
    .filter(Boolean)
    .filter((competitor) => haystack.includes(normalizeText(competitor)));

  return [...new Set(found.length > 0 ? found : fallback)].slice(0, 3);
}

function estimateMentionRank(text, businessName, competitors) {
  if (!businessName) return 3;
  const haystack = normalizeText(text);
  const businessIndex = haystack.indexOf(normalizeText(businessName));
  if (businessIndex < 0) return 3;
  const earlierCompetitors = competitors.filter((competitor) => {
    const competitorIndex = haystack.indexOf(normalizeText(competitor));
    return competitorIndex >= 0 && competitorIndex < businessIndex;
  }).length;
  return Math.min(5, earlierCompetitors + 1);
}

function findBestSource(urls, ownedHost) {
  if (urls.length === 0) return null;
  if (!ownedHost) return urls[0];
  return (
    urls.find((url) => {
      const host = getHostname(url);
      return host && (host === ownedHost || host.endsWith(`.${ownedHost}`));
    }) || urls[0]
  );
}

function buildLiveFinding({
  mentioned,
  cited,
  source,
  businessName,
  competitorRecommendations,
  providerLabel = "Live web search",
}) {
  const label = businessName || "the target business";
  if (mentioned && cited) {
    return `${providerLabel} mentions ${label} and returns ${source} as a supporting source.`;
  }
  if (mentioned) {
    return `${providerLabel} mentions ${label}, but no direct source URL was parsed from the answer.`;
  }
  return `${providerLabel} did not recommend ${label}; it favored ${competitorRecommendations
    .slice(0, 2)
    .join(" and ")} for this prompt.`;
}

function mergeEntityGaps(baseGaps, extraGaps) {
  const seen = new Set();
  return [...baseGaps, ...extraGaps].filter((gap) => {
    if (seen.has(gap.id)) return false;
    seen.add(gap.id);
    return true;
  });
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    if (!url.hostname.includes(".")) return "";
    return stripUrlNoise(url.href);
  } catch {
    return "";
  }
}

function stripUrlNoise(value) {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  return url.href;
}

function getHostname(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  return new URL(normalized).hostname.replace(/^www\./, "");
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstCsv(value) {
  return splitCsv(value)[0];
}

function parseIntegerEnv(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getOpenRouterApiKey(env) {
  return env.OPENROUTER_API_KEY || env.OPENROUTER_api_KEY || "";
}

function getOpenAiApiKey(env) {
  return env.OPENAI_API_KEY || env.OPENAI_api_KEY || "";
}

function getErrorMessage(error, fallback = "Provider request failed.") {
  if (error instanceof Error && error.message) return error.message;
  return `${fallback} No provider response could be parsed.`;
}

export { auditEngines };
