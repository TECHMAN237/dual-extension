import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore, loadSeedSources, serializeKnowledgeState, stableEntryId } from "@douala-ai/linguistic-knowledge";
import type { KnowledgeEntry } from "@douala-ai/shared";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { DEFAULT_KNOWLEDGE_FILE, findRepoRoot, resolveKnowledgeFile } from "../src/paths";
import { testEnv } from "./helpers";

const repoRoot = findRepoRoot();
const repoFile = path.join(repoRoot, DEFAULT_KNOWLEDGE_FILE);

function entry(sourceText: string, targetText: string, reference: string): KnowledgeEntry {
  const base = { sourceId: "mboasawa-dictionnaire-duala", sourceLanguage: "fr" as const, targetLanguage: "dua" as const, category: "vocabulary" as const, sourceText, targetText };
  return {
    ...base,
    id: stableEntryId(base),
    context: null,
    example: null,
    note: null,
    sourceName: "Mboa Sawa – Dictionnaire duala",
    sourceUrl: "https://mboasawa.com/",
    reference,
    origin: "extracted_unverified",
    validationStatus: "pending",
    reliability: "unknown",
    extractedAt: "2026-11-13T00:00:00.000Z",
    tags: [],
  };
}

describe("knowledge file location", () => {
  it("defaults to data/knowledge/douala.json at the repository root, from apps/backend or the bundle", () => {
    expect(existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))).toBe(true);
    expect(findRepoRoot([path.join(repoRoot, "apps/backend")])).toBe(repoRoot);
    expect(findRepoRoot([path.join(repoRoot, "apps/backend/dist")])).toBe(repoRoot);
    expect(resolveKnowledgeFile(undefined, repoRoot)).toBe(repoFile);
    expect(resolveKnowledgeFile("", repoRoot)).toBe(repoFile);
    expect(resolveKnowledgeFile("data/other.json", repoRoot)).toBe(path.join(repoRoot, "data/other.json"));
    expect(loadConfig(testEnv()).knowledgeFile).toBe(repoFile);
  });
});

describe("backend started with a knowledge file", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("loads the file's entries at startup and can find them", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "douala-kb-"));
    const file = path.join(dir, "douala.json");
    const entries = [entry("maison", "ndabo", "https://example.org/a"), entry("eau", "madiba", "https://example.org/b")];
    writeFileSync(file, serializeKnowledgeState(entries, loadSeedSources()));
    const before = statSync(file).mtimeMs;

    const { app } = await buildApp(loadConfig(testEnv({ LOCAL_KNOWLEDGE_FILE: file })), {}, { logger: false });
    const health = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(health).toMatchObject({ storage: "memory", knowledgeEntries: 2 });
    const search = (await app.inject({ method: "GET", url: "/api/knowledge/search?q=maison&sourceLanguage=fr&targetLanguage=dua&includeUnverified=true" })).json();
    expect(search.references.map((r: { targetText: string }) => r.targetText)).toContain("ndabo");
    await app.close();
    // Tests never write the file back.
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it("loads the versioned data/knowledge/douala.json shipped in the repository", async () => {
    expect(existsSync(repoFile)).toBe(true);
    const shipped = JSON.parse(readFileSync(repoFile, "utf8")) as { entries: KnowledgeEntry[] };
    const { app, container } = await buildApp(loadConfig(testEnv()), {}, { logger: false });
    const health = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(health.knowledgeEntries).toBe(shipped.entries.length);
    expect(await container.store.countEntries()).toBe(shipped.entries.length);
    await app.close();
  });
});

describe("knowledge file format", () => {
  it("is stable: sorted by id, fixed indentation, identical when re-saved", async () => {
    const entries = [entry("eau", "madiba", "r1"), entry("maison", "ndabo", "r2"), entry("arbre", "bele", "r3")];
    const text = serializeKnowledgeState([...entries].reverse(), loadSeedSources());
    const parsed = JSON.parse(text) as { entries: KnowledgeEntry[]; sources: { id: string }[] };
    expect(parsed.entries.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort());
    expect(parsed.sources.map((s) => s.id)).toEqual(parsed.sources.map((s) => s.id).sort());
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")[1]).toBe('  "version": 1,');

    const store = new InMemoryKnowledgeStore({ seedEntries: parsed.entries, seedSources: loadSeedSources() });
    expect(store.serialize()).toBe(text);
  });

  it("every shipped entry is pending, cites its page and keeps human review fields", () => {
    const shipped = JSON.parse(readFileSync(repoFile, "utf8")) as { entries: KnowledgeEntry[] };
    for (const e of shipped.entries) {
      expect(e.validationStatus).toBe("pending");
      expect(e.targetLanguage).toBe("dua");
      if (e.targetText !== null) {
        expect(e.origin).toBe("extracted_unverified");
        expect(e.reference).toMatch(/^https:\/\//);
      }
    }
  });
});
