import { LIMITS } from "@douala-ai/shared";
import type { TranslationItem } from "@douala-ai/shared";

/** Split items into batches honouring the backend's item and character limits. */
export function chunkItems(items: TranslationItem[], maxItems = LIMITS.maxBatchItems, maxChars = LIMITS.maxBatchChars): TranslationItem[][] {
  const batches: TranslationItem[][] = [];
  let current: TranslationItem[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= maxItems || chars + item.text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Run async tasks with a concurrency limit, resolving when all settle. */
export async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]!() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
