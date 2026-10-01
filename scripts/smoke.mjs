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

  // First-run tour: shown once on a fresh profile; keyboard driven; dismissal persists.
  const tour = page.getByTestId("tour");
  await tour.waitFor({ timeout: 10_000 });
  const tourStep = () => tour.locator("text=/^\\d+ of \\d+$/").first().textContent();
  if ((await tourStep()) !== "1 of 6") throw new Error(`tour did not start at its first step: ${await tourStep()}`);
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "tour-next", null, { timeout: 5_000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-testid=tour]")?.textContent.includes("2 of 6"), null, { timeout: 5_000 });
  if (!(await page.locator(".ig-tour__ring").count())) throw new Error("tour step 2 did not highlight the Seed panel");
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => document.querySelector("[data-testid=tour]")?.textContent.includes("1 of 6"), null, { timeout: 5_000 });
  await page.keyboard.press("Escape");
  await tour.waitFor({ state: "detached", timeout: 5_000 });
  if (await page.evaluate(() => localStorage.getItem("instanceGraph.tourSeen")) !== "1") throw new Error("skipping the tour was not remembered");
  console.log("first-run tour: shown on first open, Enter/←/Escape, dismissal persisted");

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
  const checkToolbarClearance = async () => {
    const cornerButton = page.locator(".nz-app-button");
    const close = await cornerButton.boundingBox();
    if (!close) throw new Error("Close iModel button is not visible");
    const toolbar = page.locator(".ig-toolbar");
    for (const name of ["Instances", "Classes", /Back \(Alt/, /Forward \(Alt/]) {
      const button = toolbar.getByRole("button", { name, exact: typeof name === "string" });
      if (!await button.count()) continue;
      const bounds = await button.boundingBox();
      if (!bounds) throw new Error(`Graph toolbar button ${name} is not visible`);
      if (bounds.x < close.x + close.width && bounds.x + bounds.width > close.x
        && bounds.y < close.y + close.height && bounds.y + bounds.height > close.y)
        throw new Error(`Close iModel overlaps ${name}: close=${JSON.stringify(close)} button=${JSON.stringify(bounds)}`);
      if (await button.isEnabled()) {
        const uncovered = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
        if (!uncovered) throw new Error(`Graph toolbar button ${name} is covered or clipped`);
      }
    }
  };
  for (const width of [1600, 1200, 1000]) {
    await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 1000), width);
    await page.waitForTimeout(300);
    await checkToolbarClearance();
    await page.locator(".ig-toolbar").getByRole("button", { name: "Classes", exact: true }).click();
    await checkToolbarClearance();
    await page.locator(".ig-toolbar").getByRole("button", { name: "Instances", exact: true }).click();
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await page.waitForTimeout(300);
  console.log("graph toolbar: corner-button clearance and visible controls at normal/narrow widths in both modes OK");
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
    const item = page.getByRole("menuitem", { name, exact: true });
    const icon = item.locator(".ig-tool-icon");
    await icon.waitFor({ state: "visible", timeout: 5_000 });
    const tool = await icon.getAttribute("data-tool");
    await item.click();
    const activeIcon = page.locator(".ig-toolbar__tool .ig-tool-icon");
    await activeIcon.waitFor({ state: "visible", timeout: 5_000 });
    if ((await activeIcon.getAttribute("data-tool")) !== tool)
      throw new Error(`${name} is missing its active toolbar icon`);
  };
  await page.locator(".ig-toolbar__tool").click();
  const toolMenuIcons = page.getByRole("menuitem").locator(".ig-tool-icon");
  await toolMenuIcons.nth(8).waitFor({ timeout: 5_000 });
  if (await toolMenuIcons.count() !== 9) throw new Error(`expected icons for all nine graph tools, got ${await toolMenuIcons.count()}`);
  await page.getByRole("menuitem", { name: "Navigate", exact: true }).click();
  if (await page.locator(".ig-toolbar__tool .ig-tool-icon").getAttribute("data-tool") !== "navigate")
    throw new Error("Navigate is missing its toolbar icon");
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

  // Phase 1 navigation: native menu, palette, find, path, breadcrumbs, filter undo, toasts.
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const state = (fn) => page.evaluate(fn);
  const menuItems = async () => app.evaluate(({ Menu }) => {
    const walk = (items, path) => items.flatMap((i) => [{ path: [...path, i.label].join(" > "), enabled: i.enabled, accelerator: i.accelerator ?? null },
      ...(i.submenu ? walk(i.submenu.items, [...path, i.label]) : [])]);
    return walk(Menu.getApplicationMenu()?.items ?? [], []);
  });
  let menu = [];
  for (let i = 0; i < 20 && !menu.some((m) => m.path === "Graph > Find in graph…" && m.enabled); i++) {
    await page.waitForTimeout(200);
    menu = await menuItems();
  }
  const find = (path) => menu.find((m) => m.path === path);
  if (!find("Graph > Find in graph…")?.enabled || find("Graph > Find in graph…").accelerator !== "CmdOrCtrl+F")
    throw new Error(`native menu is missing an enabled Graph > Find in graph…: ${JSON.stringify(menu.filter((m) => m.path.startsWith("Graph")))}`);
  if (!find("Edit > Undo") || find("Edit > Undo").accelerator !== "CmdOrCtrl+Z" || !find("View > Theme > Dark") || !find("File > Export graph > GraphML"))
    throw new Error("native menu is missing Edit > Undo, View > Theme or File > Export graph entries");
  if (find("View > Fit graph to view")?.accelerator) throw new Error("bare-key shortcuts must not become menu accelerators");
  const fitBefore = await state(() => globalThis.imodelExplorer.getState().fitRequest);
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.find((i) => i.label === "View").submenu.items.find((i) => i.label === "Fit graph to view");
    item.click();
  });
  await page.waitForFunction((n) => globalThis.imodelExplorer.getState().fitRequest > n, fitBefore, { timeout: 5_000 });
  console.log("native menu: renderer commands, accelerators, submenus and click dispatch OK");

  // Toasts (and so the toaster under AppUI's ThemeManager) via Save session.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(`${mod}+s`);
  await page.getByText(/^Saved "Session /).first().waitFor({ timeout: 5_000 });
  console.log("toasts: save session confirmation shown");

  // Command palette: instance search, centre, then a command.
  await page.keyboard.press(`${mod}+k`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor({ timeout: 5_000 });
  await palette.getByRole("combobox").fill("pump-2");
  const pump2Option = palette.getByRole("option").filter({ hasText: "Pump-2" }).first();
  await pump2Option.waitFor({ timeout: 10_000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  // Pump-2 must rank first: it is a literal match, and no command title contains "pump-2".
  if (!(await palette.getByRole("option").first().textContent()).includes("Pump-2")) throw new Error("palette did not rank the instance match first");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached", timeout: 5_000 });
  await toolIdle();
  const pump2Key = await state(() => globalThis.imodelExplorer.getState().graph.centreKey);
  if (await state(() => globalThis.imodelExplorer.getState().graph.nodes.get(globalThis.imodelExplorer.getState().graph.centreKey).label) !== "Pump-2")
    throw new Error("palette instance search did not centre on Pump-2");
  await page.keyboard.press(`${mod}+k`);
  await palette.getByRole("combobox").fill("radial layout");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached", timeout: 5_000 });
  if (await state(() => globalThis.imodelExplorer.getState().layoutMode) !== "radial") throw new Error("palette command did not run");
  console.log("command palette: instance search ranks and centres, commands run OK");

  // Find in graph: highlight, cycle, Escape.
  await page.keyboard.press(`${mod}+f`);
  const findInput = page.getByRole("textbox", { name: "Find in graph" });
  await findInput.waitFor({ timeout: 5_000 });
  await findInput.fill("pipe");
  const counter = page.locator(".ig-findbar__count");
  const total = await state(() => [...globalThis.imodelExplorer.getState().graph.nodes.values()].filter((n) => !n.aggregate && /pipe/i.test(`${n.label} ${n.className} ${n.id}`)).length);
  if (total < 2) throw new Error("expected at least two pipes around Pump-2");
  await page.waitForFunction((t) => document.querySelector(".ig-findbar__count")?.textContent === `1 of ${t}`, total, { timeout: 5_000 });
  await page.keyboard.press("Enter");
  if ((await counter.textContent()) !== `2 of ${total}`) throw new Error("Enter did not advance the find match");
  await page.keyboard.press("Shift+Enter");
  if ((await counter.textContent()) !== `1 of ${total}`) throw new Error("Shift+Enter did not go back a match");
  if (await page.locator(".ig-node--find-current").count() !== 1 || await page.locator(".ig-node--find-dimmed").count() === 0)
    throw new Error("find did not highlight the current match and dim the rest");
  await page.keyboard.press("Escape");
  await findInput.waitFor({ state: "detached", timeout: 5_000 });
  if (await page.locator(".ig-node--find-dimmed").count()) throw new Error("closing find left nodes dimmed");
  console.log("find in graph: counter, Enter/Shift+Enter cycling, highlight/dim and Escape OK");

  // Path finder from Pump-2 to Pump-1 using only PumpFeedsPipe (Pump-1 → Pipe-A ← Pump-2).
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setFilter("relationships", "TestIG:PumpFeedsPipe", "include"));
  await toolIdle();
  await page.keyboard.press(`${mod}+k`);
  await palette.getByRole("combobox").fill("pump-1");
  await palette.getByRole("option").filter({ hasText: "Pump-1" }).first().waitFor({ timeout: 10_000 });
  await page.keyboard.press("Shift+Enter");
  await palette.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().pathView !== undefined, null, { timeout: 30_000 });
  await toolIdle();
  const path = await state(() => {
    const s = globalThis.imodelExplorer.getState();
    return { labels: [...s.graph.nodes.values()].filter((n) => !n.aggregate).sort((a, b) => a.depth - b.depth).map((n) => n.label), crumbs: s.crumbs.map((c) => c.label), status: s.status.message };
  });
  if (JSON.stringify(path.labels) !== JSON.stringify(["Pump-2", "Pipe-A", "Pump-1"]) || !/2 relationships/.test(path.status))
    throw new Error(`unexpected path result: ${JSON.stringify(path)}`);
  const crumbs = page.locator(".ig-crumbs");
  await crumbs.getByText(/^Path: Pump-2 → Pump-1$/).waitFor({ timeout: 5_000 });
  console.log("path finder: shortest filtered path shown, recorded in history and labelled OK");

  // Breadcrumbs: jump back to Pump-2's neighbourhood.
  await crumbs.getByText("Pump-2", { exact: true }).last().click();
  await toolIdle();
  const afterCrumb = await state(() => ({ centre: globalThis.imodelExplorer.getState().graph.centreKey, path: globalThis.imodelExplorer.getState().pathView, forward: globalThis.imodelExplorer.getState().canGoForward }));
  if (afterCrumb.centre !== pump2Key || afterCrumb.path || !afterCrumb.forward) throw new Error(`breadcrumb jump failed: ${JSON.stringify(afterCrumb)}`);
  console.log("breadcrumbs: jump to an earlier stop keeps the forward branch OK");

  // Filter undo/redo from the keyboard (outside text fields).
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(`${mod}+z`);
  await toolIdle();
  if (await state(() => Object.keys(globalThis.imodelExplorer.getState().options.filters.relationships).length) !== 0) throw new Error(`${mod}+Z did not undo the filter`);
  await page.keyboard.press(`${mod}+Shift+z`);
  await toolIdle();
  if (await state(() => globalThis.imodelExplorer.getState().options.filters.relationships["TestIG:PumpFeedsPipe"]?.state) !== "include") throw new Error(`${mod}+Shift+Z did not redo the filter`);
  // Typing in a field must not trigger graph shortcuts.
  await page.keyboard.press(`${mod}+f`);
  await findInput.fill("");
  const pinsBefore = await state(() => globalThis.imodelExplorer.getState().pins.size);
  await findInput.press("p");
  if (await state(() => globalThis.imodelExplorer.getState().pins.size) !== pinsBefore) throw new Error("P pinned while typing in the find field");
  await page.keyboard.press("Escape");
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.clearFilters());
  await page.evaluate((key) => { const [classId, id] = key.split(":"); return globalThis.imodelExplorer.graphActions.centreOn({ classId, id }); }, summary.centre);
  await toolIdle();
  console.log("filter undo/redo shortcuts and in-field shortcut guard OK");

  // Status bar: counts follow the graph, the filter count opens Traversal & filters.
  const statusCounts = page.locator("[data-testid=status-counts]");
  const expectedCounts = await state(() => {
    const g = globalThis.imodelExplorer.getState().graph;
    return `${[...g.nodes.values()].filter((n) => !n.aggregate).length} instances · ${g.edges.size} relationships`;
  });
  await page.waitForFunction((t) => document.querySelector("[data-testid=status-counts]")?.textContent?.startsWith(t), expectedCounts, { timeout: 5_000 })
    .catch(async () => { throw new Error(`status bar shows "${await statusCounts.textContent()}", expected "${expectedCounts}"`); });
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setFilter("classes", "TestIG:Pipe", "exclude"));
  await toolIdle();
  await page.locator("[data-testid=status-filters]", { hasText: "1 filter" }).waitFor({ timeout: 5_000 });
  await page.getByRole("tab", { name: "Models & categories" }).click().catch(() => {});
  await page.locator("[data-testid=status-filters]").click();
  await page.getByText("Node budget", { exact: true }).waitFor({ state: "visible", timeout: 5_000 });
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.clearFilters());
  await toolIdle();
  await page.locator("[data-testid=status-filters]", { hasText: "No filters" }).waitFor({ timeout: 5_000 });
  await page.getByText(/^Loaded in \d/).waitFor({ timeout: 5_000 });
  const memoryText = await page.getByTestId("status-memory").textContent({ timeout: 10_000 });
  const memoryTitle = await page.getByTestId("status-memory").getAttribute("title");
  if (!/^Memory \d+(\.\d)? (MB|GB)$/.test(memoryText) || !memoryTitle.includes("Main & iModel backend"))
    throw new Error(`status bar memory is wrong: ${memoryText} / ${memoryTitle}`);
  console.log("status bar: iModel, counts, filter count (opens Filters), load time and memory OK");

  // Shortcut sheet: "?" opens it, generated from the registry and searchable.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("?");
  const sheet = page.locator(".ig-shortcuts");
  await sheet.waitFor({ timeout: 5_000 });
  for (const title of ["Command palette", "Find in graph…", "Undo", "Keyboard shortcuts", "Find path from the centre to an instance"])
    if (!(await sheet.getByText(title, { exact: true }).count())) throw new Error(`shortcut sheet is missing "${title}"`);
  await sheet.getByRole("textbox", { name: "Search shortcuts" }).fill("pin");
  if (await sheet.getByText("Command palette", { exact: true }).count() || !(await sheet.getByText("Pin or unpin selected node").count()))
    throw new Error("shortcut sheet search did not filter");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached", timeout: 5_000 });
  console.log("shortcut sheet: ? opens it, registry entries, search and Escape OK");
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
  await checkToolbarClearance();
  await page.locator(".ig-toolbar").getByRole("button", { name: /Back \(Alt/ }).click();
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
  const boxIndex = await boxRow.locator(".ig-geom-op__index").textContent();
  const opSearch = geom.getByRole("textbox", { name: "Search geometry ops", exact: true });
  const opFilter = geom.getByRole("combobox", { name: "Filter geometry ops", exact: true });
  await opSearch.fill(" bOx ");
  const filteredLabels = await geom.locator(".ig-geom-op__label").allTextContents();
  if (JSON.stringify(filteredLabels) !== JSON.stringify(["Box"]) || await boxRow.locator(".ig-geom-op__index").textContent() !== boxIndex)
    throw new Error("geometry search lost original op indices or returned unexpected rows");
  await boxRow.locator(".ig-caret").click();
  await geom.getByRole("button", { name: "Raw JSON", exact: true }).click();
  const rawJson = await geom.locator(".ig-geom-raw pre").textContent();
  if (!JSON.parse(rawJson).box) throw new Error("selected Box op did not expose its raw geometry entry");
  // Exercise the copy boundary without changing the user's system clipboard.
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", {
    configurable: true, value: async (text) => { globalThis.geometryCopiedJson = text; },
  }));
  await geom.getByRole("button", { name: "Copy JSON", exact: true }).click();
  await geom.getByRole("status").filter({ hasText: /^Copied$/ }).waitFor();
  if (await page.evaluate(() => globalThis.geometryCopiedJson) !== rawJson)
    throw new Error("Copy JSON did not preserve the exact displayed op entry");
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", {
    configurable: true, value: async () => { throw new Error("clipboard unavailable"); },
  }));
  await geom.getByRole("button", { name: "Copy JSON", exact: true }).click();
  await geom.getByRole("alert").filter({ hasText: "Failed to copy op JSON: clipboard unavailable" }).waitFor();
  await page.evaluate(() => { delete navigator.clipboard.writeText; delete globalThis.geometryCopiedJson; });
  await opSearch.fill("no matching geometry op");
  await geom.getByText("No ops match the search and filter.", { exact: true }).waitFor();
  await opSearch.fill("");
  await opFilter.click();
  await page.getByRole("option", { name: "Appearance", exact: true }).click();
  const appearanceLabels = await geom.locator(".ig-geom-op__label").allTextContents();
  if (appearanceLabels.length !== 2 || !appearanceLabels.every((label) => label === "Appearance"))
    throw new Error("Appearance filter returned unexpected geometry ops");
  await opFilter.click();
  await page.getByRole("option", { name: "All ops", exact: true }).click();
  const partRow = geom.locator(".ig-geom-op", { hasText: "Part reference" }).first();
  await partRow.locator(".ig-caret").click();
  await geom.getByRole("button", { name: "Expand part" }).click();
  await geom.locator(".ig-geom-part .ig-geom-op__label", { hasText: "Box" }).first().waitFor({ timeout: 30_000 });
  const partSearch = geom.locator(".ig-geom-part").getByRole("textbox");
  await partSearch.fill("Arc");
  if (JSON.stringify(await geom.locator(".ig-geom-part .ig-geom-op__label").allTextContents()) !== JSON.stringify(["Arc"]))
    throw new Error("expanded part search did not filter its own stream");
  await partSearch.fill("");
  console.log("geometry inspection: search/type filters, original indices, raw JSON, copy output/errors and part search OK");
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
  await page.waitForTimeout(1000);
  if (await tour.count()) throw new Error("the tour came back after it was dismissed");

  // Phase 3: replaying the tour, saved seeds, notes, session diff and pasted links.
  await toolIdle();
  await page.evaluate(() => globalThis.imodelExplorer.runCommand("help.tour", "ui"));
  await tour.waitFor({ timeout: 5_000 });
  await page.getByTestId("tour-skip").click();
  await tour.waitFor({ state: "detached", timeout: 5_000 });
  console.log("tour: not shown again on reopen; replayable from Help and skippable");

  await page.getByRole("tab", { name: "Seed query", exact: true }).click();
  await editor.fill(ecsql);
  await page.getByRole("button", { name: "Save…" }).click();
  const saveForm = page.getByRole("group", { name: "Save query" });
  await saveForm.getByPlaceholder("Name").fill("Smoke pump");
  await saveForm.getByPlaceholder("Description (optional)").fill("Pump-1 by label");
  await saveForm.getByRole("checkbox").check();
  await saveForm.getByRole("button", { name: "Save query" }).click();
  await saveForm.waitFor({ state: "detached", timeout: 5_000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("instanceGraph.savedSeeds")));
  if (saved.length !== 1 || saved[0].name !== "Smoke pump" || saved[0].ecsql !== ecsql || !saved[0].fileName)
    throw new Error(`saved seed not persisted as expected: ${JSON.stringify(saved)}`);
  await editor.fill("");
  await page.getByTestId("seed-saved").click();
  await page.getByRole("menuitem", { name: /Smoke pump/ }).first().click();
  await page.waitForFunction((q) => document.querySelector("textarea.ig-sql")?.value === q, ecsql, { timeout: 5_000 });
  await page.locator(".ig-list__item").first().waitFor({ timeout: 30_000 });
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("instanceGraph.seedHistory")));
  if (history[0] !== ecsql) throw new Error("running a query did not record it in the history");
  await page.keyboard.press(`${mod}+k`);
  await palette.getByRole("combobox").fill("smoke pump");
  await palette.getByRole("option").filter({ hasText: "Smoke pump" }).first().waitFor({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  console.log("saved seeds: save form, persisted with file scope, run from Saved menu, history, offered in palette");

  // Note on Pump-2: badge on the node, persisted, found by Find.
  await page.evaluate((k) => globalThis.imodelExplorer.graphActions.seedExternal({ classId: k.split(":")[0], id: k.split(":")[1] }, { fit: true }), pump2Key);
  await toolIdle();
  await page.evaluate((k) => globalThis.imodelExplorer.graphActions.select({ kind: "node", key: k }), pump2Key);
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const noteBox = page.getByTestId("node-note");
  await noteBox.fill("Smoke check valve");
  await noteBox.blur();
  await page.locator(".ig-node__note-badge").first().waitFor({ timeout: 5_000 });
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem("instanceGraph.annotations")));
  if (notes[file]?.[pump2Key] !== "Smoke check valve") throw new Error(`note not persisted: ${JSON.stringify(notes)}`);
  await page.keyboard.press(`${mod}+f`);
  await page.getByRole("textbox", { name: "Find in graph" }).fill("check valve");
  await page.waitForFunction(() => document.querySelector(".ig-findbar__count")?.textContent === "1 of 1", null, { timeout: 5_000 });
  await page.keyboard.press("Escape");
  console.log("annotations: note saved from Properties, badge shown, persisted per file, matched by Find");

  // Diff: save Pump-2's neighbourhood with its note, centre elsewhere, compare, exit.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(`${mod}+s`);
  await page.getByText(/^Saved "Session /).first().waitFor({ timeout: 5_000 });
  const sessionName = await page.evaluate((f) => JSON.parse(localStorage.getItem("instanceGraph.sessions")).find((x) => x.fileName === f), file);
  if (sessionName.annotations?.[pump2Key] !== "Smoke check valve") throw new Error("the saved session did not carry the note");
  const pipeAKey = await page.evaluate(() => [...globalThis.imodelExplorer.getState().graph.nodes.values()].find((n) => n.label === "Pipe-A")?.key);
  if (!pipeAKey) throw new Error("Pipe-A should neighbour Pump-2");
  await page.evaluate((k) => globalThis.imodelExplorer.graphActions.seedExternal({ classId: k.split(":")[0], id: k.split(":")[1] }, { fit: true }), pipeAKey);
  await toolIdle();
  const beforeDiff = await state(() => globalThis.imodelExplorer.getState().graph.centreKey);
  await page.evaluate((n) => globalThis.imodelExplorer.runCommand("graph.compareSession", "ui", n), sessionName.name);
  const banner = page.getByTestId("diff-banner");
  await banner.waitFor({ timeout: 30_000 });
  const diffCounts = await state(() => globalThis.imodelExplorer.getState().diffView.diff.counts);
  if (!diffCounts.nodes.added || !diffCounts.nodes.removed || !diffCounts.nodes.same) throw new Error(`expected added, removed and shared nodes: ${JSON.stringify(diffCounts)}`);
  if (!(await page.locator(".ig-node--diff-added").count()) || !(await page.locator(".ig-node--diff-removed").count()))
    throw new Error("the comparison did not style added and removed nodes");
  await banner.getByRole("button", { name: "Exit comparison" }).click();
  await banner.waitFor({ state: "detached", timeout: 5_000 });
  if (await state(() => globalThis.imodelExplorer.getState().graph.centreKey) !== beforeDiff || await page.locator(".ig-node--diff-added").count())
    throw new Error("exiting the comparison did not restore the graph");
  console.log(`session diff: ${JSON.stringify(diffCounts)} shown with banner and styles; exit restores the graph`);

  // Links pasted into the palette: invalid ones explain why; a valid one centres; a missing file keeps the iModel open.
  await page.keyboard.press(`${mod}+k`);
  await palette.getByRole("combobox").fill(`imodel-explorer://open?file=${encodeURIComponent(file)}&centre=bogus`);
  const linkOption = palette.getByRole("option").filter({ hasText: "Open this link" }).first();
  await linkOption.waitFor({ timeout: 5_000 });
  if ((await linkOption.getAttribute("aria-disabled")) !== "true" || !(await linkOption.textContent()).includes("not an instance key"))
    throw new Error(`an invalid link was not disabled with its reason: ${await linkOption.textContent()}`);
  await palette.getByRole("combobox").fill(`imodel-explorer://open?file=${encodeURIComponent(file)}&centre=${encodeURIComponent(pump2Key)}`);
  await page.waitForFunction(() => document.querySelector("[role=option]")?.getAttribute("aria-disabled") !== "true", null, { timeout: 5_000 });
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForFunction((k) => globalThis.imodelExplorer.getState().graph.centreKey === k && globalThis.imodelExplorer.getState().status.kind === "idle", pump2Key, { timeout: 30_000 });
  await page.evaluate(() => { globalThis.smokeLinkConnection = globalThis.imodelExplorer.getState().connection; });
  await page.evaluate(() => globalThis.imodelExplorer.runCommand("link.open", "ui", "imodel-explorer://open?file=/no/such/dir/missing.bim"));
  await page.getByText(/missing\.bim does not exist/).first().waitFor({ timeout: 5_000 });
  if (await page.evaluate(() => globalThis.imodelExplorer.getState().connection !== globalThis.smokeLinkConnection)) throw new Error("a link to a missing file closed the open iModel");
  await page.evaluate(() => globalThis.imodelExplorer.runCommand("link.open", "ui"));
  await page.waitForFunction(() => document.querySelector("[role=dialog] [role=combobox]")?.value === "imodel-explorer://", null, { timeout: 5_000 });
  await page.keyboard.press("Escape");
  console.log("deep links: pasted link validated and opened in the palette; missing file reported without closing the iModel; Open link… prefills");

  // Drag and drop: real Files (from a file input) so the preload bridge can resolve their paths.
  await page.evaluate(() => { const i = document.createElement("input"); i.type = "file"; i.id = "smoke-drop"; i.hidden = true; document.body.append(i); });
  const drop = async (path) => {
    await page.setInputFiles("#smoke-drop", path);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(document.getElementById("smoke-drop").files[0]);
      document.body.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.locator(".ig-drop").waitFor({ timeout: 5_000 });
    return page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(document.getElementById("smoke-drop").files[0]);
      const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
  };
  if (!(await drop(resolve("package.json")))) throw new Error("file drop was not intercepted; the window would navigate away");
  await page.getByText(/package\.json is not an iModel/).first().waitFor({ timeout: 5_000 });
  if (await page.evaluate(() => globalThis.imodelExplorer.getState().fileName) !== file) throw new Error("an invalid drop changed the open iModel");
  await page.evaluate(() => { globalThis.smokePreviousConnection = globalThis.imodelExplorer.getState().connection; });
  await drop(file);
  await page.waitForFunction((f) => {
    const s = globalThis.imodelExplorer.getState();
    return s.connection !== undefined && s.connection !== globalThis.smokePreviousConnection && s.fileName === f && s.engine !== undefined;
  }, file, { timeout: 60_000 });
  await page.locator(".ig-drop").waitFor({ state: "detached", timeout: 10_000 });
  console.log("drag and drop: overlay, invalid file rejected with a toast, .bim drop opens it");

  // A link on the command line (how Windows/Linux deliver protocol links) reaches the renderer once it is ready.
  const linkProfile = mkdtempSync(join(tmpdir(), "ig-smoke-link-"));
  const link = `imodel-explorer://open?file=${encodeURIComponent(file)}&centre=${encodeURIComponent(pump2Key)}`;
  const linked = await electron.launch({ args: [".", `--user-data-dir=${linkProfile}`, link], env: { ...process.env, IG_DEV: "" } });
  try {
    const linkedPage = await linked.firstWindow();
    await linkedPage.waitForFunction((k) => {
      const s = globalThis.imodelExplorer?.getState();
      return s?.graph.centreKey === k && s.status.kind === "idle";
    }, pump2Key, { timeout: 60_000 });
    console.log("deep links: a link in argv opens the iModel and centres on its instance at launch");
  } finally {
    await linked.close();
    rmSync(linkProfile, { recursive: true, force: true });
  }

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
