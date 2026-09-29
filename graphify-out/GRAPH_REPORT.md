# Graph Report - InstanceGraph  (2026-09-29)

## Corpus Check
- 58 files · ~27,607 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 599 nodes · 1284 edges · 55 communities (17 shown, 38 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5619bff6`
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
- @bentley/icons-generic-webfont
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

## Communities (55 total, 38 thin omitted)

### Community 0 - "TraversalStrategy.ts"
Cohesion: 0.06
Nodes (47): ClassRegistry, ViewClass, assertId(), buildAspectResolveQuery(), buildClassCatalogQuery(), buildElementResolveQuery(), buildModelResolveQuery(), buildRelationsCappedQuery() (+39 more)

### Community 1 - "InstanceGraphUiProvider.tsx"
Cohesion: 0.10
Nodes (20): main(), APP_TITLE, getRpcInterfaces(), App(), instanceGraphUiProvider, createMainFrontstage(), MAIN_STAGE_ID, AppHost (+12 more)

### Community 2 - "graphStore.ts"
Cohesion: 0.07
Nodes (40): Box, intersects(), quantile(), queryRobustExtents(), robustRange(), shouldRefit(), STRIDES, ViewportContent() (+32 more)

### Community 3 - "engine.test.ts"
Cohesion: 0.08
Nodes (32): main(), main(), buildClassIdLookupQuery(), buildInstanceQuery(), EXPERIMENTAL_OPTION, DEFAULT_OPTIONS, TraversalCancelled, nodeKeyString() (+24 more)

### Community 5 - "GraphCanvas.tsx"
Cohesion: 0.05
Nodes (54): GraphContent(), MutableGraph, GraphEdge, GraphNode, PropertyRecord, boundsOf(), edgeTypes, GraphCanvas() (+46 more)

### Community 6 - "devDependencies"
Cohesion: 0.06
Nodes (35): concurrently, cross-env, electron, eslint, eslint-plugin-react-hooks, jsdom, devDependencies, concurrently (+27 more)

### Community 7 - "frontend.test.ts"
Cohesion: 0.18
Nodes (24): parseNodeKey(), DEPTHS, DIRECTIONS, GraphToolbar(), LayoutMode, downloadText(), downloadUrl(), exportPng() (+16 more)

### Community 9 - "compilerOptions"
Cohesion: 0.07
Nodes (26): DOM, DOM.Iterable, src/frontend, test, vite/client, vite.config.ts, vitest.config.ts, WebWorker (+18 more)

### Community 10 - "GraphEngine.ts"
Cohesion: 0.09
Nodes (35): ClassFilterEntry, classMatches(), cycleFilterState(), EMPTY_FILTERS, FilterSpec, FilterState, isFilterEmpty(), passes() (+27 more)

### Community 11 - "scripts"
Cohesion: 0.10
Nodes (20): description, main, name, private, scripts, bench, build, build:backend (+12 more)

### Community 12 - "compilerOptions"
Cohesion: 0.10
Nodes (19): node, src/backend, compilerOptions, esModuleInterop, lib, module, moduleResolution, noUnusedLocals (+11 more)

### Community 13 - "dependencies"
Cohesion: 0.18
Nodes (11): elkjs, @itwin/core-frontend, @itwin/core-orbitgt, @itwin/core-react, @itwin/itwinui-react, dependencies, elkjs, @itwin/core-frontend (+3 more)

### Community 14 - "InstanceGraph"
Cohesion: 0.33
Nodes (5): How it works, InstanceGraph, Quick start, Scripts, Using it

### Community 15 - "smoke.mjs"
Cohesion: 0.40
Nodes (4): errors, file, outDir, relevant

### Community 16 - "copy-assets.mjs"
Cohesion: 0.50
Nodes (3): out, root, scope

## Knowledge Gaps
- **158 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+153 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `html-to-image`, `scripts`, `@bentley/icons-generic-webfont`, `@itwin/appui-abstract`, `@itwin/appui-react`, `@itwin/components-react`, `@itwin/core-bentley`, `@itwin/core-common`, `@itwin/core-electron`, `@itwin/core-backend`, `@itwin/core-geometry`, `@itwin/core-i18n`, `@itwin/ecschema-rpcinterface-impl`, `@itwin/core-quantity`, `@itwin/imodel-components-react`, `@itwin/ecschema-metadata`, `@itwin/ecschema-rpcinterface-common`, `@itwin/itwinui-icons-react`, `@itwin/presentation-backend`, `@itwin/webgl-compatibility`, `react`, `react-dom`, `react-redux`, `redux`, `@xyflow/react`, `zustand`, `@itwin/presentation-common`, `@itwin/presentation-components`, `@itwin/presentation-frontend`, `@itwin/tree-widget-react`, `@itwin/unified-selection`, `@mui/material`, `@stratakit/bricks`, `@stratakit/foundations`, `@stratakit/icons`, `@stratakit/mui`, `@stratakit/structures`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `useGraphStore` connect `graphStore.ts` to `InstanceGraphUiProvider.tsx`, `engine.test.ts`, `GraphCanvas.tsx`, `frontend.test.ts`, `GraphEngine.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _158 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TraversalStrategy.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.056669339748730285 - nodes in this community are weakly interconnected._
- **Should `InstanceGraphUiProvider.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10256410256410256 - nodes in this community are weakly interconnected._
- **Should `graphStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06623376623376623 - nodes in this community are weakly interconnected._