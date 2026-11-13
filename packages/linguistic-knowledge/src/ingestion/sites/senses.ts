/**
 * Split a French/English gloss into separate senses, one knowledge entry per sense.
 *
 *   "maison, demeure ; foyer"        → ["maison", "demeure", "foyer"]
 *   "Il y a (indique l'existence)."  → ["il y a"]   (note: "indique l'existence")
 *   "manteau de laine porté en Perse" → kept whole (a description, not a list)
 *
 * `;` always separates senses. `,` separates senses only when every piece is short
 * (≤ 4 words) or every piece starts with an article ("la digue, le barrage d'un cours d'eau"),
 * i.e. the gloss is a list of senses rather than one descriptive sentence.
 * Text is never translated or invented: pieces are trimmed substrings of the gloss.
 */
export interface Sense {
  text: string;
  /** Parenthetical remark removed from the end of the sense, if any. */
  note: string | null;
}

/** Split on a separator that is not inside parentheses or brackets. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Dictionary senses usually start with an article/determiner ("la digue, le barrage d'un cours d'eau"). */
const STARTS_WITH_DETERMINER = /^(le|la|les|l['’]|un|une|des|du|de la|se|s['’]|the|a|an|to)\s*\S/i;

export interface SplitOptions {
  /** Lower-case a capitalised first word ("Partager" → "partager"). Default true (French dictionaries). */
  lowercaseFirst?: boolean;
}

function tidy(raw: string, opts: SplitOptions): Sense | null {
  let text = raw.replace(/\s+/g, " ").trim().replace(/^[-–—•·:]+\s*/, "").replace(/[.;,:]+$/, "").trim();
  let note: string | null = null;
  // Trailing "(remark)" becomes a note; a leading "(se) laver" is kept as is.
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(text);
  if (m && words(m[1]!) >= 1) {
    text = m[1]!.trim();
    note = m[2]!.trim();
  }
  text = text.replace(/[.;,:]+$/, "").trim();
  if (!text || !/\p{L}/u.test(text)) return null;
  // Dictionaries capitalise the first word of a definition; lower-case it unless it looks like
  // an acronym or proper noun sequence ("ONU", "Dieu" stays if followed by uppercase/digit).
  if (opts.lowercaseFirst !== false && /^\p{Lu}\p{Ll}/u.test(text)) text = text[0]!.toLowerCase() + text.slice(1);
  return { text, note };
}

export function splitSenses(gloss: string, opts: SplitOptions = {}): Sense[] {
  const out: Sense[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    // A piece that is only "(…)" qualifies the previous sense (e.g. a scientific name).
    const paren = /^\(([^()]+)\)[.;,]?$/.exec(raw.trim());
    if (paren) {
      const prev = out[out.length - 1];
      if (prev) prev.note = [prev.note, paren[1]!.trim()].filter(Boolean).join("; ");
      return;
    }
    const s = tidy(raw, opts);
    if (!s) return;
    const key = s.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const part of splitTopLevel(gloss.replace(/\s+/g, " ").trim(), ";")) {
    const pieces = splitTopLevel(part, ",").map((p) => p.trim()).filter(Boolean);
    const isList = pieces.every((p) => words(p.replace(/\([^)]*\)/g, "")) <= 4) || pieces.every((p) => STARTS_WITH_DETERMINER.test(p));
    if (pieces.length > 1 && isList) {
      for (const p of pieces) push(p);
    } else {
      push(part);
    }
  }
  return out;
}
