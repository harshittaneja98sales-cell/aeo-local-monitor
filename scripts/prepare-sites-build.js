import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const serverDir = join(dist, "server");
const hostingSource = join(root, ".openai", "hosting.json");
const hostingTarget = join(dist, ".openai", "hosting.json");

mkdirSync(serverDir, { recursive: true });

if (existsSync(hostingSource)) {
  mkdirSync(dirname(hostingTarget), { recursive: true });
  copyFileSync(hostingSource, hostingTarget);
}

writeFileSync(
  join(serverDir, "index.js"),
  `export default {
  async fetch(request, env) {
    if (!env || !env.ASSETS) {
      return new Response("Static asset binding is not configured.", { status: 500 });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    const url = new URL(request.url);
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  }
};
`
);
