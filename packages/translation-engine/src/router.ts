import type { EngineConfig } from "./config";

export type ModelTier = "fast" | "capable";

/**
 * Cost-conscious model selection. Short interface strings go to the fast model; long text
 * (several sentences or more than 25 words) goes to the capable model. Both are configurable.
 */
export function selectTier(text: string): ModelTier {
  const words = text.split(/\s+/).length;
  const sentences = (text.match(/[.!?]+(\s|$)/g) ?? []).length;
  return words > 25 || sentences >= 2 ? "capable" : "fast";
}

export function modelForTier(config: EngineConfig, tier: ModelTier): string {
  return tier === "fast" ? (config.fastModel ?? config.model) : config.model;
}

/** Split items into batches so each LLM request stays small and the tiers stay homogeneous. */
export function partitionTexts<T extends { text: string }>(items: T[], batchSize: number): { tier: ModelTier; items: T[] }[] {
  const fast: T[] = [];
  const capable: T[] = [];
  for (const item of items) (selectTier(item.text) === "fast" ? fast : capable).push(item);
  const out: { tier: ModelTier; items: T[] }[] = [];
  for (let i = 0; i < fast.length; i += batchSize) out.push({ tier: "fast", items: fast.slice(i, i + batchSize) });
  const capableBatch = Math.max(1, Math.floor(batchSize / 2));
  for (let i = 0; i < capable.length; i += capableBatch) out.push({ tier: "capable", items: capable.slice(i, i + capableBatch) });
  return out;
}
