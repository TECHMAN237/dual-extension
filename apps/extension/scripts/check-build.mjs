// Post-build guard: verifies that dist/ is a loadable extension whose service worker
// really is the background script (a file-name collision once made the loader import
// the content script instead, so the popup waited forever).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const fail = (msg) => {
  console.error(`check-build: ${msg}`);
  process.exit(1);
};
const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
const swFile = path.join(dist, manifest.background?.service_worker ?? "");
if (!existsSync(swFile)) fail(`service worker ${manifest.background?.service_worker} missing`);

// Follow the loader's static imports and collect the code that actually runs in the worker.
const seen = new Set();
let code = "";
const visit = (file) => {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  code += src;
  for (const m of src.matchAll(/(?:import\s*(?:[^"']*?from\s*)?|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) visit(path.resolve(path.dirname(file), m[1]));
};
visit(swFile);
for (const marker of ["scripting.executeScript", "tabs.sendMessage", "onInstalled"]) {
  if (!code.includes(marker)) fail(`service worker does not contain "${marker}": it is not the background script`);
}
if (code.includes("createTreeWalker")) fail("service worker contains content-script code (createTreeWalker)");

const injected = code.match(/["'](src\/content\/[^"']+\.js)["']/)?.[1];
if (!injected || !existsSync(path.join(dist, injected))) fail(`content script file referenced by the worker is missing (${injected})`);
const content = readFileSync(path.join(dist, injected), "utf8");
if (!content.includes("createTreeWalker")) fail(`${injected} is not the content script`);

for (const page of [manifest.action?.default_popup, manifest.options_page]) {
  if (!page || !existsSync(path.join(dist, page))) fail(`page ${page} missing`);
}
// The default backend from apps/extension/.env.production must be baked into the bundle.
let backendNote = "default backend http://localhost:8787 (no apps/extension/.env.production)";
const envFile = path.resolve(dist, "../.env.production");
if (existsSync(envFile)) {
  const url = readFileSync(envFile, "utf8")
    .match(/^\s*VITE_DEFAULT_BACKEND_URL\s*=\s*["']?([^"'\s#]+)/m)?.[1]
    ?.replace(/\/+$/, "");
  if (url) {
    const jsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
    if (!jsFiles(dist).some((f) => readFileSync(f, "utf8").includes(url))) fail(`VITE_DEFAULT_BACKEND_URL (${url}) from .env.production is not in the bundle`);
    backendNote = `default backend ${url}`;
  }
}
console.log(`check-build: OK (worker ${manifest.background.service_worker} → injects ${injected}; ${backendNote})`);
