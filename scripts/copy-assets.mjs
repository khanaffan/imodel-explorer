// Copies the static assets (locales, workers, images) that @itwin packages ship under lib/public
// into public/, where Vite serves and bundles them.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scope = join(root, "node_modules", "@itwin");
const out = join(root, "public");
mkdirSync(out, { recursive: true });

if (existsSync(scope)) {
  for (const pkg of readdirSync(scope)) {
    const pub = join(scope, pkg, "lib", "public");
    if (existsSync(pub))
      cpSync(pub, out, { recursive: true });
  }
}
