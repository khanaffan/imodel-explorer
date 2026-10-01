import { Id64 } from "@itwin/core-bentley";
import { QueryBinder } from "@itwin/core-common";
import type { SchemaView } from "@itwin/ecschema-metadata";
import type { ClassRegistry } from "./ClassRegistry";
import { buildRelationsCappedQuery, ID_LIST_CHUNK, idList, buildRelationsProbeQuery, buildRelationsQuery, type GroupRef, instanceExclusionPredicate, quoteClassName } from "./ecsql";
import { aggregateKey, type Direction, parseAggregateKey, type DirectionFilter, type NodeKey, nodeKeyString, type RawRelation } from "./GraphModel";
import type { IModelQueryPort } from "./IModelQueryPort";

export type StrategyName = "relations" | "fallback";

/** Lets strategies avoid streaming huge fan-outs (a model's elements, a CodeSpec's codes, ...) that
 * the engine would only summarise as "+N more". */
export interface NeighbourLimits {
  /** Rows fetched for a relationship group whose size exceeds it. */
  readonly fetchLimit: number;
  /** Row cap for groups the user opened (`unlimited`). */
  readonly maxRows: number;
  /** `aggregateKey`s of groups to fetch up to `maxRows`. */
  readonly unlimited: ReadonlySet<string>;
  /** Instances already on the graph: links from capped groups to these are still returned. */
  readonly knownIds: readonly string[];
  /** Return only rows leading to `knownIds` (skips the per-group caps and probes). */
  readonly onlyKnown?: boolean;
  readonly excludedInstances?: readonly string[];
}

export interface NeighbourResult {
  readonly relations: RawRelation[];
  /** Server-side row counts of groups that were capped, keyed by `aggregateKey`. */
  readonly totals: ReadonlyMap<string, number>;
}

export interface TraversalStrategy {
  readonly name: StrategyName;
  /** Instances directly related to the seeds; without `limits`, every one of them. */
  neighbours(seeds: readonly NodeKey[], direction: DirectionFilter, limits?: NeighbourLimits): Promise<NeighbourResult>;
  /** Direct relationships from `seeds` to any of `targets`, without enumerating whole fans where possible. */
  linksBetween(seeds: readonly NodeKey[], targets: readonly NodeKey[], direction: DirectionFilter): Promise<RawRelation[]>;
}

function onlyTargets(relations: readonly RawRelation[], targets: readonly NodeKey[]): RawRelation[] {
  const wanted = new Set(targets.map(nodeKeyString));
  return relations.filter((r) => wanted.has(nodeKeyString(r.related)));
}


const limitFor = (limits: NeighbourLimits, gk: string) => (limits.unlimited.has(gk) ? limits.maxRows : limits.fetchLimit);
const asDirection = (v: unknown): Direction => (String(v).toLowerCase() === "forward" ? "forward" : "backward");

const BATCH_SIZE = 40;
const CONCURRENCY = 4;

async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** Uses the experimental `ECVLib.Relations()` table-valued function: one statement per batch of seeds. */
export class RelationsTraversal implements TraversalStrategy {
  public readonly name = "relations";
  /** A batch returning this many rows is re-planned with per-group counts so hub fans are capped. */
  public static probeRows = 2000;

  /** Batches that `Relations()` could not complete (e.g. a ConcurrentQuery time-out on a hub) and
   * that were answered by the metadata fallback instead. */
  public degradedBatches = 0;
  /** Seeds whose fan exceeded `probeRows` and were expanded by the metadata fallback. */
  public hubSeeds = 0;

  /** @param _fallback answers batches whose `Relations()` statement fails, so one pathological hub
   * doesn't fail the whole traversal. */
  public constructor(private readonly _port: IModelQueryPort, private readonly _fallback?: TraversalStrategy) { }

  public async neighbours(seeds: readonly NodeKey[], direction: DirectionFilter, limits?: NeighbourLimits): Promise<NeighbourResult> {
    const totals = new Map<string, number>();
    const batches = await mapConcurrent(chunk(seeds, BATCH_SIZE), CONCURRENCY, async (batch) => {
      try {
        return await this._batch(batch, direction, limits, totals);
      } catch (e) {
        if (!this._fallback)
          throw e;
        this.degradedBatches++;
        // eslint-disable-next-line no-console
        console.warn(`Relations() failed for ${batch.length} seed(s); using metadata fallback:`, e);
        const r = await this._fallback.neighbours(batch, direction, limits);
        for (const [k, n] of r.totals) totals.set(k, n);
        return r.relations;
      }
    });
    return { relations: batches.flat(), totals };
  }

