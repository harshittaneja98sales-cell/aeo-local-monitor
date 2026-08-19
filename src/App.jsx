import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  ClipboardList,
  Code2,
  Copy,
  Download,
  FileText,
  Globe2,
  ListChecks,
  MapPin,
  Play,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  businessTemplates,
  businessTypes,
  connectors,
  engines,
} from "./data/mockData.js";
import {
  calculateVisibilityScore,
  countPromptMentions,
  getStatusTone,
} from "./lib/scoring.js";
import { runLocalAiAudit } from "./lib/auditSimulation.js";
import { generateEntitySchemaPatch } from "./lib/schemaGenerator.js";

const tabs = [
  ["audit", "AI Audit", Bot],
  ["schema", "Schema Fix", Code2],
  ["monitoring", "Monitor", ShieldCheck],
  ["onboarding", "Onboarding", ClipboardList],
  ["overview", "Overview", CircleGauge],
  ["prompts", "Prompts", Search],
  ["listings", "Listings", MapPin],
  ["remediation", "Fix Queue", Wrench],
  ["settings", "Settings", Settings],
];

const engineIcons = {
  chatgpt: Bot,
  perplexity: Sparkles,
  gemini: Zap,
  "google-ai": Globe2,
  apple: ShieldCheck,
};

const profileFields = [
  ["name", "Business name"],
  ["category", "Category"],
  ["market", "Market"],
  ["website", "Website"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["hours", "Hours"],
  ["serviceArea", "Service area", "textarea"],
  ["services", "Core services", "textarea"],
  ["credential", "License / credential"],
  ["bookingUrl", "Booking URL"],
];

const requiredProfileFields = profileFields.map(([key]) => key);

const defaultMonitorConfig = {
  enabled: true,
  frequency: "weekly",
  alertEmail: "",
  watchHallucinations: true,
  watchCitations: true,
  watchCompetitors: true,
};

const defaultMonitorSummary = {
  total: 0,
  high: 0,
  hallucinations: 0,
  citations: 0,
  competitors: 0,
};
const AUDIT_CLIENT_TIMEOUT_MS = 35000;

function getInitialWorkspace() {
  const fallbackType = "plumbing";
  const saved = readStoredWorkspace();
  const selectedBusinessType =
    saved?.selectedBusinessType && businessTemplates[saved.selectedBusinessType]
      ? saved.selectedBusinessType
      : fallbackType;
  const templateType =
    businessTypes.find((type) => type.id === selectedBusinessType) ||
    businessTypes[0];
  const template = businessTemplates[selectedBusinessType];

  return {
    businessId: saved?.businessId || null,
    selectedBusinessType,
    profile: { ...template.business, ...saved?.profile },
    competitors: saved?.competitors || [
      templateType.competitorA,
      templateType.competitorB,
    ],
    monitoredLocations:
      saved?.monitoredLocations ||
      template.business.serviceArea
        .split(",")
        .map((location) => location.trim())
        .filter(Boolean)
        .slice(0, 4),
  };
}

function readStoredWorkspace() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("aeo-local-workspace");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function calculateSourceCompletion(profile, competitors, monitoredLocations) {
  const completedProfileFields = requiredProfileFields.filter((key) =>
    String(profile[key] || "").trim()
  ).length;
  const profileScore =
    (completedProfileFields / requiredProfileFields.length) * 78;
  const competitorScore = competitors.filter(Boolean).length >= 2 ? 12 : 0;
  const locationScore = monitoredLocations.filter(Boolean).length >= 1 ? 10 : 0;

  return Math.round(profileScore + competitorScore + locationScore);
}

function getInitialRoute() {
  if (typeof window === "undefined") return "landing";
  return window.location.hash === "#app" ? "app" : "landing";
}

function normalizeWebsiteInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.includes(".")) return `https://${raw}`;
  return raw;
}

function normalizeAuditKeyValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ");
}

function buildAuditInputKey({
  profile,
  selectedBusinessType,
  competitors,
  monitoredLocations,
}) {
  const fields = [
    "name",
    "website",
    "address",
    "market",
    "services",
    "category",
    "hours",
  ];
  return JSON.stringify({
    selectedBusinessType,
    profile: fields.reduce((summary, key) => {
      summary[key] = normalizeAuditKeyValue(profile?.[key]);
      return summary;
    }, {}),
    competitors: (competitors || []).map(normalizeAuditKeyValue).filter(Boolean),
    monitoredLocations: (monitoredLocations || [])
      .map(normalizeAuditKeyValue)
      .filter(Boolean),
  });
}

