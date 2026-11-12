import type { Envelope, ProgressMessage, SessionSnapshot, TabMessage } from "../shared/messages";
import { fail, ok, withTimeout } from "../shared/messages";
import { PageSession, type SessionBackend } from "./session";

declare global {
  interface Window {
    __doualaAI?: { session: PageSession };
  }
}

/** Backend proxy: all network calls go through the background service worker (extension origin). */
/** Send to the background worker, failing after `ms` instead of waiting forever. */
function ask<T>(message: unknown, ms: number): Promise<Envelope<T> | undefined> {
  return withTimeout(chrome.runtime.sendMessage(message) as Promise<Envelope<T> | undefined>, ms, () => new Error("The DOUALA AI server did not answer in time."));
}

const backend: SessionBackend = {
  async translateBatch(request) {
    const res = await ask<Awaited<ReturnType<SessionBackend["translateBatch"]>>>({ type: "API_TRANSLATE_BATCH", body: request }, 130_000);
    if (!res?.ok) throw new Error(res?.error ?? "No response from background");
    return res.data;
  },
  async scanAnalyze(request) {
    // Language detection already ran locally; the server check is only a refinement, so keep it short.
    const res = await ask<Awaited<ReturnType<SessionBackend["scanAnalyze"]>>>({ type: "API_SCAN_ANALYZE", body: request }, 5_000);
    if (!res?.ok) throw new Error(res?.error ?? "No response from background");
    return res.data;
  },
  async sessionComplete(summary) {
    await ask({ type: "SESSION_COMPLETE", summary }, 5_000);
  },
};

function broadcast(state: SessionSnapshot): void {
  const msg: ProgressMessage = { type: "PROGRESS", state };
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

function install(): PageSession {
  if (window.__doualaAI) return window.__doualaAI.session;
  const session = new PageSession({ backend, onProgress: broadcast });
  window.__doualaAI = { session };

  chrome.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
    const respond = (p: Promise<Envelope<unknown>>) => {
      p.then(sendResponse).catch((err) => sendResponse(fail(err)));
      return true;
    };
    switch (message?.type) {
      case "CS_PING":
        sendResponse(ok({ ready: true }));
        return false;
      case "CS_GET_STATE":
        sendResponse(ok(session.getSnapshot()));
        return false;
      case "CS_SCAN":
        return respond(session.scan().then(ok));
      case "CS_TRANSLATE":
        return respond(session.translate(message.sourceLanguage, message.translateDynamicContent).then(ok));
      case "CS_RESTORE":
        sendResponse(ok(session.restore()));
        return false;
      case "CS_LIST_TRANSLATIONS":
        sendResponse(ok(session.listTranslations()));
        return false;
      default:
        return false;
    }
  });

  window.addEventListener("popstate", () => {
    if (session.state.status !== "idle") {
      session.registry.prune();
      session.state.navigated = true;
      broadcast(session.getSnapshot());
    }
  });
  window.addEventListener("pagehide", () => session.dispose());
  return session;
}

install();
