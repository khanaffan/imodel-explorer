// Captures the README screenshots by driving the built app like a user would.
// Usage: npm run screenshots -- <OpenSitePlus-Example-1.6-Drainage.bim> [outDir]
// The images in docs/images were taken from the OpenSite+ "Example 1.6 - Drainage" iModel.
import { _electron as electron } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run screenshots -- <file.bim> [outDir]");
  process.exit(1);
}
const outDir = resolve(process.argv[3] ?? "docs/images");
mkdirSync(outDir, { recursive: true });

const SEED = "SELECT ECInstanceId, ECClassId, CodeValue, UserLabel, ec_classname(ECClassId) Class FROM CivilSpatial.ParkingArea";
const NO_FILTERS = { models: {}, schemas: {}, classes: {}, relationships: {} };

const app = await electron.launch({ args: ["."], env: { ...process.env, IG_DEV: "" } });
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const api = (fn, arg) => page.evaluate(fn, arg);
  const idle = () => page.waitForFunction(() => globalThis.imodelExplorer.getState().status.kind === "idle", null, { timeout: 60_000 });
  const settle = async (ms = 1500) => { await idle(); await page.waitForTimeout(ms); };
  page.on("pageerror", (e) => console.error(e));
  const shot = async (name, clip) => {
    await page.screenshot({ path: `${outDir}/${name}.png`, clip, scale: "css" });
    console.log(`wrote ${name}.png`);
  };
  const rectOf = (selector) => page.locator(selector).first().evaluate((e) => e.getBoundingClientRect().toJSON());
  // The left dock is everything left of the graph canvas.
  const leftDock = async () => { const c = await rectOf(".ig-canvas"); return { x: 0, y: 0, width: c.x, height: c.y + c.height }; };

  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });
  await api((f) => globalThis.imodelExplorer.openAndShow(f), file);
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().engine !== undefined, null, { timeout: 60_000 });
  await api((f) => globalThis.imodelExplorer.graphActions.setOptions({ depth: 1, direction: "both", groupCap: 6, filters: f }, false), NO_FILTERS);
  await api(() => globalThis.imodelExplorer.graphActions.setLayoutMode("radial"));

  // 1. Overview: seed from ECSQL, centre on the parking area, zoom the 3D view to it.
  await page.getByText("Seed query", { exact: true }).first().click();
  const editor = page.locator("textarea.ig-sql, .ig-sql textarea").first();
  await editor.fill(SEED);
  await page.getByRole("button", { name: /^Run/ }).first().click();
  await page.locator(".ig-widget:has(.ig-sql) .ig-list__item").first().click();
  await settle();
  await api(() => { const g = globalThis.imodelExplorer; g.graphActions.select({ kind: "node", key: g.getState().graph.centreKey }); });
  await page.waitForTimeout(2500);
  await shot("overview");

  // 2. The graph on its own, cropped to the nodes (the centre stays selected so its edge labels show).
  await shot("graph", await page.evaluate(() => {
    const c = document.querySelector(".ig-canvas").getBoundingClientRect();
    const rs = [...document.querySelectorAll(".react-flow__node")].map((n) => n.getBoundingClientRect());
    const pad = 24;
    const x = Math.max(c.x, Math.min(...rs.map((r) => r.left)) - pad), y = Math.max(c.y, Math.min(...rs.map((r) => r.top)) - pad);
    const r = Math.min(c.right, Math.max(...rs.map((r) => r.right)) + pad), b = Math.min(c.bottom, Math.max(...rs.map((r) => r.bottom)) + pad);
    return { x, y, width: r - x, height: b - y };
  }));

  // 3. A link-table relationship selected: constraints, multiplicity and its own properties.
  const edgeKey = await api(() => [...globalThis.imodelExplorer.getState().graph.edges.values()].find((e) => e.kind === "linkTable")?.key);
  if (edgeKey) {
    await api((key) => globalThis.imodelExplorer.graphActions.select({ kind: "edge", key }), edgeKey);
    await page.waitForTimeout(1500);
    const c = await rectOf(".ig-canvas");
    const vw = await page.evaluate(() => innerWidth);
    await shot("link-table-edge", { x: c.x, y: 0, width: vw - c.x, height: c.y + c.height });
    await api(() => globalThis.imodelExplorer.graphActions.select(undefined));
  }

  // 4. Traversal & filters with the model hierarchy: exclude a model that has sub-models.
  const parent = await api(() => {
    const models = globalThis.imodelExplorer.getState().models;
    const counts = new Map();
    for (const m of models) if (m.parentId) counts.set(m.parentId, (counts.get(m.parentId) ?? 0) + 1);
    const byId = new Map(models.map((m) => [m.id, m]));
    // A model with sub-models whose own parent is a root, so its row is visible without expanding anything.
    return [...counts.entries()].filter(([id]) => id !== "0x1" && byId.get(id) && !byId.get(byId.get(id).parentId)?.parentId)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
  });
  await page.getByText("Traversal &", { exact: false }).first().click();
  const modelsHeader = page.locator(".ig-widget [aria-expanded]", { hasText: /^Models/ }).first();
  if (await modelsHeader.getAttribute("aria-expanded") !== "true") await modelsHeader.click();
  if (parent) {
    await api(([id, f]) => globalThis.imodelExplorer.graphActions.setOptions({ filters: { ...f, models: { [id]: "exclude" } } }, false), [parent, NO_FILTERS]);
    const name = await api((id) => globalThis.imodelExplorer.getState().models.find((m) => m.id === id)?.name, parent);
    const row = page.locator(".ig-tree-row", { hasText: name }).first();
    if (await row.count()) {
      const twist = row.locator("button[aria-label=Expand]");
      if (await twist.count()) await twist.click();
      await row.evaluate((e) => e.scrollIntoView({ block: "center" }));
    }
  }
  await page.waitForTimeout(500);
  const dock = await leftDock();
  const tabTop = (await page.getByText("Traversal &", { exact: false }).first().boundingBox()).y - 12;
  await shot("filters", { ...dock, y: tabTop, height: dock.height - tabTop });
  await api((f) => globalThis.imodelExplorer.graphActions.setOptions({ filters: f }, false), NO_FILTERS);

  // 5. ECPresentation visibility trees: hide the terrain by classification.
  await page.getByText("Models & c", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  const picker = page.locator(".ig-visibility-trees select").first();
  if ((await picker.locator("option", { hasText: "Classifications" }).count()) > 0) {
    await picker.selectOption({ label: "Classifications" });
    await page.waitForTimeout(3000);
    const terrain = page.locator(".ig-visibility-trees [role=treeitem]", { hasText: "Terrain" }).first();
    if (await terrain.count()) {
      await terrain.hover();
      await terrain.getByRole("button", { name: "Hide" }).click();
      await page.waitForTimeout(3000);
    }
  }
  await shot("visibility-trees");
} catch (e) {
  await (await app.firstWindow()).screenshot({ path: `${outDir}/_failure.png` }).catch(() => {});
  throw e;
} finally {
  await app.close();
}
