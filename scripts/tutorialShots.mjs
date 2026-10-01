// Captures the widget-level screenshots used by docs/tutorial.md from samples/water-plant.bim.
// Run `npm run build` first. Uses a throwaway Electron profile so your layout, sessions and
// recent files are untouched. Output: docs/tutorial/*.png
import { _electron as electron } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const model = resolve("samples/water-plant.bim");
if (!existsSync(model)) throw new Error(`${model} not found; run npm run sample:demo`);
const outDir = resolve("docs/tutorial");
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "ig-tutorial-"));
const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env: { ...process.env, IG_DEV: "" } });

try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1600, 1000); w.center(); });
  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });
  // A fresh profile still inherits the legacy InstanceGraph localStorage (see migrateLocalStorage in
  // src/backend/main.ts), which would leak recent files and saved layouts into the shots.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });

  const shot = async (locator, name) => {
    await locator.screenshot({ path: join(outDir, `${name}.png`), animations: "disabled" });
    console.log(`  ${name}.png`);
  };
  const widget = (id) => page.locator(`[id="content-container:${id}"]`);
  const tab = (name) => page.getByRole("tab", { name, exact: true }).click();
  const idle = () => page.waitForFunction(() => globalThis.imodelExplorer.getState().status.kind === "idle", null, { timeout: 60_000 });
  const settle = async () => { await idle(); await page.waitForTimeout(1200); };
  // Graph shots: give the graph the whole centre area instead of sharing it with the 3D view,
  // and hide the viewport's floating tools (nav cube, view toolbars) that would then cover it.
  const wideGraph = async (on) => {
    await page.evaluate((w) => {
      const pane = document.querySelector(".ig-canvas").closest(".Pane1");
      pane.style.width = w ? `${pane.parentElement.clientWidth}px` : "";
      for (const el of document.querySelectorAll(".uifw-widgetPanels-toolbars"))
        el.style.visibility = w ? "hidden" : "";
    }, on);
    await page.waitForTimeout(300);
    await page.evaluate(() => globalThis.imodelExplorer.graphActions.requestFit());
    await page.waitForTimeout(1200);
  };
  // Crop a graph shot to the rendered nodes and edge labels rather than the whole (mostly empty) pane.
  const graphShot = async (name) => {
    const box = await page.evaluate(() => {
      const pane = document.querySelector(".ig-canvas").getBoundingClientRect();
      const rects = [...document.querySelectorAll(".ig-canvas .react-flow__node, .ig-canvas .ig-edge-label")].map((e) => e.getBoundingClientRect());
      const pad = 24;
      const x0 = Math.max(pane.left, Math.min(...rects.map((r) => r.left)) - pad);
      const y0 = Math.max(pane.top, Math.min(...rects.map((r) => r.top)) - pad);
      const x1 = Math.min(pane.right, Math.max(...rects.map((r) => r.right)) + pad);
      const y1 = Math.min(pane.bottom, Math.max(...rects.map((r) => r.bottom)) + pad);
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    });
    const minimap = page.locator(".ig-canvas .react-flow__minimap");
    await minimap.evaluate((el) => { el.style.visibility = "hidden"; });
    await page.screenshot({ path: join(outDir, `${name}.png`), clip: box, animations: "disabled" });
    await minimap.evaluate((el) => { el.style.visibility = ""; });
    console.log(`  ${name}.png`);
  };
  const nodeKey = (label) => page.evaluate((l) => {
    const n = [...globalThis.imodelExplorer.getState().graph.nodes.values()].find((x) => x.label === l);
    if (!n) throw new Error(`${l} is not in the graph`);
    return n.key;
  }, label);
  const node = async (label) => page.locator(`.react-flow__node[data-id="${await nodeKey(label)}"]`);
  const seedLabel = async (label) => {
    await page.evaluate(async (l) => {
      const x = globalThis.imodelExplorer;
      const conn = x.IModelApp.viewManager.selectedView.iModel;
      for await (const row of conn.createQueryReader(`SELECT ECInstanceId id, ECClassId cls FROM BisCore.Element WHERE UserLabel = '${l}'`)) {
        await x.graphActions.seedExternal({ classId: row[1], id: row[0] }, { fit: true });
        return;
      }
      throw new Error(`no element labelled ${l}`);
    }, label);
    await settle();
  };

  // 1. Welcome page + dark theme via App settings.
  await page.getByRole("button", { name: "App settings" }).click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.getByRole("combobox").click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await page.waitForTimeout(500);
  await shot(dlg, "01-settings");
  await dlg.locator("button", { hasText: /^Close$/ }).click();
  await shot(page.locator(".ig-welcome__panel"), "02-welcome");

  // 2. Open the plant and seed P-101A from the Seed query widget.
  await page.evaluate((f) => globalThis.imodelExplorer.openAndShow(f), model);
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().engine !== undefined, null, { timeout: 60_000 });
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ direction: "both" }, false));
  await tab("Seed query");
  await page.locator("textarea.ig-sql").first().fill("SELECT ECInstanceId, ECClassId FROM WaterPlant.Pump");
  await page.getByRole("button", { name: /^Run/ }).first().click();
  await page.locator(".ig-list__item").nth(4).waitFor({ timeout: 30_000 });
  await shot(widget("ig-seed"), "03-seed-query");
  await page.locator(".ig-list__item", { hasText: "P-101A" }).first().click();
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().graph.nodes.size > 1, null, { timeout: 60_000 });
  await settle();
  await shot(page.locator(".ig-toolbar").first(), "04-toolbar");
  await wideGraph(true);
  await graphShot("05-graph-p101a");

  // 3. Node close-up and the Properties card.
  await shot(await node("P-101A"), "06-node");
  await tab("Properties");
  await shot(widget("ig-properties"), "07-properties");

  // 4. Link-table relationship edge selected: Properties shows the relationship instance.
  await page.locator(".ig-edge-label", { hasText: "MotorDrivesPump" }).first().click({ force: true }).catch(async () => {
    await page.locator(".ig-edge-label").first().click({ force: true });
  });
  await page.waitForTimeout(800);
  await shot(widget("ig-properties"), "08-edge-properties");

  // 5. Layered layout, outgoing only: what P-101A points at.
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ direction: "forward" }));
  await settle();
  await page.getByRole("button", { name: "Layered layout" }).click();
  await page.waitForTimeout(1500);
  await graphShot("09-layered-outgoing");
  await page.getByRole("button", { name: "Radial layout" }).click();
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ direction: "both" }));
  await settle();

  // 6. Hub with 30 laterals: with a group cap of 8 the rest collapse into a +N aggregate node.
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ groupCap: 8 }, false));
  await seedLabel("H-601");
  await graphShot("10-hub-aggregate");
  await shot(page.locator(".react-flow__node", { has: page.locator(".ig-node__agg-count") }).first(), "11-aggregate-node");
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ groupCap: 25 }, false));

  // 7. Pins: pin P-101A, then move to its motor – the pump stays in view.
  await seedLabel("P-101A");
  await page.evaluate((k) => globalThis.imodelExplorer.graphActions.togglePin(k), await nodeKey("P-101A"));
  await page.waitForTimeout(500);
  await page.evaluate(async (k) => {
    const [classId, id] = k.split(":");
    await globalThis.imodelExplorer.graphActions.centreOn({ classId, id });
  }, await nodeKey("M-101A"));
  await settle();
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.requestFit());
  await page.waitForTimeout(1000);
  await page.locator(".ig-toolbar__pins").click();
  await page.waitForTimeout(400);
  await shot(page.locator('[role="menu"]').first(), "12-pins-menu");
  await page.keyboard.press("Escape");
  await graphShot("13-pinned-graph");
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.unpinAll());

  // 8. Traversal & filters: exclude BisCore and the Equipment Library model.
  await seedLabel("P-101A");
  await tab("Traversal & filters");
  const filters = widget("ig-filters");
  await filters.getByText("Schemas", { exact: true }).click();
  // The tri-state button cycles neutral → include → exclude.
  await filters.locator('button.ig-tri[title^="BisCore neutral"]').click();
  await settle();
  await filters.locator('button.ig-tri[title^="BisCore include"]').click();
  await settle();
  await shot(filters, "14-filters");
  await graphShot("15-graph-filtered");
  await filters.getByRole("button", { name: "Clear all" }).click();
  await settle();

  // 9. Schema widget via the class link on P-101A.
  await tab("Properties");
  await page.locator(".ig-card__sub .ig-link", { hasText: "Pump" }).first().click();
  await page.getByPlaceholder("Search any class…").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await shot(widget("ig-schema"), "16-schema");

  // 10. Geometry stream of P-101A.
  await tab("Geometry");
  const geom = widget("ig-geometry");
  await geom.locator(".ig-geom-op__label").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(geom, "17-geometry");

  // 11. Overview: class census, relationships and the treemap.
  await tab("Overview");
  const overview = widget("ig-overview");
  await overview.getByText("Schemas", { exact: true }).waitFor({ timeout: 30_000 });
  await overview.locator(".ig-census-row", { hasText: "WaterPlant" }).first().locator(".ig-tree-row__twist").click();
  await page.waitForTimeout(600);
  await shot(overview, "18-overview-classes");
  await overview.getByText("Schemas", { exact: true }).click();
  await overview.getByText("Relationships", { exact: true }).click();
  await overview.locator(".ig-census-row", { hasText: "ProcessFeeds" }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(overview, "19-overview-relationships");
  await overview.getByText("Relationships", { exact: true }).click();
  await overview.getByText("Treemap", { exact: true }).click();
  await page.waitForTimeout(800);
  await shot(overview, "20-overview-treemap");

  // 12. Rank by connections.
  await tab("Seed query");
  await page.locator("textarea.ig-sql").first().fill("SELECT ECInstanceId, ECClassId FROM WaterPlant.Equipment");
  await page.getByRole("button", { name: /^Run/ }).first().click();
  await page.locator(".ig-list__item").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Rank by connections" }).click();
  await page.locator(".ig-list__secondary", { hasText: "rel" }).first().waitFor({ timeout: 60_000 });
  await shot(widget("ig-seed"), "21-ranked");

  // 13. Class graph: neighbourhood, then whole iModel.
  await page.locator(".ig-toolbar").getByRole("button", { name: "Classes", exact: true }).click();
  await page.locator(".ig-classnode").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await graphShot("22-class-graph");
  await page.evaluate(() => globalThis.imodelExplorer.classGraphActions.setScope("imodel"));
  await page.waitForFunction(() => { const s = globalThis.imodelExplorer.getClassState(); return !s.building && s.imodelGraph?.nodes.size > 0; }, null, { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await graphShot("23-class-graph-imodel");
  await page.evaluate(() => { const c = globalThis.imodelExplorer.classGraphActions; c.setScope("neighbourhood"); c.setMode("instances"); });
  await page.locator(".ig-node").first().waitFor({ timeout: 30_000 });

  // 14. Legend & colours with a custom rule for work orders.
  const legend = widget("ig-legend");
  await legend.getByPlaceholder("Schema:Class").fill("WaterPlant:WorkOrder");
  await legend.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(600);
  await legend.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await shot(legend, "24-legend");

  // 15. Sessions.
  await tab("Sessions");
  const sessions = widget("ig-sessions");
  await sessions.getByPlaceholder("Session name").fill("P-101A seal job");
  await sessions.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(600);
  await shot(sessions, "25-sessions");

  // 16. Export menu.
  await page.locator(".ig-toolbar").getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForTimeout(400);
  await shot(page.locator('[role="menu"]').first(), "26-export-menu");
  await page.keyboard.press("Escape");

  // 17. Models & categories tree.
  await tab("Models & categories");
  await page.waitForTimeout(3000);
  await shot(widget("ig-visibility"), "27-visibility");

  // 18. 3D viewport with the selection synced.
  await wideGraph(false);
  await page.evaluate((key) => globalThis.imodelExplorer.graphActions.select({ kind: "node", key }), await nodeKey("P-101A"));
  await tab("Properties");
  await widget("ig-properties").getByRole("button", { name: "Show in 3D" }).click();
  await page.waitForTimeout(3000);
  await shot(page.locator(".SplitPane .Pane2").first(), "28-viewport");
} finally {
  await app.close();
  rmSync(profile, { recursive: true, force: true });
}
