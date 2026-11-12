import { z } from "zod";
import { EVIDENCE_LEVELS, KNOWLEDGE_CATEGORIES, KNOWLEDGE_ORIGINS, SOURCE_RELIABILITIES, VALIDATION_STATUSES } from "./evidence";
import { SOURCE_LANGUAGE_CODES, TARGET_LANGUAGE_CODES } from "./languages";

/* ------------------------------------------------------------------------- */
/* Limits                                                                     */
/* ------------------------------------------------------------------------- */

export const LIMITS = {
  /** Maximum characters of a single translatable segment. */
  maxSegmentLength: 2000,
  /** Maximum number of segments in a single batch request. */
  maxBatchItems: 60,
  /** Maximum total characters in a single batch request. */
  maxBatchChars: 20_000,
  /** Maximum length of a correction text. */
  maxCorrectionLength: 2000,
  /** Maximum length of a correction explanation. */
  maxExplanationLength: 1000,
  /** Maximum length of a knowledge search query. */
  maxSearchQueryLength: 200,
} as const;

/* ------------------------------------------------------------------------- */
/* Primitive schemas                                                          */
/* ------------------------------------------------------------------------- */

export const sourceLanguageSchema = z.enum(SOURCE_LANGUAGE_CODES);
export const sourceLanguageSelectionSchema = z.enum([...SOURCE_LANGUAGE_CODES, "auto"]);
export const targetLanguageSchema = z.enum(TARGET_LANGUAGE_CODES);
export const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS);
export const validationStatusSchema = z.enum(VALIDATION_STATUSES);
export const knowledgeOriginSchema = z.enum(KNOWLEDGE_ORIGINS);
export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES);
export const sourceReliabilitySchema = z.enum(SOURCE_RELIABILITIES);

/** Interface context where a text segment was found. Helps disambiguate UI strings. */
export const segmentContextSchema = z.enum([
  "heading",
  "paragraph",
  "button",
  "link",
  "navigation",
  "list_item",
  "label",
  "placeholder",
  "title_attribute",
  "alt_text",
  "aria_label",
  "table_cell",
  "form_description",
  "other",
]);
export type SegmentContext = z.infer<typeof segmentContextSchema>;

/* ------------------------------------------------------------------------- */
/* Translation                                                                */
/* ------------------------------------------------------------------------- */

export const translationItemSchema = z.object({
  /** Stable identifier chosen by the client so results can be mapped back to DOM nodes. */
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(LIMITS.maxSegmentLength),
  context: segmentContextSchema.default("other"),
});
export type TranslationItem = z.infer<typeof translationItemSchema>;

export const translateBatchRequestSchema = z
  .object({
    sourceLanguage: sourceLanguageSelectionSchema.default("auto"),
    targetLanguage: targetLanguageSchema.default("dua"),
    /** Domain of the page being translated. Used for context and history only. */
    domain: z.string().max(253).optional(),
    items: z.array(translationItemSchema).min(1).max(LIMITS.maxBatchItems),
  })
  .refine(
    (req) => req.items.reduce((n, i) => n + i.text.length, 0) <= LIMITS.maxBatchChars,
    { message: `Batch exceeds ${LIMITS.maxBatchChars} characters` },
  )
  .refine((req) => new Set(req.items.map((i) => i.id)).size === req.items.length, {
    message: "Item ids must be unique",
  });
export type TranslateBatchRequest = z.infer<typeof translateBatchRequestSchema>;

export const translateSingleRequestSchema = z.object({
  sourceLanguage: sourceLanguageSelectionSchema.default("auto"),
  targetLanguage: targetLanguageSchema.default("dua"),
  text: z.string().min(1).max(LIMITS.maxSegmentLength),
  context: segmentContextSchema.default("other"),
  domain: z.string().max(253).optional(),
});
export type TranslateSingleRequest = z.infer<typeof translateSingleRequestSchema>;

/** A linguistic reference that supported a translation. */
export const translationReferenceSchema = z.object({
  id: z.string(),
  category: knowledgeCategorySchema,
  sourceText: z.string(),
  targetText: z.string().nullable(),
  sourceName: z.string(),
  sourceUrl: z.string().nullable(),
  reference: z.string().nullable(),
  origin: knowledgeOriginSchema,
  validationStatus: validationStatusSchema,
  reliability: sourceReliabilitySchema,
  note: z.string().nullable().optional(),
});
export type TranslationReference = z.infer<typeof translationReferenceSchema>;

