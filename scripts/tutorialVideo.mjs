// Records a short narrated demo of the water-plant iModel to docs/tutorial.mp4.
// Needs `npm run build`, samples/water-plant.bim (npm run sample:demo), macOS `say` and ffmpeg.
// Each scene's narration is rendered first, so the scene lasts as long as its voice-over; the
// clips are then placed at the recorded scene start times and muxed with the screen recording.
import { _electron as electron } from "playwright-core";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VOICE = process.env.IG_VOICE ?? "Samantha";
const SIZE = { width: 1920, height: 1080 };
const model = resolve("samples/water-plant.bim");
const output = resolve("docs/tutorial.mp4");
if (!existsSync(model)) throw new Error(`${model} not found; run npm run sample:demo`);

const script = [
  ["intro", "This is iModel Data Explorer, open on the Riverbend water treatment plant. It shows the instance graph: the real instances in an iModel, and how they relate."],
  ["seed", "Start with any E C S Q L query. Here, every pump in the plant."],
  ["graph", "Pick a result, and the graph centres on it. Solid orange edges are link-table relationships. Dashed edges are navigation properties."],
  ["edge", "Select a relationship to see its own properties, like the coupling between this motor and pump."],
  ["recentre", "Click any node to recentre on it. Back and forward retrace your steps."],
  ["hub", "Busy hubs, like this header, collapse into plus N nodes, so large fan-outs stay readable."],
  ["overview", "The Overview panel is a census of the whole iModel: schemas, classes and relationships."],
  ["classes", "Switch to Classes to see the observed schema: which classes relate, and how often."],
  ["viewport", "And everything stays in sync with the 3D view. See the tutorial for the full tour."],
];

const work = mkdtempSync(join(tmpdir(), "ig-video-"));
const probeSeconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
const clips = new Map(script.map(([id, text]) => {
  const file = join(work, `${id}.aiff`);
  execFileSync("say", ["-v", VOICE, "-o", file, text]);
  return [id, { file, seconds: probeSeconds(file) }];
}));
console.log(`narration: ${[...clips.values()].reduce((s, c) => s + c.seconds, 0).toFixed(1)}s`);