function App() {
  const [workspace, setWorkspace] = useState(getInitialWorkspace);
  const [activeTab, setActiveTab] = useState("audit");
  const [route, setRoute] = useState(getInitialRoute);
  const [scanState, setScanState] = useState("idle");
  const [auditState, setAuditState] = useState("ready");
  const [serverAuditReport, setServerAuditReport] = useState(null);
  const [auditMode, setAuditMode] = useState("local-simulation");
  const [auditNotice, setAuditNotice] = useState("");
  const [schemaPatch, setSchemaPatch] = useState(null);
  const [schemaState, setSchemaState] = useState("ready");
  const [schemaNotice, setSchemaNotice] = useState("");
  const [savedAuditRuns, setSavedAuditRuns] = useState([]);
  const [monitorConfig, setMonitorConfig] = useState(defaultMonitorConfig);
  const [monitorAlerts, setMonitorAlerts] = useState([]);
  const [monitorSummary, setMonitorSummary] = useState(defaultMonitorSummary);
  const [monitorState, setMonitorState] = useState("ready");
  const [monitorNotice, setMonitorNotice] = useState("");
  const [persistenceStatus, setPersistenceStatus] = useState({
    mode: "unknown",
    detail: "Run an audit to start building trend history.",
  });
  const [selectedTask, setSelectedTask] = useState(
    businessTemplates[workspace.selectedBusinessType].remediationTasks[0]
  );
  const selectedBusinessType = workspace.selectedBusinessType;
  const businessId = workspace.businessId;
  const profile = workspace.profile;
  const competitors = workspace.competitors;
  const monitoredLocations = workspace.monitoredLocations;
  const template = businessTemplates[selectedBusinessType];
  const graphSources = template.graphSources;
  const prompts = template.prompts;
  const remediationTasks = template.remediationTasks;
  const score = useMemo(
    () => calculateVisibilityScore(engines, graphSources, remediationTasks),
    [graphSources, remediationTasks]
  );
  const mentionCount = useMemo(() => countPromptMentions(prompts), [prompts]);
  const sourceCompletion = useMemo(
    () => calculateSourceCompletion(profile, competitors, monitoredLocations),
    [profile, competitors, monitoredLocations]
  );
  const simulatedAuditReport = useMemo(
    () =>
      runLocalAiAudit({
        profile,
        businessType: businessTypes.find(
          (type) => type.id === selectedBusinessType
        ),
        competitors,
        monitoredLocations,
        sourceCompletion,
      }),
    [
      profile,
      selectedBusinessType,
      competitors,
      monitoredLocations,
      sourceCompletion,
    ]
  );
  const currentAuditInputKey = useMemo(
    () =>
      buildAuditInputKey({
        profile,
        selectedBusinessType,
        competitors,
        monitoredLocations,
      }),
    [profile, selectedBusinessType, competitors, monitoredLocations]
  );
  const serverAuditMatchesCurrentInput =
    serverAuditReport?.auditInputKey === currentAuditInputKey;
  const auditReport = serverAuditMatchesCurrentInput
    ? serverAuditReport
    : simulatedAuditReport;

  useEffect(() => {
    function syncRoute() {
      setRoute(window.location.hash === "#app" ? "app" : "landing");
    }

    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("aeo-local-workspace", JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    if (!businessId) {
      setSavedAuditRuns([]);
      return;
    }

    let cancelled = false;
    fetch(`/api/audit-runs?businessId=${encodeURIComponent(businessId)}&limit=10`)
      .then((response) => {
        if (!response.ok) throw new Error("Audit history endpoint failed");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSavedAuditRuns(data.auditRuns || []);
        if (data.persistence) setPersistenceStatus(data.persistence);
      })
      .catch(() => {
        if (cancelled) return;
        setPersistenceStatus({
          mode: "disabled",
          detail:
            "Audit history is temporarily unavailable. New runs can still be reviewed after completion.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  useEffect(() => {
    if (!businessId) {
      setMonitorAlerts([]);
      setMonitorSummary(defaultMonitorSummary);
      return;
    }

    let cancelled = false;
    fetch(`/api/monitor?businessId=${encodeURIComponent(businessId)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Monitor endpoint failed");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMonitorConfig({ ...defaultMonitorConfig, ...(data.config || {}) });
        setMonitorAlerts(data.alerts || []);
        setMonitorSummary(data.summary || defaultMonitorSummary);
        if (data.persistence) setPersistenceStatus(data.persistence);
      })
      .catch(() => {
        if (cancelled) return;
        setMonitorNotice(
          "Monitor alerts are not available until the database is connected."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  function setProfile(nextProfile) {
    resetAuditResult();
    setWorkspace((current) => ({
      ...current,
      profile:
        typeof nextProfile === "function"
          ? nextProfile(current.profile)
          : nextProfile,
    }));
  }

  function setCompetitors(nextCompetitors) {
    resetAuditResult();
    setWorkspace((current) => ({
      ...current,
      competitors:
        typeof nextCompetitors === "function"
          ? nextCompetitors(current.competitors)
          : nextCompetitors,
    }));
  }

  function setMonitoredLocations(nextLocations) {
    resetAuditResult();
    setWorkspace((current) => ({
      ...current,
      monitoredLocations:
        typeof nextLocations === "function"
          ? nextLocations(current.monitoredLocations)
          : nextLocations,
    }));
  }

  function changeBusinessType(typeId) {
    const nextTemplate = businessTemplates[typeId];
    const nextType = businessTypes.find((type) => type.id === typeId);
    resetAuditResult();
    setWorkspace({
      businessId: null,
      selectedBusinessType: typeId,
      profile: nextTemplate.business,
      competitors: nextType ? [nextType.competitorA, nextType.competitorB] : [],
      monitoredLocations: nextTemplate.business.serviceArea
        .split(",")
        .map((location) => location.trim())
        .filter(Boolean)
        .slice(0, 4),
    });
    setSelectedTask(nextTemplate.remediationTasks[0]);
    setScanState("idle");
    setAuditState("ready");
  }

  function resetAuditResult() {
    setServerAuditReport(null);
    setAuditMode("local-simulation");
    setAuditNotice("");
    setSchemaPatch(null);
    setSchemaState("ready");
    setSchemaNotice("");
    setAuditState((current) => (current === "running" ? current : "ready"));
  }

  function runScan() {
    if (scanState === "running") return;
    setScanState("running");
    window.setTimeout(() => setScanState("complete"), 1400);
  }

  async function runAudit() {
    if (auditState === "running") return;
    const requestAuditInputKey = currentAuditInputKey;
    const payload = buildServerPayload();
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      AUDIT_CLIENT_TIMEOUT_MS
    );
    setAuditState("running");
    setAuditMode("server-running");
    setServerAuditReport(null);
    setAuditNotice("Crawling the website and checking live AI search results.");

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Audit endpoint returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.audit) {
        throw new Error("Audit endpoint returned an empty payload");
      }

      setServerAuditReport({
        ...data.audit,
        auditInputKey: requestAuditInputKey,
      });
      setAuditMode(data.audit.mode || data.mode || "server");
      setAuditNotice(getAuditModeNotice(data.audit.mode || data.mode));
      if (data.persistence) setPersistenceStatus(data.persistence);
      if (data.business?.id) {
        setWorkspace((current) => ({
          ...current,
          businessId: data.business.id,
        }));
      }
      if (data.auditRun) {
        setSavedAuditRuns((current) =>
          [
            data.auditRun,
            ...current.filter((run) => run.id !== data.auditRun.id),
          ].slice(0, 10)
        );
      }
    } catch (error) {
      setAuditMode("local-simulation");
      setAuditNotice(
        `${getAuditErrorMessage(error)} Showing local simulation data instead.`
      );
      setPersistenceStatus({
        mode: "disabled",
        detail:
          "Audit history is temporarily unavailable. New runs can still be reviewed after completion.",
      });
    } finally {
      window.clearTimeout(timeout);
      setAuditState("complete");
    }
  }

  async function runSchemaGenerator() {
    if (schemaState === "running") return;
    setSchemaState("running");
    setSchemaNotice("");

    const businessType = businessTypes.find(
      (type) => type.id === selectedBusinessType
    );

    try {
      const response = await fetch("/api/schema", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile,
          businessId,
          businessType,
          competitors,
          monitoredLocations,
          sourceCompletion,
          auditReport,
        }),
      });

      if (!response.ok) {
        throw new Error(`Schema endpoint returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.schemaPatch) {
        throw new Error("Schema endpoint returned an empty payload");
      }

      setSchemaPatch(data.schemaPatch);
      if (data.persistence) setPersistenceStatus(data.persistence);
      if (data.business?.id) {
        setWorkspace((current) => ({
          ...current,
          businessId: data.business.id,
        }));
      }
      setSchemaNotice(
        data.savedPatch
          ? "Schema fix saved to the business record."
          : "Schema fix generated. Connect the database to save patch history."
      );
    } catch {
      setSchemaPatch(
        generateEntitySchemaPatch({
          profile,
          businessType,
          auditReport,
        })
      );
      setSchemaNotice(
        "Schema fix generated locally because the server endpoint is unavailable."
      );
    } finally {
      setSchemaState("complete");
    }
  }

  function buildServerPayload(extra = {}) {
    return {
      profile,
      businessId,
      businessType: businessTypes.find(
        (type) => type.id === selectedBusinessType
      ),
      selectedBusinessType,
      competitors,
      monitoredLocations,
      sourceCompletion,
      ...extra,
    };
  }

  async function saveMonitorConfig(nextConfig = monitorConfig) {
    setMonitorState("saving");
    setMonitorNotice("");

    try {
      const response = await fetch("/api/monitor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildServerPayload({ config: nextConfig })),
      });

      if (!response.ok) {
        throw new Error(`Monitor endpoint returned HTTP ${response.status}`);
      }

      const data = await response.json();
      setMonitorConfig({ ...defaultMonitorConfig, ...(data.config || {}) });
      setMonitorAlerts(data.alerts || []);
      setMonitorSummary(data.summary || defaultMonitorSummary);
      if (data.persistence) setPersistenceStatus(data.persistence);
      if (data.business?.id) {
        setWorkspace((current) => ({
          ...current,
          businessId: data.business.id,
        }));
      }
      setMonitorNotice("Monitoring settings saved.");
    } catch {
      setMonitorNotice("Monitoring settings could not be saved.");
    } finally {
      setMonitorState("ready");
    }
  }

  async function runContinuousMonitor() {
    if (monitorState === "running") return;
    const requestAuditInputKey = currentAuditInputKey;
    setMonitorState("running");
    setMonitorNotice("");

    try {
      const response = await fetch("/api/monitor-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildServerPayload({ monitorConfig, monitorRun: true })
        ),
      });

      if (!response.ok) {
        throw new Error(`Monitor run returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.detail || data.error);
      }

      setServerAuditReport({
        ...data.audit,
        auditInputKey: requestAuditInputKey,
      });
      setAuditMode(data.audit?.mode || "server");
      setAuditNotice(getAuditModeNotice(data.audit?.mode));
      setMonitorConfig({ ...defaultMonitorConfig, ...(data.config || {}) });
      setMonitorAlerts(data.alerts || []);
      setMonitorSummary(data.summary || defaultMonitorSummary);
      if (data.persistence) setPersistenceStatus(data.persistence);
      if (data.business?.id) {
        setWorkspace((current) => ({
          ...current,
          businessId: data.business.id,
        }));
      }
      if (data.auditRun) {
        setSavedAuditRuns((current) =>
          [
            data.auditRun,
            ...current.filter((run) => run.id !== data.auditRun.id),
          ].slice(0, 10)
        );
      }
      setAuditState("complete");
      setMonitorNotice(
        data.alerts?.length
          ? `${data.alerts.length} monitoring alert${data.alerts.length === 1 ? "" : "s"} detected.`
          : "Monitoring run complete. No active alerts detected."
      );
    } catch (error) {
      setMonitorNotice(
        error instanceof Error
          ? error.message
          : "Monitoring run could not be completed."
      );
    } finally {
      setMonitorState("ready");
    }
  }

  function openProduct(tab = "audit", seed = {}) {
    const businessInput = String(seed.businessInput || "").trim();
    const marketInput = String(seed.marketInput || "").trim();

    setActiveTab(tab);
    if (businessInput || marketInput) {
      resetAuditResult();
      setWorkspace((current) => {
        const nextProfile = { ...current.profile };

        if (businessInput) {
          const looksLikeWebsite =
            /^https?:\/\//i.test(businessInput) ||
            /^[^\s]+\.[^\s]+$/.test(businessInput);

          if (looksLikeWebsite) {
            nextProfile.website = /^https?:\/\//i.test(businessInput)
              ? businessInput
              : `https://${businessInput}`;
          } else {
            nextProfile.name = businessInput;
          }
        }

        if (marketInput) {
          nextProfile.market = marketInput;
        }

        return {
          ...current,
          businessId: null,
          profile: nextProfile,
        };
      });
    }

    setRoute("app");
    if (window.location.hash !== "#app") {
      window.location.hash = "app";
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function showLanding() {
    setRoute("landing");
    window.history.pushState("", document.title, window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openRemediationForTask(task) {
    setActiveTab(isSchemaRemediationTask(task) ? "schema" : "remediation");
    setSelectedTask(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (route === "landing") {
    return <LandingPage onOpenApp={openProduct} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Activity size={20} />
          </div>
          <div>
            <strong>AEO Local</strong>
            <span>Monitor</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              className={activeTab === id ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="dot good" />
          <div>
            <strong>Monitor online</strong>
            <span>Next run 06:00 local</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local AI visibility</p>
            <h1>{profile.name}</h1>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" onClick={showLanding}>
              <Globe2 size={17} />
              <span>Landing</span>
            </button>
            <label className="type-select">
              <span>Business type</span>
              <select
                value={selectedBusinessType}
                onChange={(event) => changeBusinessType(event.target.value)}
              >
                {businessTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button" title="Sync integrations">
              <RefreshCw size={18} />
            </button>
            <button className="primary-button" onClick={runScan}>
              {scanState === "running" ? (
                <RefreshCw className="spin" size={17} />
              ) : (
                <Play size={17} />
              )}
              <span>{scanState === "running" ? "Running" : "Run monitor"}</span>
            </button>
          </div>
        </header>

        <section className="context-strip">
          <InfoPill icon={Building2} label={profile.businessType} />
          <InfoPill icon={Building2} label={profile.category} />
          <InfoPill icon={MapPin} label={profile.market} />
          <InfoPill icon={Globe2} label={profile.website} />
          <InfoPill icon={Clock3} label={profile.hours} />
        </section>

        {activeTab === "overview" && (
          <Overview
            score={score}
            mentionCount={mentionCount}
            scanState={scanState}
            sourceCompletion={sourceCompletion}
            graphSources={graphSources}
            remediationTasks={remediationTasks}
            onSelectTask={setSelectedTask}
          />
        )}
        {activeTab === "audit" && (
          <AiAudit
            profile={profile}
            setProfile={setProfile}
            selectedBusinessType={selectedBusinessType}
            businessTypes={businessTypes}
            onBusinessTypeChange={changeBusinessType}
            auditReport={auditReport}
            auditState={auditState}
            auditMode={auditMode}
            auditNotice={auditNotice}
            savedAuditRuns={savedAuditRuns}
            persistenceStatus={persistenceStatus}
            businessId={businessId}
            sourceCompletion={sourceCompletion}
            onRunAudit={runAudit}
          />
        )}
        {activeTab === "schema" && (
          <SchemaFix
            profile={profile}
            selectedBusinessType={selectedBusinessType}
            businessTypes={businessTypes}
            auditReport={auditReport}
            auditState={auditState}
            schemaPatch={schemaPatch}
            schemaState={schemaState}
            schemaNotice={schemaNotice}
            persistenceStatus={persistenceStatus}
            onGenerateSchema={runSchemaGenerator}
          />
        )}
        {activeTab === "monitoring" && (
          <ContinuousMonitor
            profile={profile}
            businessId={businessId}
            monitorConfig={monitorConfig}
            setMonitorConfig={setMonitorConfig}
            monitorAlerts={monitorAlerts}
            monitorSummary={monitorSummary}
            monitorState={monitorState}
            monitorNotice={monitorNotice}
            persistenceStatus={persistenceStatus}
            auditMode={auditReport.mode || auditMode}
            providerStatus={auditReport.providerStatus || []}
            onSaveConfig={saveMonitorConfig}
            onRunMonitor={runContinuousMonitor}
          />
        )}
        {activeTab === "onboarding" && (
          <Onboarding
            profile={profile}
            setProfile={setProfile}
            businessTypes={businessTypes}
            selectedBusinessType={selectedBusinessType}
            onBusinessTypeChange={changeBusinessType}
            competitors={competitors}
            setCompetitors={setCompetitors}
            monitoredLocations={monitoredLocations}
            setMonitoredLocations={setMonitoredLocations}
            sourceCompletion={sourceCompletion}
            onFinish={() => setActiveTab("overview")}
          />
        )}
        {activeTab === "prompts" && <PromptMonitor prompts={prompts} />}
        {activeTab === "listings" && <ListingAudit graphSources={graphSources} />}
        {activeTab === "remediation" && (
          <RemediationQueue
            remediationTasks={remediationTasks}
            onSelectTask={setSelectedTask}
          />
        )}
        {activeTab === "settings" && (
          <SettingsPanel
            profile={profile}
            setProfile={setProfile}
            businessTypes={businessTypes}
            selectedBusinessType={selectedBusinessType}
            onBusinessTypeChange={changeBusinessType}
          />
        )}
      </main>

      <TaskDrawer
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onOpenRemediation={openRemediationForTask}
      />
    </div>
  );
}

function LandingPage({ onOpenApp }) {
  const [businessInput, setBusinessInput] = useState("");
  const [marketInput, setMarketInput] = useState("");

  function submitAudit(event) {
    event.preventDefault();
    onOpenApp("audit", { businessInput, marketInput });
  }

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <button className="landing-brand" onClick={() => onOpenApp("audit")}>
          <span className="brand-mark">
            <Activity size={20} />
          </span>
          <span>
            <strong>AEO Local</strong>
            <small>Monitor</small>
          </span>
        </button>
        <nav aria-label="Landing navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <button className="secondary-button" onClick={() => onOpenApp("audit")}>
            <Bot size={17} />
            <span>Open demo</span>
          </button>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <HeroProductVisual />
          <div className="hero-scrim" />
          <div className="landing-container hero-content">
            <div className="hero-copy">
              <span className="hero-badge">
                New GEO monitoring for local businesses
              </span>
              <h1>AEO Local Monitor</h1>
              <p>
                Find out whether ChatGPT, Perplexity, Gemini, and Google AI
                answers recommend your business or send ready-to-buy local
                customers to competitors.
              </p>
              <div className="hero-actions">
                <button
                  className="primary-button hero-primary"
                  onClick={() => onOpenApp("audit")}
                >
                  <Search size={18} />
                  <span>Run local AI audit</span>
                </button>
                <button
                  className="secondary-button hero-secondary"
                  onClick={() => onOpenApp("schema")}
                >
                  <Code2 size={18} />
                  <span>See 1-click schema fix</span>
                </button>
              </div>
            </div>

            <form className="hero-audit-box" onSubmit={submitAudit}>
              <div>
                <p className="eyebrow">Free instant scan</p>
                <h2>Check your business AI visibility score</h2>
              </div>
              <label>
                <span>Business name or website</span>
                <input
                  value={businessInput}
                  onChange={(event) => setBusinessInput(event.target.value)}
                  placeholder="choiceplumbingorlando.com"
                />
              </label>
              <label>
                <span>City / state</span>
                <input
                  value={marketInput}
                  onChange={(event) => setMarketInput(event.target.value)}
                  placeholder="Orlando, FL"
                />
              </label>
              <button className="primary-button" type="submit">
                <Zap size={18} />
                <span>Run free discovery audit</span>
              </button>
              <small>
                No credit card required. Tests high-intent local prompts and
                opens the live product workspace.
              </small>
            </form>
          </div>
        </section>

        <section className="landing-proof">
          <div className="landing-container proof-grid">
            <LandingStat value="4" label="AI answer engines simulated" />
            <LandingStat value="1-click" label="JSON-LD schema generation" />
            <LandingStat value="0 code" label="Copy, validate, and install flow" />
            <LandingStat value="Saved" label="Audit history and trends" />
          </div>
        </section>

        <section className="landing-section problem-section">
          <div className="landing-container split-section">
            <div>
              <p className="eyebrow">The problem</p>
              <h2>The way customers find local services has changed.</h2>
              <p>
                Local buyers now ask answer engines direct questions like
                &quot;best emergency plumber near me open now&quot; or
                &quot;which cosmetic dentist has same-day appointments?&quot;
                They often trust the one or two businesses named in the answer.
              </p>
            </div>
            <div className="problem-list">
              <LandingFeature
                icon={Search}
                title="You may be invisible"
                text="AI engines can skip a real business when the website lacks machine-readable local entity data."
              />
              <LandingFeature
                icon={AlertTriangle}
                title="Answers can be wrong"
                text="Outdated hours, missing service pages, and weak citations can create hallucinated recommendations."
              />
              <LandingFeature
                icon={ArrowUpRight}
                title="Competitors get the call"
                text="If another business is easier to parse and cite, the lead may never reach your website."
              />
            </div>
          </div>
        </section>

        <section className="landing-section" id="how-it-works">
          <div className="landing-container">
            <div className="section-heading">
              <p className="eyebrow">How it works</p>
              <h2>From invisible to AI-ready in three steps.</h2>
            </div>
            <div className="step-grid">
              <LandingStep
                number="01"
                icon={Bot}
                title="Run the AI visibility audit"
                text="Simulate hyper-local buying prompts across ChatGPT-style search, Perplexity, Gemini, and Google AI Overview patterns."
              />
              <LandingStep
                number="02"
                icon={Code2}
                title="Generate the entity schema"
                text="Create LocalBusiness JSON-LD with services, areas served, opening hours, sameAs links, FAQ blocks, and crawlable entity context."
              />
              <LandingStep
                number="03"
                icon={ListChecks}
                title="Save every run and fix"
                text="Track audit history, schema patches, competitor mentions, citations, and remediation tasks in one workspace."
              />
            </div>
          </div>
        </section>

        <section className="landing-section product-section">
          <div className="landing-container split-section product-split">
            <div>
              <p className="eyebrow">Built for paid local SaaS</p>
              <h2>Give owners a clear reason to pay: show the gap, then fix it.</h2>
              <p>
                The product is designed around a direct before-and-after
                workflow: audit their AI visibility, identify why the business
                is missing, generate a schema patch, and keep monitoring for
                competitor movement.
              </p>
              <div className="feature-list">
                <span>
                  <CheckCircle2 size={17} /> AI share-of-voice scoring
                </span>
                <span>
                  <CheckCircle2 size={17} /> Direct citation tracking
                </span>
                <span>
                  <CheckCircle2 size={17} /> Entity gap detection
                </span>
                <span>
                  <CheckCircle2 size={17} /> Saved audit and patch history
                </span>
              </div>
            </div>
            <div className="comparison-panel">
              <div className="comparison-row comparison-head">
                <strong>Capability</strong>
                <strong>Traditional SEO</strong>
                <strong>AEO Local</strong>
              </div>
              <ComparisonRow label="Tracks AI answers" oldValue="No" newValue="Yes" />
              <ComparisonRow label="Detects hallucinations" oldValue="Manual" newValue="Automated" />
              <ComparisonRow label="Builds LocalBusiness schema" oldValue="Developer" newValue="1-click" />
              <ComparisonRow label="Shows competitors recommended instead" oldValue="Limited" newValue="Included" />
            </div>
          </div>
        </section>

        <section className="landing-section pricing-section" id="pricing">
          <div className="landing-container">
            <div className="section-heading">
              <p className="eyebrow">Pricing</p>
              <h2>Simple plans for local businesses and agencies.</h2>
            </div>
            <div className="pricing-grid">
              <PricingCard
                name="Starter"
                price="$49"
                description="For one local business location."
                features={[
                  "Weekly AI visibility audit",
                  "1-click JSON-LD generator",
                  "Citation and mention score",
                  "Email support",
                ]}
                onClick={() => onOpenApp("audit")}
              />
              <PricingCard
                name="Growth"
                price="$99"
                description="For high-value local services and clinics."
                badge="Most popular"
                features={[
                  "Daily prompt simulation",
                  "Up to 3 locations",
                  "Competitor incursion tracking",
                  "Schema patch history",
                ]}
                onClick={() => onOpenApp("audit")}
              />
              <PricingCard
                name="Agency"
                price="$249"
                description="For agencies and multi-location operators."
                features={[
                  "Up to 10 locations",
                  "White-label report workflow",
                  "Team dashboard",
                  "Priority support",
                ]}
                onClick={() => onOpenApp("audit")}
              />
            </div>
          </div>
        </section>

        <section className="landing-section faq-section" id="faq">
          <div className="landing-container faq-grid">
            <div>
              <p className="eyebrow">FAQ</p>
              <h2>Questions local owners ask before they try it.</h2>
            </div>
            <div className="faq-list">
              <FaqItem
                question="Does this replace Google Business Profile or SEO?"
                answer="No. It strengthens them by making your business easier for AI engines to parse, cite, and compare against local competitors."
              />
              <FaqItem
                question="Do customers need a developer?"
                answer="No. The schema generator creates a copy-ready JSON-LD block with installation steps for common website platforms."
              />
              <FaqItem
                question="Is the product live?"
                answer="Yes. The app is live, and completed audits, schema fixes, and monitoring history are saved for each business."
              />
            </div>
          </div>
        </section>

        <section className="landing-final">
          <div className="landing-container final-cta">
            <div>
              <p className="eyebrow">Start with the audit</p>
              <h2>Do not let AI answers send your best local leads elsewhere.</h2>
              <p>
                Run the live workspace, check the gaps, then generate the first
                entity schema fix.
              </p>
            </div>
            <button className="primary-button" onClick={() => onOpenApp("audit")}>
              <Search size={18} />
              <span>Run my AI audit now</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function HeroProductVisual() {
  const rows = [
    ["ChatGPT", "Mentioned", "82%"],
    ["Perplexity", "Cited", "76%"],
    ["Gemini", "Gap found", "51%"],
    ["Google AI", "Competitor", "44%"],
  ];

  return (
    <div className="hero-product-stage" aria-hidden="true">
      <div className="hero-dashboard-shot">
        <div className="shot-sidebar">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="shot-main">
          <div className="shot-top">
            <span />
            <span />
          </div>
          <div className="shot-score-row">
            <div>
              <strong>AI Share of Voice</strong>
              <b>68%</b>
            </div>
            <div>
              <strong>Direct Citations</strong>
              <b>41%</b>
            </div>
            <div>
              <strong>Entity Baseline</strong>
              <b>72%</b>
            </div>
          </div>
          <div className="shot-matrix">
            {rows.map(([engine, status, width]) => (
              <div className="shot-row" key={engine}>
                <span>{engine}</span>
                <small>{status}</small>
                <i style={{ "--bar": width }} />
              </div>
            ))}
          </div>
        </div>
        <div className="shot-drawer">
          <span>Schema fix</span>
          <strong>LocalBusiness JSON-LD</strong>
          <small>Ready to copy</small>
        </div>
      </div>
    </div>
  );
}

function LandingStat({ value, label }) {
  return (
    <div className="landing-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function LandingFeature({ icon: Icon, title, text }) {
  return (
    <article className="landing-feature">
      <Icon size={20} />
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </article>
  );
}

function LandingStep({ number, icon: Icon, title, text }) {
  return (
    <article className="landing-step">
      <div className="step-topline">
        <span>{number}</span>
        <Icon size={22} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function ComparisonRow({ label, oldValue, newValue }) {
  return (
    <div className="comparison-row">
      <span>{label}</span>
      <span>{oldValue}</span>
      <strong>{newValue}</strong>
    </div>
  );
}

function PricingCard({ name, price, description, features, badge, onClick }) {
  return (
    <article className={badge ? "pricing-card featured" : "pricing-card"}>
      {badge && <span className="pricing-badge">{badge}</span>}
      <h3>{name}</h3>
      <p>{description}</p>
      <div className="price-line">
        <strong>{price}</strong>
        <span>/ month</span>
      </div>
      <ul>
        {features.map((feature) => (
          <li key={feature}>
            <CheckCircle2 size={16} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button className="primary-button" onClick={onClick}>
        <Play size={17} />
        <span>Start 7-day trial</span>
      </button>
    </article>
  );
}

function FaqItem({ question, answer }) {
  return (
    <article className="faq-item">
      <h3>{question}</h3>
      <p>{answer}</p>
    </article>
  );
}

function Overview({
  score,
  mentionCount,
  scanState,
  sourceCompletion,
  graphSources,
  remediationTasks,
  onSelectTask,
}) {
  const tone = getStatusTone(score);

  return (
    <div className="dashboard-grid">
      <section className="panel score-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Visibility score</p>
            <h2>{score}</h2>
          </div>
          <span className={`score-badge ${tone}`}>{tone}</span>
        </div>
        <div className="score-ring" style={{ "--score": `${score}%` }}>
          <div>
            <strong>{score}%</strong>
            <span>AI + Local</span>
          </div>
        </div>
        <div className="metric-row">
          <Metric label="Prompt mentions" value={mentionCount} />
          <Metric label="Open fixes" value={remediationTasks.length} />
          <Metric label="Source truth" value={`${sourceCompletion}%`} />
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Engine coverage</p>
            <h2>Answer visibility by platform</h2>
          </div>
          <span className="quiet-status">24 prompts</span>
        </div>
        <EngineMatrix />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Remediation</p>
            <h2>Highest impact fixes</h2>
          </div>
          <ListChecks size={19} />
        </div>
        <div className="task-stack">
          {remediationTasks.slice(0, 3).map((task) => (
            <button
              className="task-row"
              key={task.id}
              onClick={() => onSelectTask(task)}
            >
              <span className={`severity ${task.severity.toLowerCase()}`}>
                {task.severity}
              </span>
              <strong>{task.title}</strong>
              <small>{task.impact}</small>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Knowledge graph health</p>
            <h2>Local listing consistency</h2>
          </div>
          <MapPin size={19} />
        </div>
        <GraphSummary graphSources={graphSources} />
      </section>
    </div>
  );
}

function getAuditModeLabel(mode) {
  if (mode === "server-running") return "Live audit running";
  if (mode === "openrouter-web-search") return "Live OpenRouter";
  if (mode === "openai-web-search") return "Live OpenAI";
  if (mode === "openai-error-fallback") return "OpenAI fallback";
  if (mode === "live-provider-error-fallback") return "Provider fallback";
  if (mode === "server-crawler-simulation") return "Crawler + simulator";
  return "Local simulator";
}

function getAuditModeNotice(mode) {
  if (mode === "server-running") {
    return "The server is crawling the brand website and checking live AI search results.";
  }
  if (mode === "openrouter-web-search") {
    return "ChatGPT-style rows are using live OpenRouter web-search output; the remaining providers are still modeled.";
  }
  if (mode === "openai-web-search") {
    return "ChatGPT with Search rows are using live OpenAI web-search output; the remaining providers are still modeled.";
  }
  if (mode === "live-provider-error-fallback") {
    return "A live provider was configured, but the request failed, so this run used fallback scoring.";
  }
  if (mode === "server-crawler-simulation") {
    return "The server crawled the brand website, but no live provider key is configured, so provider answers are simulated.";
  }
  if (mode === "openai-error-fallback") {
    return "OpenAI is configured, but the provider request failed, so this run used fallback scoring.";
  }
  return "This run is using deterministic local simulation data.";
}

function getAuditErrorMessage(error) {
  if (error?.name === "AbortError") {
    return "Live audit timed out after 35 seconds.";
  }
  return `Live audit endpoint failed: ${
    error instanceof Error ? error.message : "Unknown error"
  }.`;
}

function getMonitorAlertTypeLabel(type) {
  const labels = {
    citation_gap: "Citation gap",
    third_party_citation: "Citation drift",
    hallucinated_phone: "Wrong phone",
    hallucinated_hours: "Wrong hours",
    hours_source_gap: "Hours risk",
    competitor_incursion: "Competitor",
    competitor_overtake: "Overtake",
    competitor_share_jump: "Share jump",
    rank_drop: "Rank drop",
  };
  return labels[type] || "Monitor alert";
}

function isLiveProviderResult(result) {
  return ["live-openrouter-web-search", "live-openai-web-search"].includes(
    result.providerMode
  );
}

function isProviderFallbackResult(result) {
  return result.providerMode === "live-provider-prompt-fallback";
}

function getResultProviderLabel(result) {
  if (isLiveProviderResult(result)) return "Live";
  if (isProviderFallbackResult(result)) return "Fallback";
  return "Modeled";
}

function getResultProviderClass(result) {
  if (isLiveProviderResult(result)) return "live";
  if (isProviderFallbackResult(result)) return "fallback";
  return "modeled";
}

function getResultStatusClass(result) {
  if (result.mentioned && result.cited) return "cited";
  if (result.mentioned) return "mentioned";
  return "missed";
}

function getResultChipClass(result) {
  return `result-chip ${getResultStatusClass(result)} ${getResultProviderClass(
    result
  )}`;
}

function getEngineDisplayName(name) {
  return String(name || "").replace("Google AI Overviews", "Google AI");
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getWebsiteScanLabel(scan) {
  if (!scan) return "Not run";
  if (scan.status === "scanned") return `${scan.pagesScanned} pages scanned`;
  if (scan.status === "failed") return "Crawl failed";
  return "Website missing";
}

function ContinuousMonitor({
  profile,
  businessId,
  monitorConfig,
  setMonitorConfig,
  monitorAlerts,
  monitorSummary,
  monitorState,
  monitorNotice,
  persistenceStatus,
  auditMode,
  providerStatus,
  onSaveConfig,
  onRunMonitor,
}) {
  const running = monitorState === "running";
  const saving = monitorState === "saving";
  const lastRun = monitorConfig.lastRunAt
    ? formatDateTime(monitorConfig.lastRunAt)
    : "Not run yet";
  const nextRun = monitorConfig.nextRunAt
    ? formatDateTime(monitorConfig.nextRunAt)
    : "After first monitor run";

  function updateConfig(patch) {
    setMonitorConfig((current) => ({ ...current, ...patch }));
  }

  return (
    <div className="monitor-workspace">
      <section className="panel monitor-control">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Feature 3</p>
            <h2>Continuous AI Hallucination & Citation Monitoring</h2>
          </div>
          <span
            className={
              monitorConfig.enabled
                ? "status-chip database-ready"
                : "status-chip"
            }
          >
            {monitorConfig.enabled ? "Monitoring on" : "Paused"}
          </span>
        </div>

        <div className="monitor-action-row">
          <div className="monitor-context">
            <InfoPill icon={Building2} label={profile.name || "Business"} />
            <InfoPill icon={Clock3} label={`Last run: ${lastRun}`} />
            <InfoPill icon={RefreshCw} label={`Next: ${nextRun}`} />
            <InfoPill icon={ShieldCheck} label={getAuditModeLabel(auditMode)} />
          </div>
          <div className="schema-button-row">
            <button
              className="secondary-button"
              onClick={() => onSaveConfig(monitorConfig)}
              disabled={saving || running}
            >
              {saving ? <RefreshCw className="spin" size={16} /> : <CheckCircle2 size={16} />}
              <span>{saving ? "Saving" : "Save settings"}</span>
            </button>
            <button
              className="primary-button"
              onClick={onRunMonitor}
              disabled={running}
            >
              {running ? <RefreshCw className="spin" size={17} /> : <Play size={17} />}
              <span>{running ? "Running monitor" : "Run monitor now"}</span>
            </button>
          </div>
        </div>

        <div className="monitor-config-grid">
          <label>
            <span>Schedule</span>
            <select
              value={monitorConfig.frequency}
              onChange={(event) => updateConfig({ frequency: event.target.value })}
            >
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </label>
          <label>
            <span>Alert email</span>
            <input
              value={monitorConfig.alertEmail || ""}
              placeholder="owner@example.com"
              onChange={(event) => updateConfig({ alertEmail: event.target.value })}
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={monitorConfig.enabled}
              onChange={(event) => updateConfig({ enabled: event.target.checked })}
            />
            <span>Enable automated re-scans</span>
          </label>
        </div>

        <div className="monitor-watch-grid">
          <MonitorToggle
            label="Hallucination alerts"
            checked={monitorConfig.watchHallucinations}
            onChange={(checked) => updateConfig({ watchHallucinations: checked })}
          />
          <MonitorToggle
            label="Citation loss alerts"
            checked={monitorConfig.watchCitations}
            onChange={(checked) => updateConfig({ watchCitations: checked })}
          />
          <MonitorToggle
            label="Competitor incursion alerts"
            checked={monitorConfig.watchCompetitors}
            onChange={(checked) => updateConfig({ watchCompetitors: checked })}
          />
        </div>
      </section>

      <section className="monitor-summary-grid">
        <AuditMetric
          label="Active alerts"
          value={monitorSummary.total}
          detail={businessId ? "Stored for this business" : "Run monitor to create business"}
        />
        <AuditMetric
          label="Hallucinations"
          value={monitorSummary.hallucinations}
          detail="Wrong hours, phone, or source facts"
        />
        <AuditMetric
          label="Citation issues"
          value={monitorSummary.citations}
          detail="Missing or third-party citations"
        />
        <AuditMetric
          label="Competitor alerts"
          value={monitorSummary.competitors}
          detail="Overtakes and share jumps"
        />
      </section>

      {monitorNotice && <p className="monitor-notice">{monitorNotice}</p>}

      <section className="monitor-split">
        <div className="panel monitor-alerts-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Alert inbox</p>
              <h2>Hallucination, citation, and competitor alerts</h2>
            </div>
            <span className="status-chip">{monitorSummary.high} high</span>
          </div>

          <div className="monitor-alert-list">
            {monitorAlerts.length === 0 ? (
              <div className="empty-state">
                <ShieldCheck size={22} />
                <strong>No active alerts yet</strong>
                <span>
                  Run the monitor after an audit to start tracking changes.
                </span>
              </div>
            ) : (
              monitorAlerts.map((alert) => (
                <article
                  className={`monitor-alert-card ${alert.severity.toLowerCase()}`}
                  key={alert.id || alert.fingerprint}
                >
                  <div>
                    <span className={`severity ${alert.severity.toLowerCase()}`}>
                      {alert.severity}
                    </span>
                    <span className="intent-chip">
                      {getMonitorAlertTypeLabel(alert.type)}
                    </span>
                  </div>
                  <h3>{alert.title}</h3>
                  <p>{alert.detail}</p>
                  <dl className="alert-meta-grid">
                    <div>
                      <dt>Provider</dt>
                      <dd>{alert.provider || "Monitor"}</dd>
                    </div>
                    <div>
                      <dt>Prompt</dt>
                      <dd>{alert.prompt || "Prompt set"}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{formatDateTime(alert.lastSeenAt || alert.createdAt)}</dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Retention driver</p>
              <h2>What the monitor watches</h2>
            </div>
            <ListChecks size={19} />
          </div>
          <div className="monitor-watch-list">
            <ScanCheck
              label="Weekly automated AI re-scans"
              done={monitorConfig.enabled}
            />
            <ScanCheck
              label="Incorrect hours, phone, or fact mentions"
              done={monitorConfig.watchHallucinations}
            />
            <ScanCheck
              label="Missing owned-source citations"
              done={monitorConfig.watchCitations}
            />
            <ScanCheck
              label="Competitor overtakes on local prompts"
              done={monitorConfig.watchCompetitors}
            />
          </div>
          <div className="provider-status-list">
            {providerStatus.length === 0 ? (
              <p className="quiet-status">
                Run a monitor pass to capture provider status.
              </p>
            ) : (
              providerStatus.map((provider) => (
                <div className="provider-status-row" key={provider.provider}>
                  <strong>{provider.provider}</strong>
                  <span>{provider.status}</span>
                </div>
              ))
            )}
          </div>
          <p className="quiet-status">
            {persistenceStatus.mode === "database"
              ? "Alerts are saved and reused between sessions."
              : "Alert history will appear after the monitor saves its first run."}
          </p>
        </div>
      </section>
    </div>
  );
}

function MonitorToggle({ label, checked, onChange }) {
  return (
    <label className="toggle-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SchemaFix({
  profile,
  selectedBusinessType,
  businessTypes,
  auditReport,
  auditState,
  schemaPatch,
  schemaState,
  schemaNotice,
  persistenceStatus,
  onGenerateSchema,
}) {
  const [copiedTarget, setCopiedTarget] = useState("");
  const businessType = businessTypes.find(
    (type) => type.id === selectedBusinessType
  );
  const generatedPatch =
    schemaPatch ||
    generateEntitySchemaPatch({
      profile,
      businessType,
      auditReport,
    });
  const missingGaps = auditReport.entityGaps.filter((gap) =>
    ["website-localbusiness-schema", "website-opening-hours-schema", "website-faq-schema", "services", "qa", "hours"].includes(
      gap.id
    )
  );
  const running = schemaState === "running";

  async function copyText(label, value) {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopiedTarget(label);
    window.setTimeout(() => setCopiedTarget(""), 1600);
  }

  function downloadSchema() {
    const blob = new Blob(
      [JSON.stringify(generatedPatch.schemaJson, null, 2)],
      { type: "application/ld+json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugForFile(profile.name || "local-business")}-schema.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="schema-workspace">
      <section className="panel schema-control">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Feature 2</p>
            <h2>1-click JSON-LD & Entity Schema Generator</h2>
          </div>
          <span
            className={
              persistenceStatus.mode === "database"
                ? "status-chip database-ready"
                : "status-chip"
            }
          >
            {persistenceStatus.mode === "database" ? "Saves enabled" : "Ready"}
          </span>
        </div>

        <div className="schema-action-row">
          <div className="schema-context">
            <InfoPill icon={Building2} label={profile.name || "Business"} />
            <InfoPill icon={Globe2} label={profile.website || "Website missing"} />
            <InfoPill icon={MapPin} label={profile.market || "Market missing"} />
            <InfoPill
              icon={Code2}
              label={`${generatedPatch.schemaType} JSON-LD`}
            />
          </div>
          <button className="primary-button" onClick={onGenerateSchema}>
            {running ? <RefreshCw className="spin" size={17} /> : <Code2 size={17} />}
            <span>{running ? "Generating" : "Generate schema fix"}</span>
          </button>
        </div>
      </section>

      <section className="schema-summary-grid">
        <AuditMetric
          label="Entity type"
          value={generatedPatch.schemaType}
          detail="Most specific local business type"
        />
        <AuditMetric
          label="Fields covered"
          value={`${generatedPatch.fieldCoverage.filter((field) => field.done).length}/${generatedPatch.fieldCoverage.length}`}
          detail="Profile fields included in JSON-LD"
        />
        <AuditMetric
          label="Audit gaps"
          value={missingGaps.length}
          detail={auditState === "complete" ? "Schema-related gaps detected" : "Run audit for live gaps"}
        />
        <AuditMetric
          label="Install path"
          value="No-code"
          detail="Copy, download, or install through CMS settings"
        />
      </section>

      {schemaNotice && <p className="schema-notice">{schemaNotice}</p>}

      <section className="schema-split">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Entity package</p>
              <h2>Signals fixed</h2>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="schema-check-grid">
            {generatedPatch.fixedSignals.map((signal) => (
              <ScanCheck key={signal.id} label={signal.label} done={signal.done} />
            ))}
          </div>

          <div className="schema-install-list">
            {generatedPatch.installTargets.map((target) => (
              <span key={target}>{target}</span>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Coverage</p>
              <h2>Fields included</h2>
            </div>
            <ListChecks size={19} />
          </div>
          <div className="schema-field-list">
            {generatedPatch.fieldCoverage.map((field) => (
              <ScanCheck key={field.label} label={field.label} done={field.done} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel schema-code-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Install snippet</p>
            <h2>JSON-LD script</h2>
          </div>
          <div className="schema-button-row">
            <button
              className="secondary-button"
              onClick={() =>
                copyText("snippet", generatedPatch.installSnippet)
              }
            >
              <Copy size={16} />
              <span>{copiedTarget === "snippet" ? "Copied" : "Copy snippet"}</span>
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                copyText(
                  "json",
                  JSON.stringify(generatedPatch.schemaJson, null, 2)
                )
              }
            >
              <Copy size={16} />
              <span>{copiedTarget === "json" ? "Copied" : "Copy JSON"}</span>
            </button>
            <button className="secondary-button" onClick={downloadSchema}>
              <Download size={16} />
              <span>Download</span>
            </button>
            <a
              className="secondary-button"
              href={generatedPatch.validationUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight size={16} />
              <span>Validate</span>
            </a>
          </div>
        </div>
        <pre className="schema-code">{generatedPatch.installSnippet}</pre>
      </section>
    </div>
  );
}

function slugForFile(value) {
  return String(value || "schema")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function AiAudit({
  profile,
  setProfile,
  selectedBusinessType,
  businessTypes,
  onBusinessTypeChange,
  auditReport,
  auditState,
  auditMode,
  auditNotice,
  savedAuditRuns,
  persistenceStatus,
  businessId,
  sourceCompletion,
  onRunAudit,
}) {
  const {
    summary,
    prompts,
    results,
    inputWarnings,
    entityGaps,
    competitorShare,
    websiteScan,
    providerStatus = [],
  } = auditReport;
  const visibleResults = results.slice(0, 12);
  const completed = auditState === "complete";
  const running = auditState === "running";
  const visibleAuditMode = running ? auditMode : auditReport.mode || auditMode;
  const modeNotice = auditNotice || getAuditModeNotice(visibleAuditMode);
  const liveRows = results.filter(isLiveProviderResult).length;
  const fallbackRows = results.filter(isProviderFallbackResult).length;
  const modeledRows = Math.max(0, results.length - liveRows - fallbackRows);
  const matrixStatus = [
    `${liveRows} live`,
    `${modeledRows} modeled`,
    fallbackRows > 0 ? `${fallbackRows} fallback` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="audit-workspace">
      <section className="panel audit-control">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Feature 1</p>
            <h2>Automated AI Search Audit</h2>
          </div>
          <span className="status-chip">
            {running
              ? "Running"
              : completed
                ? getAuditModeLabel(visibleAuditMode)
                : "Ready"}
          </span>
        </div>

        <div className="audit-setup">
          <label className="type-select wide-control">
            <span>Business type</span>
            <select
              value={selectedBusinessType}
              onChange={(event) => onBusinessTypeChange(event.target.value)}
            >
              {businessTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Business</span>
            <input
              value={profile.name || ""}
              placeholder="RapidFlow Plumbing"
              onChange={(event) =>
                setProfile({ ...profile, name: event.target.value })
              }
            />
          </label>
          <label className="website-field">
            <span>Brand website</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck="false"
              value={profile.website || ""}
              placeholder="https://choiceplumbingorlando.com"
              onBlur={(event) => {
                const website = normalizeWebsiteInput(event.target.value);
                if (website !== profile.website) {
                  setProfile({ ...profile, website });
                }
              }}
              onChange={(event) =>
                setProfile({ ...profile, website: event.target.value })
              }
            />
          </label>
          <label className="address-field">
            <span>Address</span>
            <input
              value={profile.address || ""}
              placeholder="2147 S Lamar Blvd"
              onChange={(event) =>
                setProfile({ ...profile, address: event.target.value })
              }
            />
          </label>
          <label>
            <span>Market</span>
            <input
              value={profile.market || ""}
              placeholder="Austin, TX"
              onChange={(event) =>
                setProfile({ ...profile, market: event.target.value })
              }
            />
          </label>

          <button
            className={`primary-button audit-run-button ${
              running ? "is-loading" : ""
            }`}
            onClick={onRunAudit}
            disabled={running}
            aria-busy={running}
          >
            {running ? <RefreshCw className="spin" size={17} /> : <Search size={17} />}
            <span>{running ? "Running audit" : "Run AI search audit"}</span>
          </button>
        </div>
      </section>

      {(completed || running) && (
        <section className="audit-status-strip">
          <article className="audit-status-card">
            <Globe2 size={16} />
            <div>
              <strong>{getAuditModeLabel(visibleAuditMode)}</strong>
              <span>{running ? "Calling audit endpoint..." : modeNotice}</span>
            </div>
          </article>
          {providerStatus.map((provider) => (
            <article className="audit-status-card" key={provider.provider}>
              <CheckCircle2 size={16} />
              <div>
                <strong>{provider.provider}</strong>
                <span>
                  {provider.status.replace("_", " ")}: {provider.detail}
                </span>
              </div>
            </article>
          ))}
        </section>
      )}

      {inputWarnings.length > 0 && (
        <section className="audit-warning-strip">
          {inputWarnings.map((warning) => (
            <article className="audit-warning" key={warning.id}>
              <AlertTriangle size={16} />
              <div>
                <strong>{warning.label}</strong>
                <span>{warning.detail}</span>
              </div>
            </article>
          ))}
        </section>
      )}

      {websiteScan && (
        <section className="panel website-scan-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Owned website crawl</p>
              <h2>{getWebsiteScanLabel(websiteScan)}</h2>
            </div>
            <Globe2 size={19} />
          </div>
          <div className="website-scan-grid">
            <ScanCheck label="LocalBusiness schema" done={websiteScan.hasLocalBusinessSchema} />
            <ScanCheck label="Opening hours schema" done={websiteScan.hasOpeningHoursSchema} />
            <ScanCheck label="Geo coordinates" done={websiteScan.hasGeoSchema} />
            <ScanCheck label="FAQ schema" done={websiteScan.hasFAQSchema} />
            <ScanCheck label="Phone signal" done={websiteScan.hasPhone} />
            <ScanCheck
              label="Service terms"
              done={(websiteScan.detectedServices || []).length > 0}
            />
          </div>
          {websiteScan.notes?.length > 0 && (
            <div className="scan-notes">
              {websiteScan.notes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="audit-metrics">
        <AuditMetric
          label="AI Share of Voice"
          value={`${summary.shareOfVoice}%`}
          detail={`${summary.mentions}/${summary.total} engine answers mention the business`}
        />
        <AuditMetric
          label="Mention Score"
          value={summary.mentionScore}
          detail={`Average rank ${summary.averageRank}`}
        />
        <AuditMetric
          label="Direct Citations"
          value={`${summary.citationRate}%`}
          detail={`${summary.citations} answers cite a source`}
        />
        <AuditMetric
          label="Entity Baseline"
          value={`${sourceCompletion}%`}
          detail={`${entityGaps.length} structured-data gaps detected`}
        />
      </section>

      <SavedAuditRunsPanel
        savedAuditRuns={savedAuditRuns}
        persistenceStatus={persistenceStatus}
        businessId={businessId}
      />

      <section className="panel wide">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Hyper-local prompts</p>
            <h2>Prompt audit matrix</h2>
          </div>
          <span className="quiet-status">{matrixStatus}</span>
        </div>
        {modeledRows > 0 && (
          <div className="audit-explainer">
            ChatGPT with Search is live when OpenRouter returns a grounded answer.
            Perplexity, Gemini, and Google AI rows are modeled until their direct
            connectors are added.
          </div>
        )}
        <div className="prompt-card-grid">
          {prompts.map((prompt) => (
            <article className="prompt-card" key={prompt.id}>
              <div className="prompt-card-head">
                <span className="intent-chip">{prompt.intent}</span>
                <span className="quiet-status">{prompt.priority}</span>
              </div>
              <strong>{prompt.query}</strong>
              <div className="engine-result-strip">
                {results
                  .filter((result) => result.promptId === prompt.id)
                  .map((result) => (
                    <span
                      className={getResultChipClass(result)}
                      key={result.id}
                      title={`${getEngineDisplayName(
                        result.engine
                      )}: ${getResultProviderLabel(result)}`}
                    >
                      <span>{getEngineDisplayName(result.engine)}</span>
                      <small>{getResultProviderLabel(result)}</small>
                    </span>
                  ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="audit-split">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Parsed answer output</p>
              <h2>Mention, citation, and competitor detection</h2>
            </div>
            <FileText size={19} />
          </div>
          <div className="audit-result-list">
            {visibleResults.map((result) => (
              <article className="audit-result-row" key={result.id}>
                <div className="audit-result-top">
                  <div className="audit-result-title">
                    <strong>{result.engine}</strong>
                    <span
                      className={`provider-chip ${getResultProviderClass(result)}`}
                    >
                      {getResultProviderLabel(result)}
                    </span>
                  </div>
                  <span className={getResultChipClass(result)}>
                    <span>
                      {result.mentioned
                        ? result.cited
                          ? "Mentioned + cited"
                          : "Mentioned"
                        : "Skipped"}
                    </span>
                  </span>
                </div>
                <p>{result.finding}</p>
                <div className="audit-result-meta">
                  <span>Rank: {result.rank ? `#${result.rank}` : "N/A"}</span>
                  <span>Source: {result.source || "No direct source"}</span>
                  <span>
                    Competitors: {result.competitorRecommendations.join(", ")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Entity gap</p>
              <h2>Why AI may skip this business</h2>
            </div>
            <AlertTriangle size={19} />
          </div>
          <div className="gap-list">
            {entityGaps.map((gap) => (
              <article className="gap-card" key={gap.id}>
                <div>
                  <span className={`severity ${gap.severity.toLowerCase()}`}>
                    {gap.severity}
                  </span>
                  <strong>{gap.title}</strong>
                </div>
                <p>{gap.detail}</p>
                <small>{gap.fix}</small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Competitor pressure</p>
            <h2>Top recommended alternatives</h2>
          </div>
          <ListChecks size={19} />
        </div>
        <div className="competitor-share-grid">
          {competitorShare.map((competitor, index) => (
            <article className="competitor-share-card" key={competitor.name}>
              <span>#{index + 1}</span>
              <strong>{competitor.name}</strong>
              <small>{competitor.count} AI recommendations</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScanCheck({ label, done }) {
  return (
    <div className={done ? "scan-check good" : "scan-check missing"}>
      {done ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      <span>{label}</span>
    </div>
  );
}

function SavedAuditRunsPanel({ savedAuditRuns, persistenceStatus, businessId }) {
  const connected = persistenceStatus?.mode === "database";
  const errored = persistenceStatus?.mode === "error";
  const hasRuns = savedAuditRuns.length > 0;
  const statusLabel = hasRuns
    ? "Tracking active"
    : errored
      ? "History issue"
      : businessId || connected
        ? "Ready"
        : "Not started";
  const statusClass = hasRuns || connected
    ? "status-chip database-ready"
    : errored
      ? "status-chip database-error"
      : "status-chip";
  const note = hasRuns
    ? "Past audits are saved for trend tracking, reporting, and before-after comparisons."
    : errored
      ? "This run completed, but history could not be updated. You can still review the current audit results."
      : businessId || connected
        ? "Run the next audit to add a point to the trend history."
        : "Run the first audit to start trend history for this business.";

  return (
    <section className="panel saved-runs-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Audit history</p>
          <h2>Saved audit runs</h2>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>

      <p className="saved-runs-note">{note}</p>

      {hasRuns ? (
        <div className="saved-run-list">
          {savedAuditRuns.map((run) => (
            <article className="saved-run-row" key={run.id}>
              <div>
                <strong>{formatRunDate(run.createdAt)}</strong>
                <span>{getAuditModeLabel(run.mode)}</span>
              </div>
              <div className="saved-run-scores">
                <Metric label="Share" value={`${run.summary?.shareOfVoice ?? 0}%`} />
                <Metric label="Mentions" value={run.summary?.mentions ?? 0} />
                <Metric label="Score" value={run.summary?.mentionScore ?? 0} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <strong>No saved audits yet</strong>
          <span>Run an audit to create the first history entry.</span>
        </div>
      )}
    </section>
  );
}

function formatRunDate(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function AuditMetric({ label, value, detail }) {
  return (
    <article className="panel audit-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Onboarding({
  profile,
  setProfile,
  businessTypes,
  selectedBusinessType,
  onBusinessTypeChange,
  competitors,
  setCompetitors,
  monitoredLocations,
  setMonitoredLocations,
  sourceCompletion,
  onFinish,
}) {
  const missingFields = requiredProfileFields.filter(
    (key) => !String(profile[key] || "").trim()
  );

  function updateListValue(setter, index, value) {
    setter((items) =>
      items.map((item, itemIndex) => (itemIndex === index ? value : item))
    );
  }

  function addListValue(setter) {
    setter((items) => [...items, ""]);
  }

  function removeListValue(setter, index) {
    setter((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="onboarding-grid">
      <section className="panel onboarding-main">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Source of truth</p>
            <h2>Business baseline</h2>
          </div>
          <span className="status-chip">{sourceCompletion}% complete</span>
        </div>

        <div className="progress-track">
          <span style={{ width: `${sourceCompletion}%` }} />
        </div>

        <form className="profile-form onboarding-form">
          <label>
            <span>Business type</span>
            <select
              value={selectedBusinessType}
              onChange={(event) => onBusinessTypeChange(event.target.value)}
            >
              {businessTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          {profileFields.map(([key, label, fieldType]) => (
            <label key={key}>
              <span>{label}</span>
              {fieldType === "textarea" ? (
                <textarea
                  value={profile[key] || ""}
                  rows={3}
                  onChange={(event) =>
                    setProfile({ ...profile, [key]: event.target.value })
                  }
                />
              ) : (
                <input
                  value={profile[key] || ""}
                  onChange={(event) =>
                    setProfile({ ...profile, [key]: event.target.value })
                  }
                />
              )}
            </label>
          ))}
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Market</p>
            <h2>Competitors</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Add competitor"
            onClick={() => addListValue(setCompetitors)}
          >
            <Sparkles size={17} />
          </button>
        </div>
        <div className="list-editor">
          {competitors.map((competitor, index) => (
            <div className="list-input-row" key={`competitor-${index}`}>
              <input
                value={competitor}
                placeholder="Competitor business"
                onChange={(event) =>
                  updateListValue(setCompetitors, index, event.target.value)
                }
              />
              <button
                className="icon-button compact"
                type="button"
                title="Remove competitor"
                onClick={() => removeListValue(setCompetitors, index)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Coverage</p>
            <h2>Tracked locations</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Add location"
            onClick={() => addListValue(setMonitoredLocations)}
          >
            <MapPin size={17} />
          </button>
        </div>
        <div className="list-editor">
          {monitoredLocations.map((location, index) => (
            <div className="list-input-row" key={`location-${index}`}>
              <input
                value={location}
                placeholder="City, neighborhood, or service area"
                onChange={(event) =>
                  updateListValue(
                    setMonitoredLocations,
                    index,
                    event.target.value
                  )
                }
              />
              <button
                className="icon-button compact"
                type="button"
                title="Remove location"
                onClick={() => removeListValue(setMonitoredLocations, index)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel onboarding-summary">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Launch</p>
            <h2>Baseline status</h2>
          </div>
          <CheckCircle2 size={19} />
        </div>
        <div className="checklist">
          <ChecklistRow
            done={missingFields.length === 0}
            label="Business profile fields"
            detail={
              missingFields.length === 0
                ? "Ready"
                : `${missingFields.length} missing`
            }
          />
          <ChecklistRow
            done={competitors.filter(Boolean).length >= 2}
            label="Competitor set"
            detail={`${competitors.filter(Boolean).length} added`}
          />
          <ChecklistRow
            done={monitoredLocations.filter(Boolean).length >= 1}
            label="Tracked locations"
            detail={`${monitoredLocations.filter(Boolean).length} added`}
          />
        </div>
        <button className="primary-button drawer-button" onClick={onFinish}>
          <ArrowUpRight size={17} />
          <span>Save baseline</span>
        </button>
      </section>
    </div>
  );
}

function ChecklistRow({ done, label, detail }) {
  return (
    <div className="checklist-row">
      <span className={done ? "check-dot done" : "check-dot"} />
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function EngineMatrix() {
  return (
    <div className="engine-list">
      {engines.map((engine) => {
        const Icon = engineIcons[engine.id] || Bot;
        return (
          <article className="engine-row" key={engine.id}>
            <div className="engine-title">
              <span
                className="engine-mark"
                style={{ backgroundColor: engine.accent }}
              >
                <Icon size={16} />
              </span>
              <div>
                <strong>{engine.name}</strong>
                <small>{engine.kind}</small>
              </div>
            </div>
            <div className="bar-wrap" aria-label={`${engine.name} visibility`}>
              <span style={{ width: `${engine.visibility}%` }} />
            </div>
            <div className="engine-stats">
              <strong>{engine.visibility}%</strong>
              <small>{engine.trend}</small>
            </div>
            <span className="status-chip">{engine.status}</span>
          </article>
        );
      })}
    </div>
  );
}

function GraphSummary({ graphSources }) {
  return (
    <div className="graph-grid">
      {graphSources.map((source) => (
        <article className="graph-source" key={source.id}>
          <div className="source-top">
            <strong>{source.name}</strong>
            <span>{source.status}</span>
          </div>
          <div className="meter">
            <span style={{ width: `${source.completeness}%` }} />
          </div>
          <div className="source-bottom">
            <span>{source.completeness}% complete</span>
            <span>{source.lastSync}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function PromptMonitor({ prompts }) {
  return (
    <section className="panel full-page">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Prompt monitoring</p>
          <h2>Tracked local purchase prompts</h2>
        </div>
        <button className="secondary-button">
          <FileText size={17} />
          <span>Export CSV</span>
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Intent</th>
              <th>Prompt</th>
              <th>Rank</th>
              <th>Engine results</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((prompt) => (
              <tr key={prompt.id}>
                <td>
                  <span className="intent-chip">{prompt.intent}</span>
                </td>
                <td className="prompt-cell">{prompt.prompt}</td>
                <td>
                  <strong>#{prompt.businessRank}</strong>
                </td>
                <td>
                  <div className="mini-results">
                    {Object.entries(prompt.engines).map(([engineId, result]) => (
                      <span key={engineId}>{result}</span>
                    ))}
                  </div>
                </td>
                <td>{prompt.issue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ListingAudit({ graphSources }) {
  return (
    <section className="panel full-page">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Listing audit</p>
          <h2>Source-of-truth comparison</h2>
        </div>
        <button className="secondary-button">
          <Plug size={17} />
          <span>Connect source</span>
        </button>
      </div>
      <div className="audit-grid">
        {graphSources.map((source) => (
          <article className="audit-source" key={source.id}>
            <div className="source-top">
              <strong>{source.name}</strong>
              <span>{source.status}</span>
            </div>
            <div className="field-list">
              {source.fields.map(([label, value]) => (
                <div className="field-row" key={label}>
                  <span>{label}</span>
                  <strong className={value === "Matched" ? "matched" : "unmatched"}>
                    {value}
                  </strong>
                </div>
              ))}
            </div>
            <div className="issue-list">
              {source.issues.map((issue) => (
                <p key={issue}>
                  <AlertTriangle size={15} />
                  {issue}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RemediationQueue({ remediationTasks, onSelectTask }) {
  return (
    <section className="panel full-page">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Fix queue</p>
          <h2>Prioritized remediation tasks</h2>
        </div>
        <button className="primary-button">
          <Sparkles size={17} />
          <span>Generate fix pack</span>
        </button>
      </div>
      <div className="queue-list">
        {remediationTasks.map((task) => (
          <button
            className="queue-item"
            key={task.id}
            onClick={() => onSelectTask(task)}
          >
            <span className={`severity ${task.severity.toLowerCase()}`}>
              {task.severity}
            </span>
            <div>
              <strong>{task.title}</strong>
              <p>{task.details}</p>
            </div>
            <span>{task.source}</span>
            <span>{task.effort}</span>
            <span className="status-chip">{task.state}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({
  profile,
  setProfile,
  businessTypes,
  selectedBusinessType,
  onBusinessTypeChange,
}) {
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Business profile</p>
            <h2>Source identity</h2>
          </div>
          <Building2 size={19} />
        </div>
        <form className="profile-form">
          <label>
            <span>Business type</span>
            <select
              value={selectedBusinessType}
              onChange={(event) => onBusinessTypeChange(event.target.value)}
            >
              {businessTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          {profileFields.map(([key, label, fieldType]) => (
            <label key={key}>
              <span>{label}</span>
              {fieldType === "textarea" ? (
                <textarea
                  value={profile[key] || ""}
                  rows={3}
                  onChange={(event) =>
                    setProfile({ ...profile, [key]: event.target.value })
                  }
                />
              ) : (
                <input
                  value={profile[key] || ""}
                  onChange={(event) =>
                    setProfile({ ...profile, [key]: event.target.value })
                  }
                />
              )}
            </label>
          ))}
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Connectors</p>
            <h2>Provider readiness</h2>
          </div>
          <Plug size={19} />
        </div>
        <div className="connector-list">
          {connectors.map(([name, status, scope]) => (
            <div className="connector-row" key={name}>
              <div>
                <strong>{name}</strong>
                <span>{scope}</span>
              </div>
              <span className="status-chip">{status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TaskDrawer({ task, onClose, onOpenRemediation }) {
  if (!task) return null;
  const actionLabel = isSchemaRemediationTask(task)
    ? "Open schema fix"
    : "Open fix queue";

  return (
    <aside className="drawer" aria-label="Remediation detail">
      <div className="drawer-head">
        <div>
          <span className={`severity ${task.severity.toLowerCase()}`}>
            {task.severity}
          </span>
          <h2>{task.title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </div>
      <p>{task.details}</p>
      <dl className="detail-grid">
        <div>
          <dt>Source</dt>
          <dd>{task.source}</dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd>{task.impact}</dd>
        </div>
        <div>
          <dt>Effort</dt>
          <dd>{task.effort}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{task.state}</dd>
        </div>
      </dl>
      <div className="action-list">
        {task.actions.map((action) => (
          <div className="action-row" key={action}>
            <CheckCircle2 size={16} />
            <span>{action}</span>
          </div>
        ))}
      </div>
      <button
        className="primary-button drawer-button"
        onClick={() => onOpenRemediation(task)}
      >
        <ArrowUpRight size={17} />
        <span>{actionLabel}</span>
      </button>
    </aside>
  );
}

function isSchemaRemediationTask(task) {
  const haystack = [
    task?.id,
    task?.title,
    task?.source,
    task?.details,
    ...(task?.actions || []),
  ]
    .join(" ")
    .toLowerCase();

  return /schema|json-ld|localbusiness|openinghours|structured data|markup|faq/.test(
    haystack
  );
}

function InfoPill({ icon: Icon, label }) {
  return (
    <span className="info-pill">
      <Icon size={15} />
      {label}
    </span>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default App;
