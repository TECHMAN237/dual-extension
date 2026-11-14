import { getLanguage, type SourceLanguageSelection } from "@douala-ai/shared";
import type { SessionSnapshot } from "../../shared/messages";
import { Banner, Button, Chip, Spinner } from "./ui";

interface Props {
  session: SessionSnapshot | null;
  pageError: string | null;
  busy: "scan" | "translate" | "restore" | null;
  sourceLanguage: SourceLanguageSelection;
  onSourceLanguageChange: (v: SourceLanguageSelection) => void;
  onScan: () => void;
  onTranslate: () => void;
  onRestore: () => void;
}

function languageLabel(code: string | null): string {
  if (!code) return "Unknown";
  return getLanguage(code)?.name ?? code;
}

/**
 * Label of the "Auto detect" option: plain before any scan, then the detected language
 * ("Auto detect · French") or "Auto detect · inconnue" when detection failed.
 */
export function autoDetectLabel(session: SessionSnapshot | null): string {
  const status = session?.status ?? "idle";
  if (!session || status === "idle") return "Auto detect";
  // While the scan is still collecting text, there is nothing to show yet.
  if (status === "scanning" && session.detectedLanguage === null) return "Auto detect";
  return `Auto detect · ${session.detectedLanguage ? languageLabel(session.detectedLanguage) : "inconnue"}`;
}

export function TranslatePanel({ session, pageError, busy, sourceLanguage, onSourceLanguageChange, onScan, onTranslate, onRestore }: Props) {
  const status = session?.status ?? "idle";
  const scanned = session !== null && session.totalSegments > 0 && status !== "idle";
  const translating = status === "translating" || busy === "translate";
  const translated = status === "translated";
  const canScan = !pageError && busy === null && status !== "translating";
  const canTranslate = !pageError && scanned && busy === null && status !== "translating" && status !== "restoring";
  const canRestore = !pageError && busy === null && (translated || (session?.translatedCount ?? 0) > 0);
  const requested = session?.requestedCount ?? 0;
  const completed = session?.completedCount ?? 0;
  const pct = requested > 0 ? Math.min(100, Math.round((completed / requested) * 100)) : translated ? 100 : 0;

  return (
    <>
      <section className="card" aria-label="Website">
        <h2 className="card-title">
          Website
          <button type="button" className="link-btn" onClick={onScan} disabled={!canScan}>
            {scanned ? "Rescan" : "Scan"}
          </button>
        </h2>
        {pageError ? (
          <Banner tone="muted">{pageError}</Banner>
        ) : (
          <>
            <div className="site-domain" title={session?.url ?? ""}>
              {session?.domain || "—"}
            </div>
            <div className="site-meta">
              <span>
                Language: <strong data-testid="detected-language">{languageLabel(session?.detectedLanguage ?? null)}</strong>
                {session?.detectionConfidence ? <span className="muted"> ({session.detectionConfidence})</span> : null}
              </span>
              <span>
                Elements: <strong data-testid="segment-count">{scanned ? session!.totalSegments : "—"}</strong>
              </span>
            </div>
            {session?.navigated ? <div className="muted" style={{ marginTop: 6 }}>The page changed. Rescan to translate the new content.</div> : null}
          </>
        )}
      </section>

      <section className="card" aria-label="Languages">
        <div className="row">
          <div className="field">
            <label htmlFor="source-language">From</label>
            <select id="source-language" className="select" value={sourceLanguage} onChange={(e) => onSourceLanguageChange(e.target.value as SourceLanguageSelection)} disabled={translating}>
              <option value="auto" data-testid="auto-detect-option">
                {autoDetectLabel(session)}
              </option>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="target-language">To</label>
            <select id="target-language" className="select" value="dua" onChange={() => undefined} aria-describedby="target-note">
              <option value="dua">Douala (Duálá)</option>
            </select>
          </div>
        </div>
        <p id="target-note" className="muted" style={{ margin: "6px 0 0" }}>
          More Cameroonian languages can be added to the language registry.
        </p>
      </section>

      <div className="actions">
        <Button variant="secondary" onClick={onScan} disabled={!canScan} data-testid="scan-button">
          {busy === "scan" || status === "scanning" ? <Spinner /> : null} Scan page
        </Button>
        <Button variant="primary" onClick={onTranslate} disabled={!canTranslate} data-testid="translate-button">
          {translating ? <Spinner /> : null} Translate page
        </Button>
        <Button variant="ghost" onClick={onRestore} disabled={!canRestore} data-testid="restore-button">
          Restore original
        </Button>
      </div>

      {session && (status === "translating" || translated || status === "error" || status === "restoring") ? (
        <section className="card" aria-label="Progress" data-testid="progress-panel">
          <h2 className="card-title">{status === "translating" ? "Translating" : status === "restoring" ? "Restoring" : status === "error" ? "Translation failed" : "Translation complete"}</h2>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-text">
            <span>
              <strong>{session.translatedCount}</strong> translated of {requested || session.totalSegments}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="chips">
            {session.uncertainCount > 0 ? <Chip tone="uncertain" title="Kept original: insufficient evidence">{session.uncertainCount} kept original</Chip> : null}
            {session.errorCount > 0 ? <Chip tone="error">{session.errorCount} errors</Chip> : null}
            {session.skippedCount > 0 ? <Chip>{session.skippedCount} skipped</Chip> : null}
          </div>
          {translated || status === "error" ? (
            <div className="chips" aria-label="Evidence summary">
              <Chip tone="high">{session.evidence.high} high</Chip>
              <Chip tone="moderate">{session.evidence.moderate} moderate</Chip>
              <Chip tone="low">{session.evidence.low} low</Chip>
              <Chip tone="unverified">{session.evidence.unverified} unverified</Chip>
            </div>
          ) : null}
          {(translated || status === "error") && (session.wordsTotal ?? 0) > 0 ? (
            <div className="progress-text" data-testid="dictionary-coverage" title="Content words of the page found in the Duala dictionary (data/knowledge/douala.json)">
              <span>
                Mots trouvés dans le dictionnaire : <strong>{Math.round((100 * session.wordsFound) / session.wordsTotal)} %</strong>
              </span>
              <span>
                {session.wordsFound}/{session.wordsTotal}
              </span>
            </div>
          ) : null}
          {status === "error" ? (
            <div style={{ marginTop: 10 }}>
              <Banner tone="error">{session.errorMessage ?? "The translation could not be completed."}</Banner>
              <div className="item-actions">
                <Button size="sm" onClick={onTranslate}>
                  Retry
                </Button>
              </div>
            </div>
          ) : null}
          {session.errorMessage && status !== "error" ? <div className="muted" style={{ marginTop: 8 }}>Some batches failed: {session.errorMessage}</div> : null}
        </section>
      ) : null}

      {session?.mock ? (
        <Banner tone="warn">
          <strong>Mock mode.</strong> The backend has no AI provider configured, so placeholders like “[MOCK dua] …” are shown. They are <strong>not</strong> Douala.
        </Banner>
      ) : null}
    </>
  );
}
