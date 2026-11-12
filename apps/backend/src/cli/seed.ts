/**
 * Seeds linguistic sources (and the empty UI term list) into the configured store.
 * Safe to run repeatedly. Usage: pnpm --filter @douala-ai/backend seed
 */
import { loadSeedSources, loadSeedUiTerms } from "@douala-ai/linguistic-knowledge";
import { createContainer } from "../container";
import { loadConfig } from "../config";

async function main() {
  const config = loadConfig();
  const c = await createContainer(config);
  for (const s of loadSeedSources()) {
    const existing = await c.store.getSource(s.id);
    await c.store.upsertSource(existing ? { ...s, ingestionStatus: existing.ingestionStatus, lastIngestedAt: existing.lastIngestedAt, notes: existing.notes ?? s.notes } : s);
  }
  const terms = loadSeedUiTerms();
  await c.store.upsertEntries(terms);
  console.log(`Seeded ${loadSeedSources().length} sources and ${terms.length} UI terms (empty targets) into ${c.store.kind} store.`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
