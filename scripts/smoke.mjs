// End-to-end smoke test: launches the built Electron app, opens an iModel, seeds the graph
// from an ECSQL query, recentres on a neighbour and captures screenshots.
// Usage: node scripts/smoke.mjs [file.bim] [ecsql]
import { _electron as electron } from "playwright-core";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const file = resolve(process.argv[2] ?? "samples/pump-network.bim");
const ecsql = process.argv[3] ?? "SELECT ECInstanceId, ECClassId FROM TestIG.Pump WHERE UserLabel = 'Pump-1'";
const outDir = resolve("dist/smoke");
mkdirSync(outDir, { recursive: true });

const errors = [];
const profile = mkdtempSync(join(tmpdir(), "ig-smoke-"));
let app;
try {
  app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env: { ...process.env, IG_DEV: "" } });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack ?? e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });
  // A crashed earlier run may have left features off in localStorage; start from defaults.
  await page.evaluate(() => globalThis.imodelExplorer.featureActions.resetDefaults());
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
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const propertyGrid = page.locator(".ig-element-properties .components-virtualized-property-grid");
  await propertyGrid.waitFor({ timeout: 30_000 });
  await propertyGrid.locator(".virtualized-grid-node-category").first().waitFor({ timeout: 30_000 });
  const gridBounds = await propertyGrid.boundingBox();
  if (!gridBounds || gridBounds.width <= 0 || gridBounds.height <= 0)
    throw new Error("element property grid has no visible area");
  await propertyGrid.locator('[data-instance-id][title*="BisCore:PhysicalModel"]').first().waitFor({ timeout: 10_000 });
  if (await propertyGrid.getByText("Selected Item(s)", { exact: true }).count())
    throw new Error("single-element properties still use a plural selection category");
  await propertyGrid.locator(".virtualized-grid-node-category").filter({ hasText: "Element" }).first().click();
  const aspectCategory = propertyGrid.locator(".virtualized-grid-node-category").filter({ hasText: "PumpSpec" });
  await aspectCategory.waitFor({ timeout: 30_000 });
  await aspectCategory.click();
  await propertyGrid.getByText("RatedPower", { exact: true }).waitFor({ timeout: 10_000 });
  await propertyGrid.getByText(/^7\.50*$/).waitFor({ timeout: 10_000 });

  // Inspect a relationship independently of element/viewport selection.
  const relationshipKey = await page.evaluate(() => {
    const s = globalThis.imodelExplorer.getState();
    return [...s.graph.edges.values()].find((e) => e.relClassName === "TestIG:PumpFeedsPipe")?.key;
  });
  if (!relationshipKey) throw new Error("expected a PumpFeedsPipe relationship");
  await page.evaluate((key) => globalThis.imodelExplorer.graphActions.select({ kind: "edge", key }), relationshipKey);
  await page.locator(".ig-prop__name", { hasText: "FlowRate" }).waitFor({ timeout: 30_000 });
  if (await page.locator(".ig-element-properties").count() !== 0)
    throw new Error("relationship incorrectly uses the element property grid");
  await page.evaluate((key) => globalThis.imodelExplorer.graphActions.select({ kind: "node", key }), summary.centre);
  await propertyGrid.waitFor({ timeout: 30_000 });

  const toolIdle = async () => {
    await page.waitForFunction(() => globalThis.imodelExplorer.getState().status.kind !== "loading", null, { timeout: 30_000 });
    const status = await page.evaluate(() => globalThis.imodelExplorer.getState().status);
    if (status.kind === "error") throw new Error(status.message);
    await page.waitForTimeout(450); // Let animated targets settle before the next user click.
  };
  const armTool = async (name) => {
    await page.locator(".ig-toolbar__tool").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const nodeTarget = (key) => page.locator(`.react-flow__node[data-id="${key}"]`);
  const clearToolsFilters = async () => {
    await page.evaluate(() => globalThis.imodelExplorer.graphActions.clearFilters());
    await toolIdle();
  };
  const selectionBeforeTools = await page.evaluate(() => {
    const s = globalThis.imodelExplorer.getState();
    return { selection: s.selection, ids: [...s.connection.selectionSet.elements] };
  });
  await armTool("Include relationship type");
  await nodeTarget(summary.centre).click();
  await page.getByRole("status").filter({ hasText: "Click a relationship edge" }).waitFor({ timeout: 5_000 });
  await page.locator(".ig-edge-label", { hasText: "PumpFeedsPipe" }).first().click();
  await toolIdle();
  await page.locator(".ig-edge-label", { hasText: "PumpFeedsPipe" }).first().click();
  await page.getByRole("status").filter({ hasText: "Already included" }).waitFor({ timeout: 5_000 });
  const includedType = await page.evaluate(() => {
    const s = globalThis.imodelExplorer.getState();
    return { filter: s.options.filters.relationships["TestIG:PumpFeedsPipe"], centre: s.graph.centreKey,
      allMatch: [...s.graph.edges.values()].every((e) => e.relClassName === "TestIG:PumpFeedsPipe") };
  });
  if (includedType.centre !== summary.centre || !includedType.allMatch || includedType.filter?.state !== "include" || includedType.filter.polymorphic)
    throw new Error("Include relationship tool did not apply an exact type allowlist");
  const selectionAfterTools = await page.evaluate(() => {
    const s = globalThis.imodelExplorer.getState();
    return { selection: s.selection, ids: [...s.connection.selectionSet.elements] };
  });
  if (JSON.stringify(selectionBeforeTools) !== JSON.stringify(selectionAfterTools))
    throw new Error("graph tool changed inspection or viewport selection");
  await clearToolsFilters();
  await armTool("Exclude relationship type");
  await page.locator(".ig-edge-label", { hasText: "PumpFeedsPipe" }).first().click();
  await toolIdle();
  if (await page.evaluate(() => [...globalThis.imodelExplorer.getState().graph.edges.values()].some((e) => e.relClassName === "TestIG:PumpFeedsPipe")))
    throw new Error("Exclude relationship tool leaked edges");
  await clearToolsFilters();

  for (const tool of ["Include node class", "Exclude node class", "Include model", "Exclude model"]) {
    const target = await page.evaluate(() => [...globalThis.imodelExplorer.getState().graph.nodes.values()].find((n) => n.className === "TestIG:Pipe"));
    if (!target) throw new Error("expected a pipe target for click tools");
    await armTool(tool);
    await nodeTarget(target.key).click();
    await toolIdle();
    const entry = await page.evaluate(({ tool, target }) => {
      const f = globalThis.imodelExplorer.getState().options.filters;
      return tool.endsWith("model") ? f.models[target.modelId] : f.classes[target.className];
    }, { tool, target });
    const state = tool.startsWith("Include") ? "include" : "exclude";
    if (typeof entry === "string" ? entry !== state : entry?.state !== state || entry.polymorphic)
      throw new Error(`${tool} did not apply its filter`);
    if ((await page.locator(".ig-toolbar__tool").textContent()) !== `Tool: ${tool}`)
      throw new Error("click tool did not stay armed");
    await clearToolsFilters();
  }
  await armTool("Exclude this instance");
  await nodeTarget(summary.centre).click();
  await page.getByRole("status").filter({ hasText: "centre cannot be excluded" }).waitFor({ timeout: 5_000 });
  const excludedKey = await page.evaluate(() => [...globalThis.imodelExplorer.getState().graph.nodes.values()].find((n) => n.className === "TestIG:Pipe").key);
  await nodeTarget(excludedKey).click({ modifiers: ["Shift"] });
  await toolIdle();
  const excludedResult = await page.evaluate((key) => {
    const s = globalThis.imodelExplorer.getState();
    return { absent: !s.graph.nodes.has(key), sibling: [...s.graph.nodes.values()].some((n) => n.className === "TestIG:Pipe"),
      centre: s.graph.centreKey, filters: s.options.filters.classes, exclusions: s.options.excludedInstances };
  }, excludedKey);
  if (!excludedResult.absent || !excludedResult.sibling || excludedResult.centre !== summary.centre || Object.keys(excludedResult.filters).length || !excludedResult.exclusions.includes(excludedKey))
    throw new Error("single-instance exclusion changed the wrong scope");
  await page.keyboard.press("Escape");
  if ((await page.locator(".ig-toolbar__tool").textContent()) !== "Tool: Navigate")
    throw new Error("Escape did not restore normal navigation");
  await clearToolsFilters();
  await armTool("Exclude node class");
  await page.locator(".ig-toolbar").getByRole("button", { name: "Classes", exact: true }).click();
  if (await page.locator(".ig-toolbar__tool").count()) throw new Error("instance tools leaked into the class graph");
  await page.locator(".ig-toolbar").getByRole("button", { name: "Instances", exact: true }).click();
  if ((await page.locator(".ig-toolbar__tool").textContent()) !== "Tool: Navigate")
    throw new Error("returning to the instance graph did not reset the tool");
  await page.waitForTimeout(450);
  console.log("graph tools: exact type/class/model filters, instance exclusion, repeated clicks, feedback and Escape OK");
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

  // Overview: census loads, and a class row lists exemplars through the Seed panel.
  await page.getByRole("tab", { name: "Overview" }).click();
  const overview = page.locator('[id="content-container:ig-overview"]');
  await overview.getByText("Schemas", { exact: true }).waitFor({ timeout: 30_000 });
  await overview.locator(".ig-census-row", { hasText: "TestIG" }).first().locator(".ig-tree-row__twist").click();
  const pumpRow = overview.locator(".ig-census-row", { hasText: "Pump" }).first();
  const pumpCount = await pumpRow.locator(".ig-census-row__count").textContent();
  console.log(`overview: TestIG Pump count = ${pumpCount}`);
  if (pumpCount !== "3") throw new Error(`overview shows ${pumpCount} pumps, expected 3`);
  await pumpRow.locator("button.ig-census-row__name").click();
  await page.waitForFunction(() => document.querySelector("textarea.ig-sql")?.value.includes("FROM ONLY TestIG.Pump"), null, { timeout: 30_000 });
  await page.locator(".ig-list__item").first().waitFor({ timeout: 30_000 });

  // Relationship census: the link-table PumpFeedsPipe is counted immediately.
  await page.getByRole("tab", { name: "Overview" }).click();
  await overview.getByText("Relationships", { exact: true }).click();
  const feedsRow = overview.locator(".ig-census-row", { hasText: "PumpFeedsPipe" }).first();
  await feedsRow.waitFor({ timeout: 30_000 });
  const feedsCount = await feedsRow.locator(".ig-census-row__count").textContent();
  console.log(`overview: PumpFeedsPipe count = ${feedsCount}`);
  if (feedsCount !== "33") throw new Error(`relationship census shows ${feedsCount} PumpFeedsPipe rows, expected 33`);

  // Treemap renders a rectangle per schema.
  await overview.getByText("Treemap", { exact: true }).click();
  const cells = await overview.locator(".ig-treemap rect").count();
  console.log(`overview: treemap cells = ${cells}`);
  if (cells < 2) throw new Error(`treemap rendered ${cells} cells, expected at least 2`);

  await page.screenshot({ path: `${outDir}/10-overview.png` });
  await page.getByRole("tab", { name: "Seed query" }).click();

  // Class-level graph: neighbourhood collapse, whole-iModel build, double-click back to instances.
  await page.locator(".ig-toolbar").getByRole("button", { name: "Classes", exact: true }).click();
  await page.locator(".ig-classnode", { hasText: "Pump" }).first().waitFor({ timeout: 30_000 });
  const hoodClasses = await page.locator(".ig-classnode").count();
  await page.evaluate(() => globalThis.imodelExplorer.classGraphActions.setScope("imodel"));
  await page.waitForFunction(() => {
    const s = globalThis.imodelExplorer.getClassState();
    return !s.building && s.imodelGraph && s.imodelGraph.nodes.size > 0;
  }, undefined, { timeout: 60_000 });
  await page.locator(".ig-classnode", { hasText: "PumpSpec" }).first().waitFor({ timeout: 30_000 });
  // React Flow renders only in-viewport nodes; count from state, not the DOM.
  const wholeClasses = await page.evaluate(() => globalThis.imodelExplorer.getClassState().imodelGraph.nodes.size);
  console.log(`class graph: neighbourhood ${hoodClasses} classes, whole iModel ${wholeClasses}`);
  if (wholeClasses <= hoodClasses) throw new Error("whole-iModel class graph is not larger than the neighbourhood");
  await page.screenshot({ path: `${outDir}/11-class-graph.png` });
  await page.locator(".ig-classnode", { hasText: "Pump" }).first().dblclick();
  await page.locator(".ig-node").first().waitFor({ timeout: 30_000 });
  const classSeed = await page.locator("textarea.ig-sql").first().inputValue();
  if (!classSeed.includes("FROM ONLY TestIG.Pump")) throw new Error(`class double-click did not fill the seed query: ${classSeed}`);
  await page.getByRole("tab", { name: "Seed query" }).click();

  // Exemplar ranking: the hub ("Header", 30 feeds) sorts to the top.
  await page.getByRole("button", { name: "Rank by connections" }).click();
  await page.locator(".ig-list__secondary", { hasText: "rel" }).first().waitFor({ timeout: 30_000 });
  const topSeed = await page.locator(".ig-list__item .ig-list__primary").first().textContent();
  console.log(`ranking: top seed = ${topSeed}`);
  if (topSeed !== "Header") throw new Error(`ranking put ${topSeed} first, expected Header`);
  await page.screenshot({ path: `${outDir}/12-ranked.png` });

  // Geometry widget: Pump-1's stream shows formatted ops and an expandable part, without a stack.
  await page.evaluate(async (k) => {
    const [classId, id] = k.split(":");
    await globalThis.imodelExplorer.graphActions.seedExternal({ classId, id });
  }, summary.centre);
  await idle();
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: "Geometry" }).click();
  const geom = page.locator('[id="content-container:ig-geometry"]');
  await geom.locator(".ig-geom-op__label", { hasText: "Box" }).first().waitFor({ timeout: 30_000 });
  if (await geom.getByText("Stack", { exact: true }).count() || await geom.locator(".ig-stream-stack").count())
    throw new Error("geometry still renders the removed stack view");
  const opLabels = await geom.locator(".ig-geom-op__label").allTextContents();
  console.log(`geometry ops: ${opLabels.join(",")}`);
  if (opLabels.length < 8) throw new Error(`geometry rendered ${opLabels.length} ops, expected at least 8`);
  if (!opLabels.includes("Box") || !opLabels.includes("Part reference"))
    throw new Error(`geometry ops missing Box/Part reference: ${opLabels.join(",")}`);
  const boxRow = geom.locator(".ig-geom-op").filter({ has: page.locator(".ig-geom-op__label", { hasText: /^Box$/ }) }).first();
  await boxRow.click();
  await geom.locator(".ig-geom-op--selected", { hasText: "Box" }).waitFor({ timeout: 5_000 });
  const partRow = geom.locator(".ig-geom-op", { hasText: "Part reference" }).first();
  await partRow.locator(".ig-caret").click();
  await geom.getByRole("button", { name: "Expand part" }).click();
  await geom.locator(".ig-geom-part .ig-geom-op__label", { hasText: "Box" }).first().waitFor({ timeout: 30_000 });
  console.log("geometry: part expanded inline");
  await geom.getByText("Range & axes").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/13-geometry.png` });

  const checkReferenceCentre = async (id, className) => {
    await toolIdle();
    const centre = await page.evaluate(() => {
      const s = globalThis.imodelExplorer.getState();
      const n = s.graph.nodes.get(s.graph.centreKey);
      return { id: n?.id, className: n?.className };
    });
    if (centre.id !== id || centre.className !== className)
      throw new Error(`instance link navigated to ${JSON.stringify(centre)}, expected ${className} ${id}`);
  };
  const backToGeometry = async () => {
    await page.evaluate(() => globalThis.imodelExplorer.graphActions.back());
    await toolIdle();
    await geom.locator(".ig-geom-op__label", { hasText: "Box" }).first().waitFor({ timeout: 30_000 });
    const centre = await page.evaluate(() => globalThis.imodelExplorer.getState().graph.centreKey);
    if (centre !== summary.centre) throw new Error("Back from an instance link did not restore the centre");
  };
  const partLink = partRow.locator(".ig-geom-op__detail [data-instance-id]").first();
  const partId = await partLink.getAttribute("data-instance-id");
  await partLink.click();
  await checkReferenceCentre(partId, "BisCore:GeometryPart");
  await backToGeometry();

  await geom.getByText("Category & sub-categories", { exact: true }).click();
  const categoryLink = geom.locator(".ig-prop").filter({ has: page.locator(".ig-prop__name", { hasText: /^Category$/ }) }).locator("[data-instance-id]");
  const categoryId = await categoryLink.getAttribute("data-instance-id");
  await categoryLink.click();
  await checkReferenceCentre(categoryId, "BisCore:SpatialCategory");
  await backToGeometry();

  await geom.getByText("Category & sub-categories", { exact: true }).click();
  const subCategoryLink = geom.locator(".ig-prop").filter({ has: page.locator(".ig-prop__name", { hasText: /^Sub-category$/ }) }).locator("[data-instance-id]").first();
  const subCategoryId = await subCategoryLink.getAttribute("data-instance-id");
  await subCategoryLink.click();
  await checkReferenceCentre(subCategoryId, "BisCore:SubCategory");
  await backToGeometry();

  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const modelLink = page.locator('[id="content-container:ig-properties"] .ig-card [data-instance-id][title*="BisCore:Model"]');
  const modelId = await modelLink.getAttribute("data-instance-id");
  await modelLink.click();
  await checkReferenceCentre(modelId, "BisCore:PhysicalModel");
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.back());
  await toolIdle();
  const navigationValue = propertyGrid.locator('[data-instance-id][title*="BisCore:PhysicalModel"]').first();
  await navigationValue.waitFor({ timeout: 10_000 });
  await navigationValue.click();
  await checkReferenceCentre(modelId, "BisCore:PhysicalModel");
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.back());
  await toolIdle();
  console.log("instance links: part, category, sub-category, model header and Presentation navigation, with Back OK");
  await page.getByRole("tab", { name: "Geometry", exact: true }).click();

  // Feature settings: switching a feature off removes its widgets (even the active Geometry tab)
  // and stops its queries; switching back on restores them without reopening the iModel.
  await page.evaluate(() => globalThis.imodelExplorer.featureActions.setEnabled("overview", false));
  await page.evaluate(() => globalThis.imodelExplorer.featureActions.setEnabled("geometry", false));
  await page.waitForTimeout(1000);
  const overviewTabs = await page.getByRole("tab", { name: "Overview" }).count();
  const geometryTabs = await page.getByRole("tab", { name: "Geometry" }).count();
  if (overviewTabs || geometryTabs) throw new Error(`disabled widgets still present: overview=${overviewTabs} geometry=${geometryTabs}`);
  await page.evaluate(() => globalThis.imodelExplorer.classGraphActions.setMode("classes"));
  await page.evaluate(() => globalThis.imodelExplorer.featureActions.setEnabled("classGraph", false));
  await page.waitForTimeout(600);
  const classesButtons = await page.locator(".ig-toolbar").getByRole("button", { name: "Classes", exact: true }).count();
  const modeAfter = await page.evaluate(() => globalThis.imodelExplorer.getClassState().mode);
  if (classesButtons || modeAfter !== "instances") throw new Error(`class graph still active when disabled: buttons=${classesButtons} mode=${modeAfter}`);
  console.log("features: overview/geometry tabs removed, class graph fell back to instances");
  await page.evaluate(() => globalThis.imodelExplorer.featureActions.setEnabled("overview", true));
  await page.getByRole("tab", { name: "Overview" }).waitFor({ timeout: 10_000 });
  console.log("features: re-enabling restored the Overview tab live");
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("instanceGraph.features.v1")));
  if (persisted.geometry !== false || persisted["geometry.overlay"] !== true)
    throw new Error(`feature settings not persisted as expected: ${JSON.stringify(persisted)}`);
  await page.getByRole("button", { name: "App settings" }).click();
  await page.getByText("Optional features", { exact: true }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${outDir}/14-settings.png` });
  // Reset also undoes the overlay toggle persisted by the geometry step: clean slate for next run.
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await page.getByRole("tab", { name: "Geometry" }).waitFor({ timeout: 10_000 });
  await page.locator("button", { hasText: /^Close$/ }).click();
  console.log("features: settings dialog, persistence and reset OK");

  await armTool("Exclude this instance");
  await page.evaluate((f) => globalThis.imodelExplorer.openAndShow(f), file);
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().engine !== undefined, null, { timeout: 60_000 });
  await page.locator(".ig-toolbar__tool").waitFor({ timeout: 5_000 });
  if ((await page.locator(".ig-toolbar__tool").textContent()) !== "Tool: Navigate")
    throw new Error("opening another connection did not reset the active tool");
  if (await page.evaluate(() => globalThis.imodelExplorer.getState().options.excludedInstances.length))
    throw new Error("instance exclusions leaked across connections");
  console.log("graph tools: connection changes reset the active tool and instance exclusions");

  if (summary.nodes < 2 || summary.rendered < 2)
    throw new Error("graph did not render");
} finally {
  try {
    await app?.close();
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
const relevant = errors.filter((e) => !/DevTools|Autofill|favicon/i.test(e));
if (relevant.length) {
  console.log("renderer errors:\n" + relevant.join("\n"));
  process.exitCode = 1;
} else {
  console.log("smoke OK");
}
