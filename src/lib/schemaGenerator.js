const schemaTypeByBusinessType = {
  plumbing: "Plumber",
  hvac: "HomeAndConstructionBusiness",
  dentistry: "Dentist",
  restaurant: "Restaurant",
  salon: "HairSalon",
  law: "LegalService",
};

const dayAliases = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  sun: "Sunday",
  sunday: "Sunday",
};

const orderedDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function generateEntitySchemaPatch({
  profile,
  businessType,
  auditReport,
}) {
  const cleanProfile = profile || {};
  const cleanBusinessType = businessType || {};
  const website = normalizeWebsite(cleanProfile.website);
  const services = splitCsv(cleanProfile.services);
  const address = parseAddress(cleanProfile.address, cleanProfile.market);
  const openingHoursSpecification = parseOpeningHours(cleanProfile.hours);
  const schemaType =
    schemaTypeByBusinessType[cleanBusinessType.id] ||
    cleanProfile.businessType ||
    "LocalBusiness";
  const businessId = website
    ? `${website}/#localbusiness`
    : `#${slugify(cleanProfile.name || "local-business")}`;
  const websiteId = website ? `${website}/#website` : "#website";
  const faqId = website ? `${website}/#faq` : "#faq";
  const gapIds = (auditReport?.entityGaps || []).map((gap) => gap.id);

  const localBusiness = cleanObject({
    "@type": schemaType,
    "@id": businessId,
    name: cleanProfile.name,
    legalName: cleanProfile.name,
    url: website,
    telephone: cleanProfile.phone,
    description: buildDescription(cleanProfile, cleanBusinessType, services),
    address,
    areaServed: buildAreaServed(cleanProfile.serviceArea, cleanProfile.market),
    openingHoursSpecification:
      openingHoursSpecification.length > 0
        ? openingHoursSpecification
        : undefined,
    openingHours:
      openingHoursSpecification.length === 0 && cleanProfile.hours
        ? cleanProfile.hours
        : undefined,
    hasOfferCatalog: buildOfferCatalog(services, businessId),
    knowsAbout: services.length > 0 ? services : undefined,
    identifier: cleanProfile.credential
      ? {
          "@type": "PropertyValue",
          name: "License or credential",
          value: cleanProfile.credential,
        }
      : undefined,
    potentialAction: cleanProfile.bookingUrl
      ? {
          "@type": "ReserveAction",
          target: cleanProfile.bookingUrl,
        }
      : undefined,
  });

  const websiteNode = cleanObject({
    "@type": "WebSite",
    "@id": websiteId,
    url: website,
    name: cleanProfile.name,
    publisher: { "@id": businessId },
  });

  const faqNode = buildFaqNode({
    id: faqId,
    profile: cleanProfile,
    businessType: cleanBusinessType,
    services,
  });

  const schemaJson = {
    "@context": "https://schema.org",
    "@graph": [localBusiness, websiteNode, faqNode].filter(Boolean),
  };
  const installSnippet = `<script type="application/ld+json">\n${JSON.stringify(
    schemaJson,
    null,
    2
  )}\n</script>`;

  return {
    title: `${cleanProfile.name || "Local business"} entity schema fix`,
    status: "ready",
    schemaType,
    schemaJson,
    installSnippet,
    gapIds,
    fixedSignals: buildFixedSignals(gapIds, cleanProfile, services),
    fieldCoverage: buildFieldCoverage({
      profile: cleanProfile,
      address,
      openingHoursSpecification,
      services,
      website,
    }),
    installTargets: [
      "Website head",
      "WordPress SEO plugin custom schema",
      "Webflow custom code",
      "Google Tag Manager custom HTML",
    ],
    validationUrl: website
      ? `https://search.google.com/test/rich-results?url=${encodeURIComponent(
          website
        )}`
      : "https://search.google.com/test/rich-results",
    generatedAt: new Date().toISOString(),
  };
}

function buildDescription(profile, businessType, services) {
  const parts = [
    profile.category,
    profile.market ? `serving ${profile.market}` : "",
    services.length > 0 ? `with services including ${services.slice(0, 4).join(", ")}` : "",
    businessType.highIntentService
      ? `and ${businessType.highIntentService}`
      : "",
  ].filter(Boolean);
  return parts.length > 0 ? sentenceCase(parts.join(" ")) : undefined;
}

function buildAreaServed(serviceArea, market) {
  const places = splitCsv(serviceArea || market).slice(0, 12);
  if (places.length === 0) return undefined;
  return places.map((place) => ({
    "@type": "Place",
    name: place,
  }));
}

function buildOfferCatalog(services, businessId) {
  if (services.length === 0) return undefined;
  return {
    "@type": "OfferCatalog",
    name: "Services",
    itemListElement: services.slice(0, 12).map((service, index) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        "@id": `${businessId}/service/${slugify(service) || index + 1}`,
        name: service,
      },
    })),
  };
}

function buildFaqNode({ id, profile, businessType, services }) {
  const city = extractCity(profile.market);
  const service = services[0] || businessType.highIntentService;
  const questions = [
    {
      name: `Does ${profile.name || "this business"} serve ${city}?`,
      text: `${profile.name || "The business"} serves ${
        profile.serviceArea || profile.market || city || "the local area"
      }.`,
    },
    service && {
      name: `Does ${profile.name || "this business"} offer ${service}?`,
      text: `${profile.name || "The business"} lists ${service} among its core local services.`,
    },
    businessType.urgentNeed && {
      name: `Who should I contact for ${businessType.urgentNeed} in ${city}?`,
      text: `${profile.name || "The business"} can be contacted at ${
        profile.phone || profile.bookingUrl || profile.website || "its website"
      } for ${businessType.urgentNeed} and related local service needs.`,
    },
  ].filter(Boolean);

  if (questions.length === 0) return null;

  return {
    "@type": "FAQPage",
    "@id": id,
    mainEntity: questions.map((question) => ({
      "@type": "Question",
      name: question.name,
      acceptedAnswer: {
        "@type": "Answer",
        text: question.text,
      },
    })),
  };
}

