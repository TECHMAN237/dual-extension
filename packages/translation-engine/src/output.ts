import { llmOutputSchema, type LlmOutput } from "./prompt";

export class MalformedOutputError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "MalformedOutputError";
  }
}

/**
 * Parse and validate model output. Performs safe recovery for common
 * formatting slips (markdown fences, prose around the JSON) but never
 * accepts output that fails schema validation.
 */
export function parseLlmOutput(raw: string, expectedIds: string[]): LlmOutput {
  const candidates = [raw.trim(), stripFences(raw), extractJsonObject(raw)].filter((c): c is string => Boolean(c));
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const json: unknown = JSON.parse(candidate);
      const parsed = llmOutputSchema.safeParse(json);
      if (!parsed.success) {
        lastError = parsed.error;
        continue;
      }
      return reconcile(parsed.data, expectedIds, raw);
    } catch (err) {
      lastError = err;
    }
  }
  throw new MalformedOutputError(`Model output is not valid JSON matching the schema: ${(lastError as Error)?.message ?? "unknown"}`, raw);
}

function stripFences(raw: string): string | null {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m?.[1]?.trim() ?? null;
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/** Ensure one output per expected id; unknown ids are dropped, missing ids become null translations. */
function reconcile(output: LlmOutput, expectedIds: string[], raw: string): LlmOutput {
  const byId = new Map(output.items.map((i) => [i.id, i]));
  const expected = new Set(expectedIds);
  const unknown = output.items.filter((i) => !expected.has(i.id));
  if (unknown.length > 0 && byId.size < expectedIds.length / 2) {
    throw new MalformedOutputError("Model output ids do not match the request", raw);
  }
  return {
    items: expectedIds.map(
      (id) =>
        byId.get(id) ?? {
          id,
          translation: null,
          evidence: "unverified" as const,
          usedReferenceIds: [],
          note: "The model did not return a result for this segment.",
        },
    ),
  };
}

/**
 * Word tokens for the anti-invention check: Unicode NFC, lower case, letters with their
 * combining marks (tones, macron below) kept, apostrophes unified. Diacritics are NOT removed:
 * a Duala word must be copied exactly as in the reference.
 */
export function wordTokens(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .split(/[^\p{L}\p{M}\p{N}']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 0 && /\p{L}/u.test(t));
}

/**
 * Anti-invention check for ASSISTED translations. The output is accepted only if
 *  - it contains at least one Duala word taken from the references given for the segment, and
 *  - every word is either in the source segment (kept as a loan) or in those references.
 * Elided forms ("l'argent") may be split by the model: their parts are accepted too.
 */
export function checkAssistedTranslation(source: string, translation: string, referenceTargets: string[]): { ok: true; usedTargets: string[] } | { ok: false; reason: string } {
  const sourceWords = new Set(wordTokens(source).flatMap((t) => [t, ...t.split("'")]));
  const refWords = new Set(referenceTargets.flatMap((r) => wordTokens(r).flatMap((t) => [t, ...t.split("'")])));
  const out = wordTokens(translation);
  const doualaUsed = out.filter((t) => refWords.has(t) && !sourceWords.has(t));
  if (doualaUsed.length === 0) return { ok: false, reason: "no Duala word from the references" };
  const unknown = out.filter((t) => !sourceWords.has(t) && !refWords.has(t) && !t.split("'").every((p) => !p || sourceWords.has(p) || refWords.has(p)));
  if (unknown.length > 0) return { ok: false, reason: `words not in the source nor in the references: ${[...new Set(unknown)].slice(0, 5).join(", ")}` };
  const used = referenceTargets.filter((r) => wordTokens(r).some((t) => doualaUsed.includes(t)));
  return { ok: true, usedTargets: used };
}

/**
 * Sanity checks applied to each translation before it reaches the page:
 * reject empty output, output identical to a placeholder, or output that
 * dropped a protected token (URL, placeholder, number) present in the source.
 */
export function validateTranslationText(source: string, translation: string | null): { ok: boolean; reason?: string } {
  if (translation === null) return { ok: true };
  const t = translation.trim();
  if (!t) return { ok: false, reason: "empty translation" };
  if (t.length > Math.max(400, source.length * 4)) return { ok: false, reason: "translation implausibly long" };
  if (/^\s*[{[]/.test(t) && /[}\]]\s*$/.test(t)) return { ok: false, reason: "translation looks like JSON" };
  const protectedTokens = source.match(/\{\{?[^}]+\}?\}|%[sd]|https?:\/\/\S+|\S+@\S+\.\S+/g) ?? [];
  for (const tok of protectedTokens) {
    if (!t.includes(tok)) return { ok: false, reason: `protected token ${tok} was altered` };
  }
  return { ok: true };
}
