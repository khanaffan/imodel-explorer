# Graph Report - InstanceGraph  (2026-09-29)

## Corpus Check
- 56 files · ~26,625 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 563 nodes · 1232 edges · 43 communities (18 shown, 25 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- TraversalStrategy.ts
- useGraphStore
- GraphModel.ts
- engine.test.ts
- ClassRegistry
- layout.ts
- devDependencies
- graphStore.ts
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
- @itwin/appui-abstract
- @itwin/appui-react
- @itwin/components-react
- @itwin/core-bentley
- @itwin/core-common
- @itwin/core-electron
- @itwin/core-frontend
- @itwin/core-geometry
- @itwin/core-i18n
- @itwin/core-orbitgt
- @itwin/core-quantity
- @itwin/core-react
- @itwin/ecschema-metadata
- @itwin/ecschema-rpcinterface-common
- @itwin/itwinui-icons-react
- @itwin/itwinui-react
- @itwin/webgl-compatibility
- react
- react-dom
- react-redux
- redux
- @xyflow/react
- zustand

## God Nodes (most connected - your core abstractions)
1. `useGraphStore` - 30 edges
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

## Communities (43 total, 25 thin omitted)

### Community 0 - "TraversalStrategy.ts"
Cohesion: 0.10
Nodes (37): assertId(), buildAspectResolveQuery(), buildElementResolveQuery(), buildModelResolveQuery(), buildRelationsCappedQuery(), buildRelationsProbeQuery(), buildRelationsQuery(), buildTraversalRecipe() (+29 more)

### Community 1 - "useGraphStore"
Cohesion: 0.07
Nodes (30): main(), APP_TITLE, getRpcInterfaces(), App(), GraphContent(), Box, quantile(), queryRobustExtents() (+22 more)

### Community 2 - "GraphModel.ts"
Cohesion: 0.09
Nodes (38): MutableGraph, AggregateInfo, EdgeKind, GraphEdge, GraphNode, NODE_CATEGORIES, NodeCategory, boundsOf() (+30 more)

### Community 3 - "engine.test.ts"
Cohesion: 0.06
Nodes (39): main(), main(), buildClassIdLookupQuery(), buildInstanceQuery(), EXPERIMENTAL_OPTION, quoteClassName(), DEFAULT_OPTIONS, TraversalCancelled (+31 more)

### Community 4 - "ClassRegistry"
Cohesion: 0.08
Nodes (17): ClassRegistry, ViewClass, buildClassCatalogQuery(), freeze(), GraphEngine, toMutable(), Cardinality, edgeKeyFor() (+9 more)

### Community 5 - "layout.ts"
Cohesion: 0.09
Nodes (24): adjacencyOf(), angularGap(), arcFootprint(), bfsDepths(), centreOnOrigin(), computeLayout(), getElk(), layeredLayout() (+16 more)

### Community 6 - "devDependencies"
Cohesion: 0.06
Nodes (35): concurrently, cross-env, electron, eslint, eslint-plugin-react-hooks, jsdom, devDependencies, concurrently (+27 more)

### Community 7 - "graphStore.ts"
Cohesion: 0.06
Nodes (43): FilterSpec, CancelToken, TraversalOptions, GraphData, parseNodeKey(), DEPTHS, DIRECTIONS, GraphToolbar() (+35 more)

### Community 9 - "compilerOptions"
Cohesion: 0.07
Nodes (26): DOM, DOM.Iterable, src/frontend, test, vite/client, vite.config.ts, vitest.config.ts, WebWorker (+18 more)

### Community 10 - "GraphEngine.ts"
Cohesion: 0.17
Nodes (20): ClassFilterEntry, classMatches(), cycleFilterState(), EMPTY_FILTERS, FilterState, isFilterEmpty(), passes(), passesClassFilters() (+12 more)

### Community 11 - "scripts"
Cohesion: 0.10
Nodes (20): description, main, name, private, scripts, bench, build, build:backend (+12 more)

### Community 12 - "compilerOptions"
Cohesion: 0.10
Nodes (19): node, src/backend, compilerOptions, esModuleInterop, lib, module, moduleResolution, noUnusedLocals (+11 more)

### Community 13 - "dependencies"
Cohesion: 0.29
Nodes (7): elkjs, @itwin/core-backend, @itwin/imodel-components-react, dependencies, elkjs, @itwin/core-backend, @itwin/imodel-components-react

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
- **143 isolated node(s):** `name`, `version`, `private`, `description`, `main` (+138 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useGraphStore` connect `useGraphStore` to `engine.test.ts`, `GraphModel.ts`, `GraphEngine.ts`, `graphStore.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `html-to-image`, `scripts`, `@itwin/appui-abstract`, `@itwin/appui-react`, `@itwin/components-react`, `@itwin/core-bentley`, `@itwin/core-common`, `@itwin/core-electron`, `@itwin/core-frontend`, `@itwin/core-geometry`, `@itwin/core-i18n`, `@itwin/core-orbitgt`, `@itwin/core-quantity`, `@itwin/core-react`, `@itwin/ecschema-metadata`, `@itwin/ecschema-rpcinterface-common`, `@itwin/itwinui-icons-react`, `@itwin/itwinui-react`, `@itwin/webgl-compatibility`, `react`, `react-dom`, `react-redux`, `redux`, `@xyflow/react`, `zustand`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _143 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `TraversalStrategy.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09714285714285714 - nodes in this community are weakly interconnected._
- **Should `useGraphStore` be split into smaller, more focused modules?**
  _Cohesion score 0.07003367003367003 - nodes in this community are weakly interconnected._
- **Should `GraphModel.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08985200845665962 - nodes in this community are weakly interconnected._
- **Should `engine.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06390977443609022 - nodes in this community are weakly interconnected._