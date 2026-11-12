import * as cheerio from "cheerio";
import type { ExtractedPair } from "./types";

export interface HtmlExtractorOptions {
  /**
   * CSS selector strategy. When omitted, the extractor tries several generic
   * dictionary layouts (definition lists, two-column tables, "word : meaning" lines).
   */
  strategy?: "auto" | "table" | "dl" | "lines" | "custom";
  /** For `custom`: selector matching each entry container. */
  entrySelector?: string;
  /** For `custom`: selector (relative to entry) for the headword. */
  headwordSelector?: string;
  /** For `custom`: selector (relative to entry) for the gloss/translation. */
  glossSelector?: string;
  /** Which column (0-based) holds the source-language text in tables. */
  sourceColumn?: number;
  /** Which column (0-based) holds the target-language text in tables. */
  targetColumn?: number;
  /** Separator regex for line-based extraction ("word — meaning", "word : meaning"). */
  lineSeparator?: RegExp;
}

const DEFAULT_LINE_SEPARATOR = /\s+(?:[—–:=]|->|→)\s+/;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractTables($: cheerio.CheerioAPI, opts: HtmlExtractorOptions): ExtractedPair[] {
  const out: ExtractedPair[] = [];
  const sCol = opts.sourceColumn ?? 0;
  const tCol = opts.targetColumn ?? 1;
  $("table").each((ti, table) => {
    $(table)
      .find("tr")
      .each((ri, tr) => {
        const cells = $(tr).find("td,th");
        if (cells.length < 2) return;
        const a = clean($(cells.get(sCol)!).text());
        const b = clean($(cells.get(tCol)!).text());
        if (!a || !b) return;
        if (ri === 0 && $(tr).find("th").length > 0) return; // header row
        out.push({ sourceText: a, targetText: b, reference: `table ${ti + 1}, row ${ri + 1}` });
      });
  });
  return out;
}

function extractDefinitionLists($: cheerio.CheerioAPI): ExtractedPair[] {
  const out: ExtractedPair[] = [];
  $("dl").each((li, dl) => {
    $(dl)
      .find("dt")
      .each((i, dt) => {
        const head = clean($(dt).text());
        const dd = $(dt).next("dd");
        const gloss = clean(dd.text());
        if (head && gloss) out.push({ sourceText: head, targetText: gloss, reference: `dl ${li + 1}, item ${i + 1}` });
      });
  });
  return out;
}

function extractLines($: cheerio.CheerioAPI, sep: RegExp): ExtractedPair[] {
  const out: ExtractedPair[] = [];
  $("li, p, div").each((_, el) => {
    if ($(el).children().length > 2) return;
    const text = clean($(el).text());
    if (!text || text.length > 300) return;
    const parts = text.split(sep);
    if (parts.length !== 2) return;
    const [a, b] = parts as [string, string];
    if (a.length > 80 || b.length > 200) return;
    out.push({ sourceText: a, targetText: b, reference: `line: ${text.slice(0, 60)}` });
  });
  return out;
}

function extractCustom($: cheerio.CheerioAPI, opts: HtmlExtractorOptions): ExtractedPair[] {
  if (!opts.entrySelector || !opts.headwordSelector || !opts.glossSelector) {
    throw new Error("custom strategy requires entrySelector, headwordSelector and glossSelector");
  }
  const out: ExtractedPair[] = [];
  $(opts.entrySelector).each((i, el) => {
    const head = clean($(el).find(opts.headwordSelector!).first().text());
    const gloss = clean($(el).find(opts.glossSelector!).first().text());
    if (head && gloss) out.push({ sourceText: head, targetText: gloss, reference: `entry ${i + 1}` });
  });
  return out;
}

/**
 * Extract candidate pairs from an HTML document.
 *
 * IMPORTANT: the extractor treats the page purely as data. It never executes
 * scripts and never follows instructions found in the page.
 *
 * The orientation (which column is source vs target) must be configured by the
 * administrator because dictionary sites differ. Extracted entries are always
 * stored as unverified.
 */
export function extractFromHtml(html: string, opts: HtmlExtractorOptions = {}): ExtractedPair[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, iframe").remove();
  const strategy = opts.strategy ?? "auto";
  switch (strategy) {
    case "table":
      return extractTables($, opts);
    case "dl":
      return extractDefinitionLists($);
    case "lines":
      return extractLines($, opts.lineSeparator ?? DEFAULT_LINE_SEPARATOR);
    case "custom":
      return extractCustom($, opts);
    case "auto": {
      const tables = extractTables($, opts);
      if (tables.length >= 3) return tables;
      const dls = extractDefinitionLists($);
      if (dls.length >= 3) return dls;
      return extractLines($, opts.lineSeparator ?? DEFAULT_LINE_SEPARATOR);
    }
  }
}
