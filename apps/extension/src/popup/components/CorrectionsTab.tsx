import { useEffect, useState } from "react";
import type { CorrectionRecord, CorrectionSubmission, SourceLanguageCode } from "@douala-ai/shared";
import { sendToBackground, type SessionSnapshot, type TranslatedSegmentInfo } from "../../shared/messages";
import { addSubmittedCorrection, getClientId, getSubmittedCorrections, updateSubmittedCorrections, type SubmittedCorrection } from "../../shared/storage";
import { Banner, Button, Chip, EvidenceChip, Spinner, formatDate } from "./ui";

interface Props {
  session: SessionSnapshot | null;
  enabled: boolean;
  onToast: (msg: string) => void;
}

function SegmentItem({ seg, session, onSubmitted, enabled }: { seg: TranslatedSegmentInfo; session: SessionSnapshot; onSubmitted: (r: CorrectionRecord) => void; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [proposed, setProposed] = useState("");
  const [explanation, setExplanation] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "sent"; record: CorrectionRecord } | { kind: "error"; message: string }>({ kind: "idle" });

  const submit = async () => {
    const text = proposed.trim();
    if (!text) return;
    setState({ kind: "sending" });
    try {
      const sourceLanguage: SourceLanguageCode = session.resolvedSourceLanguage ?? session.detectedLanguage ?? "en";
      const body: CorrectionSubmission = {
        sourceLanguage,
        targetLanguage: "dua",
        sourceText: seg.sourceText,
        aiTranslation: seg.translatedText,
        proposedTranslation: text,
        explanation: explanation.trim() || undefined,
        context: seg.context,
        domain: session.domain,
        clientId: await getClientId(),
      };
      const record = await sendToBackground({ type: "API_SUBMIT_CORRECTION", body });
      setState({ kind: "sent", record });
      onSubmitted(record);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <li className="item">
      <div className="item-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="original">{seg.sourceText}</div>
          <div className={`translated${seg.translatedText ? "" : " translated--none"}`}>{seg.translatedText ?? "Kept original — insufficient evidence"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <EvidenceChip level={seg.evidence} />
          {seg.status !== "translated" ? <Chip tone={seg.status}>{seg.status}</Chip> : null}
        </div>
      </div>
      {seg.note ? <div className="item-meta">{seg.note}</div> : null}
      {seg.references.length > 0 ? (
        <details className="references">
          <summary>
            {seg.references.length} reference{seg.references.length > 1 ? "s" : ""}
          </summary>
          {seg.references.map((r) => (
            <div className="reference" key={r.id}>
              <div>
                <strong>{r.sourceText}</strong> → {r.targetText ?? <em>no translation recorded</em>}
              </div>
              <div className="ref-name">
                {r.sourceName}
                {r.reference ? ` · ${r.reference}` : ""} · {r.validationStatus} · {r.category.replace("_", " ")}
                {r.sourceUrl ? (
                  <>
                    {" · "}
                    <a href={r.sourceUrl} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </details>
      ) : null}
      {enabled && state.kind !== "sent" ? (
        <div className="item-actions">
          <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Cancel" : "Suggest correction"}
          </Button>
        </div>
      ) : null}
      {open && state.kind !== "sent" ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor={`proposed-${seg.id}`}>Your Douala translation</label>
            <textarea id={`proposed-${seg.id}`} className="textarea" value={proposed} onChange={(e) => setProposed(e.target.value)} maxLength={2000} required />
          </div>
          <div className="field">
            <label htmlFor={`explanation-${seg.id}`}>Explanation (optional)</label>
            <input id={`explanation-${seg.id}`} className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={1000} placeholder="Source, dialect, grammar note…" />
          </div>
          {state.kind === "error" ? <Banner tone="error">{state.message}</Banner> : null}
          <div className="item-actions">
            <Button variant="primary" size="sm" type="submit" disabled={state.kind === "sending" || !proposed.trim()}>
              {state.kind === "sending" ? <Spinner /> : null} Submit correction
            </Button>
          </div>
        </form>
      ) : null}
      {state.kind === "sent" ? (
        <div className="item-meta">
          Submitted · <Chip tone={state.record.status}>{state.record.status}</Chip>
        </div>
      ) : null}
    </li>
  );
}

export function CorrectionsTab({ session, enabled, onToast }: Props) {
  const [segments, setSegments] = useState<TranslatedSegmentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<SubmittedCorrection[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendToBackground({ type: "LIST_TRANSLATIONS" })
      .then((list) => !cancelled && setSegments(list))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    getSubmittedCorrections().then((list) => !cancelled && setMine(list));
    return () => {
      cancelled = true;
    };
  }, [session?.updatedAt]);

  const refreshStatuses = async () => {
    if (mine.length === 0) return;
    setRefreshing(true);
    try {
      const { corrections } = await sendToBackground({ type: "API_CORRECTION_STATUS", ids: mine.slice(0, 50).map((c) => c.id) });
      setMine(await updateSubmittedCorrections(corrections));
      onToast("Statuses updated");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not refresh statuses");
    } finally {
      setRefreshing(false);
    }
  };

  const onSubmitted = async (record: CorrectionRecord) => {
    setMine(await addSubmittedCorrection(record));
    onToast("Correction submitted for review");
  };

  const reviewable = (segments ?? []).filter((s) => s.status === "translated" || s.status === "uncertain");

  return (
    <>
      <section className="card" aria-label="Corrections">
        <h2 className="card-title">This page</h2>
        {!enabled ? <Banner tone="muted">Corrections are disabled in Settings.</Banner> : null}
        {error ? <Banner tone="muted">{error}</Banner> : null}
        {segments === null && !error ? (
          <div className="empty">
            <Spinner />
          </div>
        ) : reviewable.length === 0 ? (
          <div className="empty">Translate the page first, then review and correct segments here.</div>
        ) : (
          <ul className="list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {reviewable.map((seg) => (
              <SegmentItem key={seg.id} seg={seg} session={session!} onSubmitted={onSubmitted} enabled={enabled} />
            ))}
          </ul>
        )}
      </section>
      <section className="card" aria-label="My corrections">
        <h2 className="card-title">
          My corrections
          <button type="button" className="link-btn" onClick={() => void refreshStatuses()} disabled={refreshing || mine.length === 0}>
            {refreshing ? "Refreshing…" : "Refresh status"}
          </button>
        </h2>
        {mine.length === 0 ? (
          <div className="empty">No corrections submitted yet.</div>
        ) : (
          <ul className="list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {mine.map((c) => (
              <li className="item" key={c.id}>
                <div className="item-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="original">{c.sourceText}</div>
                    <div className="translated">{c.proposedTranslation}</div>
                    <div className="item-meta">
                      {c.domain ?? "—"} · {formatDate(c.createdAt)}
                    </div>
                  </div>
                  <Chip tone={c.status}>{c.status}</Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
