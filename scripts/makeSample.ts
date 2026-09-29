import { IModelHost } from "@itwin/core-backend";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createFixture } from "../test/fixture";

/** Writes the test fixture (pumps, pipes, nav + link-table relationships) to a .bim for manual exploration. */
/* eslint-disable no-console */
async function main() {
  const file = resolve(process.argv[2] ?? "samples/pump-network.bim");
  mkdirSync(dirname(file), { recursive: true });
  const fx = await createFixture({ file, keep: true });
  await fx.close();
  await IModelHost.shutdown();
  console.log(`Sample iModel written to ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
