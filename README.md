<p align="center">
  <img src="docs/banner.png" alt="iModel Data Explorer" width="100%">
</p>

# iModel Data Explorer

A developer tool for exploring the **instance graph** of an iModel: the actual EC instances and the
relationships between them, rather than the schema. Open a `.bim` file, pick a starting instance
with any ECSQL query, and see what it is connected to, as many hops out as you like.

Built on iTwin.js 5.x (Electron, AppUI, iTwinUI, ECPresentation), React Flow and elkjs.

## Features

- **ECSQL seed.** Any query that returns an `ECInstanceId` picks the instance at the centre.
- **Centred graph.** The seed sits in the middle with one ring per hop. Click a node to recentre
  on it, and use back and forward to retrace your steps. You can set the depth (1–6) and the
  direction.
- **Both kinds of relationship.** Link-table relationships are drawn as solid orange edges, and
  selecting one shows the relationship instance's own properties. Navigation properties are
  dashed edges. Both are found with `ECVLib.Relations()`, falling back to schema metadata on
  runtimes that lack it.
- **Cardinality** from the `ECRelationshipClass` constraints, shown at each end of an edge.
- **Properties and Schema panels.** The Properties panel shows a node's readable properties. The
  Schema panel shows its class definition: hierarchy, mixins, property types and derived classes.
- **Geometry panel.** The selected element's geometry stream, op by op: a graphical stack of the
  stream (with a rail showing which appearance governs which primitives), formatted facts per
  primitive, inline `GeometryPart` drill-down, placement / category / view / iModel-frame facts,
  a 3D range-and-axes decorator, and JSON export.
- **Overview.** A census of the iModel: instances per schema, class, relationship and model, with
  how much of each schema the authoring app actually used, a treemap of where the data lives, and
  CSV/Markdown export. Click a class to list its instances, or filter the traversal straight from
  a row.
- **Class graph.** Switch the pane from Instances to Classes for the "observed schema": one node
  per class, one edge per relationship class with instance counts — either collapsed from the
  current neighbourhood or built for the whole iModel. Double-click a class to jump back to its
  instances.
- **Include or exclude filters** by model (as a hierarchy), schema, class or relationship.
- **Exemplar ranking.** Sort seed-query results by relationship fan-out to find the
  best-connected instances to start from.
- **Colouring** by element kind (geometric, definition, information, …), with custom rules.
- **Pinned nodes** stay in view as you click through the graph.
- **Hub safety.** Large fan-outs collapse to `+N` summary nodes that you can open on demand.
- **3D view** with two-way selection sync, plus model, category and classification visibility
  trees.
- **Sessions and export.** Save and restore sessions. Export JSON, GraphML, a CmapTools concept
  map (CXL) or PNG, or copy an ECSQL recipe that reproduces the traversal.

## Quick start

Requires Node.js 22.

```bash
npm install
npm run sample     # writes samples/pump-network.bim
npm start          # build and launch
```

Open a `.bim` from the welcome page, run a seed query such as
`SELECT ECInstanceId, ECClassId FROM TestIG.Pump`, and click a result.

## Scripts

| Command | Purpose |
|---|---|
| `npm start` / `npm run dev` | Build and launch, or run with hot reload |
| `npm test` | Unit and engine tests (Vitest) |
| `npm run typecheck` / `npm run lint` | Type-check and lint |
| `npm run smoke [file.bim]` | End-to-end run of the built app |
| `npm run bench -- file.bim "<ecsql>"` | Time queries and traversals |

## Project layout

```
src/backend/     Electron host (opens files, serves tiles)
src/frontend/
  engine/        UI-free traversal engine (ECSQL, relationship metadata)
  state/         zustand store, history, theme
  graph/         React Flow canvas, layouts
  widgets/       AppUI panels
```
