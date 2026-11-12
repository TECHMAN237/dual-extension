// Copies static assets (admin page, seed data) next to the bundled server.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
rmSync(path.join(dist, "seed"), { recursive: true, force: true });
rmSync(path.join(dist, "admin"), { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(path.join(root, "src/admin"), path.join(dist, "admin"), { recursive: true });
cpSync(path.resolve(root, "../../packages/linguistic-knowledge/seed"), path.join(dist, "seed"), { recursive: true });
console.log("postbuild: copied admin/ and seed/ into dist/");
