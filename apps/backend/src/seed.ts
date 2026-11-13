import { loadSeedSources, loadSeedUiTerms, type KnowledgeStore } from "@douala-ai/linguistic-knowledge";

/**
 * Seed the linguistic source registry and the (empty-target) UI term list.
 * Idempotent: existing sources keep their ingestion status and notes.
 */
export async function seedStore(store: KnowledgeStore): Promise<{ sources: number; terms: number }> {
  const sources = loadSeedSources();
  for (const s of sources) {
    const existing = await store.getSource(s.id);
    await store.upsertSource(existing ? { ...s, ingestionStatus: existing.ingestionStatus, lastIngestedAt: existing.lastIngestedAt, notes: existing.notes ?? s.notes } : s);
  }
  const terms = loadSeedUiTerms();
  await store.upsertEntries(terms);
  return { sources: sources.length, terms: terms.length };
}

/** Seed only when the knowledge table is empty (first start on a fresh Supabase project). */
export async function seedIfEmpty(store: KnowledgeStore): Promise<{ sources: number; terms: number } | null> {
  if ((await store.countEntries()) > 0) return null;
  return seedStore(store);
}
