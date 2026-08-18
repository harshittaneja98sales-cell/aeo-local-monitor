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

const tabs = [
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
  const [activeTab, setActiveTab] = useState("onboarding");
  const [scanState, setScanState] = useState("idle");
  const [selectedTask, setSelectedTask] = useState(
    businessTemplates[workspace.selectedBusinessType].remediationTasks[0]
  );
  const selectedBusinessType = workspace.selectedBusinessType;
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

  useEffect(() => {
    window.localStorage.setItem("aeo-local-workspace", JSON.stringify(workspace));
  }, [workspace]);

  function setProfile(nextProfile) {
    setWorkspace((current) => ({
      ...current,
      profile:
        typeof nextProfile === "function"
          ? nextProfile(current.profile)
          : nextProfile,
    }));
  }

  function setCompetitors(nextCompetitors) {
    setWorkspace((current) => ({
      ...current,
      competitors:
        typeof nextCompetitors === "function"
          ? nextCompetitors(current.competitors)
          : nextCompetitors,
    }));
  }

  function setMonitoredLocations(nextLocations) {
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
    setWorkspace({
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
  }

  function runScan() {
    if (scanState === "running") return;
    setScanState("running");
    window.setTimeout(() => setScanState("complete"), 1400);
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
