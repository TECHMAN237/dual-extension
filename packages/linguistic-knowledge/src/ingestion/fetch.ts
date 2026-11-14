/**
 * Polite fetching for public web resources.
 *
 * Rules:
 *  - Honour robots.txt (Disallow rules for `*` and our user agent).
 *  - Never bypass authentication, CAPTCHAs or paywalls: a 401/403/429 is reported, not retried aggressively.
 *  - Identify ourselves with a descriptive User-Agent.
 *  - Limit response size.
 */

export interface PoliteFetchOptions {
  userAgent?: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface PoliteFetchResult {
  ok: boolean;
  status: number;
  url: string;
  contentType: string | null;
  body: Buffer | null;
  blockedBy: "robots" | "status" | "size" | "network" | null;
  message: string | null;
}

const DEFAULT_UA = "DoualaAI-Ingestion/0.1 (+https://github.com/TECHMAN237/dual-extension; linguistic research; respects robots.txt)";

/** Minimum pause between two requests to the same host (the project's politeness rule: ≥ 3 s). */
export const MIN_REQUEST_INTERVAL_MS = 3_500;

/** Raised when a site refuses us (403, 429, CAPTCHA/bot challenge): the whole run must stop. */
export class SiteBlockedError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SiteBlockedError";
  }
}

/** Non-retryable HTTP answer (e.g. 500, oversized body): reported as is. */
export class HttpStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpStatusError";
  }
}

const CHALLENGE_MARKERS = [/<title>\s*just a moment/i, /cf-chl-|challenge-platform|cf_chl_opt/i, /g-recaptcha|h-captcha|hcaptcha\.com|recaptcha\/api/i, /<title>[^<]*(captcha|access denied|attention required)/i];

/** True when an HTML body is a bot challenge / CAPTCHA page rather than content. */
export function looksLikeChallenge(body: string): boolean {
  return CHALLENGE_MARKERS.some((re) => re.test(body.slice(0, 200_000)));
}

export interface PoliteSessionOptions {
  userAgent?: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * Check robots.txt before each path (default true). Only disable for official APIs whose
   * terms explicitly allow programmatic clients (e.g. the MediaWiki Action API, see
   * docs/LINGUISTIC_RESEARCH.md); never to get around a site's wishes.
   */
  respectRobots?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * Sequential, rate-limited fetching for one crawl: one request at a time, at least
 * `minIntervalMs` between requests to the same host (robots.txt included), robots.txt
 * fetched once per host, and a hard stop (SiteBlockedError) on 403, 429 or a CAPTCHA.
 */
export class PoliteSession {
  private readonly ua: string;
  private readonly minIntervalMs: number;
  private readonly lastRequest = new Map<string, number>();
  private readonly robots = new Map<string, string | null>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  requests = 0;

