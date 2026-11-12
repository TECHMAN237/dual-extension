import type { CompletionRequest, CompletionResponse, LlmProvider } from "./types";
import { promptItemsSchema } from "../prompt";

/**
 * Clearly-labelled mock provider for UI and integration testing WITHOUT an API key.
 *
 * Behaviour:
 *  - If a reference with an exact, verified translation is supplied for an item,
 *    the mock returns that reference translation (evidence: high).
 *  - Otherwise it returns a visibly fake placeholder `[MOCK dua] <original text>`
 *    marked as `unverified`, so nobody mistakes it for real Douala.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  /** Optional hook used by tests to simulate failures or malformed output. */
  constructor(private readonly behaviour: { malformedOnce?: boolean; failWith?: Error } = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (this.behaviour.failWith) throw this.behaviour.failWith;
    if (this.behaviour.malformedOnce) {
      this.behaviour.malformedOnce = false;
      return { text: "this is not json {", model: req.model, stopReason: "end_turn" };
    }
    const start = req.user.indexOf("<items>");
    const end = req.user.indexOf("</items>");
    const payload = start >= 0 && end > start ? req.user.slice(start + "<items>".length, end) : "[]";
    const parsed = promptItemsSchema.safeParse(JSON.parse(payload));
    const items = parsed.success ? parsed.data : [];
    const out = items.map((item) => {
      const exact = item.references.find((r) => r.match === "exact" && r.target && r.status === "verified");
      if (exact) {
        return { id: item.id, translation: exact.target, evidence: "high", usedReferenceIds: [exact.id], note: null };
      }
      return { id: item.id, translation: `[MOCK dua] ${item.text}`, evidence: "unverified", usedReferenceIds: [], note: "Mock provider: placeholder output, not Douala." };
    });
    return { text: JSON.stringify({ items: out }), model: req.model, stopReason: "end_turn" };
  }
}
