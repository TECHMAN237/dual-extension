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
  // Single-token identifiers such as `user_id`, `v1.2.3`, `camelCaseToken`.
  if (!text.includes(" ") && IDENTIFIER_RE.test(text) && /[_\-.]|[a-z][A-Z]/.test(text)) return true;
  return false;
}

/** Tokenise for lexical matching. */
export function tokenize(text: string): string[] {
  return normalizeForLookup(text)
    .split(" ")
    .filter((t) => t.length > 0);
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