  public async linksBetween(seeds: readonly NodeKey[], targets: readonly NodeKey[], direction: DirectionFilter): Promise<RawRelation[]> {
    if (seeds.length === 0 || targets.length === 0) return [];
    // Relations() can't filter by the related id before enumerating a fan; the fallback's indexed
    // per-relationship queries can.
    if (this._fallback) return this._fallback.linksBetween(seeds, targets, direction);
    return onlyTargets((await this.neighbours(seeds, direction)).relations, targets);
  }

  private async _batch(batch: NodeKey[], direction: DirectionFilter, limits: NeighbourLimits | undefined, totals: Map<string, number>): Promise<RawRelation[]> {
    const toRelation = (row: Record<string, any>): RawRelation => ({
      seed: batch[row.SeedIndex],
      related: { id: row.RelatedECInstanceId, classId: row.RelatedECClassId },
      direction: asDirection(row.Direction),
      relClassId: row.RelationshipECClassId,
      relInstanceId: row.RelationshipECInstanceId,
      navPropertyName: row.NavPropertyName ?? undefined,
    });
    if (!limits)
      return (await this._port.query(buildRelationsQuery(batch, direction))).map(toRelation);

    // Common case: nothing big in this batch, one statement.
    const probeRows = RelationsTraversal.probeRows;
    const probe = await this._port.query(buildRelationsQuery(batch, direction, { limit: probeRows, excludedInstances: limits.excludedInstances }));
    if (probe.length < probeRows)
      return probe.map(toRelation);

    // Relations() can't push a relationship-class filter down, so capping a hub still means
    // enumerating its whole fan (minutes for a CodeSpec on a 40 GB iModel). Rows arrive grouped by
    // seed in seed order: seeds before the one the probe stopped in are complete. That seed is a hub
    // only if it fills the probe by itself; otherwise it is re-probed with the rest.
    if (!probe.every((r, i) => i === 0 || r.SeedIndex >= probe[i - 1].SeedIndex))
      return this._hubs(batch, direction, limits, totals, toRelation);
    const stoppedAt = probe[probe.length - 1].SeedIndex as number;
    if (stoppedAt > 0) {
      const complete = probe.filter((r) => r.SeedIndex < stoppedAt).map(toRelation);
      return [...complete, ...await this._batch(batch.slice(stoppedAt), direction, limits, totals)];
    }
    const [hub, rest] = await Promise.all([
      this._hubs([batch[0]], direction, limits, totals, toRelation),
      batch.length > 1 ? this._batch(batch.slice(1), direction, limits, totals) : [],
    ]);
    return [...hub, ...rest];
  }

  /** Expands seeds with a large fan: through the metadata fallback's indexed, per-relationship
   * `LIMIT`/`COUNT` queries when available, otherwise with one windowed `Relations()` scan. */
  private async _hubs(seeds: NodeKey[], direction: DirectionFilter, limits: NeighbourLimits, totals: Map<string, number>,
    toRelation: (row: Record<string, any>) => RawRelation): Promise<RawRelation[]> {
    if (this._fallback) {
      this.hubSeeds += seeds.length;
      const r = await this._fallback.neighbours(seeds, direction, limits);
      for (const [k, n] of r.totals) totals.set(k, n);
      return r.relations;
    }
    const batch = seeds;
    const seedIndex = new Map(batch.map((k, i) => [nodeKeyString(k), i]));
    const unlimited: GroupRef[] = [];
    for (const gk of limits.unlimited) {
      const { ownerKey, relClassId, direction: dir } = parseAggregateKey(gk);
      const i = seedIndex.get(ownerKey);
      if (i !== undefined) unlimited.push({ seedIndex: i, relClassId, direction: dir });
    }
    const withKnownIds = limits.knownIds.length > 0;
    const rows = await this._port.query(
      buildRelationsCappedQuery(batch, direction, { fetchLimit: limits.fetchLimit, maxRows: limits.maxRows, unlimited, withKnownIds, excludedInstances: limits.excludedInstances }),
      withKnownIds ? new QueryBinder().bindIdSet(1, [...limits.knownIds]) : undefined);
    const out: RawRelation[] = [];
    for (const row of rows) {
      const rel = toRelation(row);
      const gk = aggregateKey(nodeKeyString(rel.seed), rel.relClassId, rel.direction);
      if (row.N > limitFor(limits, gk)) totals.set(gk, row.N);
      out.push(rel);
    }
    return out;
  }
}

