/* eslint-disable no-console */
/** Times seed queries, depth 1-3 traversals and property loads with both strategies against an
 * iModel, read-only. Usage: npm run bench -- <file.bim> "<seed ECSQL>" ["<seed ECSQL>" ...]
 * MAX_DEPTH=2 limits the depths tried (useful on very large iModels). */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IModelHost, SnapshotDb } from "@itwin/core-backend";
import { DEFAULT_OPTIONS, GraphEngine } from "../src/frontend/engine/GraphEngine";
import { createQueryPort, type QuerySource } from "../src/frontend/engine/IModelQueryPort";
import { runSeedQuery } from "../src/frontend/engine/seedQuery";
import { loadInstanceProperties } from "../src/frontend/engine/instanceProperties";

async function main() {
  const [file, ...seeds] = process.argv.slice(2);
  await IModelHost.startup({ cacheDir: join(tmpdir(), "instancegraph-bench") });
  const db = SnapshotDb.openFile(file);
  const port = createQueryPort(db as unknown as QuerySource);
  for (const prefer of ["relations", "fallback"] as const) {
    let t = Date.now();
    const engine = await GraphEngine.create(port, prefer);
    console.log(`\n## strategy=${engine.strategy.name} (asked ${prefer}) init ${Date.now() - t}ms`);
    for (const sql of seeds) {
      t = Date.now();
      let seed;
      try { seed = await runSeedQuery(engine, sql); } catch (e: any) { console.log(`  SEED FAIL ${sql}: ${e.message}`); continue; }
      console.log(`  seed "${sql.slice(0, 70)}" -> ${seed.candidates.length} (skipped ${seed.skipped}) ${Date.now() - t}ms; first=${seed.candidates[0]?.label} ${seed.candidates[0]?.className}`);
      const c = seed.candidates[0];
      if (!c) continue;
      for (const depth of [1, 2, 3].slice(0, Number(process.env.MAX_DEPTH ?? 3))) {
        t = Date.now();
        const g = await engine.buildNeighbourhood(c.key, { ...DEFAULT_OPTIONS, depth });
        const kinds: Record<string, number> = {};
        for (const e of g.edges.values()) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        const rels = new Set([...g.edges.values()].map((e) => e.relClassName));
        const noCard = [...g.edges.values()].filter((e) => e.kind !== "aggregate" && !e.cardinality).length;
        console.log(`    depth ${depth}: ${g.nodes.size} nodes, ${g.edges.size} edges ${JSON.stringify(kinds)} rels=${rels.size} noCardinality=${noCard} truncated=${g.truncated} ${Date.now() - t}ms`);
        if (depth === 1) console.log(`      rel classes: ${[...rels].slice(0, 12).join(", ")}`);
      }
      t = Date.now();
      const props = await loadInstanceProperties(engine.port, engine.registry, c.className, c.key.id);
      console.log(`    properties: ${JSON.stringify(props).length} chars ${Date.now() - t}ms`);
    }
  }
  db.close();
  await IModelHost.shutdown();
}
main().catch((e) => { console.error(e); process.exit(1); });
