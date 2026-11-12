/**
 * Live end-to-end check: built content script + real backend (mock provider).
 *
 * Requires: `pnpm build:extension`, a Chromium available to Playwright, and the backend
 * running (this script starts one on port 8793 by itself).
 *   node scripts/e2e-live.mjs
 *
 * The content script normally talks to the background service worker through
 * chrome.runtime.sendMessage; here that bridge is replaced by direct fetch calls to
 * the backend, which is exactly what the background worker does.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8793;
const BACKEND = `http://localhost:${PORT}`;

async function importPlaywright() {
  for (const candidate of ["playwright", "/opt/node-tools/node_modules/playwright/index.js"]) {
    try {
      const mod = await import(candidate);
      return mod.chromium ? mod : mod.default;
    } catch {}
  }
  throw new Error("playwright not found. Install it with `npm i -g playwright` or add it to the workspace.");
}

const backend = spawn("node", ["dist/index.js"], {
  cwd: path.join(root, "apps/backend"),
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "test", AI_PROVIDER: "mock", LOG_LEVEL: "warn" },
  stdio: ["ignore", "inherit", "inherit"],
});
const cleanup = () => backend.kill();
process.on("exit", cleanup);

for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${BACKEND}/api/health`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const { chromium } = await importPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.setContent(`<html lang="en"><body>
  <nav><a href="/">Home</a><a href="/about">About us</a></nav>
  <h1>Welcome to the site</h1>
  <p>Read the latest <strong>news</strong> today</p>
  <button id="b" onclick="window.__clicked=true">Sign in</button>
  <input placeholder="Search" />
  <img alt="Company logo" src="x.png" />
  <p class="notranslate">Keep me</p>
  <code>const x = 1;</code>
  <p>https://example.com</p>
  <p>12,345</p>
  <div id="feed"></div>
  <script>var x = "Script text";</script>
</body></html>`);

// The background service worker performs backend calls from the extension origin.
// Here Node plays that role (an about:blank page has a "null" origin that the backend's CORS rightly rejects).
await page.exposeFunction("__backendCall", async (method, p, body) => {
  const res = await fetch(BACKEND + p, { method, headers: { "content-type": "application/json", "x-douala-client-id": "e2e-live-client", origin: "chrome-extension://e2eharness" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  return res.ok ? { ok: true, data: json } : { ok: false, error: json.error?.message, code: json.error?.code };
});
await page.evaluate(() => {
  const listeners = [];
  window.__requests = 0;
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: async (m) => {
        if (m.type === "API_TRANSLATE_BATCH") { window.__requests++; return window.__backendCall("POST", "/api/translate/batch", m.body); }
        if (m.type === "API_SCAN_ANALYZE") return window.__backendCall("POST", "/api/scan/analyze", m.body);
        if (m.type === "GET_SETTINGS") return { ok: true, data: { translateDynamicContent: true } };
        return { ok: true, data: null };
      },
    },
  };
  window.__listeners = listeners;
});
await page.addScriptTag({ path: path.join(root, "apps/extension/dist/src/content/index.js") });

const result = await page.evaluate(async () => {
  const send = (msg) => new Promise((res) => window.__listeners[0](msg, {}, res));
  const scan = await send({ type: "CS_SCAN" });
  const tr = await send({ type: "CS_TRANSLATE", sourceLanguage: "auto", translateDynamicContent: true });
  const q = (s) => document.querySelector(s);
  const after = {
    h1: q("h1").textContent, strong: q("strong").textContent, button: q("#b").textContent, placeholder: q("input").placeholder, alt: q("img").alt,
    notranslate: q(".notranslate").textContent, code: q("code").textContent, url: document.querySelectorAll("p")[2].textContent, number: document.querySelectorAll("p")[3].textContent,
    childCount: document.body.children.length, requests: window.__requests,
  };
  q("#b").click();
  // Dynamic content: insert new nodes and wait for the observer + backend round trip.
  const feed = q("#feed");
  feed.innerHTML = "<p>Breaking news just arrived</p><p>Breaking news just arrived</p>";
  await new Promise((r) => setTimeout(r, 2500));
  const dynamic = { first: feed.children[0].textContent, second: feed.children[1].textContent, requests: window.__requests };
  const list = await send({ type: "CS_LIST_TRANSLATIONS" });
  const restored = await send({ type: "CS_RESTORE" });
  const afterRestore = { h1: q("h1").textContent, button: q("#b").textContent, placeholder: q("input").placeholder, feed: feed.children[0].textContent };
  const tr2 = await send({ type: "CS_TRANSLATE", sourceLanguage: "en", translateDynamicContent: false });
  const restored2 = await send({ type: "CS_RESTORE" });
  return { scan: scan.data, translate: { status: tr.data.status, translated: tr.data.translatedCount, total: tr.data.totalSegments, skipped: tr.data.skippedCount, mock: tr.data.mock }, after, clicked: window.__clicked === true, dynamic, listCount: list.data.length, sampleRef: list.data[0], restored: restored.data.status, afterRestore, secondCycle: { status: tr2.data.status, translated: tr2.data.translatedCount }, restored2: restored2.data.status };
});
await browser.close();
backend.kill();

console.log(JSON.stringify(result, null, 1));
const checks = [
  ["scan found segments", result.scan.totalSegments >= 7],
  ["detected English", result.scan.detectedLanguage === "en"],
  ["translation completed", result.translate.status === "translated" && result.translate.translated >= 6],
  ["heading translated", result.after.h1.startsWith("[MOCK dua]")],
  ["nested strong translated separately", result.after.strong.startsWith("[MOCK dua]")],
  ["button translated", result.after.button.startsWith("[MOCK dua]")],
  ["placeholder translated", result.after.placeholder.startsWith("[MOCK dua]")],
  ["alt translated", result.after.alt.startsWith("[MOCK dua]")],
  ["notranslate untouched", result.after.notranslate === "Keep me"],
  ["code untouched", result.after.code === "const x = 1;"],
  ["url untouched", result.after.url === "https://example.com"],
  ["number untouched", result.after.number === "12,345"],
  ["DOM structure intact", result.after.childCount === 12],
  ["button listener still works", result.clicked],
  ["dynamic content translated", result.dynamic.first.startsWith("[MOCK dua]")],
  ["duplicate dynamic text reused", result.dynamic.second === result.dynamic.first],
  ["dynamic content cost one extra request", result.dynamic.requests === result.after.requests + 1],
  ["corrections list populated", result.listCount >= 7],
  ["restore returned original", result.afterRestore.h1 === "Welcome to the site" && result.afterRestore.button === "Sign in" && result.afterRestore.placeholder === "Search" && result.afterRestore.feed === "Breaking news just arrived"],
  ["second translate/restore cycle works", result.secondCycle.status === "translated" && result.restored2 === "idle"],
  ["no page errors", errors.length === 0],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
if (errors.length) console.log("page errors:", errors);
console.log(`\n${checks.length - failed}/${checks.length} live e2e checks passed`);
process.exit(failed ? 1 : 0);
