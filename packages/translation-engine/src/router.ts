import type { EngineConfig } from "./config";
import type { PromptItem } from "./prompt";

export type ModelTier = "fast" | "capable";

/**
 * Cost-conscious model selection.
 *
 * Ordinary short interface strings that have supporting references go to the
 * fast model. Long or ambiguous segments (several sentences, no references,
 * body text) go to the capable model. Both are configurable via environment.
 */
export function selectTier(items: PromptItem[]): ModelTier {
  for (const item of items) {
    const words = item.text.split(/\s+/).length;
    const sentences = (item.text.match(/[.!?]+(\s|$)/g) ?? []).length;
    const hasGoodReference = item.references.some((r) => r.target && (r.match === "exact" || r.match === "contained"));
    if (words > 25 || sentences >= 2) return "capable";
    if (!hasGoodReference && words > 6) return "capable";
    if (item.context === "body text" && words > 12) return "capable";
  }
  return "fast";
}

export function modelForTier(config: EngineConfig, tier: ModelTier): string {
  return tier === "fast" ? (config.fastModel ?? config.model) : config.model;
}

/** Split items into batches so each LLM request stays small and the tiers stay homogeneous. */
export function partitionItems(items: PromptItem[], batchSize: number): { tier: ModelTier; items: PromptItem[] }[] {
  const fast: PromptItem[] = [];
  const capable: PromptItem[] = [];
  for (const item of items) (selectTier([item]) === "fast" ? fast : capable).push(item);
  const out: { tier: ModelTier; items: PromptItem[] }[] = [];
  for (let i = 0; i < fast.length; i += batchSize) out.push({ tier: "fast", items: fast.slice(i, i + batchSize) });
  const capableBatch = Math.max(1, Math.floor(batchSize / 2));
  for (let i = 0; i < capable.length; i += capableBatch) out.push({ tier: "capable", items: capable.slice(i, i + capableBatch) });
  return out;
}
