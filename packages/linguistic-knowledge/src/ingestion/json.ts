import { z } from "zod";
import { knowledgeCategorySchema } from "@douala-ai/shared";
import type { ExtractedPair } from "./types";

const jsonPairSchema = z.object({
  sourceText: z.string().min(1),
  targetText: z.string().nullable().default(null),
  category: knowledgeCategorySchema.optional(),
  context: z.string().nullable().optional(),
  example: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

/** Accepts either an array of pairs or `{ "entries": [...] }`. */
export function extractFromJson(raw: string): ExtractedPair[] {
  const parsed: unknown = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(list)) throw new Error("JSON must be an array of pairs or an object with an `entries` array");
  return list.map((item, i) => {
    const res = jsonPairSchema.safeParse(item);
    if (!res.success) throw new Error(`Invalid entry at index ${i}: ${res.error.message}`);
    return res.data;
  });
}
