import type { ExtractedPair } from "./types";

const DEFAULT_SEPARATOR = /\s+(?:[—–:=]|->|→)\s+/;

/**
 * Extract "headword — gloss" style pairs from already-extracted PDF text.
 * Text extraction itself is done by `extractPdfText` (pdf-parse) so that this
 * function stays pure and testable.
 */
export function extractPairsFromText(text: string, separator: RegExp = DEFAULT_SEPARATOR, pageHint?: (lineIndex: number) => string | null): ExtractedPair[] {
  const out: ExtractedPair[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || line.length > 300) return;
    const parts = line.split(separator);
    if (parts.length !== 2) return;
    const [a, b] = parts as [string, string];
    if (!a || !b || a.length > 80) return;
    out.push({ sourceText: a, targetText: b, reference: pageHint?.(i) ?? `line ${i + 1}` });
  });
  return out;
}

/** Extract plain text from a PDF buffer using pdf-parse (lazy import keeps startup fast). */
export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const mod = await import("pdf-parse");
  const PDFParse = (mod as unknown as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string; total?: number }> ; destroy?: () => Promise<void> } }).PDFParse;
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy?.();
  return { text: result.text, pages: result.total ?? 0 };
}
