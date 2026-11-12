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

const DEFAULT_UA = "DoualaAI-Ingestion/0.1 (+linguistic research; respects robots.txt)";

/** Minimal robots.txt evaluation: returns true when `path` is allowed. Exported for tests. */
export function isAllowedByRobots(robotsTxt: string, path: string, userAgent = DEFAULT_UA): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const agentToken = userAgent.split("/")[0]!.toLowerCase();
  let applies = false;
  let sawSpecific = false;
  const rules: { allow: boolean; path: string }[] = [];
  const generic: { allow: boolean; path: string }[] = [];
  let current: { allow: boolean; path: string }[] | null = null;
  for (const line of lines) {
    const [keyRaw, ...rest] = line.split(":");
    if (!keyRaw || rest.length === 0) continue;
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const ua = value.toLowerCase();
      if (ua === agentToken) {
        applies = true;
        sawSpecific = true;
        current = rules;
      } else if (ua === "*") {
        current = generic;
        applies = true;
      } else {
        current = null;
        applies = false;
      }
    } else if ((key === "disallow" || key === "allow") && applies && current) {
      if (value === "" && key === "disallow") continue;
      current.push({ allow: key === "allow", path: value });
    }
  }
  const active = sawSpecific ? rules : generic;
  let best: { allow: boolean; path: string } | null = null;
  for (const r of active) {
    if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
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
      if (!isAllowedByRobots(robots, target.pathname, ua)) {
        return { ok: false, status: robotsRes.status, url, contentType: null, body: null, blockedBy: "robots", message: "Disallowed by robots.txt" };
      }
    }
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
