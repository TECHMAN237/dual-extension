import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { knowledgeEntrySchema, linguisticSourceSchema, lookupTokens, normalizeForLookup, tokenize } from "@douala-ai/shared";
import type { KnowledgeEntry, LinguisticSource } from "@douala-ai/shared";
import type { KnowledgeEntryInput, KnowledgeSearchOptions, KnowledgeStore } from "../store";

interface PersistedState {
  version: 1;
  sources: LinguisticSource[];
  entries: KnowledgeEntry[];
}

export interface InMemoryKnowledgeStoreOptions {
  /** Optional JSON file used to persist the store between restarts (local mode). */
  persistPath?: string;
  /** Load `persistPath` but never write it back (tests, read-only deployments). */
  readOnly?: boolean;
  seedEntries?: KnowledgeEntry[];
  seedSources?: LinguisticSource[];
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stable JSON for the knowledge file: sources and entries sorted by id, keys in schema order,
 * 2-space indentation, trailing newline. Re-saving unchanged data produces an identical file.
 */
export function serializeKnowledgeState(entries: KnowledgeEntry[], sources: LinguisticSource[]): string {
  const state: PersistedState = {
    version: 1,
    sources: [...sources].map((s) => linguisticSourceSchema.parse(s)).sort(byId),
    entries: [...entries].map((e) => knowledgeEntrySchema.parse(e)).sort(byId),
  };
  return `${JSON.stringify(state, null, 2)}\n`;
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
  private readOnly: boolean;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: InMemoryKnowledgeStoreOptions = {}) {
    this.persistPath = options.persistPath;
    this.readOnly = options.readOnly ?? false;
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
    for (const token of new Set([...tokenize(entry.sourceText), ...lookupTokens(entry.sourceText)])) {
      let set = this.index.get(token);
      if (!set) {
        set = new Set();
        this.index.set(token, set);
      }
      set.add(entry.id);
    }
  }

  private removeFromIndex(entry: KnowledgeEntry): void {
    for (const token of new Set([...tokenize(entry.sourceText), ...lookupTokens(entry.sourceText)])) {
      this.index.get(token)?.delete(entry.id);
    }
    this.entries.delete(entry.id);
  }

  /** Serialise the store deterministically so the versioned file gives readable Git diffs. */
  serialize(): string {
    return serializeKnowledgeState([...this.entries.values()], [...this.sources.values()]);
  }

  private persist(): Promise<void> {
    if (!this.persistPath || this.readOnly) return Promise.resolve();
    const p = this.persistPath;
    const content = this.serialize();
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      await fs.writeFile(tmp, content, "utf8");
      // On Windows the target can be briefly locked (editor, indexer, antivirus): retry with
      // backoff instead of failing the whole import.
      for (let attempt = 1; ; attempt++) {
        try {
          await fs.rename(tmp, p);
          break;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt >= 8) throw err;
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      }
    });
    return this.writeQueue;
  }

  async searchCandidates(query: string, options: KnowledgeSearchOptions): Promise<KnowledgeEntry[]> {
    // Content words (+ singular forms) only: function words such as "les" match hundreds of
    // entries and would fill the candidate limit before the meaningful word is reached.
    const tokens = new Set(lookupTokens(query));
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