const profile = join(work, "profile");
const videoDir = join(work, "video");
const app = await electron.launch({
  args: [".", `--user-data-dir=${profile}`],
  env: { ...process.env, IG_DEV: "" },
  recordVideo: { dir: videoDir, size: SIZE },
});
const placed = [];
let t0 = 0;
let trimStart = 0;
const markers = [];
let viewport = SIZE;
let trimEnd = 0;
try {
  const page = await app.firstWindow();
  t0 = Date.now();
  await app.evaluate(({ BrowserWindow }, s) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(s.width, s.height); w.center(); }, SIZE);
  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });
  // A fresh profile still inherits legacy localStorage (migrateLocalStorage in src/backend/main.ts).
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => globalThis.imodelExplorer !== undefined, null, { timeout: 60_000 });

  const wait = (ms) => page.waitForTimeout(ms);
  const idle = () => page.waitForFunction(() => globalThis.imodelExplorer.getState().status.kind === "idle", null, { timeout: 60_000 });
  const widget = (id) => page.locator(`[id="content-container:${id}"]`);
  // Recordings have no pointer, so draw one that follows the (real) mouse events.
  const addCursor = () => page.evaluate(() => {
    const c = document.createElement("div");
    Object.assign(c.style, {
      position: "fixed", left: "-40px", top: "-40px", width: "20px", height: "20px", borderRadius: "50%", pointerEvents: "none",
      zIndex: "2147483647", background: "rgba(255,255,255,0.85)", border: "2px solid #4fa3ff", transform: "translate(-50%,-50%)",
      boxShadow: "0 0 8px rgba(0,0,0,0.6)", transition: "transform 80ms",
    });
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener("mousedown", () => { c.style.transform = "translate(-50%,-50%) scale(0.7)"; }, true);
    addEventListener("mouseup", () => { c.style.transform = "translate(-50%,-50%)"; }, true);
  });
  const click = async (locator) => {
    await locator.waitFor({ timeout: 30_000 });
    const b = await locator.boundingBox();
    if (!b) throw new Error(`not visible: ${locator}`);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await wait(200);
    // Re-aim in case the target moved while the pointer travelled (lists and graphs re-layout).
    const f = await locator.boundingBox();
    await page.mouse.click(f.x + f.width / 2, f.y + f.height / 2);
  };
  const type = async (text) => {
    const sql = page.locator("textarea.ig-sql").first();
    await click(sql);
    await sql.fill("");
    await sql.pressSequentially(text, { delay: 22 });
  };
  const node = async (label) => {
    const key = await page.evaluate((l) => [...globalThis.imodelExplorer.getState().graph.nodes.values()].find((n) => n.label === l)?.key, label);
    if (!key) {
      await page.screenshot({ path: join(tmpdir(), "ig-video-error.png") });
      throw new Error(`${label} is not in the graph`);
    }
    return page.locator(`.react-flow__node[data-id="${key}"]`);
  };
  // Drag the graph/3D splitter: wide gives the graph all but the 3D view's minimum width.
  const wideGraph = async (on) => {
    const r = await page.locator(".SplitPane .Resizer").first().boundingBox();
    const split = await page.locator(".SplitPane").first().boundingBox();
    const y = split.y + split.height * 0.6;
    await page.mouse.move(r.x + 0.5, y, { steps: on ? 1 : 20 });
    await page.mouse.down();
    await page.mouse.move(on ? split.x + split.width : split.x + split.width * 0.45, y, { steps: 20 });
    await page.mouse.up();
    await wait(400);
  };
  // Wheel-zoom towards a node until labels render (nodes go compact below zoom 0.45).
  const zoomTo = async (locator, target = 0.7) => {
    const b = await locator.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
    for (let i = 0; i < 20; i++) {
      const zoom = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".ig-canvas .react-flow__viewport")).transform).a);
      if (zoom >= target) break;
      await page.mouse.wheel(0, -60);
      await wait(60);
    }
  };
  // Sync marker: the recording neither starts at t0 nor runs at wall-clock speed, so flash black
  // frames before and after the scenes and map wall time onto video time between them.
  const flash = async () => {
    await page.evaluate(() => {
      const m = document.createElement("div");
      m.id = "ig-sync";
      Object.assign(m.style, { position: "fixed", inset: "0", background: "#000", zIndex: "2147483647" });
      document.body.appendChild(m);
    });
    await wait(700);
    await page.evaluate(() => document.getElementById("ig-sync").remove());
    return (Date.now() - t0) / 1000;
  };
  const scene = async (id, action) => {
    const { file, seconds } = clips.get(id);
    const start = Date.now();
    placed.push({ file, at: (start - t0) / 1000 });
    await action();
    const left = seconds * 1000 + 700 - (Date.now() - start);
    if (left > 0) await wait(left);
  };

  // Pre-roll (trimmed): dark theme, open the model, widen the graph pane.
  await page.getByRole("button", { name: "App settings" }).click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.getByRole("combobox").click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await dlg.locator("button", { hasText: /^Close$/ }).click();
  await page.evaluate((f) => globalThis.imodelExplorer.openAndShow(f), model);
  await page.waitForFunction(() => globalThis.imodelExplorer.getState().engine !== undefined, null, { timeout: 60_000 });
  await page.addStyleTag({ content: ".nz-app-button { display: none !important; }" });
  await page.evaluate(() => globalThis.imodelExplorer.graphActions.setOptions({ direction: "both", groupCap: 8 }, false));
  await wideGraph(true);
  await page.getByRole("tab", { name: "Seed query", exact: true }).click();
  await addCursor();
  await page.mouse.move(SIZE.width / 2, SIZE.height / 2);
  await wait(3000);
  markers.push(await flash());
  viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await wait(1000);
  trimStart = (Date.now() - t0) / 1000;

  await scene("intro", () => wait(500));
  await scene("seed", async () => {
    await type("SELECT ECInstanceId, ECClassId FROM WaterPlant.Pump");
    await click(page.getByRole("button", { name: /^Run/ }).first());
    await page.locator(".ig-list__item").nth(4).waitFor({ timeout: 30_000 });
  });
  await scene("graph", async () => {
    await click(page.locator(".ig-list__item", { hasText: "P-101A" }).first());
    await idle();
    await wait(800);
    await zoomTo(await node("P-101A"));
  });
  await scene("edge", async () => {
    await page.getByRole("tab", { name: "Properties", exact: true }).click();
    await click(page.locator(".ig-edge-label", { hasText: "MotorDrivesPump" }).first());
  });
  await scene("recentre", async () => {
    await click(await node("M-101A"));
    await idle();
    await wait(800);
    await zoomTo(await node("M-101A"), 0.6);
    await wait(800);
    await click(page.getByRole("button", { name: "Back (Alt+←)" }));
    await idle();
    await wait(600);
    await zoomTo(await node("P-101A"), 0.6);
  });
  await scene("hub", async () => {
    await page.getByRole("tab", { name: "Seed query", exact: true }).click();
    await type("SELECT ECInstanceId, ECClassId FROM WaterPlant.Header");
    await click(page.getByRole("button", { name: /^Run/ }).first());
    await click(page.locator(".ig-list__item", { hasText: "H-601" }).first());
    await idle();
    await wait(800);
    await zoomTo(page.locator(".react-flow__node", { has: page.locator(".ig-node__agg-count") }).first(), 0.55);
  });
  await scene("overview", async () => {
    await click(page.getByRole("tab", { name: "Overview", exact: true }));
    await widget("ig-overview").getByText("Relationships", { exact: true }).waitFor({ timeout: 30_000 });
    await click(widget("ig-overview").getByText("Relationships", { exact: true }));
  });
  await scene("classes", async () => {
    await click(page.locator(".ig-toolbar").getByRole("button", { name: "Classes", exact: true }));
    await page.locator(".ig-classnode").first().waitFor({ timeout: 30_000 });
  });
  await scene("viewport", async () => {
    await click(page.locator(".ig-toolbar").getByRole("button", { name: "Instances", exact: true }));
    await click(page.getByRole("button", { name: "Back (Alt+←)" }));
    await idle();
    await click(page.getByRole("button", { name: "Fit to view (F)" }));
    await wideGraph(false);
    await page.getByRole("tab", { name: "Properties", exact: true }).click();
    const pump = await node("P-101A");
    const b = await pump.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.evaluate((key) => globalThis.imodelExplorer.graphActions.select({ kind: "node", key }), await pump.getAttribute("data-id"));
    await click(widget("ig-properties").getByRole("button", { name: "Show in 3D" }));
    await wait(1500);
  });
  await wait(1500);
  trimEnd = (Date.now() - t0) / 1000;
  markers.push(await flash());
  await wait(1000);
} catch (e) {
  rmSync(work, { recursive: true, force: true });
  throw e;
} finally {
  // Closing the app finalises the recording.
  await app.close();
}