type ViewClass = SchemaView.Class;
type ViewConstraint = SchemaView.RelConstraint | undefined;

interface NavDecl {
  readonly holderClass: string;
  readonly propName: string;
  /** True when the holder is the relationship source. */
  readonly holderIsSource: boolean;
  /** Constraint at the end opposite the holder. */
  readonly otherEnd: ViewConstraint;
}

interface LinkTableRoot {
  readonly className: string;
  readonly source: ViewConstraint;
  readonly target: ViewConstraint;
}

function constraintAccepts(constraint: ViewConstraint, cls: ViewClass): boolean {
  if (!constraint)
    return false;
  return constraint.constraintClasses.some((k) => (constraint.polymorphic ? cls.is(k) : k.fullName === cls.fullName));
}

function abstractOf(constraint: ViewConstraint): string | undefined {
  return constraint?.abstractConstraint?.fullName ?? constraint?.constraintClasses[0]?.fullName;
}

/** Metadata-driven traversal for runtimes without `Relations()`: enumerates, from the SchemaView,
 * the navigation properties and link-table relationships that can apply to each seed's class and
 * queries each. Same contract as {@link RelationsTraversal}. */
export class FallbackTraversal implements TraversalStrategy {
  public readonly name = "fallback";
  private _navDecls?: NavDecl[];
  private _linkRoots?: LinkTableRoot[];

  public constructor(private readonly _port: IModelQueryPort, private readonly _registry: ClassRegistry) { }

  private _index(): { navDecls: NavDecl[]; linkRoots: LinkTableRoot[] } {
    if (this._navDecls && this._linkRoots)
      return { navDecls: this._navDecls, linkRoots: this._linkRoots };
    const navDecls: NavDecl[] = [];
    const endTableRels = new Set<string>();
    const relClasses: ViewClass[] = [];
    for (const schema of this._registry.view.getSchemas()) {
      for (const cls of schema.getClasses()) {
        if (cls.isRelationship()) {
          relClasses.push(cls);
          continue;
        }
        if (!cls.isEntity() && !cls.isMixin())
          continue;
        for (const prop of cls.getOwnProperties()) {
          if (!prop.isNavigation())
            continue;
          const rel = prop.relationshipClass;
          endTableRels.add(rel.fullName);
          const holderIsSource = prop.direction !== 2;
          navDecls.push({ holderClass: cls.fullName, propName: prop.name, holderIsSource, otherEnd: holderIsSource ? rel.target : rel.source });
        }
      }
    }
    const isEndTable = (rel: ViewClass): boolean => {
      for (let c: ViewClass | undefined = rel; c; c = c.baseClass)
        if (endTableRels.has(c.fullName)) return true;
      return rel.derivedClasses.some((d) => isEndTable(d));
    };
    const linkRoots: LinkTableRoot[] = [];
    for (const rel of relClasses) {
      if (rel.baseClass || isEndTable(rel) || !rel.isRelationship())
        continue;
      linkRoots.push({ className: rel.fullName, source: rel.source, target: rel.target });
    }
    this._navDecls = navDecls;
    this._linkRoots = linkRoots;
    return { navDecls, linkRoots };
  }

  public async neighbours(seeds: readonly NodeKey[], direction: DirectionFilter, limits?: NeighbourLimits): Promise<NeighbourResult> {
    const totals = new Map<string, number>();
    const results = await mapConcurrent(seeds, CONCURRENCY, async (seed) => this._neighboursOf(seed, direction, limits, totals));
    return { relations: results.flat(), totals };
  }

  public async linksBetween(seeds: readonly NodeKey[], targets: readonly NodeKey[], direction: DirectionFilter): Promise<RawRelation[]> {
    if (seeds.length === 0 || targets.length === 0) return [];
    const limits: NeighbourLimits = { fetchLimit: 0, maxRows: 0, unlimited: new Set(), knownIds: [...new Set(targets.map((t) => t.id))], onlyKnown: true };
    const { relations } = await this.neighbours(seeds, direction, limits);
    return onlyTargets(relations, targets);
  }

