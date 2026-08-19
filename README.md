# AEO Local Monitor

A lightweight SaaS prototype for tracking how local businesses appear across AI answer engines and local knowledge graphs.

## Current MVP

- Dashboard with AI visibility score, engine coverage, local listing health, prompt monitoring, and remediation queue.
- Automated AI Search Audit screen with hyper-local prompt simulation, AI Share of Voice, citation detection, competitor recommendations, and entity-gap findings.
- Server-side `/api/audit` endpoint that crawls the entered brand website and can replace the ChatGPT row with live OpenAI web-search output when `OPENAI_API_KEY` is configured.
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
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
OPENAI_WEB_SEARCH_TOOL_TYPE=web_search
```

## Integration Plan

1. Add provider adapters for Perplexity Sonar, Gemini Search Grounding, Google Places, Google Business Profile, Apple Business, and Azure Maps.
2. Persist businesses, prompt runs, citations, listings, and remediation tasks in a database.
3. Add OAuth and delegated access for listing remediation where each platform permits updates.
4. Add scheduled monitoring jobs and weekly customer reports.