try {
  const [webm] = readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  const detect = spawnSync("ffmpeg", ["-v", "info", "-i", join(videoDir, webm), "-vf", "blackdetect=d=0.3:pic_th=0.9", "-an", "-f", "null", "-"], { encoding: "utf8" });
  const ends = [...detect.stderr.matchAll(/black_end:([\d.]+)/g)].map((m) => Number(m[1]));
  if (ends.length === 0) throw new Error("sync marker not found in the recording");
  if (ends.length < 2) throw new Error(`expected 2 sync markers, found ${ends.length}`);
  const [v0, v1] = ends.slice(-2);
  const rate = (v1 - v0) / (markers[1] - markers[0]); // video seconds per wall second
  const toVideo = (w) => v0 + (w - markers[0]) * rate;
  console.log(`recording rate ${rate.toFixed(3)}`);
  const inputs = placed.flatMap((p) => ["-i", p.file]);
  const delays = placed.map((p, i) => {
    const ms = Math.max(0, Math.round((p.at - trimStart) * 1000));
    return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
  });
  const video = `[0:v]trim=start=${toVideo(trimStart).toFixed(3)}:end=${toVideo(trimEnd).toFixed(3)},setpts=(PTS-STARTPTS)/${rate.toFixed(5)},`
    + `crop=${viewport.width}:${viewport.height}:0:0,scale=${viewport.width}:-2[vout]`;
  const filter = `${video};${delays.join(";")};${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0[aout]`;
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", join(videoDir, webm), ...inputs,
    "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", "-r", "25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "slow",     "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output,
  ], { stdio: "inherit" });
  console.log(`${output} (${probeSeconds(output).toFixed(1)}s)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