  /** Runs a per-seed statement that has a `Rel` column (relationship class id) and a related-id
   * column, capping any relationship class that has more rows than its limit. */
  private async _capped(base: string, binder: () => QueryBinder, idColumn: string, classColumn: string, seed: NodeKey, dir: Direction,
    limits: NeighbourLimits | undefined, totals: Map<string, number>): Promise<Array<Record<string, any>>> {
    if (!limits)
      return this._safeQuery(base, binder());
    const predicate = instanceExclusionPredicate(classColumn, idColumn, limits.excludedInstances);
    const query = predicate ? (sql: string, b: QueryBinder) => this._port.query(sql, b) : (sql: string, b: QueryBinder) => this._safeQuery(sql, b);
    if (predicate) base = `SELECT * FROM (${base}) WHERE ${predicate}`;
    if (limits.onlyKnown) {
      const parts = await Promise.all(chunk([...limits.knownIds], ID_LIST_CHUNK).map(async (known) =>
        query(`SELECT * FROM (${base}) WHERE ${idColumn} IN (${idList(known)})`, binder())));
      return parts.flat();
    }
    const owner = nodeKeyString(seed);
    const probeLimit = [...limits.unlimited].some((k) => k.startsWith(`agg|${owner}|`) && k.endsWith(`|${dir}`)) ? limits.maxRows : limits.fetchLimit;
    const probe = await query(`${base} LIMIT ${probeLimit + 1}`, binder());
    if (probe.length <= probeLimit)
      return probe; // complete

    const small: Array<string | undefined> = [];
    const big: Array<{ rel: string; limit: number }> = [];
    for (const c of await query(`SELECT Rel, COUNT(*) N FROM (${base}) GROUP BY Rel`, binder())) {
      if (!c.Rel || !Id64.isValidId64(c.Rel)) { small.push(undefined); continue; } // unset RelECClassId: never capped
      const gk = aggregateKey(owner, c.Rel, dir);
      const limit = limitFor(limits, gk);
      if (c.N > limit) {
        big.push({ rel: c.Rel, limit });
        totals.set(gk, (totals.get(gk) ?? 0) + c.N);
      } else {
        small.push(c.Rel);
      }
    }
    // Ids come from the count query and were validated above, so inlining them is safe.
    const smallIds = small.filter((r): r is string => r !== undefined);
    const smallPredicate = [smallIds.length ? `Rel IN (${smallIds.join(", ")})` : "", small.includes(undefined) ? "Rel IS NULL" : ""].filter(Boolean).join(" OR ");
    const parts = await Promise.all([
      smallPredicate ? query(`SELECT * FROM (${base}) WHERE ${smallPredicate}`, binder()) : [],
      ...big.map((b) => query(`SELECT * FROM (${base}) WHERE Rel = ${b.rel} LIMIT ${b.limit}`, binder())),
      // An id list (not InVirtualSet) lets SQLite seek known ids instead of scanning the whole fan.
      ...(big.length ? chunk([...limits.knownIds], ID_LIST_CHUNK) : []).map(async (known) =>
        query(`SELECT * FROM (${base}) WHERE Rel IN (${big.map((b) => b.rel).join(", ")}) AND ${idColumn} IN (${idList(known)})`, binder())),
    ]);
    return parts.flat();
  }

  private async _safeQuery(ecsql: string, binder?: QueryBinder) {
    try {
      return await this._port.query(ecsql, binder);
    } catch {
      // Some metadata-derived statements are not queryable (e.g. unmapped mixins); skip them.
      return [];
    }
  }

  private async _classIdOf(abstractClass: string | undefined, id: string): Promise<string | undefined> {
    if (!abstractClass)
      return undefined;
    const rows = await this._safeQuery(`SELECT ECClassId FROM ${quoteClassName(abstractClass)} WHERE ECInstanceId = ?`, new QueryBinder().bindId(1, id));
    return rows[0]?.ECClassId;
  }

