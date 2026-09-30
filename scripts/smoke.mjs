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

  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });
  await page.screenshot({ path: `${outDir}/01-welcome.png` });

  await page.evaluate((f) => globalThis.imodelExplorer.openAndShow(f), file);
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().engine !== undefined, null, { timeout: 60_000 });

  const strategy = await page.evaluate(() => globalThis.imodelExplorer.getState().engine.strategy.name);
  console.log(`strategy: ${strategy}`);

  // Options persist in localStorage; start from known settings.
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ depth: 1, direction: "both", filters: { models: {}, schemas: {}, classes: {}, relationships: {} } }, false));

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
    const s = globalThis.imodelExplorer.getState();
    return s.status.kind === "idle" && s.graph.nodes.size > 1;
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const summary = await page.evaluate(() => {
    const s = globalThis.imodelExplorer.getState();
    return { centre: s.graph.centreKey, nodes: s.graph.nodes.size, edges: s.graph.edges.size, rendered: document.querySelectorAll(".react-flow__node").length };
  });
  console.log("after seed:", JSON.stringify(summary));
  // Edges exist in the DOM even when CSS collapses their SVG, so check that they actually paint.
  const paintedEdges = await page.evaluate(() => [...document.querySelectorAll(".react-flow__edge")]
    .filter((e) => { const svg = e.closest("svg"); return svg && svg.getBoundingClientRect().width > 0; }).length);
  console.log(`painted edges: ${paintedEdges}`);
  if (summary.edges > 0 && paintedEdges === 0) throw new Error("edges are in the DOM but not painted");
  await page.screenshot({ path: `${outDir}/02-graph.png` });

  // Depth 2 then recentre by clicking a neighbour node.
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ depth: 2 }));
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().status.kind === "idle", null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const depth2 = await page.evaluate(() => globalThis.imodelExplorer.getState().graph.nodes.size);
  console.log(`depth 2 nodes: ${depth2}`);
  await page.screenshot({ path: `${outDir}/03-depth2.png` });

  const other = page.locator(".react-flow__node:not(:has(.ig-node--centre)):not(:has(.ig-node--aggregate))").first();
  await other.click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => globalThis.imodelExplorer.getState().graph.centreKey);
  console.log(`recentred: ${after !== summary.centre} (${summary.centre} -> ${after})`);
  await page.screenshot({ path: `${outDir}/04-recentred.png` });

  const idle = () => page.waitForFunction(() => globalThis.imodelExplorer.getState().status.kind === "idle", null, { timeout: 60_000 });

  // Back returns to the previous centre without re-querying.
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.back());
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => globalThis.imodelExplorer.getState().graph.centreKey);
  console.log(`back: ${back === summary.centre}`);
  if (back !== summary.centre) throw new Error("back did not restore the previous centre");

  // Excluding BisCore should leave only TestIG instances (plus the centre and summaries).
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ filters: { models: {}, schemas: { BisCore: "exclude" }, classes: {}, relationships: {} } }));
  await idle();
  await page.waitForTimeout(800);
  const schemas = await page.evaluate(() => [...new Set([...globalThis.imodelExplorer.getState().graph.nodes.values()].filter((n) => !n.aggregate).map((n) => n.schemaName))]);
  console.log(`schemas after excluding BisCore: ${schemas.join(",")}`);
  if (schemas.includes("BisCore")) throw new Error("schema filter leaked");
  await page.screenshot({ path: `${outDir}/05-filtered.png` });

  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setLayoutMode("layered"));
  await page.waitForTimeout(2000);
  const layered = await page.evaluate(() => document.querySelectorAll(".react-flow__node").length);
  console.log(`layered rendered nodes: ${layered}`);
  await page.screenshot({ path: `${outDir}/06-layered.png` });
  await page.evaluate(() => {
    globalThis.imodelExplorer.graphActions.setLayoutMode("radial");
    globalThis.imodelExplorer.graphActions.setOptions({ depth: 1, filters: { models: {}, schemas: {}, classes: {}, relationships: {} } }, false);
  });

  // Pin the centre, then click a neighbour in the canvas: the pin stays (it relates directly to the
  // new centre) even though the click echoes back through the viewport selection.
  await page.evaluate(async (k) => {
    const [classId, id] = k.split(":");
    await globalThis.imodelExplorer.graphActions.seedExternal({ classId, id });
  }, summary.centre);
  await idle();
  await page.waitForTimeout(1200);
  await page.evaluate((k) => globalThis.imodelExplorer.graphActions.togglePin(k), summary.centre);
  await page.waitForTimeout(600);
  await page.locator(".react-flow__node:not(:has(.ig-node--centre)):not(:has(.ig-node--aggregate))").first().click();
  await page.waitForFunction((k) => globalThis.imodelExplorer.getState().graph.centreKey !== k, summary.centre, { timeout: 30_000 });
  await idle();
  await page.waitForTimeout(1500);
  const pinned = await page.evaluate((k) => {
    const s = globalThis.imodelExplorer.getState();
    return { kept: s.pins.has(k), shown: s.graph.nodes.has(k), edges: [...s.graph.edges.values()].filter((e) => e.source === k || e.target === k).length, painted: document.querySelectorAll(".ig-node--pinned").length };
  }, summary.centre);
  console.log(`pin after recentre: ${JSON.stringify(pinned)}`);
  if (!pinned.kept || !pinned.shown || pinned.edges === 0 || pinned.painted === 0)
    throw new Error("pinned node did not survive a recentre to its neighbour");
  await page.screenshot({ path: `${outDir}/07-pinned.png` });
  await page.locator(".ig-toolbar__pins").click();
  await page.getByRole("menuitem", { name: "Unpin all" }).waitFor({ timeout: 5_000 });
  await page.locator('[role="menuitem"]').first().hover();
  await page.getByRole("menuitem", { name: "Centre here" }).waitFor({ timeout: 5_000 });
  await page.screenshot({ path: `${outDir}/08-pin-menu.png` });
  await page.keyboard.press("Escape");

  await page.evaluate(async (k) => {
    const [classId, id] = k.split(":");
    await globalThis.imodelExplorer.graphActions.seedExternal({ classId, id });
  }, summary.centre);
  await idle();
  const pinsAfterSeed = await page.evaluate(() => globalThis.imodelExplorer.getState().pins.size);
  console.log(`pins after external seed: ${pinsAfterSeed}`);
  if (pinsAfterSeed !== 0) throw new Error("external seed did not clear pins");

  // Schema panel: the class link in Properties opens it; the explored class survives a reload.
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: "Properties" }).click();
  const centreClass = await page.evaluate(() => {
    const s = globalThis.imodelExplorer.getState();
    return s.graph.nodes.get(s.graph.centreKey).className;
  });
  await page.locator(".ig-card__sub .ig-link", { hasText: centreClass }).click();
  const schemaTitle = () => page.locator(".ig-card__title").first().textContent();
  await page.getByPlaceholder("Search any class…").waitFor({ timeout: 5_000 });
  if ((await schemaTitle()) !== centreClass) throw new Error(`schema panel shows ${await schemaTitle()}, expected ${centreClass}`);
  await page.locator(".ig-schema__chain .ig-link").first().click();
  const explored = await schemaTitle();
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ depth: 2 }));
  await idle();
  await page.waitForTimeout(800);
  console.log(`schema panel: ${centreClass} -> ${explored}, after reload: ${await schemaTitle()}`);
  if ((await schemaTitle()) !== explored) throw new Error("schema panel lost the explored class on reload");
  await page.screenshot({ path: `${outDir}/09-schema.png` });
  await page.getByRole("button", { name: "←", exact: true }).click();
  if ((await schemaTitle()) !== centreClass) throw new Error("schema panel back did not return to the selected class");
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ depth: 1 }, false));

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
