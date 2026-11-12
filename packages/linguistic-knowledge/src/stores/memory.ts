import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { knowledgeEntrySchema, linguisticSourceSchema, normalizeForLookup, tokenize } from "@douala-ai/shared";
import type { KnowledgeEntry, LinguisticSource } from "@douala-ai/shared";
import type { KnowledgeEntryInput, KnowledgeSearchOptions, KnowledgeStore } from "../store";

interface PersistedState {
  version: 1;
  entries: KnowledgeEntry[];
  sources: LinguisticSource[];
}

export interface InMemoryKnowledgeStoreOptions {
  /** Optional JSON file used to persist the store between restarts (local mode). */
  persistPath?: string;
  seedEntries?: KnowledgeEntry[];
  seedSources?: LinguisticSource[];
}

/**
 * In-memory knowledge store with optional JSON persistence.
 * Suitable for local development and tests. Not intended for multi-instance deployments.
 */
export class InMemoryKnowledgeStore implements KnowledgeStore {
  readonly kind = "memory" as const;
  private entries = new Map<string, KnowledgeEntry>();
  private sources = new Map<string, LinguisticSource>();
  /** token -> entry ids (inverted index for candidate lookup). */
  private index = new Map<string, Set<string>>();
  private persistPath: string | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: InMemoryKnowledgeStoreOptions = {}) {
    this.persistPath = options.persistPath;
    for (const s of options.seedSources ?? []) this.sources.set(s.id, s);
    for (const e of options.seedEntries ?? []) this.addToIndex(e);
  }

  /** Load persisted state from disk if the file exists. Seeds remain if the file is absent. */
  async load(): Promise<void> {
    if (!this.persistPath) return;
    try {
      const raw = await fs.readFile(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      for (const s of parsed.sources ?? []) {
        const res = linguisticSourceSchema.safeParse(s);
        if (res.success) this.sources.set(res.data.id, res.data);
      }
      for (const e of parsed.entries ?? []) {
        const res = knowledgeEntrySchema.safeParse(e);
        if (res.success) this.addToIndex(res.data);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private addToIndex(entry: KnowledgeEntry): void {
    this.entries.set(entry.id, entry);
    for (const token of new Set(tokenize(entry.sourceText))) {
      let set = this.index.get(token);
      if (!set) {
        set = new Set();
        this.index.set(token, set);
      }
      set.add(entry.id);
    }
  }

  private removeFromIndex(entry: KnowledgeEntry): void {
    for (const token of new Set(tokenize(entry.sourceText))) {
      this.index.get(token)?.delete(entry.id);
    }
    this.entries.delete(entry.id);
  }

  private persist(): Promise<void> {
    if (!this.persistPath) return Promise.resolve();
    const p = this.persistPath;
    const snapshot: PersistedState = {
      version: 1,
      entries: [...this.entries.values()],
      sources: [...this.sources.values()],
    };
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      await fs.rename(tmp, p);
    });
    return this.writeQueue;
  }

  async searchCandidates(query: string, options: KnowledgeSearchOptions): Promise<KnowledgeEntry[]> {
    const tokens = new Set(tokenize(query));
    const normalized = normalizeForLookup(query);
    const ids = new Set<string>();
    for (const t of tokens) for (const id of this.index.get(t) ?? []) ids.add(id);
    const limit = options.limit ?? 200;
    const matches = (e: KnowledgeEntry): boolean => {
      if (e.targetLanguage !== options.targetLanguage) return false;
      if (options.sourceLanguage && e.sourceLanguage !== options.sourceLanguage) return false;
      if (options.includeUnverified === false && e.validationStatus !== "verified") return false;
      if (e.validationStatus === "rejected") return false;
      return true;
    };
    const out: KnowledgeEntry[] = [];
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e || !matches(e)) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    // Also include exact matches that may have no indexed tokens (e.g. single symbol words).
    if (out.length === 0) {
      for (const e of this.entries.values()) {
        if (matches(e) && normalizeForLookup(e.sourceText) === normalized) out.push(e);
      }
    }
    return out;
  }

  async getEntries(ids: string[]): Promise<KnowledgeEntry[]> {
    return ids.map((id) => this.entries.get(id)).filter((e): e is KnowledgeEntry => Boolean(e));
  }

  async upsertEntries(inputs: KnowledgeEntryInput[]): Promise<KnowledgeEntry[]> {
    const now = new Date().toISOString();
    const saved: KnowledgeEntry[] = [];
    for (const input of inputs) {
      const id = input.id ?? randomUUID();
      const existing = this.entries.get(id);
      if (existing) this.removeFromIndex(existing);
      const entry = knowledgeEntrySchema.parse({
        ...input,
        id,
        extractedAt: input.extractedAt ?? existing?.extractedAt ?? now,
        tags: input.tags ?? [],
      });
      this.addToIndex(entry);
      saved.push(entry);
    }
    await this.persist();
    return saved;
  }

  async updateEntryStatus(id: string, status: KnowledgeEntry["validationStatus"], note?: string): Promise<KnowledgeEntry | null> {
    const existing = this.entries.get(id);
    if (!existing) return null;
    const updated: KnowledgeEntry = { ...existing, validationStatus: status, note: note ?? existing.note };
    this.entries.set(id, updated);
    await this.persist();
    return updated;
  }

  async listEntries(options: { status?: KnowledgeEntry["validationStatus"]; sourceId?: string; limit?: number; offset?: number }): Promise<KnowledgeEntry[]> {
    const all = [...this.entries.values()]
      .filter((e) => (options.status ? e.validationStatus === options.status : true))
      .filter((e) => (options.sourceId ? e.sourceId === options.sourceId : true))
      .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt));
    const offset = options.offset ?? 0;
    return all.slice(offset, offset + (options.limit ?? 100));
  }

  async countEntries(): Promise<number> {
    return this.entries.size;
  }

  async listSources(): Promise<LinguisticSource[]> {
    return [...this.sources.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSource(id: string): Promise<LinguisticSource | null> {
    return this.sources.get(id) ?? null;
  }

  async upsertSource(source: LinguisticSource): Promise<LinguisticSource> {
    const parsed = linguisticSourceSchema.parse(source);
    this.sources.set(parsed.id, parsed);
    await this.persist();
    return parsed;
  }
}
