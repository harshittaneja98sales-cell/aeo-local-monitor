# AEO Local Monitor

A lightweight SaaS prototype for tracking how local businesses appear across AI answer engines and local knowledge graphs.

## Current MVP

- Dashboard with AI visibility score, engine coverage, local listing health, prompt monitoring, and remediation queue.
- Mocked provider data for ChatGPT, Perplexity, Gemini, Google AI Overviews, Apple Intelligence, Google Business Profile, Apple Maps, and Microsoft/Azure Maps.
- API key placeholders in `.env.example` for the real integrations.

## Run Locally

```bash
npm install
npm run dev
```

## Integration Plan

1. Add provider adapters for OpenAI Responses API, Perplexity Agent API, Gemini Search Grounding, Google Places, Google Business Profile, Apple Business, and Azure Maps.
2. Persist businesses, prompt runs, citations, listings, and remediation tasks in a database.
3. Add OAuth and delegated access for listing remediation where each platform permits updates.
4. Add scheduled monitoring jobs and weekly customer reports.
