# Graph Report - InstanceGraph  (2026-09-29)

## Corpus Check
- 60 files · ~27,883 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 606 nodes · 1297 edges · 56 communities (18 shown, 38 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2b49ac25`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TraversalStrategy.ts
- InstanceGraphUiProvider.tsx
- graphStore.ts
- engine.test.ts
- NavigationHistory
- GraphCanvas.tsx
- devDependencies
- frontend.test.ts
- html-to-image
- compilerOptions
- GraphEngine.ts
- scripts
- compilerOptions
- dependencies
- InstanceGraph
- smoke.mjs
- copy-assets.mjs
- vite.config.ts
- @itwin/core-frontend
- @itwin/appui-abstract
- @itwin/appui-react
- @itwin/components-react
- @itwin/core-bentley
- @itwin/core-common
- @itwin/core-electron
- @itwin/core-backend
- @itwin/core-geometry
- @itwin/core-i18n
- @itwin/ecschema-rpcinterface-impl
- @itwin/core-quantity
- @itwin/imodel-components-react
- @itwin/ecschema-metadata
- @itwin/ecschema-rpcinterface-common
- @itwin/itwinui-icons-react
- @itwin/presentation-backend
- @itwin/webgl-compatibility
- react
- react-dom
- react-redux
- redux
- @xyflow/react
- zustand
- @itwin/presentation-common
- @itwin/presentation-components
- @itwin/presentation-frontend
- @itwin/tree-widget-react
- @itwin/unified-selection
- @mui/material
- @stratakit/bricks
- @stratakit/foundations
- @stratakit/icons
- @stratakit/mui
- @stratakit/structures
- FiltersWidget.tsx

## God Nodes (most connected - your core abstractions)
1. `useGraphStore` - 32 edges
2. `ClassRegistry` - 20 edges
3. `NodeKey` - 19 edges
4. `nodeKeyString()` - 17 edges
5. `GraphEngine` - 16 edges
6. `GraphData` - 16 edges
7. `scripts` - 15 edges
8. `compilerOptions` - 15 edges
9. `IModelQueryPort` - 14 edges
10. `NavigationHistory` - 14 edges

## Surprising Connections (you probably didn't know these)
- `key()` --calls--> `nodeKeyString()`  [EXTRACTED]
  test/engine.test.ts → src/frontend/engine/GraphModel.ts
- `main()` --calls--> `createQueryPort()`  [EXTRACTED]
  scripts/bench.ts → src/frontend/engine/IModelQueryPort.ts
- `main()` --calls--> `loadInstanceProperties()`  [EXTRACTED]
  scripts/bench.ts → src/frontend/engine/instanceProperties.ts
- `main()` --calls--> `runSeedQuery()`  [EXTRACTED]
  scripts/bench.ts → src/frontend/engine/seedQuery.ts
- `main()` --calls--> `createFixture()`  [EXTRACTED]
  scripts/makeSample.ts → test/fixture.ts

## Import Cycles
- None detected.

## Communities (56 total, 38 thin omitted)

### Community 0 - "TraversalStrategy.ts"
Cohesion: 0.08
Nodes (41): assertId(), buildAspectResolveQuery(), buildClassCatalogQuery(), buildElementResolveQuery(), buildModelResolveQuery(), buildRelationsCappedQuery(), buildRelationsProbeQuery(), buildRelationsQuery() (+33 more)

### Community 1 - "InstanceGraphUiProvider.tsx"
Cohesion: 0.08
Nodes (27): main(), APP_TITLE, getRpcInterfaces(), App(), GraphContent(), instanceGraphUiProvider, createMainFrontstage(), MAIN_STAGE_ID (+19 more)

### Community 2 - "graphStore.ts"
Cohesion: 0.07
Nodes (34): Box, intersects(), quantile(), queryRobustExtents(), robustRange(), shouldRefit(), STRIDES, ViewportContent() (+26 more)

### Community 3 - "engine.test.ts"
Cohesion: 0.08
Nodes (33): main(), main(), buildClassIdLookupQuery(), buildInstanceQuery(), EXPERIMENTAL_OPTION, DEFAULT_OPTIONS, TraversalCancelled, nodeKeyString() (+25 more)

### Community 5 - "GraphCanvas.tsx"
Cohesion: 0.06
Nodes (48): boundsOf(), edgeTypes, GraphCanvasInner(), nodeTypes, hiddenHandle, InstanceFlowNode, InstanceNode, InstanceNodeData (+40 more)

### Community 6 - "devDependencies"
Cohesion: 0.06
Nodes (35): concurrently, cross-env, electron, eslint, eslint-plugin-react-hooks, jsdom, devDependencies, concurrently (+27 more)

### Community 7 - "frontend.test.ts"
Cohesion: 0.16
Nodes (27): FilterSpec, TraversalOptions, parseNodeKey(), DEPTHS, DIRECTIONS, GraphToolbar(), LayoutMode, downloadText() (+19 more)

### Community 9 - "compilerOptions"
Cohesion: 0.07
Nodes (26): DOM, DOM.Iterable, src/frontend, test, vite/client, vite.config.ts, vitest.config.ts, WebWorker (+18 more)

### Community 10 - "GraphEngine.ts"
Cohesion: 0.07
Nodes (34): ClassRegistry, ViewClass, classMatches(), EMPTY_FILTERS, passes(), passesClassFilters(), passesModelFilters(), passesRelationshipFilters() (+26 more)

### Community 11 - "scripts"
Cohesion: 0.10
Nodes (20): description, main, name, private, scripts, bench, build, build:backend (+12 more)

### Community 12 - "compilerOptions"
Cohesion: 0.10
Nodes (19): node, src/backend, compilerOptions, esModuleInterop, lib, module, moduleResolution, noUnusedLocals (+11 more)

### Community 13 - "dependencies"
Cohesion: 0.18
Nodes (11): @bentley/icons-generic-webfont, elkjs, @itwin/core-orbitgt, @itwin/core-react, @itwin/itwinui-react, dependencies, @bentley/icons-generic-webfont, elkjs (+3 more)

### Community 14 - "InstanceGraph"
Cohesion: 0.33
Nodes (5): How it works, InstanceGraph, Quick start, Scripts, Using it

### Community 15 - "smoke.mjs"
Cohesion: 0.40
Nodes (4): errors, file, outDir, relevant

### Community 16 - "copy-assets.mjs"
Cohesion: 0.50
Nodes (3): out, root, scope

### Community 55 - "FiltersWidget.tsx"
Cohesion: 0.21
Nodes (13): ClassFilterEntry, cycleFilterState(), FilterState, isFilterEmpty(), ClassFilterSection(), countLabel(), filterEdits, FiltersWidget() (+5 more)

## Knowledge Gaps
- **159 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+154 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `html-to-image`, `scripts`, `@itwin/core-frontend`, `@itwin/appui-abstract`, `@itwin/appui-react`, `@itwin/components-react`, `@itwin/core-bentley`, `@itwin/core-common`, `@itwin/core-electron`, `@itwin/core-backend`, `@itwin/core-geometry`, `@itwin/core-i18n`, `@itwin/ecschema-rpcinterface-impl`, `@itwin/core-quantity`, `@itwin/imodel-components-react`, `@itwin/ecschema-metadata`, `@itwin/ecschema-rpcinterface-common`, `@itwin/itwinui-icons-react`, `@itwin/presentation-backend`, `@itwin/webgl-compatibility`, `react`, `react-dom`, `react-redux`, `redux`, `@xyflow/react`, `zustand`, `@itwin/presentation-common`, `@itwin/presentation-components`, `@itwin/presentation-frontend`, `@itwin/tree-widget-react`, `@itwin/unified-selection`, `@mui/material`, `@stratakit/bricks`, `@stratakit/foundations`, `@stratakit/icons`, `@stratakit/mui`, `@stratakit/structures`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `useGraphStore` connect `graphStore.ts` to `InstanceGraphUiProvider.tsx`, `engine.test.ts`, `GraphCanvas.tsx`, `frontend.test.ts`, `GraphEngine.ts`, `FiltersWidget.tsx`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `NavigationHistory` connect `NavigationHistory` to `graphStore.ts`, `GraphEngine.ts`, `frontend.test.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _159 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TraversalStrategy.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07787698412698413 - nodes in this community are weakly interconnected._
- **Should `InstanceGraphUiProvider.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07918367346938776 - nodes in this community are weakly interconnected._
- **Should `graphStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06826241134751773 - nodes in this community are weakly interconnected._