  constructor(private readonly opts: PoliteSessionOptions = {}) {
    this.ua = opts.userAgent ?? DEFAULT_UA;
    this.minIntervalMs = Math.max(3_000, opts.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  private async raw(url: URL, accept: string): Promise<Response> {
    const host = url.host;
    const last = this.lastRequest.get(host);
    if (last !== undefined) {
      const wait = last + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequest.set(host, this.now());
    this.requests++;
    this.opts.log?.(`GET ${url.toString()}`);
    try {
      return await this.fetchImpl(url.toString(), { headers: { "user-agent": this.ua, "api-user-agent": this.ua, accept }, redirect: "follow", signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000) });
    } finally {
      this.lastRequest.set(host, this.now());
    }
  }

  /** robots.txt content for the origin (null when absent), fetched once. */
  async robotsFor(url: URL): Promise<string | null> {
    if (!this.robots.has(url.origin)) {
      const res = await this.raw(new URL("/robots.txt", url.origin), "text/plain");
      if (res.status === 403 || res.status === 429) throw new SiteBlockedError(`robots.txt answered HTTP ${res.status}`, url.toString(), res.status);
      this.robots.set(url.origin, res.ok ? await res.text() : null);
    }
    return this.robots.get(url.origin) ?? null;
  }

  /** Fetch a page as text. Throws SiteBlockedError on 403/429/CAPTCHA; returns null on 404. */
  async getText(target: string, accept = "text/html,application/json;q=0.9,*/*;q=0.5"): Promise<string | null> {
    const url = new URL(target);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Unsupported URL ${target}`);
    if (this.opts.respectRobots !== false) {
      const robots = await this.robotsFor(url);
      if (robots && !isAllowedByRobots(robots, url.pathname + url.search, this.ua)) throw new SiteBlockedError("Disallowed by robots.txt", target, 0);
    }
    const attempt = async (): Promise<string | null> => {
      const res = await this.raw(url, accept);
      if (res.status === 403 || res.status === 429) throw new SiteBlockedError(`HTTP ${res.status}: the site refused the request. Stopping, not retrying.`, target, res.status);
      if (res.status === 404) return null;
      // A server error (5xx) is treated like a dropped connection: one pause and one retry,
      // then the run stops cleanly (SiteBlockedError) with what was already collected.
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new HttpStatusError(`HTTP ${res.status} for ${target}`);
      // Reading the body can time out too: it is part of the same attempt.
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > (this.opts.maxBytes ?? 10 * 1024 * 1024)) throw new HttpStatusError(`Response too large for ${target}`);
      const text = buf.toString("utf8");
      if (looksLikeChallenge(text)) throw new SiteBlockedError("CAPTCHA / bot challenge detected. Stopping, not bypassing.", target, res.status);
      return text;
    };
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof SiteBlockedError || err instanceof HttpStatusError) throw err;
      // A dropped connection or a timeout (while connecting or reading) may be transient or a
      // sign the site wants us to slow down: wait 30 s and try once more; a second failure stops the run.
      this.opts.log?.(`network error (${(err as Error).message}); pausing 30 s before one retry`);
      await this.sleep(30_000);
      try {
        return await attempt();
      } catch (err2) {
        if (err2 instanceof SiteBlockedError || err2 instanceof HttpStatusError) throw err2;
        throw new SiteBlockedError(`Network failed twice (${(err2 as Error).message}). Stopping, the site may be limiting us.`, target, 0);
      }
    }
  }
}

/** Minimal robots.txt evaluation: returns true when `path` is allowed. Exported for tests. */
export function isAllowedByRobots(robotsTxt: string, path: string, userAgent = DEFAULT_UA): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const agentToken = userAgent.split("/")[0]!.toLowerCase();
  let sawSpecific = false;
  const rules: { allow: boolean; path: string }[] = [];
  const generic: { allow: boolean; path: string }[] = [];
  // A group = consecutive User-agent lines followed by rules; it applies to us if any of its
  // agents is our token (specific) or `*` (generic).
  let groupSpecific = false;
  let groupGeneric = false;
  let lastWasAgent = false;
  for (const line of lines) {
    const [keyRaw, ...rest] = line.split(":");
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!lastWasAgent) {
        groupSpecific = false;
        groupGeneric = false;
      }
      const ua = value.toLowerCase();
      if (ua === agentToken) {
        groupSpecific = true;
        sawSpecific = true;
      } else if (ua === "*") groupGeneric = true;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key !== "disallow" && key !== "allow") continue;
    if (value === "" && key === "disallow") continue;
    const rule = { allow: key === "allow", path: value };
    if (groupSpecific) rules.push(rule);
    else if (groupGeneric) generic.push(rule);
  }
  const active = sawSpecific ? rules : generic;
  // RFC 9309: `*` matches any sequence, a trailing `$` anchors the end; the longest matching
  // rule wins and, on a tie, Allow wins.
  const matches = (rulePath: string) => {
    const anchored = rulePath.endsWith("$");
    const body = anchored ? rulePath.slice(0, -1) : rulePath;
    const re = new RegExp(`^${body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
    return re.test(path);
  };
  let best: { allow: boolean; path: string } | null = null;
  for (const r of active) {
    if (!matches(r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

export async function politeFetch(url: string, options: PoliteFetchOptions = {}): Promise<PoliteFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ua = options.userAgent ?? DEFAULT_UA;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, status: 0, url, contentType: null, body: null, blockedBy: "network", message: "Invalid URL" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, status: 0, url, contentType: null, body: null, blockedBy: "network", message: "Only http(s) URLs are supported" };
  }

  const withTimeout = (input: string, init: RequestInit = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetchImpl(input, { ...init, signal: ctrl.signal, headers: { "user-agent": ua, accept: "text/html,application/pdf,text/csv,application/json;q=0.9,*/*;q=0.5", ...(init.headers ?? {}) } }).finally(() => clearTimeout(t));
  };

  try {
    const robotsRes = await withTimeout(`${target.origin}/robots.txt`).catch(() => null);
    if (robotsRes && robotsRes.ok) {
      const robots = await robotsRes.text();
      if (!isAllowedByRobots(robots, target.pathname + target.search, ua)) {
        return { ok: false, status: robotsRes.status, url, contentType: null, body: null, blockedBy: "robots", message: "Disallowed by robots.txt" };
      }
    }
    // Politeness: never two requests to the same site less than 3 s apart (robots.txt included).
    if (robotsRes) await (options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(MIN_REQUEST_INTERVAL_MS);
    const res = await withTimeout(target.toString());
    if (!res.ok) {
      const msg = res.status === 401 || res.status === 403 ? "Access restricted (authentication, paywall or bot protection). Not bypassed." : `HTTP ${res.status}`;
      return { ok: false, status: res.status, url, contentType: res.headers.get("content-type"), body: null, blockedBy: "status", message: msg };
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) {
      return { ok: false, status: res.status, url, contentType: res.headers.get("content-type"), body: null, blockedBy: "size", message: `Response larger than ${maxBytes} bytes` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return { ok: false, status: res.status, url, contentType: res.headers.get("content-type"), body: null, blockedBy: "size", message: `Response larger than ${maxBytes} bytes` };
    }
    return { ok: true, status: res.status, url, contentType: res.headers.get("content-type"), body: buf, blockedBy: null, message: null };
  } catch (err) {
    return { ok: false, status: 0, url, contentType: null, body: null, blockedBy: "network", message: (err as Error).message };
  }
}
