import { EVIDENCE_DESCRIPTIONS, EVIDENCE_LABELS, EVIDENCE_LEVELS } from "@douala-ai/shared";
import { Chip } from "./ui";

export function AboutTab() {
  const version = chrome.runtime.getManifest?.().version ?? "dev";
  return (
    <>
      <section className="card about" aria-label="About">
        <h2 className="card-title">About DOUALA AI</h2>
        <p>DOUALA AI translates the interface and text of websites from English or French into Douala (Duálá), a Bantu language of Cameroon&apos;s Littoral Region.</p>
        <p>
          Translations are produced by an AI model that is grounded in a curated linguistic knowledge base: dictionaries, grammar references and approved community corrections. When the evidence is insufficient, the original text is kept rather than inventing Douala.
        </p>
        <p>The extension only accesses the current tab when you click it, and sends page text to the backend you configure in Settings.</p>
        <p className="muted">Version {version} · Documentation: see the project README and docs folder.</p>
      </section>
      <section className="card" aria-label="Evidence legend">
        <h2 className="card-title">Evidence levels</h2>
        <div className="legend">
          {EVIDENCE_LEVELS.map((level) => (
            <div className="legend-row" key={level}>
              <Chip tone={level}>{EVIDENCE_LABELS[level]}</Chip>
              <span>{EVIDENCE_DESCRIPTIONS[level]}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
