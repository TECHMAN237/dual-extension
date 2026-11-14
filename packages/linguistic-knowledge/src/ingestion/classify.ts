/**
 * Audit of extracted glosses: is the French/English side a translation equivalent, a
 * description of the word, or a whole sentence?
 *
 *   "être dur" → "sense"          (kept as vocabulary)
 *   "exprime la surprise, le désespoir ou la douleur" → "definition"
 *   "aliment à base de maïs moulu enveloppé dans des feuilles et cuit" → "definition"
 *   "entrer dans la maison" / "só̱lo̱ ó ndábo" → "sentence" (shows word order)
 *
 * A definition is kept (category `contextual_meaning`, the description stored in the note) but
 * is never applied as a translation: it explains the Duala word, it does not translate it.
 */
export type GlossKind = "sense" | "definition" | "sentence";

const DESCRIPTIVE_START =
  /^((expr|poss|pron|adj|adv|pr[ée]p|conj|suff|pr[ée]f|part|abr|interj)\.\s|exprime|exprimant|onomatop[ée]e|interjection|particule|marque|marqueur|indique|indiquant|d[ée]signe|d[ée]signant|se dit|sert [àa]|servant [àa]|terme |nom (d'|d’|de |du |des |donn)|sorte d|esp[èe]ce d|vari[ée]t[ée] d|type d|genre d|appellation|cri |expression (de|d'|d’|qui)|formule|used (to|for|as)|expresses|expressing|indicates|marker|particle|a kind of|a type of|a species of|any of|name (of|for)|term (for|of|used)|onomatopoeia|salutation|(qui|celui qui|celle qui|ceux qui|ce qui) \S+ \S|onom\.|f\. (caus|réfl|récipr|appl|instr|intr|pronom)|passif |interrog\.|arch\.|obsc\.|vulg\.|nom vulg|qualif\.|se rapp\.)/i;

/** Number of words outside parentheses. */
function wordCount(text: string): number {
  return text
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w)).length;
}

/** Maximum length (in words) of a gloss still treated as a translation equivalent. */
export const MAX_SENSE_WORDS = 6;

export function classifyGloss(sourceText: string, targetText: string | null): GlossKind {
  const text = sourceText.trim();
  if (DESCRIPTIVE_START.test(text)) return "definition";
  const words = wordCount(text);
  const duala = targetText ? wordCount(targetText) : 0;
  if (words >= 4 && duala >= 3) return "sentence";
  if (words > MAX_SENSE_WORDS) return "definition";
  return "sense";
}
