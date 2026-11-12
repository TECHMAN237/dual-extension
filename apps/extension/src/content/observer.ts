import type { Segment } from "./scanner";

export interface DynamicObserverOptions {
  root: Node;
  /** Scanner bound to the session (knows which nodes are already tracked). */
  scan: (root: Node) => Segment[];
  /** Called with newly discovered segments after the debounce window. */
  onSegments: (segments: Segment[]) => void;
  /** Called when the document URL changed since the observer started (SPA navigation). */
  onNavigate?: (url: string) => void;
  debounceMs?: number;
  /** Injected for tests. */
  setTimeoutImpl?: TimerSet;
  clearTimeoutImpl?: TimerClear;
}

export type TimerSet = (fn: () => void, ms: number) => unknown;
export type TimerClear = (id: unknown) => void;

/**
 * Watches the page for content inserted after the initial translation
 * (infinite scroll, SPA route changes, lazy menus) and reports eligible
 * segments once, debounced. Mutations caused by the extension itself are
 * discarded through `ignoreOwnMutations`.
 */
export class DynamicContentObserver {
  private observer: MutationObserver | null = null;
  private pending = new Set<Node>();
  private timer: unknown = null;
  private lastUrl: string;
  private readonly debounceMs: number;
  private readonly setT: TimerSet;
  private readonly clearT: TimerClear;

  constructor(private readonly opts: DynamicObserverOptions) {
    this.debounceMs = opts.debounceMs ?? 400;
    // Timer functions must be invoked with the global object as `this`; storing them on
    // the instance and calling `this.setT(...)` throws "Illegal invocation" in Chrome.
    this.setT = opts.setTimeoutImpl ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearT = opts.clearTimeoutImpl ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
    this.lastUrl = typeof location !== "undefined" ? location.href : "";
  }

  get active(): boolean {
    return this.observer !== null;
  }

  start(): void {
    if (this.observer) return;
    this.lastUrl = typeof location !== "undefined" ? location.href : "";
    this.observer = new MutationObserver((records) => this.handle(records));
    this.observer.observe(this.opts.root, { childList: true, subtree: true, characterData: true });
  }

  stop(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
    this.pending.clear();
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Run DOM writes made by the extension without triggering a re-scan. */
  ignoreOwnMutations<T>(fn: () => T): T {
    try {
      return fn();
    } finally {
      // Records for our own synchronous writes are queued but not yet delivered; drain them.
      this.observer?.takeRecords();
    }
  }

  private handle(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === "childList") {
        record.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) this.pending.add(n);
        });
      } else if (record.type === "characterData") {
        this.pending.add(record.target);
      }
    }
    if (this.pending.size === 0) return;
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = this.setT(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    this.timer = null;
    const roots = [...this.pending];
    this.pending.clear();
    if (typeof location !== "undefined" && location.href !== this.lastUrl) {
      this.lastUrl = location.href;
      this.opts.onNavigate?.(this.lastUrl);
    }
    const seen = new Set<string>();
    const segments: Segment[] = [];
    for (const root of roots) {
      if (!root.isConnected) continue;
      // Skip roots nested inside another pending root to avoid double scanning.
      if (roots.some((other) => other !== root && other.nodeType === Node.ELEMENT_NODE && other !== root && other.contains(root))) continue;
      for (const seg of this.opts.scan(root)) {
        const key = seg.kind === "text" ? seg.node : seg.node;
        const k = `${seg.kind}:${seg.kind === "attr" ? seg.attr : ""}`;
        const token = `${k}:${nodeToken(key)}`;
        if (seen.has(token)) continue;
        seen.add(token);
        segments.push(seg);
      }
    }
    if (segments.length > 0) this.opts.onSegments(segments);
  }
}

const tokens = new WeakMap<Node, number>();
let tokenCounter = 0;
function nodeToken(node: Node): number {
  let t = tokens.get(node);
  if (t === undefined) {
    t = ++tokenCounter;
    tokens.set(node, t);
  }
  return t;
}
