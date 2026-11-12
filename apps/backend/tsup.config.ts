import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "cli/ingest": "src/cli/ingest.ts", "cli/test-connection": "src/cli/test-connection.ts", "cli/seed": "src/cli/seed.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: false,
  // Bundle only the workspace packages; every third-party module stays external and is
  // resolved from node_modules at runtime (they are listed in package.json dependencies).
  noExternal: [/^@douala-ai\//],
  external: [/^[^./]/],
  onSuccess: "node scripts/postbuild.mjs",
});
