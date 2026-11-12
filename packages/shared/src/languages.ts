/**
 * Language registry.
 *
 * Douala (ISO 639-3: dua) is the only target language in v1, but the registry is
 * designed so additional Cameroonian languages can be added by appending an
 * entry here and in the `languages` database table.
 */
export interface LanguageDefinition {
  /** ISO 639-1 (when it exists) or ISO 639-3 code used throughout the system. */
  code: string;
  /** ISO 639-3 code. */
  iso6393: string;
  /** English display name. */
  name: string;
  /** Name in the language itself when known. */
  nativeName: string;
  /** Whether the language can be a translation source. */
  isSource: boolean;
  /** Whether the language can be a translation target. */
  isTarget: boolean;
  /** Glottolog identifier when known. */
  glottocode?: string;
  /** Regions where the language is spoken. */
  region?: string;
}

export const LANGUAGES: readonly LanguageDefinition[] = [
  {
    code: "en",
    iso6393: "eng",
    name: "English",
    nativeName: "English",
    isSource: true,
    isTarget: false,
  },
  {
    code: "fr",
    iso6393: "fra",
    name: "French",
    nativeName: "Français",
    isSource: true,
    isTarget: false,
  },
  {
    code: "dua",
    iso6393: "dua",
    name: "Douala",
    nativeName: "Duálá",
    isSource: false,
    isTarget: true,
    glottocode: "dual1243",
    region: "Littoral Region, Cameroon",
  },
] as const;

export type SourceLanguageCode = "en" | "fr";
export type TargetLanguageCode = "dua";
export type LanguageCode = SourceLanguageCode | TargetLanguageCode;
export type SourceLanguageSelection = SourceLanguageCode | "auto";

export const SOURCE_LANGUAGE_CODES = ["en", "fr"] as const satisfies readonly SourceLanguageCode[];
export const TARGET_LANGUAGE_CODES = ["dua"] as const satisfies readonly TargetLanguageCode[];

export function getLanguage(code: string): LanguageDefinition | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function isSourceLanguage(code: string): code is SourceLanguageCode {
  return (SOURCE_LANGUAGE_CODES as readonly string[]).includes(code);
}

export function isTargetLanguage(code: string): code is TargetLanguageCode {
  return (TARGET_LANGUAGE_CODES as readonly string[]).includes(code);
}
