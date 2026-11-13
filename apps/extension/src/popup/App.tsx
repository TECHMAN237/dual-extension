import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceLanguageSelection } from "@douala-ai/shared";
import { createClient, healthWithWakeUp } from "../shared/api";
import { sendToBackground, type ProgressMessage, type SessionSnapshot } from "../shared/messages";
import { getSettings, isLocalBackend, saveSettings, type Settings } from "../shared/storage";
import { Banner } from "./components/ui";
import { AboutTab } from "./components/AboutTab";
import { CorrectionsTab } from "./components/CorrectionsTab";
import { Header, type HealthState } from "./components/Header";
import { HistoryTab } from "./components/HistoryTab";
import { TranslatePanel } from "./components/TranslatePanel";

type Tab = "translate" | "corrections" | "history" | "about";

/** If the first translation has produced nothing after this delay, the server is probably waking up. */
export const WAKE_NOTICE_DELAY_MS = 4_000;
export const WAKE_NOTICE = "Réveil du serveur, la première traduction peut prendre une minute";

const TABS: { id: Tab; label: string }[] = [
  { id: "translate", label: "Translate" },
  { id: "corrections", label: "Corrections" },
  { id: "history", label: "History" },
  { id: "about", label: "About" },
];

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<HealthState>({ status: "checking" });
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "translate" | "restore" | null>(null);
  const [tab, setTab] = useState<Tab>("translate");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wakeNotice, setWakeNotice] = useState(false);
  const firstTranslate = useRef(true);
  const serverAwake = useRef(false);

  const showToast = useCallback((msg: string, ms = 2200) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  // Settings + health + current tab state.
  useEffect(() => {
    let cancelled = false;
    getSettings().then((s) => !cancelled && setSettings(s));
    createClient()
      .then((c) =>
        // A local backend is either running or not; a cloud one may be asleep (free plan) for up to ~60 s.
        isLocalBackend(c.baseUrl) ? c.health() : healthWithWakeUp(c, { onWaking: () => !cancelled && setHealth({ status: "waking" }) }),
      )
      .then((info) => {
        serverAwake.current = true;
        if (!cancelled) setHealth(info.mock ? { status: "mock", info } : { status: "connected", info });
      })
      .catch((err) => !cancelled && setHealth({ status: "offline", error: err instanceof Error ? err.message : String(err) }));
    sendToBackground({ type: "GET_STATE" })
      .then((state) => !cancelled && setSession(state))
      .catch((err) => !cancelled && setPageError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Live progress from the content script.
  useEffect(() => {
    const listener = (message: ProgressMessage | { type?: string }) => {
      if (message && message.type === "PROGRESS") {
        const state = (message as ProgressMessage).state;
        setSession(state);
        // A batch came back: the server is answering.
        if (state.completedCount > 0) setWakeNotice(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const run = useCallback(
    async (kind: "scan" | "translate" | "restore") => {
      setBusy(kind);
      setPageError(null);
      let wakeTimer: ReturnType<typeof setTimeout> | undefined;
      if (kind === "translate" && firstTranslate.current) {
        firstTranslate.current = false;
        // Only when the health check has not already proven the server awake.
        if (!serverAwake.current) wakeTimer = setTimeout(() => setWakeNotice(true), WAKE_NOTICE_DELAY_MS);
      }
      try {
        if (kind === "scan") {
          await sendToBackground({ type: "SCAN" });
          setSession(await sendToBackground({ type: "GET_STATE" }));
        } else if (kind === "translate") {
          setSession(await sendToBackground({ type: "TRANSLATE", sourceLanguage: settings?.sourceLanguage ?? "auto" }));
        } else {
          setSession(await sendToBackground({ type: "RESTORE" }));
          showToast("Original content restored");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code;
        if (code === "unsupported_page" || code === "inject_failed" || code === "no_tab") setPageError(message);
        else showToast(message, 7000);
      } finally {
        clearTimeout(wakeTimer);
        if (kind === "translate") setWakeNotice(false);
        setBusy(null);
      }
    },
    [settings?.sourceLanguage, showToast],
  );

  const changeSource = async (value: SourceLanguageSelection) => {
    const next = await saveSettings({ sourceLanguage: value, autoDetect: value === "auto" });
    setSettings(next);
  };

  return (
    <div className="app">
      <Header health={health} />
      <main className="main">
        {wakeNotice && tab === "translate" ? (
          <div data-testid="wake-notice">
            <Banner tone="info">{WAKE_NOTICE}</Banner>
          </div>
        ) : null}
        {tab === "translate" ? (
          <TranslatePanel
            session={session}
            pageError={pageError}
            busy={busy}
            sourceLanguage={settings?.sourceLanguage ?? "auto"}
            onSourceLanguageChange={(v) => void changeSource(v)}
            onScan={() => void run("scan")}
            onTranslate={() => void run("translate")}
            onRestore={() => void run("restore")}
          />
        ) : null}
        {tab === "corrections" ? <CorrectionsTab session={session} enabled={settings?.correctionsEnabled ?? true} onToast={showToast} /> : null}
        {tab === "history" ? <HistoryTab onToast={showToast} /> : null}
        {tab === "about" ? <AboutTab /> : null}
      </main>
      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