function buildFixedSignals(gapIds, profile, services) {
  const signals = [
    {
      id: "localbusiness",
      label: "LocalBusiness entity",
      done: Boolean(profile.name && profile.website),
    },
    {
      id: "address",
      label: "PostalAddress",
      done: Boolean(profile.address),
    },
    {
      id: "hours",
      label: "Opening hours",
      done: Boolean(profile.hours),
    },
    {
      id: "services",
      label: "Service catalog",
      done: services.length > 0,
    },
    {
      id: "qa",
      label: "FAQPage Q&A",
      done: true,
    },
    {
      id: "credential",
      label: "License or credential",
      done: Boolean(profile.credential),
    },
  ];

  return signals.map((signal) => ({
    ...signal,
    gapMatched: gapIds.includes(signal.id),
  }));
}

function buildFieldCoverage({
  profile,
  address,
  openingHoursSpecification,
  services,
  website,
}) {
  return [
    ["Name", Boolean(profile.name)],
    ["URL", Boolean(website)],
    ["Phone", Boolean(profile.phone)],
    ["Address", Boolean(address)],
    ["Market", Boolean(profile.market)],
    ["Opening hours", Boolean(profile.hours || openingHoursSpecification.length)],
    ["Service catalog", services.length > 0],
    ["Service area", Boolean(profile.serviceArea)],
    ["Booking action", Boolean(profile.bookingUrl)],
    ["Credential", Boolean(profile.credential)],
  ].map(([label, done]) => ({ label, done }));
}

function parseAddress(address, market) {
  const raw = String(address || "").trim();
  const fallbackMarket = String(market || "").trim();
  if (!raw && !fallbackMarket) return undefined;

  const parts = (raw || fallbackMarket)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const regionPart = parts.at(-1) || "";
  const regionMatch = regionPart.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);

  if (parts.length >= 3) {
    return cleanObject({
      "@type": "PostalAddress",
      streetAddress: parts.slice(0, -2).join(", "),
      addressLocality: parts.at(-2),
      addressRegion: regionMatch?.[1]?.toUpperCase() || regionPart,
      postalCode: regionMatch?.[2],
      addressCountry: "US",
    });
  }

  if (parts.length === 2) {
    return cleanObject({
      "@type": "PostalAddress",
      addressLocality: parts[0],
      addressRegion: regionMatch?.[1]?.toUpperCase() || parts[1],
      postalCode: regionMatch?.[2],
      addressCountry: "US",
    });
  }

  return cleanObject({
    "@type": "PostalAddress",
    streetAddress: raw || undefined,
    addressLocality: !raw ? fallbackMarket : undefined,
    addressCountry: "US",
  });
}

function parseOpeningHours(hours) {
  const value = String(hours || "").trim();
  if (!value) return [];

  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(parseOpeningHoursSegment)
    .filter(Boolean);
}

function parseOpeningHoursSegment(segment) {
  const normalized = segment.replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const dayMatch = normalized.match(/^([A-Za-z,\-\s]+?)\s+(.+)$/);
  if (!dayMatch) return null;

  const days = parseDays(dayMatch[1]);
  if (days.length === 0) return null;

  if (/24\s*hours?|24\/7/i.test(dayMatch[2])) {
    return {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days,
      opens: "00:00",
      closes: "23:59",
    };
  }

  const timeParts = dayMatch[2].split(/\s*-\s*/);
  if (timeParts.length !== 2) return null;
  const opens = parseTime(timeParts[0]);
  const closes = parseTime(timeParts[1]);
  if (!opens || !closes) return null;

  return {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: days,
    opens,
    closes,
  };
}

function parseDays(value) {
  const normalized = value.toLowerCase().replace(/\./g, "").trim();
  if (normalized.includes("-")) {
    const [start, end] = normalized.split("-").map((day) => day.trim());
    const startDay = dayAliases[start];
    const endDay = dayAliases[end];
    const startIndex = orderedDays.indexOf(startDay);
    const endIndex = orderedDays.indexOf(endDay);
    if (startIndex < 0 || endIndex < 0) return [];
    if (startIndex <= endIndex) return orderedDays.slice(startIndex, endIndex + 1);
    return [...orderedDays.slice(startIndex), ...orderedDays.slice(0, endIndex + 1)];
  }

  return normalized
    .split(/\s+|\/|&/)
    .map((day) => dayAliases[day])
    .filter(Boolean);
}

function parseTime(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const period = match[3]?.toUpperCase();

  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  if (hour > 23) return "";

  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function normalizeWebsite(value) {
  const website = String(value || "").trim();
  if (!website) return "";
  const withProtocol = /^https?:\/\//i.test(website)
    ? website
    : `https://${website}`;
  try {
    const url = new URL(withProtocol);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => {
        if (child === undefined || child === null || child === "") return false;
        if (Array.isArray(child) && child.length === 0) return false;
        return !(typeof child === "object" && Object.keys(child).length === 0);
      })
      .map(([key, child]) => [key, Array.isArray(child) ? child : cleanObject(child)])
  );
}

function sentenceCase(value) {
  const text = String(value || "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "";
}

function extractCity(market) {
  return String(market || "your market").split(",")[0].trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
