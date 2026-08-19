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
const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const MAX_EXTRA_PAGES = 3;
const FETCH_TIMEOUT_MS = 9000;

export async function runServerAudit(payload = {}, env = process.env) {
  const request = normalizeAuditPayload(payload);
  const simulatedAudit = runLocalAiAudit(request);
  const websiteScan = await crawlWebsite(request.profile.website, request);
  const openRouterApiKey = getOpenRouterApiKey(env);
  const openAiApiKey = getOpenAiApiKey(env);
  const entityGaps = mergeEntityGaps(
    simulatedAudit.entityGaps,
    buildWebsiteScanGaps(websiteScan)
  );
  const providerAttempts = [];

  if (openRouterApiKey) {
    try {
      const openRouterResults = await runOpenRouterSearchAudit({
        request,
        simulatedResults: simulatedAudit.results,
        websiteScan,
        env,
        openRouterApiKey,
      });

      return buildLiveAudit({
        simulatedAudit,
        liveResults: openRouterResults,
        websiteScan,
        entityGaps,
        mode: "openrouter-web-search",
        providerStatus: [
          {
            provider: "OpenRouter web search",
            status: "live",
            detail:
              "ChatGPT-style rows use grounded OpenRouter output with web search.",
          },
          {
            provider: "Perplexity, Gemini, Google AI Overviews",
            status: "simulated",
            detail:
              "Direct provider connectors are not enabled yet, so those rows remain modeled.",
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
    if (result.engineId !== "chatgpt-search") return result;
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
        .join("\n"),
      text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 50000),
    };
  });
  const combinedJsonLd = pageSummaries.map((page) => page.jsonLd).join("\n");
  const combinedText = pageSummaries.map((page) => page.text).join(" ").toLowerCase();
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
      /LocalBusiness|Plumber|Dentist|Restaurant|HairSalon|HVACBusiness|LegalService/i.test(
        combinedJsonLd
      ),
    hasFAQSchema: /FAQPage|Question|acceptedAnswer/i.test(combinedJsonLd),
    hasOpeningHoursSchema: /openingHours|openingHoursSpecification/i.test(combinedJsonLd),
    hasGeoSchema: /"geo"|"latitude"|"longitude"|GeoCoordinates/i.test(combinedJsonLd),
    hasSameAs: /"sameAs"/i.test(combinedJsonLd),
    hasPhone,
    detectedServices,
    notes: buildWebsiteScanNotes({
      pagesScanned: pages.length,
      detectedServices,
      serviceTerms,
    }),
  };
}

function buildWebsiteScanNotes({ pagesScanned, detectedServices, serviceTerms }) {
  const notes = [`Scanned ${pagesScanned} owned page${pagesScanned === 1 ? "" : "s"}.`];
  if (serviceTerms.length > 0) {
    notes.push(
      `${detectedServices.length}/${serviceTerms.length} entered service terms were found in page text.`
    );
  }
  return notes;
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
      await runOpenRouterPrompt({
        env,
        openRouterApiKey,
        request,
        prompt: item.prompt,
        fallback: item.fallback,
        websiteScan,
      })
    );
  }
  return results;
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

async function runOpenRouterPrompt({
  env,
  openRouterApiKey,
  request,
  prompt,
  fallback,
  websiteScan,
}) {
  const response = await createOpenRouterChatCompletion(env, openRouterApiKey, {
    model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You audit local AI answer visibility. Answer naturally with current web evidence. Include source URLs when available.",
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
    providerMode: "live-openrouter-web-search",
    providerLabel: "OpenRouter web search",
  });
}

function buildLivePromptResult({
  response,
  outputText,
  request,
  fallback,
  providerMode,
  providerLabel,
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
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(env, apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenRouter HTTP ${response.status}: ${truncateText(detail, 500)}`
    );
  }

  return response.json();
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
