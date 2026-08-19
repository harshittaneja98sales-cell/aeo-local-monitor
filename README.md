# AEO Local Monitor

A lightweight SaaS prototype for tracking how local businesses appear across AI answer engines and local knowledge graphs.

## Current MVP

- Dashboard with AI visibility score, engine coverage, local listing health, prompt monitoring, and remediation queue.
- Automated AI Search Audit screen with hyper-local prompt simulation, AI Share of Voice, citation detection, competitor recommendations, and entity-gap findings.
- 1-click JSON-LD & Entity Schema Generator with LocalBusiness, service catalog, opening hours, FAQPage, copy/download actions, and Rich Results Test link.
- Continuous AI Hallucination & Citation Monitoring with saved monitor settings, manual monitor runs, alert persistence, competitor-incursion detection, citation drift alerts, and a Vercel cron-ready weekly scan endpoint.
- Server-side `/api/audit` endpoint that crawls the entered brand website and can replace the ChatGPT-style row with live OpenRouter web-search output when `OPENROUTER_API_KEY` is configured, then falls back to OpenAI or local simulation.
- Postgres-backed business records, saved audit runs, saved schema patches, monitor configs, and monitor alerts when `DATABASE_URL` is configured.
- Mocked provider data for ChatGPT, Perplexity, Gemini, Google AI Overviews, Apple Intelligence, Google Business Profile, Apple Maps, and Microsoft/Azure Maps.
- API key placeholders in `.env.example` for the real integrations.

## Run Locally

```bash
npm install
npm run dev
```

The Vite dev server and GitHub Pages preview are static, so `/api/audit` will fall back to local simulation there. Use a server-capable host for the real audit endpoint:

```bash
npx vercel dev
```

Set these environment variables on the server:

```bash
DATABASE_URL=
CRON_SECRET=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4.1-mini
OPENROUTER_SEARCH_ENGINE=auto
OPENROUTER_SEARCH_RESULTS=4
OPENROUTER_SEARCH_CONTEXT_SIZE=medium
OPENROUTER_SITE_URL=https://aeo-local-monitor.vercel.app
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
OPENAI_WEB_SEARCH_TOOL_TYPE=web_search
```

The live audit provider order is OpenRouter first, OpenAI second, and deterministic simulation last. This keeps the MVP usable even when one provider has billing or rate-limit issues.

The database layer is compatible with managed Postgres providers such as Supabase, Neon, and Vercel Postgres. The API creates the required tables automatically when the connection role has schema permissions; the same schema is also checked in at `database/schema.sql`.

Scheduled monitoring is exposed at `/api/cron/monitor` and configured in `vercel.json` for Monday 06:00 UTC. Set `CRON_SECRET` in production to require a bearer token on manual cron calls. Alert email is saved in monitor settings; outbound email delivery is still a future integration.

## Integration Plan

1. Add provider adapters for Perplexity Sonar, Gemini Search Grounding, Google Places, Google Business Profile, Apple Business, and Azure Maps.
2. Add auth and tenant isolation so each customer only sees their own businesses and audit runs.
3. Add OAuth and delegated access for listing remediation where each platform permits updates.
4. Add scheduled monitoring jobs and weekly customer reports.
