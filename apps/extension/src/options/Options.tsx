import { useEffect, useState } from "react";
import { BackendClient } from "../shared/api";
import { Banner, Button } from "../popup/components/ui";
import { DEFAULT_SETTINGS, MAX_HISTORY, clearAllLocalData, getClientId, getSettings, saveSettings, validateSettings, type Settings } from "../shared/storage";

function Toggle({ id, label, help, checked, onChange }: { id: string; label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle">
      <label className="toggle-label" htmlFor={id}>
        <span>{label}</span>
        {help ? <span className="muted">{help}</span> : null}
      </label>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </div>
  );
}

export function Options() {
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [test, setTest] = useState<{ kind: "idle" } | { kind: "testing" } | { kind: "ok"; message: string } | { kind: "error"; message: string }>({ kind: "idle" });

  useEffect(() => {
    getSettings().then((s) => {
      setForm(s);
      setLoaded(true);
    });
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    const errs = validateSettings(form);
    setErrors(errs);
    if (errs.length > 0) return;
    const saved = await saveSettings(form);
    setForm(saved);
    flash("Settings saved");
  };

  const testConnection = async () => {
    const errs = validateSettings({ backendUrl: form.backendUrl });
    if (errs.length > 0) {
      setTest({ kind: "error", message: errs.join(". ") });
      return;
    }
    setTest({ kind: "testing" });
    try {
      const client = new BackendClient({ backendUrl: form.backendUrl, accessToken: form.accessToken, clientId: await getClientId() });
      const h = await client.health();
      setTest({ kind: "ok", message: `Connected to backend ${h.version} · provider ${h.provider}${h.model ? ` (${h.model})` : ""}${h.mock ? " · MOCK MODE (no AI key configured)" : ""} · ${h.knowledgeEntries} knowledge entries · storage: ${h.storage}` });
    } catch (err) {
      setTest({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const clearData = async () => {
    if (!confirm("Clear all local data (settings, history, submitted corrections and the anonymous client id)?")) return;
    await clearAllLocalData();
    setForm(await getSettings());
    flash("Local data cleared");
  };

  return (
    <div className="options-page">
      <div>
        <h1>DOUALA AI settings</h1>
        <p className="intro">Configure where the extension sends translation requests. AI provider API keys are configured on the backend only and are never stored in the browser.</p>
      </div>

      <section className="card" aria-labelledby="backend-h">
        <h2 className="card-title" id="backend-h">
          Backend
        </h2>
        <div className="inline">
          <div className="field">
            <label htmlFor="backendUrl">Backend URL</label>
            <input id="backendUrl" className="input" value={form.backendUrl} onChange={(e) => update("backendUrl", e.target.value)} placeholder="http://localhost:8787" spellCheck={false} />
          </div>
          <Button onClick={() => void testConnection()} disabled={test.kind === "testing"}>
            {test.kind === "testing" ? "Testing…" : "Test connection"}
          </Button>
        </div>
        <p className="help">Local development: http://localhost:8787. Cloud deployment: your Render service URL (https).</p>
        {test.kind === "ok" ? <Banner tone="info">{test.message}</Banner> : null}
        {test.kind === "error" ? <Banner tone="error">{test.message}</Banner> : null}
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="accessToken">Access token (optional)</label>
          <input id="accessToken" className="input" type="password" value={form.accessToken} onChange={(e) => update("accessToken", e.target.value)} autoComplete="off" />
          <p className="help">Only needed when the backend was deployed with EXTENSION_ACCESS_TOKEN. This is a client credential, not an AI provider key.</p>
        </div>
      </section>

      <section className="card" aria-labelledby="lang-h">
        <h2 className="card-title" id="lang-h">
          Languages
        </h2>
        <div className="row">
          <div className="field">
            <label htmlFor="sourceLanguage">Default source language</label>
            <select id="sourceLanguage" className="select" value={form.sourceLanguage} onChange={(e) => update("sourceLanguage", e.target.value as Settings["sourceLanguage"])}>
              <option value="auto">Auto detect</option>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="targetLanguage">Target language</label>
            <select id="targetLanguage" className="select" value={form.targetLanguage} onChange={(e) => update("targetLanguage", e.target.value as Settings["targetLanguage"])}>
              <option value="dua">Douala (Duálá)</option>
            </select>
          </div>
        </div>
        <Toggle id="autoDetect" label="Automatic language detection" help="Detect whether the page is in English or French before translating." checked={form.autoDetect} onChange={(v) => update("autoDetect", v)} />
      </section>

      <section className="card" aria-labelledby="behaviour-h">
        <h2 className="card-title" id="behaviour-h">
          Translation behaviour
        </h2>
        <Toggle id="translateDynamicContent" label="Translate dynamic content" help="Keep translating text that appears after the page loads (feeds, menus, infinite scroll)." checked={form.translateDynamicContent} onChange={(v) => update("translateDynamicContent", v)} />
        <Toggle id="correctionsEnabled" label="Enable corrections" help="Allow suggesting better Douala translations from the popup." checked={form.correctionsEnabled} onChange={(v) => update("correctionsEnabled", v)} />
      </section>

      <section className="card" aria-labelledby="privacy-h">
        <h2 className="card-title" id="privacy-h">
          History & privacy
        </h2>
        <Toggle id="keepHistory" label="Keep translation history" help="Stores domain, languages, date and counts locally. Never page content." checked={form.keepHistory} onChange={(v) => update("keepHistory", v)} />
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="historyLimit">History entries to keep (max {MAX_HISTORY})</label>
          <input id="historyLimit" className="input" type="number" min={1} max={MAX_HISTORY} value={form.historyLimit} onChange={(e) => update("historyLimit", Number(e.target.value))} style={{ width: 120 }} />
        </div>
        <div className="item-actions" style={{ marginTop: 12 }}>
          <Button variant="danger" size="sm" onClick={() => void clearData()}>
            Clear local data
          </Button>
        </div>
      </section>

      {errors.length > 0 ? <Banner tone="error">{errors.join(". ")}</Banner> : null}
      <div className="item-actions">
        <Button variant="primary" onClick={() => void save()} disabled={!loaded}>
          Save settings
        </Button>
      </div>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