  private async _neighboursOf(seed: NodeKey, direction: DirectionFilter, limits: NeighbourLimits | undefined, totals: Map<string, number>): Promise<RawRelation[]> {
    const cls = this._registry.findClass(this._registry.nameOf(seed.classId));
    if (!cls)
      return [];
    const { navDecls, linkRoots } = this._index();
    const wantForward = direction !== "backward";
    const wantBackward = direction !== "forward";
    const out: RawRelation[] = [];
    const idBinder = () => new QueryBinder().bindId(1, seed.id);
    const excluded = new Set(limits?.excludedInstances);

    // Navigation properties held by the seed.
    const ownNavs = cls.getProperties().filter((p) => p.isNavigation());
    if (ownNavs.length > 0) {
      const cols = ownNavs.map((p, i) => `[${p.name}].Id N${i}, [${p.name}].RelECClassId R${i}`).join(", ");
      const [row] = await this._safeQuery(`SELECT ${cols} FROM ${quoteClassName(cls.fullName)} WHERE ECInstanceId = ?`, idBinder());
      if (row) {
        await Promise.all(ownNavs.map(async (p, i) => {
          const relatedId: string | undefined = row[`N${i}`];
          if (!relatedId || !p.isNavigation())
            return;
          const rel = p.relationshipClass;
          const holderIsSource = p.direction !== 2;
          const dir = holderIsSource ? "forward" : "backward";
          if ((dir === "forward" && !wantForward) || (dir === "backward" && !wantBackward))
            return;
          // Data doesn't always honour the constraint (the root Subject is modeled by the RepositoryModel
          // but is not an ISubModeledElement), so fall back to looking the id up as an element.
          const classId = await this._classIdOf(abstractOf(holderIsSource ? rel.target : rel.source), relatedId)
            ?? await this._classIdOf("BisCore:Element", relatedId);
          if (!classId)
            return;
          if (excluded.has(nodeKeyString({ id: relatedId, classId }))) return;
          out.push({ seed, related: { id: relatedId, classId }, direction: dir, relClassId: row[`R${i}`], relInstanceId: seed.id, navPropertyName: p.name });
        }));
      }
    }

    // Navigation properties on other classes that point at the seed.
    await Promise.all(navDecls.filter((d) => constraintAccepts(d.otherEnd, cls)).map(async (d) => {
      const dir = d.holderIsSource ? "backward" : "forward";
      if ((dir === "forward" && !wantForward) || (dir === "backward" && !wantBackward))
        return;
      const rows = await this._capped(
        `SELECT ECInstanceId Id, ECClassId ClassId, [${d.propName}].RelECClassId Rel FROM ${quoteClassName(d.holderClass)} WHERE [${d.propName}].Id = ?`,
        idBinder, "Id", "ClassId", seed, dir, limits, totals);
      for (const r of rows)
        out.push({ seed, related: { id: r.Id, classId: r.ClassId }, direction: dir, relClassId: r.Rel, relInstanceId: r.Id, navPropertyName: d.propName });
    }));

    // Link-table relationships.
    await Promise.all(linkRoots.map(async (root) => {
      const binder = () => new QueryBinder().bindId(1, seed.id).bindId(2, seed.classId);
      if (wantForward && constraintAccepts(root.source, cls)) {
        const rows = await this._capped(`SELECT ECInstanceId Id, ECClassId Rel, TargetECInstanceId OId, TargetECClassId OClassId FROM ${quoteClassName(root.className)} WHERE SourceECInstanceId = ? AND SourceECClassId = ?`,
          binder, "OId", "OClassId", seed, "forward", limits, totals);
        for (const r of rows)
          out.push({ seed, related: { id: r.OId, classId: r.OClassId }, direction: "forward", relClassId: r.Rel, relInstanceId: r.Id });
      }
      if (wantBackward && constraintAccepts(root.target, cls)) {
        const rows = await this._capped(`SELECT ECInstanceId Id, ECClassId Rel, SourceECInstanceId OId, SourceECClassId OClassId FROM ${quoteClassName(root.className)} WHERE TargetECInstanceId = ? AND TargetECClassId = ?`,
          binder, "OId", "OClassId", seed, "backward", limits, totals);
        for (const r of rows)
          out.push({ seed, related: { id: r.OId, classId: r.OClassId }, direction: "backward", relClassId: r.Rel, relInstanceId: r.Id });
      }
    }));
    return out;
  }
}

/** Picks `Relations()` when this connection can prepare it, otherwise the metadata fallback. */
export async function selectStrategy(port: IModelQueryPort, registry: ClassRegistry, prefer?: StrategyName): Promise<TraversalStrategy> {
  if (prefer === "fallback")
    return new FallbackTraversal(port, registry);
  try {
    await port.query(buildRelationsProbeQuery());
    return new RelationsTraversal(port, new FallbackTraversal(port, registry));
  } catch {
    return new FallbackTraversal(port, registry);
  }
}
