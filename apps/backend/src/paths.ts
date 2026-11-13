import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Versioned knowledge base, relative to the repository root. */
export const DEFAULT_KNOWLEDGE_FILE = "data/knowledge/douala.json";

/**
 * Repository root: the closest parent folder containing pnpm-workspace.yaml.
 * Searched from the working directory first (Render starts in apps/backend, `pnpm dev:backend`
 * too), then from this module's location (src/ or the bundled dist/).
 */
export function findRepoRoot(starts: string[] = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]): string {
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`Repository root (pnpm-workspace.yaml) not found from: ${starts.join(", ")}`);
}

/**
 * Absolute path of the knowledge file. LOCAL_KNOWLEDGE_FILE may be absolute, or relative to
 * the repository root; when unset, data/knowledge/douala.json is used.
 */
export function resolveKnowledgeFile(value: string | undefined, repoRoot: string = findRepoRoot()): string {
  const file = value?.trim() || DEFAULT_KNOWLEDGE_FILE;
  return path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
}
