import type { Envelope, ProgressMessage, SessionSnapshot, TabMessage } from "../shared/messages";
import { fail, ok } from "../shared/messages";
import { PageSession, type SessionBackend } from "./session";

declare global {
  interface Window {
    __doualaAI?: { session: PageSession };
  }
}

/** Backend proxy: all network calls go through the background service worker (extension origin). */
const backend: SessionBackend = {
  async translateBatch(request) {
    const res = (await chrome.runtime.sendMessage({ type: "API_TRANSLATE_BATCH", body: request })) as Envelope<Awaited<ReturnType<SessionBackend["translateBatch"]>>>;
    if (!res?.ok) throw new Error(res?.error ?? "No response from background");
    return res.data;
  },
  async scanAnalyze(request) {
    const res = (await chrome.runtime.sendMessage({ type: "API_SCAN_ANALYZE", body: request })) as Envelope<Awaited<ReturnType<SessionBackend["scanAnalyze"]>>>;
    if (!res?.ok) throw new Error(res?.error ?? "No response from background");
    return res.data;
  },
  async sessionComplete(summary) {
    await chrome.runtime.sendMessage({ type: "SESSION_COMPLETE", summary });
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
