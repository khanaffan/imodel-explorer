// End-to-end smoke test: launches the built Electron app, opens an iModel, seeds the graph
// from an ECSQL query, recentres on a neighbour and captures screenshots.
// Usage: node scripts/smoke.mjs [file.bim] [ecsql]
import { _electron as electron } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.argv[2] ?? "samples/pump-network.bim");
const ecsql = process.argv[3] ?? "SELECT ECInstanceId, ECClassId FROM TestIG.Pump WHERE UserLabel = 'Pump-1'";
const outDir = resolve("dist/smoke");
mkdirSync(outDir, { recursive: true });

const errors = [];
const app = await electron.launch({ args: ["."], env: { ...process.env, IG_DEV: "" } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack ?? e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  await page.waitForFunction(() => globalThis.instanceGraph !== undefined, null, { timeout: 60_000 });
  await page.screenshot({ path: `${outDir}/01-welcome.png` });

  await page.evaluate((f) => globalThis.instanceGraph.openAndShow(f), file);
  await page.waitForFunction(() => globalThis.instanceGraph.getState().engine !== undefined, null, { timeout: 60_000 });

  const strategy = await page.evaluate(() => globalThis.instanceGraph.getState().engine.strategy.name);
  console.log(`strategy: ${strategy}`);

  // Options persist in localStorage; start from known settings.
  await page.evaluate(() => globalThis.instanceGraph.graphActions.setOptions({ depth: 1, direction: "both", filters: { models: {}, schemas: {}, classes: {}, relationships: {} } }, false));

  // Drive the Seed widget like a user would.
  // The persisted layout may have another tab active in the seed panel.
  await page.getByText("Seed query", { exact: true }).first().click().catch(() => {});
  const editor = page.locator("textarea.ig-sql").first();
  await editor.waitFor({ timeout: 30_000 });
  await editor.fill(ecsql);
  await page.getByRole("button", { name: /run/i }).first().click();
  await page.locator(".ig-list__item").first().waitFor({ timeout: 30_000 });
  await page.locator(".ig-list__item").first().click();

  await page.waitForFunction(() => {
    const s = globalThis.instanceGraph.getState();
    return s.status.kind === "idle" && s.graph.nodes.size > 1;
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const summary = await page.evaluate(() => {
    const s = globalThis.instanceGraph.getState();
    return { centre: s.graph.centreKey, nodes: s.graph.nodes.size, edges: s.graph.edges.size, rendered: document.querySelectorAll(".react-flow__node").length };
  });
  console.log("after seed:", JSON.stringify(summary));
  await page.screenshot({ path: `${outDir}/02-graph.png` });

  // Depth 2 then recentre by clicking a neighbour node.
  await page.evaluate(() => globalThis.instanceGraph.graphActions.setOptions({ depth: 2 }));
  await page.waitForFunction(() => globalThis.instanceGraph.getState().status.kind === "idle", null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const depth2 = await page.evaluate(() => globalThis.instanceGraph.getState().graph.nodes.size);
  console.log(`depth 2 nodes: ${depth2}`);
  await page.screenshot({ path: `${outDir}/03-depth2.png` });

  const other = page.locator(".react-flow__node:not(:has(.ig-node--centre)):not(:has(.ig-node--aggregate))").first();
  await other.click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => globalThis.instanceGraph.getState().graph.centreKey);
  console.log(`recentred: ${after !== summary.centre} (${summary.centre} -> ${after})`);
  await page.screenshot({ path: `${outDir}/04-recentred.png` });

  const idle = () => page.waitForFunction(() => globalThis.instanceGraph.getState().status.kind === "idle", null, { timeout: 60_000 });

  // Back returns to the previous centre without re-querying.
  await page.evaluate(() => globalThis.instanceGraph.graphActions.back());
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => globalThis.instanceGraph.getState().graph.centreKey);
  console.log(`back: ${back === summary.centre}`);
  if (back !== summary.centre) throw new Error("back did not restore the previous centre");

  // Excluding BisCore should leave only TestIG instances (plus the centre and summaries).
  await page.evaluate(() => globalThis.instanceGraph.graphActions.setOptions({ filters: { models: {}, schemas: { BisCore: "exclude" }, classes: {}, relationships: {} } }));
  await idle();
  await page.waitForTimeout(800);
  const schemas = await page.evaluate(() => [...new Set([...globalThis.instanceGraph.getState().graph.nodes.values()].filter((n) => !n.aggregate).map((n) => n.schemaName))]);
  console.log(`schemas after excluding BisCore: ${schemas.join(",")}`);
  if (schemas.includes("BisCore")) throw new Error("schema filter leaked");
  await page.screenshot({ path: `${outDir}/05-filtered.png` });

  await page.evaluate(() => globalThis.instanceGraph.graphActions.setLayoutMode("layered"));
  await page.waitForTimeout(2000);
  const layered = await page.evaluate(() => document.querySelectorAll(".react-flow__node").length);
  console.log(`layered rendered nodes: ${layered}`);
  await page.screenshot({ path: `${outDir}/06-layered.png` });
  await page.evaluate(() => {
    globalThis.instanceGraph.graphActions.setLayoutMode("radial");
    globalThis.instanceGraph.graphActions.setOptions({ depth: 1, filters: { models: {}, schemas: {}, classes: {}, relationships: {} } }, false);
  });

  if (summary.nodes < 2 || summary.rendered < 2)
    throw new Error("graph did not render");
} finally {
  await app.close();
}
const relevant = errors.filter((e) => !/DevTools|Autofill|favicon/i.test(e));
if (relevant.length) {
  console.log("renderer errors:\n" + relevant.join("\n"));
  process.exitCode = 1;
} else {
  console.log("smoke OK");
}
