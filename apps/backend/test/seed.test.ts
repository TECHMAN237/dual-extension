import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeStore } from "@douala-ai/linguistic-knowledge";
import { seedIfEmpty } from "../src/seed";

describe("seedIfEmpty", () => {
  it("seeds sources and UI terms into an empty store, then does nothing on the next start", async () => {
    const store = new InMemoryKnowledgeStore();
    const first = await seedIfEmpty(store);
    expect(first).not.toBeNull();
    expect(first!.sources).toBeGreaterThan(0);
    expect(first!.terms).toBeGreaterThan(0);
    expect(await store.countEntries()).toBe(first!.terms);
    expect((await store.listSources()).length).toBe(first!.sources);

    expect(await seedIfEmpty(store)).toBeNull();
    expect(await store.countEntries()).toBe(first!.terms);
  });
});
