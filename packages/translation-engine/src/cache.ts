import { fnv1a, normalizeForLookup } from "@douala-ai/shared";
import type { TranslationResult } from "@douala-ai/shared";

interface CacheEntry {
  value: Omit<TranslationResult, "id" | "cached">;
  expiresAt: number;
}

/** Simple LRU + TTL cache for translation results (in-memory, per backend instance). */
export class TranslationCache {
  private map = new Map<string, CacheEntry>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  static key(text: string, source: string, target: string, context: string, model: string): string {
    return `${source}>${target}|${context}|${model}|${fnv1a(normalizeForLookup(text))}|${fnv1a(text)}`;
  }

  get(key: string): CacheEntry["value"] | null {
    if (this.ttlMs === 0 || this.maxEntries === 0) return null;
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.map.delete(key);
      return null;
    }
    // Refresh LRU position.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: CacheEntry["value"]): void {
    if (this.ttlMs === 0 || this.maxEntries === 0) return;
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
