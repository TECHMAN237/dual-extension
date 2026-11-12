/**
 * Real-extension end-to-end test: loads apps/extension/dist as an unpacked extension in
 * Chromium and drives the popup's messages through the real background service worker.
 *
 *   node apps/extension/e2e/real-extension.mjs            (starts the backend itself)
 *   node apps/extension/e2e/real-extension.mjs --no-backend
 *
 * Playwright cannot click the toolbar icon, so it cannot grant `activeTab`. The test copies
 * dist/ to a temporary folder and adds a localhost host permission to that copy only;
 * the shipped manifest keeps activeTab-only permissions.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const withBackend = !process.argv.includes("--no-backend");
const BACKEND_PORT = 8787; // the extension's default backend URL
const PAGE_PORT = 8899;

async function loadPlaywright() {
  for (const c of ["playwright", "/opt/node-tools/node_modules/playwright/index.js"]) {
    try {
      const m = await import(c);
      return m.chromium ? m : m.default;
    } catch {}
  }
  throw new Error("Playwright not found: npm i -g playwright && npx playwright install chromium");
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "douala-ext-"));
const extPath = path.join(tmp, "ext");
cpSync(path.join(root, "apps/extension/dist"), extPath, { recursive: true });
const manifestPath = path.join(extPath, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = [`http://localhost:${PAGE_PORT}/*`];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

let backend = null;
if (withBackend) {
  backend = spawn("node", ["dist/index.js"], { cwd: path.join(root, "apps/backend"), env: { ...process.env, PORT: String(BACKEND_PORT), NODE_ENV: "test", AI_PROVIDER: "mock", LOG_LEVEL: "warn", LOCAL_KNOWLEDGE_FILE: path.join(tmp, "kb.json") }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://localhost:${BACKEND_PORT}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
}
const page = `<html lang="fr"><body><nav><a href="/">Accueil</a><a href="/a">À propos</a></nav><h1>Bienvenue sur notre site</h1><p>Lisez les dernières nouvelles de la région aujourd'hui.</p><button>Se connecter</button><input placeholder="Rechercher"/></body></html>`;
const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page); }).listen(PAGE_PORT);

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`] });
const checks = [];
const check = (name, ok, detail = "") => checks.push([name, !!ok, detail]);
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = sw.url().split("/")[2];
  const target = await ctx.newPage();
  await target.goto(`http://localhost:${PAGE_PORT}/`);
  const tabId = await sw.evaluate(async (port) => (await chrome.tabs.query({ url: `http://localhost:${port}/*` }))[0].id, PAGE_PORT);
  // In real use the popup sits on top of the page, so the page is the active tab.
  await sw.evaluate((id) => { const q = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async (o) => (o && o.active ? [await chrome.tabs.get(id)] : q(o)); }, tabId);
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/index.html`);
  const send = (msg, ms) => popup.evaluate(([m, t]) => Promise.race([chrome.runtime.sendMessage(m), new Promise((r) => setTimeout(() => r({ hung: true }), t))]), [msg, ms]);

  let t0 = Date.now();
  const scan = await send({ type: "SCAN" }, 15000);
  const scanMs = Date.now() - t0;
  check("scan answers", scan?.ok, JSON.stringify(scan).slice(0, 200));
  check("scan answers in under 6 s", scanMs < 6000, `${scanMs} ms`);
  check("French detected", scan?.data?.detectedLanguage === "fr", scan?.data?.detectedLanguage);
  check("elements counted", (scan?.data?.totalSegments ?? 0) >= 6, scan?.data?.totalSegments);

  t0 = Date.now();
  const tr = await send({ type: "TRANSLATE", sourceLanguage: "auto" }, 60000);
  const h1 = await target.evaluate(() => document.querySelector("h1").textContent);
  if (withBackend) {
    check("translate succeeds through the worker", tr?.ok && tr.data.status === "translated", JSON.stringify(tr).slice(0, 200));
    check("page text replaced (mock)", h1.startsWith("[MOCK dua]"), h1);
  } else {
    check("translate fails cleanly without server", tr && !tr.hung, JSON.stringify(tr).slice(0, 200));
    check("page untouched without server", h1 === "Bienvenue sur notre site", h1);
  }
  const restore = await send({ type: "RESTORE" }, 10000);
  const h1After = await target.evaluate(() => document.querySelector("h1").textContent);
  check("restore answers", restore?.ok, JSON.stringify(restore).slice(0, 120));
  check("original text restored", h1After === "Bienvenue sur notre site", h1After);
  const health = await popup.evaluate(async (port) => { try { return (await fetch(`http://localhost:${port}/api/health`)).status; } catch (e) { return String(e); } }, BACKEND_PORT);
  if (withBackend) check("popup reaches backend (CORS)", health === 200, health);
} finally {
  await ctx.close();
  server.close();
  backend?.kill();
  rmSync(tmp, { recursive: true, force: true });
}
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} real-extension checks passed (${withBackend ? "with" : "without"} backend)`);
process.exit(failed ? 1 : 0);
