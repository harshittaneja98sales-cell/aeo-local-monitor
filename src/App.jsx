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

function App() {
  const [workspace, setWorkspace] = useState(getInitialWorkspace);
  const [activeTab, setActiveTab] = useState("audit");
  const [scanState, setScanState] = useState("idle");
  const [auditState, setAuditState] = useState("ready");
  const [serverAuditReport, setServerAuditReport] = useState(null);
  const [auditMode, setAuditMode] = useState("local-simulation");
  const [auditNotice, setAuditNotice] = useState("");
  const [schemaPatch, setSchemaPatch] = useState(null);
  const [schemaState, setSchemaState] = useState("ready");
  const [schemaNotice, setSchemaNotice] = useState("");
  const [savedAuditRuns, setSavedAuditRuns] = useState([]);
  const [persistenceStatus, setPersistenceStatus] = useState({
    mode: "unknown",
    detail: "Run an audit after connecting DATABASE_URL to save history.",
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
  const auditReport = serverAuditReport || simulatedAuditReport;

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
            "Audit history is not available on this preview until DATABASE_URL is configured.",
        });
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
    setAuditState("running");
    setServerAuditReport(null);
    setAuditNotice("");

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile,
          businessId,
          businessType: businessTypes.find(
            (type) => type.id === selectedBusinessType
          ),
          competitors,
          monitoredLocations,
          sourceCompletion,
        }),
      });

      if (!response.ok) {
        throw new Error(`Audit endpoint returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.audit) {
        throw new Error("Audit endpoint returned an empty payload");
      }

      setServerAuditReport(data.audit);
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
    } catch {
      setAuditMode("local-simulation");
      setAuditNotice(
        "Live audit endpoint is unavailable on this static preview, so this run is using local simulation."
      );
      setPersistenceStatus({
        mode: "disabled",
        detail:
          "Audit history is not available on this preview until DATABASE_URL is configured.",
      });
    } finally {
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

      <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
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
  if (mode === "openai-web-search") return "Live OpenAI";
  if (mode === "openai-error-fallback") return "OpenAI fallback";
  if (mode === "server-crawler-simulation") return "Crawler + simulator";
  return "Local simulator";
}

function getAuditModeNotice(mode) {
  if (mode === "openai-web-search") {
    return "ChatGPT with Search rows are using live OpenAI web-search output; the remaining providers are still modeled.";
  }
  if (mode === "server-crawler-simulation") {
    return "The server crawled the brand website, but OPENAI_API_KEY is not configured, so provider answers are simulated.";
  }
  if (mode === "openai-error-fallback") {
    return "OpenAI is configured, but the provider request failed, so this run used fallback scoring.";
  }
  return "This preview is using deterministic local simulation data.";
}

function getWebsiteScanLabel(scan) {
  if (!scan) return "Not run";
  if (scan.status === "scanned") return `${scan.pagesScanned} pages scanned`;
  if (scan.status === "failed") return "Crawl failed";
  return "Website missing";
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
  const visibleAuditMode = auditReport.mode || auditMode;
  const modeNotice = auditNotice || getAuditModeNotice(visibleAuditMode);

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

          <div className="audit-input-grid">
            <label>
              <span>Business</span>
              <input
                value={profile.name || ""}
                onChange={(event) =>
                  setProfile({ ...profile, name: event.target.value })
                }
              />
            </label>
            <label>
              <span>Brand website</span>
              <input
                value={profile.website || ""}
                placeholder="https://example.com"
                onChange={(event) =>
                  setProfile({ ...profile, website: event.target.value })
                }
              />
            </label>
            <label>
              <span>Address</span>
              <input
                value={profile.address || ""}
                onChange={(event) =>
                  setProfile({ ...profile, address: event.target.value })
                }
              />
            </label>
            <label>
              <span>Market</span>
              <input
                value={profile.market || ""}
                onChange={(event) =>
                  setProfile({ ...profile, market: event.target.value })
                }
              />
            </label>
          </div>

          <button className="primary-button audit-run-button" onClick={onRunAudit}>
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
            <h2>Prompt simulation matrix</h2>
          </div>
          <span className="quiet-status">{prompts.length} prompts x 4 engines</span>
        </div>
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
                      className={
                        result.mentioned
                          ? result.cited
                            ? "result-chip cited"
                            : "result-chip mentioned"
                          : "result-chip missed"
                      }
                      key={result.id}
                    >
                      {result.engine.replace("Google AI Overviews", "Google AI")}
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
                  <strong>{result.engine}</strong>
                  <span
                    className={
                      result.mentioned
                        ? result.cited
                          ? "result-chip cited"
                          : "result-chip mentioned"
                        : "result-chip missed"
                    }
                  >
                    {result.mentioned
                      ? result.cited
                        ? "Mentioned + cited"
                        : "Mentioned"
                      : "Skipped"}
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

  return (
    <section className="panel saved-runs-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Audit history</p>
          <h2>Saved audit runs</h2>
        </div>
        <span
          className={
            connected
              ? "status-chip database-ready"
              : errored
                ? "status-chip database-error"
                : "status-chip"
          }
        >
          {connected ? "Database connected" : errored ? "Save error" : "Not connected"}
        </span>
      </div>

      <p className="saved-runs-note">
        {connected
          ? businessId
            ? "Each completed run is stored for trend tracking and reports."
            : "Run the first audit to create this business record."
          : persistenceStatus?.detail ||
            "Set DATABASE_URL to start saving businesses and audit runs."}
      </p>

      {savedAuditRuns.length > 0 && (
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

function TaskDrawer({ task, onClose }) {
  if (!task) return null;

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
      <button className="primary-button drawer-button">
        <ArrowUpRight size={17} />
        <span>Open remediation</span>
      </button>
    </aside>
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
