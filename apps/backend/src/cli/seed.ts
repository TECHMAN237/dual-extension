/**
 * Seeds linguistic sources (and the empty UI term list) into the configured store.
 * Safe to run repeatedly. Usage: pnpm --filter @douala-ai/backend seed
 * (The server also does this automatically on first start with an empty Supabase database.)
 */
import { createContainer } from "../container";
import { loadConfig } from "../config";
import { seedStore } from "../seed";

async function main() {
  const config = loadConfig();
  const c = await createContainer(config);
  const { sources, terms } = await seedStore(c.store);
  console.log(`Seeded ${sources} sources and ${terms} UI terms (empty targets) into ${c.store.kind} store.`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
