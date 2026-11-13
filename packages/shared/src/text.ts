/**
 * Text utilities shared by the extension scanner and the backend engine.
 */

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_RE = /^[\s\d.,:;%$€£¥+\-/()*#°]*$/;
const IDENTIFIER_RE = /^[A-Za-z0-9_\-.]{1,}$/;
const HAS_LETTER_RE = /\p{L}/u;

/** Collapse whitespace and trim. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Lower-case, strip diacritics and punctuation: used for cache keys and lexical lookup. */
export function normalizeForLookup(text: string): string {
  return normalizeWhitespace(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when a text should not be sent for translation at all:
 * URLs, email addresses, pure numbers, technical identifiers, empty strings.
 */
export function isUntranslatableText(raw: string): boolean {
  const text = normalizeWhitespace(raw);
  if (!text) return true;
  if (!HAS_LETTER_RE.test(text)) return true;
  if (URL_RE.test(text)) return true;
  if (EMAIL_RE.test(text)) return true;
  if (NUMERIC_RE.test(text)) return true;
  // Single-token identifiers such as `user_id`, `v1.2.3`, `camelCaseToken`. A sentence-final
  // period is not part of the token: "Payer." is a word, not an identifier.
  const token = text.replace(/[.!?…:]+$/, "");
  if (!token.includes(" ") && IDENTIFIER_RE.test(token) && /[_\-.]|[a-z][A-Z]/.test(token)) return true;
  return false;
}

/**
 * Tokenise for lexical matching. Elisions are split ("l'huilerie" → "l", "huilerie") so that
 * the content word can be matched on its own; the elided article is a function word.
 */
export function tokenize(text: string): string[] {
  return normalizeForLookup(text)
    .split(/[\s']+/)
    .filter((t) => t.length > 0);
}

/**
 * French and English function words (articles, determiners, possessives, pronouns,
 * prepositions, conjunctions). They never create a match on their own: a reference is only
 * relevant if it shares a content word with the segment. Stored in normalised form
 * (lower case, no accents).
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // fr: articles, elided forms, determiners
  "le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "au", "aux",
  "ce", "cet", "cette", "ces", "c", "ca", "cela", "ceci",
  // fr: possessives
  "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs",
  // fr: pronouns
  "je", "j", "tu", "il", "elle", "on", "nous", "ils", "elles", "me", "m", "te", "t", "se", "s", "lui", "y", "en", "qui", "que", "qu", "quoi", "dont", "ou",
  // fr: prepositions, conjunctions, common particles
  "a", "et", "dans", "par", "pour", "sur", "sous", "avec", "sans", "chez", "vers", "entre", "mais", "donc", "or", "ni", "car", "si", "ne", "n", "pas", "plus", "tres", "tout", "toute", "tous", "toutes", "est", "sont",
  // en
  "the", "an", "of", "to", "in", "on", "at", "by", "for", "from", "with", "and", "or", "but", "your", "yours", "my", "our", "their", "his", "her", "its", "this", "that", "these", "those", "it", "is", "are", "be", "as", "into", "you", "we", "they", "i",
]);

/** Content words of a text: tokens minus function words. */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !FUNCTION_WORDS.has(t));
}

/**
 * Tokens used to find candidate entries: content words plus their singular form (so "transferts"
 * finds "transfert" and vice versa). Falls back to all tokens when the text has only function words.
 */
export function lookupTokens(text: string): string[] {
  const content = contentTokens(text);
  const base = content.length > 0 ? content : tokenize(text);
  return [...new Set(base.flatMap((t) => [t, singularize(t)]))];
}

/**
 * Simple plural → singular for dictionary keys: a final -s or -x, only on words of 5+ letters.
 * Short words are left alone because many end in -s/-x in the singular ("pays", "mois", "bras",
 * "prix") and would collide with other words ("pays" → "pay").
 */
function singularize(token: string): string {
  return token.length >= 5 && /[sx]$/.test(token) && !/ss$/.test(token) ? token.slice(0, -1) : token;
}

const LEADING_DETERMINER = /^(?:(?:le|la|les|un|une|des|du|the|a|an|to) +|(?:l|d)' *)+/;

/**
 * Key for exact dictionary matching: case, accents and punctuation removed (normalizeForLookup),
 * leading article dropped ("le solde" = "Solde", "l'huilerie" = "huilerie", "to buy" = "buy") and
 * simple plurals reduced ("transferts" = "transfert", "frais" and "frai" share a key).
 * Two texts with the same key are treated as the same lexical item.
 */
export function dictionaryKey(text: string): string {
  const stripped = normalizeForLookup(text).replace(LEADING_DETERMINER, "");
  return stripped
    .split(" ")
    .filter(Boolean)
    .map((w) => w.split("'").map(singularize).join("'"))
    .join(" ");
}

/** Stable, short hash (FNV-1a 32-bit, hex) for cache keys and ids. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
