import type { ReactNode } from "react";
import { EVIDENCE_LABELS, type EvidenceLevel } from "@douala-ai/shared";

export function Chip({ tone, children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`chip${tone ? ` chip--${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function EvidenceChip({ level }: { level: EvidenceLevel }) {
  return <Chip tone={level}>{EVIDENCE_LABELS[level]}</Chip>;
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function Banner({ tone, children }: { tone: "warn" | "error" | "info" | "muted"; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Button({
  variant = "secondary",
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" }) {
  const cls = ["btn", `btn--${variant}`, size ? `btn--${size}` : "", className ?? ""].filter(Boolean).join(" ");
  return <button type="button" className={cls} {...props} />;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
