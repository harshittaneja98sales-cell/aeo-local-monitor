import { useMemo, useState } from "react";
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

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [scanState, setScanState] = useState("idle");
  const [selectedBusinessType, setSelectedBusinessType] = useState("plumbing");
  const [selectedTask, setSelectedTask] = useState(
    businessTemplates.plumbing.remediationTasks[0]
  );
  const [profile, setProfile] = useState(businessTemplates.plumbing.business);
  const template = businessTemplates[selectedBusinessType];
  const graphSources = template.graphSources;
  const prompts = template.prompts;
  const remediationTasks = template.remediationTasks;
  const score = useMemo(
    () => calculateVisibilityScore(engines, graphSources, remediationTasks),
    [graphSources, remediationTasks]
  );
  const mentionCount = useMemo(() => countPromptMentions(prompts), [prompts]);

  function changeBusinessType(typeId) {
    const nextTemplate = businessTemplates[typeId];
    setSelectedBusinessType(typeId);
    setProfile(nextTemplate.business);
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
            graphSources={graphSources}
            remediationTasks={remediationTasks}
            onSelectTask={setSelectedTask}
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
          <Metric
            label="Last run"
            value={scanState === "complete" ? "Just now" : "Yesterday"}
          />
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
          {[
            ["name", "Business name"],
            ["category", "Category"],
            ["market", "Market"],
            ["website", "Website"],
            ["phone", "Phone"],
            ["address", "Address"],
            ["serviceArea", "Service area"],
            ["services", "Core services"],
            ["credential", "License / credential"],
            ["bookingUrl", "Booking URL"],
          ].map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={profile[key]}
                onChange={(event) =>
                  setProfile({ ...profile, [key]: event.target.value })
                }
              />
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
