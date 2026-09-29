# Graph Report - InstanceGraph  (2026-09-29)

## Corpus Check
- 62 files · ~29,108 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 618 nodes · 1336 edges · 55 communities (18 shown, 37 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `89e487fa`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TraversalStrategy.ts
- useGraphStore
- graphStore.ts
- engine.test.ts
- @bentley/icons-generic-webfont
- GraphCanvas.tsx
- devDependencies
- frontend.test.ts
- html-to-image
- compilerOptions
- ClassRegistry
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
- GraphEngine.ts

## God Nodes (most connected - your core abstractions)
1. `useGraphStore` - 32 edges
2. `ClassRegistry` - 21 edges
3. `NodeKey` - 19 edges
4. `GraphEngine` - 17 edges
5. `nodeKeyString()` - 17 edges
6. `GraphData` - 16 edges
7. `scripts` - 15 edges
8. `IModelQueryPort` - 15 edges
9. `compilerOptions` - 15 edges
10. `NavigationHistory` - 14 edges

## Surprising Connections (you probably didn't know these)
- `buildModelTree()` --indirect_call--> `m()`  [INFERRED]
  src/frontend/engine/models.ts → test/models.test.ts
- `key()` --calls--> `nodeKeyString()`  [EXTRACTED]
  test/engine.test.ts → src/frontend/engine/GraphModel.ts
- `FakeScheduler` --implements--> `Scheduler`  [EXTRACTED]
  test/frontend.test.ts → src/frontend/graph/motion.ts
- `main()` --calls--> `createQueryPort()`  [EXTRACTED]
  scripts/bench.ts → src/frontend/engine/IModelQueryPort.ts
- `main()` --calls--> `loadInstanceProperties()`  [EXTRACTED]
  scripts/bench.ts → src/frontend/engine/instanceProperties.ts

## Import Cycles
- None detected.

## Communities (55 total, 37 thin omitted)

### Community 0 - "TraversalStrategy.ts"
Cohesion: 0.09
Nodes (38): assertId(), buildAspectResolveQuery(), buildElementResolveQuery(), buildModelResolveQuery(), buildRelationsCappedQuery(), buildRelationsProbeQuery(), buildRelationsQuery(), buildTraversalRecipe() (+30 more)

### Community 1 - "useGraphStore"
Cohesion: 0.05
Nodes (50): main(), APP_TITLE, getRpcInterfaces(), App(), GraphContent(), Box, intersects(), quantile() (+42 more)

### Community 2 - "graphStore.ts"
Cohesion: 0.07
Nodes (25): ViewClass, CancelToken, AggregateInfo, Cardinality, EdgeKind, emptyGraph(), NODE_CATEGORIES, NodeCategory (+17 more)

### Community 3 - "engine.test.ts"
Cohesion: 0.08
Nodes (32): main(), main(), buildClassIdLookupQuery(), buildInstanceQuery(), EXPERIMENTAL_OPTION, DEFAULT_OPTIONS, TraversalCancelled, edgeKeyFor() (+24 more)

### Community 5 - "GraphCanvas.tsx"
Cohesion: 0.06
Nodes (53): MutableGraph, GraphEdge, GraphNode, PropertyRecord, boundsOf(), edgeTypes, GraphCanvasInner(), GraphEmptyState() (+45 more)

### Community 6 - "devDependencies"
Cohesion: 0.06
Nodes (35): concurrently, cross-env, electron, eslint, eslint-plugin-react-hooks, jsdom, devDependencies, concurrently (+27 more)

### Community 7 - "frontend.test.ts"
Cohesion: 0.15
Nodes (23): parseNodeKey(), DEPTHS, DIRECTIONS, GraphToolbar(), downloadText(), downloadUrl(), exportPng(), GraphJson (+15 more)

### Community 9 - "compilerOptions"
Cohesion: 0.07
Nodes (26): DOM, DOM.Iterable, src/frontend, test, vite/client, vite.config.ts, vitest.config.ts, WebWorker (+18 more)

### Community 10 - "ClassRegistry"
Cohesion: 0.09
Nodes (12): ClassRegistry, buildClassCatalogQuery(), freeze(), GraphEngine, toMutable(), GraphData, parseAggregateKey(), IModelQueryPort (+4 more)

### Community 11 - "scripts"
Cohesion: 0.10
Nodes (20): description, main, name, private, scripts, bench, build, build:backend (+12 more)

### Community 12 - "compilerOptions"
Cohesion: 0.10
Nodes (19): node, src/backend, compilerOptions, esModuleInterop, lib, module, moduleResolution, noUnusedLocals (+11 more)

### Community 13 - "dependencies"
Cohesion: 0.18
Nodes (11): elkjs, @itwin/components-react, @itwin/core-orbitgt, @itwin/core-react, @itwin/itwinui-react, dependencies, elkjs, @itwin/components-react (+3 more)

### Community 14 - "InstanceGraph"
Cohesion: 0.33
Nodes (5): How it works, InstanceGraph, Quick start, Scripts, Using it

### Community 15 - "smoke.mjs"
Cohesion: 0.40
Nodes (4): errors, file, outDir, relevant

### Community 16 - "copy-assets.mjs"
Cohesion: 0.50
Nodes (3): out, root, scope

### Community 55 - "GraphEngine.ts"
Cohesion: 0.10
Nodes (36): ClassFilterEntry, classMatches(), cycleFilterState(), EMPTY_FILTERS, FilterSpec, FilterState, isFilterEmpty(), passes() (+28 more)

## Knowledge Gaps
- **160 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+155 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@bentley/icons-generic-webfont`, `html-to-image`, `scripts`, `@itwin/core-frontend`, `@itwin/appui-abstract`, `@itwin/appui-react`, `@itwin/core-bentley`, `@itwin/core-common`, `@itwin/core-electron`, `@itwin/core-backend`, `@itwin/core-geometry`, `@itwin/core-i18n`, `@itwin/ecschema-rpcinterface-impl`, `@itwin/core-quantity`, `@itwin/imodel-components-react`, `@itwin/ecschema-metadata`, `@itwin/ecschema-rpcinterface-common`, `@itwin/itwinui-icons-react`, `@itwin/presentation-backend`, `@itwin/webgl-compatibility`, `react`, `react-dom`, `react-redux`, `redux`, `@xyflow/react`, `zustand`, `@itwin/presentation-common`, `@itwin/presentation-components`, `@itwin/presentation-frontend`, `@itwin/tree-widget-react`, `@itwin/unified-selection`, `@mui/material`, `@stratakit/bricks`, `@stratakit/foundations`, `@stratakit/icons`, `@stratakit/mui`, `@stratakit/structures`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `useGraphStore` connect `useGraphStore` to `graphStore.ts`, `engine.test.ts`, `GraphCanvas.tsx`, `frontend.test.ts`, `GraphEngine.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `NavigationHistory` connect `graphStore.ts` to `ClassRegistry`, `frontend.test.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _160 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TraversalStrategy.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `useGraphStore` be split into smaller, more focused modules?**
  _Cohesion score 0.050617283950617285 - nodes in this community are weakly interconnected._
- **Should `graphStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06570048309178744 - nodes in this community are weakly interconnected._