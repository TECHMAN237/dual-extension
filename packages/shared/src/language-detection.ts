import type { SourceLanguageCode } from "./languages";
import { tokenize } from "./text";

/**
 * Lightweight stop-word based detection between English and French.
 * This is deliberately simple and dependency-free so it can run inside the
 * content script. The backend uses the same routine and may be upgraded to a
 * statistical detector without changing the API contract.
 */
const EN_STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "is", "you", "that", "it", "for", "on", "with", "as", "are",
  "this", "be", "at", "or", "from", "your", "by", "an", "we", "our", "not", "have", "all", "can",
  "more", "about", "will", "if", "they", "their", "which", "has", "was", "but", "new", "learn",
  "sign", "search", "home", "contact", "help", "get", "page", "read", "view", "privacy", "terms",
]);

const FR_STOPWORDS = new Set([
  "le", "la", "les", "de", "des", "du", "et", "est", "un", "une", "pour", "dans", "que", "qui",
  "vous", "nous", "votre", "vos", "sur", "avec", "pas", "ce", "cette", "ces", "au", "aux", "en",
  "plus", "sont", "par", "ou", "il", "elle", "ils", "nos", "notre", "tout", "tous", "aussi",
  "accueil", "rechercher", "connexion", "aide", "contact", "lire", "voir", "savoir", "mentions",
  "à", "être", "très", "déjà", "où",
]);

export interface LanguageDetectionResult {
  language: SourceLanguageCode | null;
  confidence: "high" | "medium" | "low";
  scores: { en: number; fr: number };
}

export function detectSourceLanguage(text: string, htmlLang?: string | null): LanguageDetectionResult {
  const tokens = tokenize(text);
  let en = 0;
  let fr = 0;
  for (const t of tokens) {
    if (EN_STOPWORDS.has(t)) en++;
    if (FR_STOPWORDS.has(t)) fr++;
  }
  // Accented characters are a strong French signal in web UI text.
  const accents = (text.match(/[àâçéèêëîïôûùüÿœ]/gi) ?? []).length;
  fr += Math.min(accents, 20) * 0.5;

  const hint = (htmlLang ?? "").toLowerCase();
  if (hint.startsWith("fr")) fr += 3;
  if (hint.startsWith("en")) en += 3;

  const total = en + fr;
  if (total === 0) {
    return { language: null, confidence: "low", scores: { en, fr } };
  }
  const winner: SourceLanguageCode = fr > en ? "fr" : "en";
  const ratio = Math.max(en, fr) / total;
  const confidence: LanguageDetectionResult["confidence"] =
    total >= 8 && ratio >= 0.75 ? "high" : total >= 3 && ratio >= 0.6 ? "medium" : "low";
  return { language: winner, confidence, scores: { en, fr } };
}
