import type { CompletionRequest, CompletionResponse, LlmProvider } from "./types";

/**
 * Clearly-labelled mock provider for UI and integration testing WITHOUT an API key.
 * It returns a visibly fake placeholder `[MOCK dua] <original text>` for every segment, with the
 * glosses the engine sent, so nobody mistakes it for real Douala. (The engine skips the
 * anti-invention check and reports "unverified" evidence for the mock provider.)
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
    let items: { id: string; text: string; words?: { word: string; lex: string[] }[] }[] = [];
    try {
      items = start >= 0 && end > start ? JSON.parse(req.user.slice(start + "<items>".length, end)) : [];
    } catch {
      items = [];
    }
    const out = items.map((item) => ({
      id: item.id,
      translation: `[MOCK dua] ${item.text}`,
      glosses: [],
      notFound: (item.words ?? []).filter((w) => w.lex.length === 0).map((w) => w.word),
      note: "Mock provider: placeholder output, not Douala.",
    }));
    return { text: JSON.stringify({ items: out }), model: req.model, stopReason: "end_turn" };
  }
}
