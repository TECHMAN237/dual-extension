import { LIMITS, isUntranslatableText, normalizeWhitespace, type SegmentContext } from "@douala-ai/shared";

/** A translatable unit found in the page: either a text node or one attribute of an element. */
export interface TextSegment {
  id: string;
  kind: "text";
  node: Text;
  /** Full original nodeValue, including surrounding whitespace. */
  originalValue: string;
  /** Trimmed text sent for translation. */
  text: string;
  leading: string;
  trailing: string;
  context: SegmentContext;
}

export interface AttributeSegment {
  id: string;
  kind: "attr";
  node: Element;
  attr: "placeholder" | "title" | "alt" | "aria-label" | "value";
  originalValue: string;
  text: string;
  leading: string;
  trailing: string;
  context: SegmentContext;
}

export type Segment = TextSegment | AttributeSegment;

/** Elements whose entire subtree is never translated. */
const EXCLUDED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "SVG", "MATH", "KBD", "SAMP", "VAR",
  "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "CANVAS", "VIDEO", "AUDIO",
]);

/** Attribute used to mark UI injected by the extension itself. */
export const OWN_UI_ATTR = "data-douala-ui";

const INTERACTIVE_FOR_TITLE = "a, button, input, select, summary, label, [role='button'], [role='link'], [role='tab'], [role='menuitem']";
const ARIA_LABEL_TARGETS = "a, button, input, [role='button'], [role='link'], [role='tab'], [role='menuitem']";

export interface ScannerOptions {
  /** Counter shared across scans so ids stay unique within a page session. */
  nextId: () => string;
  /** Returns true when this node/attribute is already tracked (translated or queued). */
  isKnown?: (node: Node, attr?: string) => boolean;
}

function isElementExcluded(el: Element, ignoreTag = false): boolean {
  if (!ignoreTag && EXCLUDED_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.namespaceURI === "http://www.w3.org/2000/svg") return true;
  if (el.hasAttribute(OWN_UI_ATTR)) return true;
  if (el.getAttribute("translate") === "no") return true;
  if (el.classList.contains("notranslate")) return true;
  const ce = el.getAttribute("contenteditable");
  if (ce !== null && ce.toLowerCase() !== "false") return true;
  if ((el as HTMLElement).hidden) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "password") return true;
  const view = el.ownerDocument.defaultView;
  if (view) {
    try {
      const style = view.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return true;
    } catch {
      /* detached or unsupported: treat as visible */
    }
  }
  return false;
}

/**
 * True when the element or any ancestor is excluded.
 * With `forAttributes`, the element's own tag is not a reason to exclude it
 * (a TEXTAREA's content is never translated, but its placeholder is).
 */
export function isInExcludedSubtree(node: Node, forAttributes = false): boolean {
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  let first = true;
  while (el) {
    if (isElementExcluded(el, forAttributes && first)) return true;
    first = false;
    el = el.parentElement;
  }
  return false;
}

export function inferContext(node: Node): SegmentContext {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return "other";
  if (el.closest("h1, h2, h3, h4, h5, h6")) return "heading";
  if (el.closest("button, [role='button'], input[type='submit'], input[type='button'], summary")) return "button";
  if (el.closest("nav, [role='navigation'], [role='menubar'], [role='menu']")) return "navigation";
  if (el.closest("a, [role='link']")) return "link";
  if (el.closest("label")) return "label";
  if (el.closest("li, [role='listitem'], [role='option']")) return "list_item";
  if (el.closest("td, th")) return "table_cell";
  if (el.closest("p")) return "paragraph";
  return "other";
}

function splitWhitespace(value: string): { leading: string; trailing: string; text: string } {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const text = normalizeWhitespace(value);
  return { leading, trailing, text };
}

function isEligibleText(text: string): boolean {
  if (!text) return false;
  if (text.length > LIMITS.maxSegmentLength) return false;
  return !isUntranslatableText(text);
}

function textSegment(node: Text, opts: ScannerOptions): TextSegment | null {
  const value = node.nodeValue ?? "";
  const { leading, trailing, text } = splitWhitespace(value);
  if (!isEligibleText(text)) return null;
  if (opts.isKnown?.(node)) return null;
  return { id: opts.nextId(), kind: "text", node, originalValue: value, text, leading, trailing, context: inferContext(node) };
}

function attributeSegments(el: Element, opts: ScannerOptions): AttributeSegment[] {
  const out: AttributeSegment[] = [];
  const consider = (attr: AttributeSegment["attr"], context: SegmentContext) => {
    const value = el.getAttribute(attr);
    if (value === null) return;
    const { leading, trailing, text } = splitWhitespace(value);
    if (!isEligibleText(text)) return;
    if (opts.isKnown?.(el, attr)) return;
    out.push({ id: opts.nextId(), kind: "attr", node: el, attr, originalValue: value, text, leading, trailing, context });
  };
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (type === "password" || type === "hidden") return out;
    consider("placeholder", "placeholder");
    if (type === "submit" || type === "button" || type === "reset") consider("value", "button");
  } else if (tag === "TEXTAREA") {
    consider("placeholder", "placeholder");
  }
  if (tag === "IMG" || tag === "AREA") consider("alt", "alt_text");
  if (el.matches(INTERACTIVE_FOR_TITLE)) consider("title", "title_attribute");
  if (el.matches(ARIA_LABEL_TARGETS)) consider("aria-label", "aria_label");
  return out;
}

/**
 * Scan a subtree (or a single text node) for translatable segments.
 * Uses a TreeWalker so excluded elements prune their whole subtree.
 */
export function scanSegments(root: Node, opts: ScannerOptions): Segment[] {
  const segments: Segment[] = [];
  if (!root.isConnected && root.nodeType !== Node.DOCUMENT_NODE) {
    // Detached nodes are ignored: they cannot be visible.
    return segments;
  }
  if (root.nodeType === Node.TEXT_NODE) {
    if (isInExcludedSubtree(root)) return segments;
    const seg = textSegment(root as Text, opts);
    if (seg) segments.push(seg);
    return segments;
  }
  const rootEl = root.nodeType === Node.DOCUMENT_NODE ? (root as Document).body : (root as Element);
  if (!rootEl) return segments;
  if (isInExcludedSubtree(rootEl)) return segments;

  const doc = rootEl.ownerDocument;
  const walker = doc.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return isElementExcluded(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  // The root element's own attributes.
  if (rootEl !== doc.body) segments.push(...attributeSegments(rootEl, opts));
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const seg = textSegment(current as Text, opts);
      if (seg) segments.push(seg);
    }
    current = walker.nextNode();
  }
  // Attribute segments on descendants (elements are skipped by the walker above, so query them).
  const candidates = rootEl.querySelectorAll("input, textarea, img, area, " + INTERACTIVE_FOR_TITLE + ", " + ARIA_LABEL_TARGETS);
  const seen = new Set<Element>();
  candidates.forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (isInExcludedSubtree(el, true)) return;
    segments.push(...attributeSegments(el, opts));
  });
  return segments;
}

/** Collect a bounded sample of visible text for language detection. */
export function sampleText(segments: Segment[], maxChars = 4000): string {
  let out = "";
  for (const s of segments) {
    if (out.length + s.text.length + 1 > maxChars) break;
    out += `${s.text}\n`;
  }
  return out;
}
