import type { KnowledgeEntry, LinguisticSource, SourceLanguageCode, TargetLanguageCode } from "@douala-ai/shared";

export interface KnowledgeSearchOptions {
  sourceLanguage?: SourceLanguageCode;
  targetLanguage: TargetLanguageCode;
  /** Maximum candidates returned by the store (the ranker trims further). */
  limit?: number;
  includeUnverified?: boolean;
}

/** Input for creating or updating a knowledge entry. `id` is optional on insert. */
export type KnowledgeEntryInput = Omit<KnowledgeEntry, "id" | "extractedAt" | "tags"> & {
  id?: string;
  extractedAt?: string;
  tags?: string[];
};

/**
 * Storage abstraction for the linguistic knowledge base.
 *
 * Two implementations ship with the prototype:
 *  - InMemoryKnowledgeStore (optionally persisted to a JSON file) for local mode.
 *  - SupabaseKnowledgeStore for cloud mode.
 */
export interface KnowledgeStore {
  readonly kind: "memory" | "supabase";
  /**
   * Candidate lookup. Implementations return entries whose normalised source
   * text shares tokens with the query. Ranking happens in `retrieval.ts` so that
   * behaviour is identical regardless of storage backend.
   */
  searchCandidates(query: string, options: KnowledgeSearchOptions): Promise<KnowledgeEntry[]>;
  getEntries(ids: string[]): Promise<KnowledgeEntry[]>;
  upsertEntries(entries: KnowledgeEntryInput[]): Promise<KnowledgeEntry[]>;
  updateEntryStatus(id: string, status: KnowledgeEntry["validationStatus"], note?: string): Promise<KnowledgeEntry | null>;
  listEntries(options: { status?: KnowledgeEntry["validationStatus"]; sourceId?: string; limit?: number; offset?: number }): Promise<KnowledgeEntry[]>;
  countEntries(): Promise<number>;
  listSources(): Promise<LinguisticSource[]>;
  getSource(id: string): Promise<LinguisticSource | null>;
  upsertSource(source: LinguisticSource): Promise<LinguisticSource>;
}
