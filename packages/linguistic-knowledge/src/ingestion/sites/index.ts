import type { PoliteSession } from "../fetch";
import type { ExtractedPair } from "../types";
import { MBOASAWA_DICTIONARY_URL, mboasawaLetterUrl, mboasawaPairs, parseMboasawaLetterPage, parseMboasawaWordPage } from "./mboasawa";
import { WIKTIONARY_CATEGORY, wiktionaryPairs, type WikiLang, type WiktionaryPage } from "./wiktionary";

export * from "./senses";
export * from "./mboasawa";
export * from "./wiktionary";

/** A batch of pairs extracted from one document, with the document's URL. */
export interface CrawlBatch {
  url: string;
  label: string;
  pairs: ExtractedPair[];
}

export interface MboasawaCrawlOptions {
  session: PoliteSession;
  letters: string[];
  /** Stop after this many word pages (dry runs). */
  maxWords?: number;
  log?: (line: string) => void;
}

/**
 * Walk the letter pages (following `mboa_page` pagination) and open each word page.
 * Yields one batch per word page. Requests go through the session (rate limit, robots.txt,
 * stop on 403/429/CAPTCHA).
 */
export async function* crawlMboasawa(opts: MboasawaCrawlOptions): AsyncGenerator<CrawlBatch> {
  let words = 0;
  for (const letter of opts.letters) {
    let pageUrl: string | null = mboasawaLetterUrl(letter);
    let pageNo = 1;
    while (pageUrl) {
      const html = await opts.session.getText(pageUrl);
      if (html === null) {
        opts.log?.(`letter ${letter} page ${pageNo}: 404, skipped`);
        break;
      }
      const list = parseMboasawaLetterPage(html, pageUrl);
      opts.log?.(`letter ${letter} page ${pageNo}: ${list.words.length} headwords`);
      for (const w of list.words) {
        if (opts.maxWords !== undefined && words >= opts.maxWords) return;
        words++;
        const wordHtml = await opts.session.getText(w.url);
        if (wordHtml === null) {
          opts.log?.(`  ${w.headword}: 404, skipped`);
          continue;
        }
        const parsed = parseMboasawaWordPage(wordHtml);
        const pairs = parsed ? mboasawaPairs(parsed, w.url) : [];
        yield { url: w.url, label: `${letter}${pageNo > 1 ? `/${pageNo}` : ""} ${parsed?.headword ?? w.headword}`, pairs };
      }
      pageUrl = list.nextPage;
      pageNo++;
    }
  }
}

export const MBOASAWA_ALL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export { MBOASAWA_DICTIONARY_URL };

export interface WiktionaryCrawlOptions {
  session: PoliteSession;
  wiki: WikiLang;
  /** Stop after this many pages (dry runs). */
  maxPages?: number;
  log?: (line: string) => void;
}

interface ApiResponse {
  continue?: Record<string, string>;
  query?: {
    categorymembers?: { ns: number; title: string }[];
    pages?: { title: string; missing?: boolean; revisions?: { revid: number; slots: { main: { content: string } } }[] }[];
  };
  error?: { code: string; info: string };
}

function apiUrl(wiki: WikiLang, params: Record<string, string>): string {
  const u = new URL(`https://${wiki}.wiktionary.org/w/api.php`);
  for (const [k, v] of Object.entries({ ...params, format: "json", formatversion: "2", maxlag: "5" })) u.searchParams.set(k, v);
  return u.toString();
}

async function api(session: PoliteSession, wiki: WikiLang, params: Record<string, string>): Promise<ApiResponse> {
  const text = await session.getText(apiUrl(wiki, params), "application/json");
  if (text === null) throw new Error("MediaWiki API returned 404");
  const json = JSON.parse(text) as ApiResponse;
  if (json.error) throw new Error(`MediaWiki API error ${json.error.code}: ${json.error.info}`);
  return json;
}

/** List the category's main-namespace pages, then read their wikitext 50 titles per request. */
export async function* crawlWiktionary(opts: WiktionaryCrawlOptions): AsyncGenerator<CrawlBatch> {
  const titles: string[] = [];
  let cont: Record<string, string> | undefined;
  do {
    const res = await api(opts.session, opts.wiki, { action: "query", list: "categorymembers", cmtitle: WIKTIONARY_CATEGORY[opts.wiki], cmnamespace: "0", cmlimit: "500", cmprop: "title", ...(cont ?? {}) });
    for (const m of res.query?.categorymembers ?? []) titles.push(m.title);
    cont = res.continue;
  } while (cont);
  opts.log?.(`${WIKTIONARY_CATEGORY[opts.wiki]}: ${titles.length} pages`);
  const selected = opts.maxPages !== undefined ? titles.slice(0, opts.maxPages) : titles;
  for (let i = 0; i < selected.length; i += 50) {
    const chunk = selected.slice(i, i + 50);
    const res = await api(opts.session, opts.wiki, { action: "query", prop: "revisions", rvprop: "content|ids", rvslots: "main", titles: chunk.join("|") });
    for (const p of res.query?.pages ?? []) {
      const rev = p.revisions?.[0];
      if (p.missing || !rev) continue;
      const page: WiktionaryPage = { title: p.title, revid: rev.revid, wikitext: rev.slots.main.content };
      yield { url: `https://${opts.wiki}.wiktionary.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, label: p.title, pairs: wiktionaryPairs(opts.wiki, page) };
    }
  }
}
