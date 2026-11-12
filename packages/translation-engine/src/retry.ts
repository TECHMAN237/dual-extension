import { ProviderError } from "./providers/types";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, err: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter. Only retries errors flagged retryable. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retryable = err instanceof ProviderError ? err.options.retryable : false;
      if (!retryable || attempt >= opts.maxRetries) throw err;
      attempt++;
      opts.onRetry?.(attempt, err);
      const delay = Math.min(max, base * 2 ** (attempt - 1)) * (0.5 + Math.random());
      await sleep(delay);
    }
  }
}

/** Minimal concurrency limiter (no dependency). */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}
