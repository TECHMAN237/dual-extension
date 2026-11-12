import { useEffect, useState } from "react";
import { getLanguage } from "@douala-ai/shared";
import { clearHistory, getHistory, type HistoryEntry } from "../../shared/storage";
import { Button, Chip, formatDate } from "./ui";

export function HistoryTab({ onToast }: { onToast: (msg: string) => void }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    getHistory().then(setHistory);
  }, []);
  const clear = async () => {
    await clearHistory();
    setHistory([]);
    onToast("History cleared");
  };
  const tone = (s: HistoryEntry["status"]) => (s === "completed" ? "approved" : s === "partial" ? "uncertain" : "error");
  return (
    <section className="card" aria-label="History">
      <h2 className="card-title">
        Translation history
        <button type="button" className="link-btn" onClick={() => void clear()} disabled={!history || history.length === 0}>
          Clear history
        </button>
      </h2>
      {history === null ? null : history.length === 0 ? (
        <div className="empty">No translations yet.</div>
      ) : (
        <ul className="list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {history.map((h) => (
            <li className="item" key={h.id}>
              <div className="item-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="item-title">{h.domain}</div>
                  <div className="item-sub">
                    {getLanguage(h.sourceLanguage)?.name ?? h.sourceLanguage} → {getLanguage(h.targetLanguage)?.name ?? h.targetLanguage} · {h.translatedCount}/{h.totalSegments} elements
                  </div>
                  <div className="item-meta">{formatDate(h.date)}</div>
                </div>
                <Chip tone={tone(h.status)}>{h.status}</Chip>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ marginTop: 10 }}>
        History is stored only in this browser and never includes page text — just the domain, languages, date and counts.
      </p>
    </section>
  );
}
