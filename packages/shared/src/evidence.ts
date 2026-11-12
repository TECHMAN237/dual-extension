/**
 * Evidence levels describe how much linguistic support backs a translation.
 *
 * They are categorical on purpose: the system never presents a fabricated
 * numeric probability as a measured confidence.
 */
export const EVIDENCE_LEVELS = ["high", "moderate", "low", "unverified"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  high: "High evidence",
  moderate: "Moderate evidence",
  low: "Low evidence",
  unverified: "Unverified",
};

export const EVIDENCE_DESCRIPTIONS: Record<EvidenceLevel, string> = {
  high: "Backed by a verified dictionary entry, approved correction, or verified translation pair that matches the source text.",
  moderate: "Backed by verified references covering most of the source text, or by unverified entries extracted from an established source.",
  low: "Only partial or indirect references were available; the model had to generalise.",
  unverified: "No linguistic reference supported this output. Treat it as an AI suggestion that needs human review.",
};

/** Validation status of a knowledge entry or a correction. */
export const VALIDATION_STATUSES = ["pending", "verified", "rejected"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** Who or what produced a knowledge entry. */
export const KNOWLEDGE_ORIGINS = [
  "verified_source",
  "extracted_unverified",
  "ai_suggestion",
  "user_correction",
] as const;
export type KnowledgeOrigin = (typeof KNOWLEDGE_ORIGINS)[number];

export const KNOWLEDGE_CATEGORIES = [
  "vocabulary",
  "expression",
  "grammar_rule",
  "conjugation_rule",
  "sentence_example",
  "translation_pair",
  "contextual_meaning",
  "language_variant",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const SOURCE_RELIABILITIES = ["academic", "institutional", "established", "community", "unknown"] as const;
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];

/** Rank used when ordering references: higher is more trustworthy. */
export const RELIABILITY_RANK: Record<SourceReliability, number> = {
  academic: 5,
  institutional: 4,
  established: 3,
  community: 2,
  unknown: 1,
};
