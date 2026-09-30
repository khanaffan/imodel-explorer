import { IModelHost } from "@itwin/core-backend";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createDemoModel } from "../test/demoModel";

/** Writes the "Riverbend Water Treatment Plant" demo iModel. */
/* eslint-disable no-console */
async function main() {
  const file = resolve(process.argv[2] ?? "samples/water-plant.bim");
  mkdirSync(dirname(file), { recursive: true });
  rmSync(file, { force: true });
  await IModelHost.startup({ cacheDir: join(dirname(file), ".demo-cache") });
  try {
    const summary = await createDemoModel(file);
    console.log(`Demo iModel written to ${file} (${summary.elements} elements, ${summary.relationships} link-table relationships)`);
  } finally {
    await IModelHost.shutdown();
    rmSync(join(dirname(file), ".demo-cache"), { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