export const translationStatusSchema = z.enum([
  /** A translation was produced. */
  "translated",
  /** The engine declined to translate because evidence was insufficient. Original text should stay. */
  "uncertain",
  /** The text should not be translated (identifier, URL, number, name...). */
  "skipped",
  /** A provider or validation error occurred for this item. */
  "error",
]);
export type TranslationStatus = z.infer<typeof translationStatusSchema>;

export const translationResultSchema = z.object({
  id: z.string(),
  sourceText: z.string(),
  translatedText: z.string().nullable(),
  status: translationStatusSchema,
  evidence: evidenceLevelSchema,
  /** True when the item should be shown to a human reviewer. */
  needsReview: z.boolean(),
  references: z.array(translationReferenceSchema),
  /** Short explanation of uncertainty, in English or French. */
  note: z.string().nullable(),
  /** Whether the result came from cache. */
  cached: z.boolean().default(false),
});
export type TranslationResult = z.infer<typeof translationResultSchema>;

export const translateBatchResponseSchema = z.object({
  sourceLanguage: sourceLanguageSchema,
  targetLanguage: targetLanguageSchema,
  detectedLanguage: z
    .object({ language: sourceLanguageSchema, confidence: z.enum(["high", "medium", "low"]) })
    .nullable(),
  results: z.array(translationResultSchema),
  provider: z.string(),
  model: z.string().nullable(),
  /** True when the backend is running the clearly-labelled mock provider. */
  mock: z.boolean(),
  historyId: z.string().nullable().optional(),
});
export type TranslateBatchResponse = z.infer<typeof translateBatchResponseSchema>;

/* ------------------------------------------------------------------------- */
/* Scan analysis                                                              */
/* ------------------------------------------------------------------------- */

export const scanAnalyzeRequestSchema = z.object({
  domain: z.string().max(253).optional(),
  htmlLang: z.string().max(35).optional(),
  /** Sample of visible text used for language detection. */
  sampleText: z.string().max(5000),
  segmentCount: z.number().int().nonnegative().max(1_000_000),
});
export type ScanAnalyzeRequest = z.infer<typeof scanAnalyzeRequestSchema>;

export const scanAnalyzeResponseSchema = z.object({
  detectedLanguage: sourceLanguageSchema.nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  supported: z.boolean(),
  message: z.string().nullable(),
});
export type ScanAnalyzeResponse = z.infer<typeof scanAnalyzeResponseSchema>;

/* ------------------------------------------------------------------------- */
/* Corrections                                                                */
/* ------------------------------------------------------------------------- */

export const correctionSubmissionSchema = z.object({
  sourceLanguage: sourceLanguageSchema,
  targetLanguage: targetLanguageSchema.default("dua"),
  sourceText: z.string().min(1).max(LIMITS.maxSegmentLength),
  /** The translation the AI produced (may be null when the AI declined). */
  aiTranslation: z.string().max(LIMITS.maxSegmentLength).nullable(),
  proposedTranslation: z.string().min(1).max(LIMITS.maxCorrectionLength),
  explanation: z.string().max(LIMITS.maxExplanationLength).optional(),
  context: segmentContextSchema.default("other"),
  domain: z.string().max(253).optional(),
  /** Anonymous, client-generated identifier. Never an email or a name. */
  clientId: z.string().min(8).max(64),
});
export type CorrectionSubmission = z.infer<typeof correctionSubmissionSchema>;

export const correctionStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type CorrectionStatus = z.infer<typeof correctionStatusSchema>;

