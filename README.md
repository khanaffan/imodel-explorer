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
- **Properties and Schema panels.** Elements use the ECPresentation property grid with categorized,
  formatted properties, including schema-hidden fields and unique/multi-aspect properties.
  Other EC instances and relationships show raw database properties. The
  Schema panel shows its class definition: hierarchy, mixins, property types and derived classes.
  Instance references in properties, model headers and geometry details are clickable to centre the
  graph on the referenced instance.
- **Geometry panel.** The selected element's geometry stream, op by op: formatted facts per
  primitive, searchable/type-filtered op lists with per-op raw JSON and Copy,
  inline `GeometryPart` drill-down, placement / category / view / iModel-frame facts,
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
- **Graph click-tools.** Choose a tool, then click a node or relationship to include/exclude its
  exact class/type or containing model. Exclude this instance removes just that node and paths
  through it. Tools stay active until Escape or Navigate; instance exclusions are saved in sessions.
- **Command palette** (Cmd/Ctrl+K). Run any command, open a recent file or saved session, or search
  instances by UserLabel, CodeValue or exact ID: Enter centres the instance, Shift+Enter finds a
  path to it from the current centre.
- **Native menu.** File, Edit, View and Graph menus run the same commands as the palette and
  keyboard shortcuts; the palette explains why an unavailable command is disabled.
- **Find in graph** (Cmd/Ctrl+F). Highlights displayed nodes matching a label, class or ID and dims
  the rest; Enter / Shift+Enter step through matches.
- **Path finder.** Shortest path from the centre to another instance (Find-path tool, palette or
  Graph menu), up to 6 hops, honouring direction, filters and instance exclusions. Searches are
  cancellable and recorded in history.
- **Breadcrumbs** above the graph jump straight to any earlier stop in the navigation history.
- **Filter undo/redo** (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, or the Filters panel) for filter and
  instance-exclusion changes. In text fields the shortcuts keep their usual text-editing meaning.
- **Drag and drop** a `.bim`, `.ibim` or `.imodel` file anywhere on the window to open it.
- **Status bar** with the iModel name, instance and relationship counts (and whether the node
  budget was reached), the number of active filters (click to open them) and the last load time.
- **Keyboard shortcut sheet** (`?` or Help → Keyboard shortcuts), generated from the same command
  list and searchable.
- **Feedback.** Toasts confirm saves, exports and imports and report failures. Loading panels show
  placeholders, the graph shows a progress bar while it loads, and animations are turned off
  when the OS asks for reduced motion.
- **Exemplar ranking.** Sort seed-query results by relationship fan-out to find the
  best-connected instances to start from.
- **Colouring** by element kind (geometric, definition, information, …), with custom rules.
- **Pinned nodes** stay in view as you click through the graph.
- **Hub safety.** Large fan-outs collapse to `+N` summary nodes that you can open on demand.
- **3D view** with two-way selection sync, plus model, category and classification visibility
  trees.
- **Sessions and export.** Save and restore sessions. Export JSON, GraphML, a CmapTools concept
  map (CXL) or PNG, or copy an ECSQL recipe that reproduces the traversal.
- **App settings** (gear icon). Pick a colour theme (system, light, dark or high contrast) and
  switch off optional features — Overview census, class graph, Schema or Geometry panels,
  visibility trees and more — to skip their queries and keep the app fast when you only need the
  core data-model view. Choices persist across iModels; children of a disabled feature keep their
  saved state.

### Keyboard shortcuts

Shortcuts never fire while typing in a field, except Cmd/Ctrl+K, Cmd/Ctrl+F and Escape.

| Shortcut | Command |
|---|---|
| ? | Keyboard shortcut sheet |
| Cmd/Ctrl+K | Command palette |
| Cmd/Ctrl+F | Find in graph |
| Cmd/Ctrl+O | Open iModel |
| Cmd/Ctrl+S | Save session |
| Cmd/Ctrl+, | App settings |
| Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z | Undo / redo filters |
| Alt+← / Alt+→ | Back / forward |
| F | Fit graph to view |
| P | Pin or unpin the selected node |
| Escape | Cancel a path search, close Find, then return to Navigate |

## Quick start

Requires Node.js 22.

```bash
npm install
npm run sample       # writes samples/pump-network.bim (small test fixture)
npm run sample:demo  # writes samples/water-plant.bim (demo plant)
npm start            # build and launch
```

See the [tutorial](docs/tutorial.md) for a guided tour of every feature using the demo model, or
watch the [one-minute demo video](docs/tutorial.mp4).

Open a `.bim` from the welcome page, run a seed query such as
`SELECT ECInstanceId, ECClassId FROM TestIG.Pump`, and click a result.

### Demo model

`samples/water-plant.bim` is a small water-treatment works built from scratch by
`test/demoModel.ts`: fenced site with road, trees and a control building, raw-water tank,
clarifiers, filters, clearwell, pumps with motors, valves, instruments and colour-coded piping. Its
`WaterPlant` schema uses mixins, enums, structs, type definitions, unique and multi aspects,
navigation and link-table relationships. The model also contains process areas, trains
(groups), work orders and a P&ID drawing linked to the 3D elements. Good seeds:

- `SELECT ECInstanceId, ECClassId FROM WaterPlant.Pump WHERE UserLabel = 'P-101A'`: motor,
  valves, pipes, work orders, train and P&ID symbol.
- `SELECT ECInstanceId, ECClassId FROM WaterPlant.Header WHERE UserLabel = 'H-601'`: a hub with
  30 laterals, which collapse into a group node.
- `SELECT ECInstanceId, ECClassId FROM WaterPlant.WorkOrder`: maintenance backlog and its assets.

## Scripts

| Command | Purpose |
|---|---|
| `npm start` / `npm run dev` | Build and launch, or run with hot reload |
| `npm test` | Unit and engine tests (Vitest) |
| `npm run typecheck` / `npm run lint` | Type-check and lint |
| `npm run smoke [file.bim]` | End-to-end run of the built app |
| `npm run bench -- file.bim "<ecsql>"` | Time queries and traversals |
| `npm run docs:shots` | Regenerate the tutorial screenshots (needs a build and the demo model) |
| `npm run docs:video` | Record the narrated demo video (needs `ffmpeg` and `npm run docs:tts-setup` once) |

## Project layout

```
src/backend/     Electron host (opens files, serves tiles)
src/frontend/
  engine/        UI-free traversal engine (ECSQL, relationship metadata)
  state/         zustand store, history, theme
  graph/         React Flow canvas, layouts
  widgets/       AppUI panels
```
