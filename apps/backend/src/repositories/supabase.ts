import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { correctionRecordSchema, historyRecordSchema, type CorrectionRecord, type CorrectionSubmission, type HistoryRecord } from "@douala-ai/shared";
import type { CorrectionsRepository, HistoryInput, HistoryRepository, Repositories, UsageInput, UsageRepository, UsageSummary } from "./types";

interface CorrectionRow {
  id: string;
  client_id: string;
  source_language: string;
  target_language: string;
  source_text: string;
  ai_translation: string | null;
  proposed_translation: string;
  explanation: string | null;
  context: string;
  domain: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCorrection(r: CorrectionRow): CorrectionRecord {
  return correctionRecordSchema.parse({
    id: r.id,
    sourceLanguage: r.source_language,
    targetLanguage: r.target_language,
    sourceText: r.source_text,
    aiTranslation: r.ai_translation,
    proposedTranslation: r.proposed_translation,
    explanation: r.explanation,
    context: r.context,
    domain: r.domain,
    status: r.status,
    reviewNote: r.review_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

class SupabaseCorrectionsRepository implements CorrectionsRepository {
  constructor(private client: SupabaseClient) {}

  async create(input: CorrectionSubmission): Promise<CorrectionRecord> {
    const { data, error } = await this.client
      .from("corrections")
      .insert({
        client_id: input.clientId,
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
        source_text: input.sourceText,
        ai_translation: input.aiTranslation,
        proposed_translation: input.proposedTranslation,
        explanation: input.explanation ?? null,
        context: input.context,
        domain: input.domain ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Supabase corrections.create failed: ${error.message}`);
    return rowToCorrection(data as CorrectionRow);
  }

  async getByIds(ids: string[]): Promise<CorrectionRecord[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client.from("corrections").select("*").in("id", ids);
    if (error) throw new Error(`Supabase corrections.getByIds failed: ${error.message}`);
    return (data as CorrectionRow[]).map(rowToCorrection);
  }

  async listByClient(clientId: string, limit = 100): Promise<CorrectionRecord[]> {
    const { data, error } = await this.client.from("corrections").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`Supabase corrections.listByClient failed: ${error.message}`);
    return (data as CorrectionRow[]).map(rowToCorrection);
  }

  async list(options: { status?: CorrectionRecord["status"]; limit?: number; offset?: number }): Promise<CorrectionRecord[]> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    let q = this.client.from("corrections").select("*").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (options.status) q = q.eq("status", options.status);
    const { data, error } = await q;
    if (error) throw new Error(`Supabase corrections.list failed: ${error.message}`);
    return (data as CorrectionRow[]).map(rowToCorrection);
  }

  async review(id: string, status: "approved" | "rejected", reviewNote: string | null, reviewer: string): Promise<CorrectionRecord | null> {
    const { data, error } = await this.client.from("corrections").update({ status, review_note: reviewNote }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Supabase corrections.review failed: ${error.message}`);
    if (!data) return null;
    const { error: reviewError } = await this.client.from("correction_reviews").insert({ correction_id: id, reviewer, decision: status, note: reviewNote });
    if (reviewError) throw new Error(`Supabase correction_reviews.insert failed: ${reviewError.message}`);
    return rowToCorrection(data as CorrectionRow);
  }

  async countRecent(clientId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.client.from("corrections").select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", sinceIso);
    if (error) throw new Error(`Supabase corrections.countRecent failed: ${error.message}`);
    return count ?? 0;
  }
}

class SupabaseHistoryRepository implements HistoryRepository {
  constructor(private client: SupabaseClient) {}
  async record(input: HistoryInput): Promise<HistoryRecord> {
    const { data, error } = await this.client
      .from("translation_history")
      .insert({
        client_id: input.clientId,
        domain: input.domain,
        source_language: input.sourceLanguage,
        target_language: input.targetLanguage,
        translated_count: input.translatedCount,
        uncertain_count: input.uncertainCount,
        status: input.status,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Supabase translation_history.insert failed: ${error.message}`);
    return toHistory(data as Record<string, unknown>);
  }
  async listByClient(clientId: string, limit = 50): Promise<HistoryRecord[]> {
    const { data, error } = await this.client.from("translation_history").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`Supabase translation_history.list failed: ${error.message}`);
    return (data as Record<string, unknown>[]).map(toHistory);
  }
}

function toHistory(r: Record<string, unknown>): HistoryRecord {
  return historyRecordSchema.parse({
    id: r.id,
    domain: r.domain,
    sourceLanguage: r.source_language,
    targetLanguage: r.target_language,
    translatedCount: r.translated_count,
    uncertainCount: r.uncertain_count,
    status: r.status,
    createdAt: r.created_at,
  });
}

class SupabaseUsageRepository implements UsageRepository {
  constructor(private client: SupabaseClient) {}
  async record(input: UsageInput): Promise<void> {
    const { error } = await this.client.from("api_usage").insert({
      client_id: input.clientId,
      provider: input.provider,
      model: input.model,
      tier: input.tier,
      items: input.items,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      duration_ms: input.durationMs,
      ok: input.ok,
      error: input.error ?? null,
    });
    if (error) throw new Error(`Supabase api_usage.insert failed: ${error.message}`);
  }
  async summary(sinceIso: string): Promise<UsageSummary> {
    const { data, error } = await this.client.from("api_usage").select("model, items, input_tokens, output_tokens, ok").gte("created_at", sinceIso).limit(10_000);
    if (error) throw new Error(`Supabase api_usage.summary failed: ${error.message}`);
    const summary: UsageSummary = { requests: 0, failures: 0, items: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
    for (const u of data as { model: string; items: number; input_tokens: number; output_tokens: number; ok: boolean }[]) {
      summary.requests++;
      if (!u.ok) summary.failures++;
      summary.items += u.items;
      summary.inputTokens += u.input_tokens;
      summary.outputTokens += u.output_tokens;
      const m = (summary.byModel[u.model] ??= { requests: 0, items: 0, inputTokens: 0, outputTokens: 0 });
      m.requests++;
      m.items += u.items;
      m.inputTokens += u.input_tokens;
      m.outputTokens += u.output_tokens;
    }
    return summary;
  }
}

export function createSupabaseRepositories(url: string, serviceRoleKey: string): Repositories & { client: SupabaseClient } {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return { client, corrections: new SupabaseCorrectionsRepository(client), history: new SupabaseHistoryRepository(client), usage: new SupabaseUsageRepository(client) };
}