export const correctionRecordSchema = z.object({
  id: z.string(),
  sourceLanguage: sourceLanguageSchema,
  targetLanguage: targetLanguageSchema,
  sourceText: z.string(),
  aiTranslation: z.string().nullable(),
  proposedTranslation: z.string(),
  explanation: z.string().nullable(),
  context: segmentContextSchema,
  domain: z.string().nullable(),
  status: correctionStatusSchema,
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CorrectionRecord = z.infer<typeof correctionRecordSchema>;

export const correctionStatusQuerySchema = z.object({
  /** Comma-separated correction ids. */
  ids: z.string().max(2000).optional(),
  clientId: z.string().min(8).max(64).optional(),
});

/* ------------------------------------------------------------------------- */
/* History                                                                    */
/* ------------------------------------------------------------------------- */

export const historyRecordSchema = z.object({
  id: z.string(),
  domain: z.string(),
  sourceLanguage: sourceLanguageSchema,
  targetLanguage: targetLanguageSchema,
  translatedCount: z.number().int().nonnegative(),
  uncertainCount: z.number().int().nonnegative(),
  status: z.enum(["completed", "partial", "failed"]),
  createdAt: z.string(),
});
export type HistoryRecord = z.infer<typeof historyRecordSchema>;

/* ------------------------------------------------------------------------- */
/* Knowledge                                                                  */
/* ------------------------------------------------------------------------- */

export const knowledgeEntrySchema = z.object({
  id: z.string(),
  sourceLanguage: sourceLanguageSchema,
  targetLanguage: targetLanguageSchema,
  sourceText: z.string().min(1),
  /** Null when the entry records a term that still needs a verified translation. */
  targetText: z.string().nullable(),
  category: knowledgeCategorySchema,
  context: z.string().nullable(),
  example: z.string().nullable(),
  note: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceName: z.string(),
  sourceUrl: z.string().nullable(),
  /** Page, entry, or document reference inside the source. */
  reference: z.string().nullable(),
  origin: knowledgeOriginSchema,
  validationStatus: validationStatusSchema,
  reliability: sourceReliabilitySchema,
  extractedAt: z.string(),
  tags: z.array(z.string()).default([]),
});
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;

export const knowledgeSearchQuerySchema = z.object({
  q: z.string().min(1).max(LIMITS.maxSearchQueryLength),
  sourceLanguage: sourceLanguageSchema.optional(),
  targetLanguage: targetLanguageSchema.default("dua"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  includeUnverified: z.coerce.boolean().default(true),
});
export type KnowledgeSearchQuery = z.infer<typeof knowledgeSearchQuerySchema>;

export const linguisticSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  type: z.enum([
    "online_dictionary",
    "bilingual_dictionary",
    "grammar",
    "translation_platform",
    "academic_publication",
    "corpus",
    "vocabulary_database",
    "educational",
    "manual_entry",
    "community",
    "other",
  ]),
  reliability: sourceReliabilitySchema,
  languages: z.array(z.string()),
  accessibility: z.enum(["public", "restricted", "offline", "unknown", "blocked_in_build_environment"]),
  license: z.string().nullable(),
  notes: z.string().nullable(),
  ingestionStatus: z.enum(["not_ingested", "ingested", "partial", "failed"]).default("not_ingested"),
  lastIngestedAt: z.string().nullable().default(null),
});
export type LinguisticSource = z.infer<typeof linguisticSourceSchema>;

/** Manual ingestion payload: one or more entries typed or imported by an administrator. */
export const knowledgeIngestRequestSchema = z.object({
  sourceId: z.string().min(1).max(100),
  entries: z
    .array(
      z.object({
        sourceLanguage: sourceLanguageSchema,
        targetLanguage: targetLanguageSchema.default("dua"),
        sourceText: z.string().min(1).max(LIMITS.maxSegmentLength),
        targetText: z.string().max(LIMITS.maxSegmentLength).nullable(),
        category: knowledgeCategorySchema.default("vocabulary"),
        context: z.string().max(200).nullable().optional(),
        example: z.string().max(LIMITS.maxSegmentLength).nullable().optional(),
        note: z.string().max(1000).nullable().optional(),
        reference: z.string().max(300).nullable().optional(),
        validationStatus: validationStatusSchema.default("pending"),
        tags: z.array(z.string().max(50)).max(20).default([]),
      }),
    )
    .min(1)
    .max(500),
});
export type KnowledgeIngestRequest = z.infer<typeof knowledgeIngestRequestSchema>;

/* ------------------------------------------------------------------------- */
/* Health                                                                     */
/* ------------------------------------------------------------------------- */

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  mock: z.boolean(),
  storage: z.enum(["memory", "supabase"]),
  knowledgeEntries: z.number().int().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/* ------------------------------------------------------------------------- */
/* Error envelope                                                             */
/* ------------------------------------------------------------------------- */

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
