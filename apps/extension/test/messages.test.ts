import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageTimeoutError, sendToBackground, withTimeout } from "../src/shared/messages";

describe("sendToBackground timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects with a clear error when the background never answers", async () => {
    vi.useFakeTimers();
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation((() => new Promise(() => undefined)) as never);
    const pending = sendToBackground({ type: "SCAN" });
    const assertion = expect(pending).rejects.toBeInstanceOf(MessageTimeoutError);
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
  });

  it("returns data when the background answers in time", async () => {
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation((async () => ({ ok: true, data: { status: "idle" } })) as never);
    await expect(sendToBackground({ type: "GET_STATE" })).resolves.toEqual({ status: "idle" });
  });

  it("withTimeout clears its timer when the promise wins", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(Promise.resolve(1), 1000, () => new Error("late"));
    expect(clear).toHaveBeenCalled();
  });
});
