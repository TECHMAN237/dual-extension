import contentScriptPath from "../content/content-script?script&iife";
import { BackendClient } from "../shared/api";
import { fail, ok, type BackgroundMessage, type Envelope, type TabMessage } from "../shared/messages";
import { addHistoryEntry, getClientId, getSettings } from "../shared/storage";

/* ------------------------------------------------------------------------- */
/* Backend client                                                             */
/* ------------------------------------------------------------------------- */

async function client(): Promise<BackendClient> {
  const [settings, clientId] = await Promise.all([getSettings(), getClientId()]);
  return new BackendClient({ backendUrl: settings.backendUrl, accessToken: settings.accessToken, clientId });
}

/* ------------------------------------------------------------------------- */
/* Tab helpers                                                                */
/* ------------------------------------------------------------------------- */

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw Object.assign(new Error("No active tab."), { code: "no_tab" });
  const url = tab.url ?? "";
  if (!/^https?:/i.test(url) && !/^file:/i.test(url)) {
    throw Object.assign(new Error("This page cannot be translated (browser or extension page)."), { code: "unsupported_page" });
  }
  return tab.id;
}

async function sendToTab<T>(tabId: number, message: TabMessage): Promise<T> {
  const res = (await chrome.tabs.sendMessage(tabId, message)) as Envelope<T> | undefined;
  if (!res) throw new Error("The page did not respond.");
  if (!res.ok) throw Object.assign(new Error(res.error), { code: res.code });
  return res.data;
}

/** Inject the content script on demand (activeTab grants access after the user clicks the action). */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await sendToTab(tabId, { type: "CS_PING" });
    return;
  } catch {
    /* not injected yet */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [contentScriptPath] });
  } catch (err) {
    throw Object.assign(new Error(`Cannot access this page: ${(err as Error).message}`), { code: "inject_failed" });
  }
  await sendToTab(tabId, { type: "CS_PING" });
}

async function withTab<T>(message: TabMessage): Promise<T> {
  const tabId = await activeTabId();
  await ensureContentScript(tabId);
  return sendToTab<T>(tabId, message);
}

/* ------------------------------------------------------------------------- */
/* Message router                                                             */
/* ------------------------------------------------------------------------- */

async function handle(message: BackgroundMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_STATE":
      return withTab({ type: "CS_GET_STATE" });
    case "SCAN":
      return withTab({ type: "CS_SCAN" });
    case "TRANSLATE": {
      const settings = await getSettings();
      return withTab({ type: "CS_TRANSLATE", sourceLanguage: message.sourceLanguage, translateDynamicContent: settings.translateDynamicContent });
    }
    case "RESTORE":
      return withTab({ type: "CS_RESTORE" });
    case "LIST_TRANSLATIONS":
      return withTab({ type: "CS_LIST_TRANSLATIONS" });
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return null;
    case "GET_SETTINGS":
      return getSettings();
    case "API_HEALTH":
      return (await client()).health();
    case "API_TRANSLATE_BATCH":
      return (await client()).translateBatch(message.body);
    case "API_SCAN_ANALYZE":
      return (await client()).scanAnalyze(message.body);
    case "API_SUBMIT_CORRECTION":
      return (await client()).submitCorrection(message.body);
    case "API_CORRECTION_STATUS":
      return (await client()).correctionStatus(message.ids);
    case "SESSION_COMPLETE": {
      const s = message.summary;
      await addHistoryEntry({ domain: s.domain, sourceLanguage: s.sourceLanguage, targetLanguage: s.targetLanguage, translatedCount: s.translatedCount, totalSegments: s.totalSegments, status: s.status });
      return null;
    }
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundMessage | { type: string }, _sender, sendResponse) => {
  // PROGRESS broadcasts from content scripts are for the popup; ignore them here.
  if (!message || message.type === "PROGRESS") return false;
  handle(message as BackgroundMessage)
    .then((data) => sendResponse(data === undefined ? fail(new Error(`Unknown message ${message.type}`)) : ok(data)))
    .catch((err) => sendResponse(fail(err, (err as { code?: string }).code)));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void getClientId();
});
