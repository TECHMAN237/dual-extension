import { describe, expect, it, vi } from "vitest";
import type { TranslationResult } from "@douala-ai/shared";
import { scanSegments } from "../src/content/scanner";
import { TranslationRegistry } from "../src/content/translator";

function result(id: string, text: string, translated: string | null, status: TranslationResult["status"] = "translated"): TranslationResult {
  return { id, sourceText: text, translatedText: translated, status, evidence: "unverified", needsReview: true, references: [], note: null, cached: false };
}

describe("TranslationRegistry", () => {
  it("applies translations by writing nodeValue only, preserving structure, whitespace and listeners", () => {
    document.body.innerHTML = `<div id="box"><p>  Hello <strong>world</strong> today  </p><button id="btn">Click me</button></div>`;
    const btn = document.getElementById("btn")!;
    const handler = vi.fn();
    btn.addEventListener("click", handler);
    const beforeChildren = document.getElementById("box")!.querySelectorAll("*").length;

    let n = 0;
    const segs = scanSegments(document.body, { nextId: () => `d-${++n}` });
    const registry = new TranslationRegistry();
    for (const seg of segs) registry.apply(seg, `T:${seg.text}`, result(seg.id, seg.text, `T:${seg.text}`));

    expect(document.querySelector("p")!.firstChild!.nodeValue).toBe("  T:Hello ");
    expect(document.querySelector("strong")!.textContent).toBe("T:world");
    expect(btn.textContent).toBe("T:Click me");
    expect(document.getElementById("box")!.querySelectorAll("*").length).toBe(beforeChildren);
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(4);
  });

  it("restores the exact original values and can be used for several cycles", () => {
    document.body.innerHTML = `<p>  Original text  </p><input placeholder="Type here" />`;
    const original = document.body.innerHTML;
    for (let cycle = 0; cycle < 3; cycle++) {
      let n = 0;
      const registry = new TranslationRegistry();
      const segs = scanSegments(document.body, { nextId: () => `d-${++n}` });
      expect(segs).toHaveLength(2);
      for (const seg of segs) expect(registry.apply(seg, `T${cycle}`, result(seg.id, seg.text, `T${cycle}`))).toBe(true);
      expect(document.querySelector("p")!.textContent).toBe(`  T${cycle}  `);
      expect(document.querySelector("input")!.getAttribute("placeholder")).toBe(`T${cycle}`);
      expect(registry.restore()).toBe(2);
      expect(document.body.innerHTML).toBe(original);
      expect(registry.size).toBe(0);
    }
  });

  it("does not restore nodes the site changed after translation, and does not apply to changed nodes", () => {
    document.body.innerHTML = `<p id="a">Alpha</p><p id="b">Beta</p>`;
    let n = 0;
    const segs = scanSegments(document.body, { nextId: () => `d-${++n}` });
    const registry = new TranslationRegistry();
    // The site re-rendered "Beta" before we could apply.
    document.getElementById("b")!.firstChild!.nodeValue = "Beta (updated)";
    expect(registry.apply(segs[0]!, "T:Alpha", result("d-1", "Alpha", "T:Alpha"))).toBe(true);
    expect(registry.apply(segs[1]!, "T:Beta", result("d-2", "Beta", "T:Beta"))).toBe(false);
    expect(document.getElementById("b")!.textContent).toBe("Beta (updated)");
    // The site changed "Alpha" after our translation: leave it alone on restore.
    document.getElementById("a")!.firstChild!.nodeValue = "Alpha v2";
    expect(registry.restore()).toBe(0);
    expect(document.getElementById("a")!.textContent).toBe("Alpha v2");
  });

  it("tracks known nodes and prunes disconnected ones", () => {
    document.body.innerHTML = `<p>One</p><p>Two</p>`;
    let n = 0;
    const segs = scanSegments(document.body, { nextId: () => `d-${++n}` });
    const registry = new TranslationRegistry();
    registry.apply(segs[0]!, "T1", result("d-1", "One", "T1"));
    registry.track(segs[1]!);
    expect(registry.has(segs[0]!.node)).toBe(true);
    expect(registry.has(segs[1]!.node)).toBe(true);
    document.querySelector("p")!.remove();
    expect(registry.prune()).toBe(1);
    expect(registry.size).toBe(0);
  });
});
