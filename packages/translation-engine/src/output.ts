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
          glosses: [],
          notFound: [],
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

/** Letters that do not occur in French spelling: a quoted form containing one is Duala. */
const NON_FRENCH = /[^a-zàâäçéèêëîïôöùûüÿœæ'’\s\-.,;!?«»"()0-9]/i;

/**
 * Duala words documented in the grammar sheet: the Duala side (left of " = ") of every
 * "- Exemple :" line, and quoted forms in the rule text that contain a non-French letter
 * (tones, ɓ ɗ ɛ ɔ ŋ, macron below…). French glosses in quotes are not included.
 */
export function grammarSheetDualaWords(sheet: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const w of wordTokens(s)) for (const p of [w, ...w.split("'")]) if (p) out.add(p);
  };
  for (const raw of sheet.split(/\r?\n/)) {
    const line = raw.trim();
    const example = /^-\s*Exemple\s*:\s*(.+)$/.exec(line);
    if (example) {
      for (const part of example[1]!.split(";")) {
        const left = part.split(" = ")[0] ?? "";
        for (const m of left.matchAll(/«\s*([^»]+?)\s*»/g)) add(m[1]!);
      }
      continue;
    }
    if (line.startsWith("- Source") || line.startsWith("#")) continue;
    for (const m of line.matchAll(/«\s*([^»]+?)\s*»/g)) if (NON_FRENCH.test(m[1]!)) add(m[1]!);
  }
  return out;
}

export type CompositionCheck = { ok: true; dualaWords: string[] } | { ok: false; reason: string };

/**
 * Anti-invention check for a composed translation. Every word must come from:
 *  - the Duala texts of the lexicon or the examples given in the request,
 *  - the Duala forms of the grammar sheet,
 *  - or the source segment itself (a word kept as a loan).
 * A translation made only of source words translates nothing and is rejected too.
 */
export function checkComposition(source: string, translation: string, allowedDuala: Set<string>): CompositionCheck {
  const sourceWords = new Set(wordTokens(source).flatMap((t) => [t, ...t.split("'")]));
  const out = wordTokens(translation);
  const unknown = out.filter((t) => !sourceWords.has(t) && !allowedDuala.has(t) && !t.split("'").every((p) => !p || sourceWords.has(p) || allowedDuala.has(p)));
  if (unknown.length > 0) return { ok: false, reason: `words neither in the documentation nor in the source text: ${[...new Set(unknown)].slice(0, 5).join(", ")}` };
  const dualaWords = out.filter((t) => allowedDuala.has(t) && !sourceWords.has(t));
  if (dualaWords.length === 0) return { ok: false, reason: "no Duala word from the documentation" };
  return { ok: true, dualaWords };
}

/**
 * Evidence from dictionary coverage of the content words:
 * high ≥ 80 % with verified entries only, moderate ≥ 80 %, low ≥ 30 %, otherwise unverified.
 */
export function coverageEvidence(found: number, total: number, allVerified: boolean): "high" | "moderate" | "low" | "unverified" {
  if (total === 0 || found === 0) return "unverified";
  const ratio = found / total;
  if (ratio >= 0.8) return allVerified ? "high" : "moderate";
  if (ratio >= 0.3) return "low";
  return "unverified";
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
