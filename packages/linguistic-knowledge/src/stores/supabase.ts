import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { knowledgeEntrySchema, linguisticSourceSchema, normalizeForLookup, tokenize } from "@douala-ai/shared";
import type { KnowledgeEntry, LinguisticSource } from "@douala-ai/shared";
import type { KnowledgeEntryInput, KnowledgeSearchOptions, KnowledgeStore } from "../store";

/** Row shape of the `linguistic_knowledge` table (see supabase/migrations). */
interface KnowledgeRow {
  id: string;
  source_language: string;
  target_language: string;
  source_text: string;
  source_text_normalized: string;
  target_text: string | null;
  category: string;
  context: string | null;
  example: string | null;
  note: string | null;
  source_id: string | null;
  source_name: string;
  source_url: string | null;
  reference: string | null;
  origin: string;
  validation_status: string;
  reliability: string;
  extracted_at: string;
  tags: string[] | null;
}

interface SourceRow {
  id: string;
  name: string;
  url: string | null;
  type: string;
  reliability: string;
  languages: string[] | null;
  accessibility: string;
  license: string | null;
  notes: string | null;
  ingestion_status: string;
  last_ingested_at: string | null;
}

function rowToEntry(row: KnowledgeRow): KnowledgeEntry {
  return knowledgeEntrySchema.parse({
    id: row.id,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    sourceText: row.source_text,
    targetText: row.target_text,
    category: row.category,
    context: row.context,
    example: row.example,
    note: row.note,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    reference: row.reference,
    origin: row.origin,
    validationStatus: row.validation_status,
    reliability: row.reliability,
    extractedAt: row.extracted_at,
    tags: row.tags ?? [],
  });
}

function entryToRow(e: KnowledgeEntryInput & { id?: string }): Partial<KnowledgeRow> {
  const row: Partial<KnowledgeRow> = {
    source_language: e.sourceLanguage,
    target_language: e.targetLanguage,
    source_text: e.sourceText,
    source_text_normalized: normalizeForLookup(e.sourceText),
    target_text: e.targetText,
    category: e.category,
    context: e.context,
    example: e.example,
    note: e.note,
    source_id: e.sourceId,
    source_name: e.sourceName,
    source_url: e.sourceUrl,
    reference: e.reference,
    origin: e.origin,
    validation_status: e.validationStatus,
    reliability: e.reliability,
    tags: e.tags ?? [],
  };
  if (e.id) row.id = e.id;
  if (e.extractedAt) row.extracted_at = e.extractedAt;
  return row;
}

function rowToSource(row: SourceRow): LinguisticSource {
  return linguisticSourceSchema.parse({
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    reliability: row.reliability,
    languages: row.languages ?? [],
    accessibility: row.accessibility,
    license: row.license,
    notes: row.notes,
    ingestionStatus: row.ingestion_status,
    lastIngestedAt: row.last_ingested_at,
  });
}

/**
 * Supabase-backed knowledge store. Must be constructed with the SERVICE ROLE key
 * on the backend only. Never ship this client to the extension.
 */
export class SupabaseKnowledgeStore implements KnowledgeStore {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string, client?: SupabaseClient) {
    this.client = client ?? createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async searchCandidates(query: string, options: KnowledgeSearchOptions): Promise<KnowledgeEntry[]> {
    const tokens = [...new Set(tokenize(query))].slice(0, 12);
    const normalized = normalizeForLookup(query);
    let q = this.client
      .from("linguistic_knowledge")
      .select("*")
      .eq("target_language", options.targetLanguage)
      .neq("validation_status", "rejected")
      .limit(options.limit ?? 200);
    if (options.sourceLanguage) q = q.eq("source_language", options.sourceLanguage);
    if (options.includeUnverified === false) q = q.eq("validation_status", "verified");
    if (tokens.length > 0) {
      // Full-text search on the normalised source text; `websearch` handles multi-word queries.
      q = q.or(
        [
          `source_text_normalized.eq.${normalized.replace(/,/g, " ")}`,
          `source_text_normalized.wfts.${tokens.join(" ")}`,
        ].join(","),
      );
    } else {
      q = q.eq("source_text_normalized", normalized);
    }
    const { data, error } = await q;
    if (error) throw new Error(`Supabase search failed: ${error.message}`);
    return (data as KnowledgeRow[]).map(rowToEntry);
  }

  async getEntries(ids: string[]): Promise<KnowledgeEntry[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client.from("linguistic_knowledge").select("*").in("id", ids);
    if (error) throw new Error(`Supabase getEntries failed: ${error.message}`);
    return (data as KnowledgeRow[]).map(rowToEntry);
  }

  async upsertEntries(entries: KnowledgeEntryInput[]): Promise<KnowledgeEntry[]> {
    const rows = entries.map(entryToRow);
    const { data, error } = await this.client.from("linguistic_knowledge").upsert(rows, { onConflict: "id" }).select("*");
    if (error) throw new Error(`Supabase upsertEntries failed: ${error.message}`);
    return (data as KnowledgeRow[]).map(rowToEntry);
  }

  async updateEntryStatus(id: string, status: KnowledgeEntry["validationStatus"], note?: string): Promise<KnowledgeEntry | null> {
    const patch: Partial<KnowledgeRow> = { validation_status: status };
    if (note !== undefined) patch.note = note;
    const { data, error } = await this.client.from("linguistic_knowledge").update(patch).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Supabase updateEntryStatus failed: ${error.message}`);
    return data ? rowToEntry(data as KnowledgeRow) : null;
  }

  async listEntries(options: { status?: KnowledgeEntry["validationStatus"]; sourceId?: string; limit?: number; offset?: number }): Promise<KnowledgeEntry[]> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    let q = this.client.from("linguistic_knowledge").select("*").order("extracted_at", { ascending: false }).range(offset, offset + limit - 1);
    if (options.status) q = q.eq("validation_status", options.status);
    if (options.sourceId) q = q.eq("source_id", options.sourceId);
    const { data, error } = await q;
    if (error) throw new Error(`Supabase listEntries failed: ${error.message}`);
    return (data as KnowledgeRow[]).map(rowToEntry);
  }

  async countEntries(): Promise<number> {
    const { count, error } = await this.client.from("linguistic_knowledge").select("id", { count: "exact", head: true });
    if (error) throw new Error(`Supabase countEntries failed: ${error.message}`);
    return count ?? 0;
  }

  async listSources(): Promise<LinguisticSource[]> {
    const { data, error } = await this.client.from("linguistic_sources").select("*").order("name");
    if (error) throw new Error(`Supabase listSources failed: ${error.message}`);
    return (data as SourceRow[]).map(rowToSource);
  }

  async getSource(id: string): Promise<LinguisticSource | null> {
    const { data, error } = await this.client.from("linguistic_sources").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase getSource failed: ${error.message}`);
    return data ? rowToSource(data as SourceRow) : null;
  }

  async upsertSource(source: LinguisticSource): Promise<LinguisticSource> {
    const row: SourceRow = {
      id: source.id,
      name: source.name,
      url: source.url,
      type: source.type,
      reliability: source.reliability,
      languages: source.languages,
      accessibility: source.accessibility,
      license: source.license,
      notes: source.notes,
      ingestion_status: source.ingestionStatus,
      last_ingested_at: source.lastIngestedAt,
    };
    const { data, error } = await this.client.from("linguistic_sources").upsert(row, { onConflict: "id" }).select("*").single();
    if (error) throw new Error(`Supabase upsertSource failed: ${error.message}`);
    return rowToSource(data as SourceRow);
  }
}
