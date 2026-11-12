import { randomUUID } from "node:crypto";
import type { CorrectionRecord, CorrectionSubmission, HistoryRecord } from "@douala-ai/shared";
import type { CorrectionsRepository, HistoryInput, HistoryRepository, Repositories, UsageInput, UsageRepository, UsageSummary } from "./types";

interface StoredCorrection extends CorrectionRecord {
  clientId: string;
  reviews: { reviewer: string; status: "approved" | "rejected"; note: string | null; at: string }[];
}

export class MemoryCorrectionsRepository implements CorrectionsRepository {
  private items = new Map<string, StoredCorrection>();

  async create(input: CorrectionSubmission): Promise<CorrectionRecord> {
    const now = new Date().toISOString();
    const rec: StoredCorrection = {
      id: randomUUID(),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceText: input.sourceText,
      aiTranslation: input.aiTranslation,
      proposedTranslation: input.proposedTranslation,
      explanation: input.explanation ?? null,
      context: input.context,
      domain: input.domain ?? null,
      status: "pending",
      reviewNote: null,
      createdAt: now,
      updatedAt: now,
      clientId: input.clientId,
      reviews: [],
    };
    this.items.set(rec.id, rec);
    return strip(rec);
  }

  async getByIds(ids: string[]): Promise<CorrectionRecord[]> {
    return ids.map((id) => this.items.get(id)).filter((r): r is StoredCorrection => Boolean(r)).map(strip);
  }

  async listByClient(clientId: string, limit = 100): Promise<CorrectionRecord[]> {
    return [...this.items.values()].filter((r) => r.clientId === clientId).sort(byNewest).slice(0, limit).map(strip);
  }

  async list(options: { status?: CorrectionRecord["status"]; limit?: number; offset?: number }): Promise<CorrectionRecord[]> {
    const all = [...this.items.values()].filter((r) => (options.status ? r.status === options.status : true)).sort(byNewest);
    const offset = options.offset ?? 0;
    return all.slice(offset, offset + (options.limit ?? 100)).map(strip);
  }

  async review(id: string, status: "approved" | "rejected", reviewNote: string | null, reviewer: string): Promise<CorrectionRecord | null> {
    const rec = this.items.get(id);
    if (!rec) return null;
    rec.status = status;
    rec.reviewNote = reviewNote;
    rec.updatedAt = new Date().toISOString();
    rec.reviews.push({ reviewer, status, note: reviewNote, at: rec.updatedAt });
    return strip(rec);
  }

  async countRecent(clientId: string, sinceIso: string): Promise<number> {
    return [...this.items.values()].filter((r) => r.clientId === clientId && r.createdAt >= sinceIso).length;
  }
}

function strip(rec: StoredCorrection): CorrectionRecord {
  const { clientId: _c, reviews: _r, ...rest } = rec;
  return rest;
}
function byNewest(a: { createdAt: string }, b: { createdAt: string }) {
  return b.createdAt.localeCompare(a.createdAt);
}

export class MemoryHistoryRepository implements HistoryRepository {
  private items: (HistoryRecord & { clientId: string })[] = [];
  async record(input: HistoryInput): Promise<HistoryRecord> {
    const rec = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
    this.items.unshift(rec);
    if (this.items.length > 5000) this.items.length = 5000;
    const { clientId: _c, ...rest } = rec;
    return rest;
  }
  async listByClient(clientId: string, limit = 50): Promise<HistoryRecord[]> {
    return this.items
      .filter((r) => r.clientId === clientId)
      .slice(0, limit)
      .map(({ clientId: _c, ...rest }) => rest);
  }
}

export class MemoryUsageRepository implements UsageRepository {
  private items: (UsageInput & { at: string })[] = [];
  async record(input: UsageInput): Promise<void> {
    this.items.push({ ...input, at: new Date().toISOString() });
    if (this.items.length > 10_000) this.items.splice(0, this.items.length - 10_000);
  }
  async summary(sinceIso: string): Promise<UsageSummary> {
    const summary: UsageSummary = { requests: 0, failures: 0, items: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
    for (const u of this.items) {
      if (u.at < sinceIso) continue;
      summary.requests++;
      if (!u.ok) summary.failures++;
      summary.items += u.items;
      summary.inputTokens += u.inputTokens;
      summary.outputTokens += u.outputTokens;
      const m = (summary.byModel[u.model] ??= { requests: 0, items: 0, inputTokens: 0, outputTokens: 0 });
      m.requests++;
      m.items += u.items;
      m.inputTokens += u.inputTokens;
      m.outputTokens += u.outputTokens;
    }
    return summary;
  }
}

export function createMemoryRepositories(): Repositories {
  return { corrections: new MemoryCorrectionsRepository(), history: new MemoryHistoryRepository(), usage: new MemoryUsageRepository() };
}
