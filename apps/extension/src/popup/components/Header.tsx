import type { HealthResponse } from "@douala-ai/shared";
import { sendToBackground } from "../../shared/messages";

export type HealthState = { status: "checking" } | { status: "connected"; info: HealthResponse } | { status: "mock"; info: HealthResponse } | { status: "offline"; error: string };

const LABELS: Record<HealthState["status"], string> = {
  checking: "Checking…",
  connected: "Connected",
  mock: "Mock mode",
  offline: "Offline",
};

export function Header({ health }: { health: HealthState }) {
  const tooltip =
    health.status === "connected" || health.status === "mock"
      ? `Backend ${health.info.version} · provider: ${health.info.provider}${health.info.model ? ` · model: ${health.info.model}` : ""} · ${health.info.knowledgeEntries} knowledge entries`
      : health.status === "offline"
        ? health.error
        : "Contacting the backend";
  return (
    <header className="header">
      <div className="monogram" aria-hidden="true">
        D
      </div>
      <div className="brand">
        <span className="wordmark">Douala AI</span>
        <span className="tagline">Website translation into Douala</span>
      </div>
      <span className={`status status--${health.status}`} title={tooltip} data-testid="connection-status">
        <span className="status-dot" />
        {LABELS[health.status]}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label="Settings"
        title="Settings"
        onClick={() => {
          void sendToBackground({ type: "OPEN_OPTIONS" }).catch(() => chrome.runtime.openOptionsPage());
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
    </header>
  );
}
