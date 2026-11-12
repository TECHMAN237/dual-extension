import type { TranslationResult } from "@douala-ai/shared";
import type { Segment } from "./scanner";

export interface RegistryEntry {
  segment: Segment;
  translatedText: string;
  /** The exact value we wrote into the node/attribute. */
  appliedValue: string;
  result: TranslationResult;
}

function readValue(segment: Segment): string | null {
  if (segment.kind === "text") return segment.node.nodeValue;
  return segment.node.getAttribute(segment.attr);
}

function writeValue(segment: Segment, value: string): void {
  if (segment.kind === "text") {
    segment.node.nodeValue = value;
  } else {
    segment.node.setAttribute(segment.attr, value);
  }
}

/**
 * Registry of every node the extension modified, so the original content can
 * be restored safely. DOM identity is preserved: we only ever write to
 * `Text.nodeValue` or a single attribute, never to innerHTML.
 */
export class TranslationRegistry {
  private entries = new Map<string, RegistryEntry>();
  private byNode = new WeakMap<Node, Set<string>>();

  get size(): number {
    return this.entries.size;
  }

  values(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** True when this node (and attribute) is already tracked. */
  has(node: Node, attr?: string): boolean {
    const set = this.byNode.get(node);
    if (!set) return false;
    return set.has(attr ?? "#text");
  }

  /**
   * Apply a translation to a segment. Returns false when the node changed since
   * the scan (the site re-rendered), in which case nothing is modified.
   */
  apply(segment: Segment, translatedText: string, result: TranslationResult): boolean {
    if (!segment.node.isConnected) return false;
    const current = readValue(segment);
    if (current !== segment.originalValue) return false;
    const appliedValue = `${segment.leading}${translatedText}${segment.trailing}`;
    writeValue(segment, appliedValue);
    this.entries.set(segment.id, { segment, translatedText, appliedValue, result });
    let set = this.byNode.get(segment.node);
    if (!set) {
      set = new Set();
      this.byNode.set(segment.node, set);
    }
    set.add(segment.kind === "attr" ? segment.attr : "#text");
    return true;
  }

  /** Track a segment without modifying it (e.g. uncertain results) so it is not re-requested. */
  track(segment: Segment): void {
    let set = this.byNode.get(segment.node);
    if (!set) {
      set = new Set();
      this.byNode.set(segment.node, set);
    }
    set.add(segment.kind === "attr" ? segment.attr : "#text");
  }

  /**
   * Restore every tracked node to its original value, but only when the node
   * still contains exactly what we wrote. Returns the number of nodes restored.
   */
  restore(): number {
    let restored = 0;
    for (const entry of this.entries.values()) {
      const { segment } = entry;
      if (!segment.node.isConnected) continue;
      if (readValue(segment) !== entry.appliedValue) continue;
      writeValue(segment, segment.originalValue);
      restored++;
    }
    this.clear();
    return restored;
  }

  /** Drop entries whose nodes left the document (prevents leaks on dynamic pages). */
  prune(): number {
    let dropped = 0;
    for (const [id, entry] of this.entries) {
      if (!entry.segment.node.isConnected) {
        this.entries.delete(id);
        dropped++;
      }
    }
    return dropped;
  }

  clear(): void {
    this.entries.clear();
    this.byNode = new WeakMap();
  }
}
