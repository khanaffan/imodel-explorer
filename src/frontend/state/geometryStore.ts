/** State for the Geometry widget: loads an element's geometry stream over the connection, parses it
 * with {@link parseGeometryStream}, expands part references and follows the graph selection. */
import { create } from "zustand";
import type { IModelConnection } from "@itwin/core-frontend";
import {
  type GeometricElement3dProps, type GeometryPartProps, IModel, SubCategoryAppearance,
} from "@itwin/core-common";
import { parseGeometryStream, type ParsedStream } from "../engine/geometryStream";
import { parseNodeKey } from "../engine/GraphModel";
import { useGraphStore } from "./graphStore";

export interface GeometryTarget {
  readonly id: string;
  readonly label?: string;
  readonly className?: string;
}

export interface LoadedGeometry {
  /** Element props including `geom` (undefined when the element has no geometry stream). */
  readonly props: GeometricElement3dProps;
  readonly parsed?: ParsedStream;
  /** Why there is nothing to show, when there isn't. */
  readonly emptyReason?: string;
  /** Default sub-category appearance of the element's category (override/inherited baseline). */
  readonly baseline?: SubCategoryAppearance;
}

export interface ExpandedPart {
  readonly loading: boolean;
  readonly parsed?: ParsedStream;
  readonly error?: string;
}

interface GeometryState {
  readonly target?: GeometryTarget;
  readonly loading: boolean;
  readonly error?: string;
  readonly result?: LoadedGeometry;
  readonly expandedParts: ReadonlyMap<string, ExpandedPart>;
  /** Raw index of the op selected in the stack/list. */
  readonly selectedOp?: number;
  readonly wantBRep: boolean;
  readonly follow: boolean;
  readonly showDecoration: boolean;
}

export const useGeometryStore = create<GeometryState>(() => ({
  loading: false,
  expandedParts: new Map(),
  wantBRep: false,
  follow: true,
  showDecoration: false,
}));

const set = useGeometryStore.setState;
const get = useGeometryStore.getState;

/** Loaded streams per connection; dropped automatically when the connection goes away. */
const cache = new WeakMap<IModelConnection, Map<string, Promise<LoadedGeometry>>>();

let generation = 0;

function cacheFor(connection: IModelConnection): Map<string, Promise<LoadedGeometry>> {
  let m = cache.get(connection);
  if (!m) {
    m = new Map();
    cache.set(connection, m);
  }
  return m;
}

function is2d(props: GeometricElement3dProps): boolean {
  const p = props.placement as { angle?: unknown } | undefined;
  return p?.angle !== undefined;
}

async function loadBaseline(connection: IModelConnection, categoryId: string | undefined): Promise<SubCategoryAppearance | undefined> {
  if (!categoryId) return undefined;
  const request = connection.subcategories.load(categoryId);
  if (request) await request.promise;
  return connection.subcategories.getSubCategoryAppearance(IModel.getDefaultSubCategoryId(categoryId));
}

async function load(connection: IModelConnection, id: string, wantBRep: boolean): Promise<LoadedGeometry> {
  const props = (await connection.elements.loadProps(id, { wantGeometry: true, wantBRepData: wantBRep })) as GeometricElement3dProps | undefined;
  if (!props) throw new Error(`Element ${id} was not found.`);
  if (props.category === undefined)
    return { props, emptyReason: "Not a geometric element." };
  if (!props.geom || !Array.isArray(props.geom) || props.geom.length === 0)
    return { props, emptyReason: "This element has no geometry stream." };
  const baseline = await loadBaseline(connection, props.category).catch(() => undefined);
  const parsed = parseGeometryStream(props.geom, {
    kind: is2d(props) ? "element2d" : "element3d",
    placement: props.placement,
    category: props.category,
  }, baseline);
  return { props, parsed, baseline };
}

export const geometryActions = {
  /** Loads and shows the geometry stream of `id`. A newer call supersedes an in-flight one. */
  async inspect(target: GeometryTarget): Promise<void> {
    const connection = useGraphStore.getState().connection;
    if (!connection) return;
    const myGeneration = ++generation;
    set({ target, loading: true, error: undefined, expandedParts: new Map(), selectedOp: undefined });
    const key = `${target.id}|${get().wantBRep}`;
    const byId = cacheFor(connection);
    let p = byId.get(key);
    if (!p) {
      p = load(connection, target.id, get().wantBRep);
      byId.set(key, p);
      p.catch(() => byId.delete(key));
    }
    try {
      const result = await p;
      if (myGeneration !== generation) return;
      set({ result, loading: false });
    } catch (e) {
      if (myGeneration !== generation) return;
      set({ result: undefined, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  /** Loads a referenced GeometryPart's stream, parsed with the referencing op's params/transform. */
  async expandPart(partId: string): Promise<void> {
    const connection = useGraphStore.getState().connection;
    const { result, expandedParts } = get();
    if (!connection || !result?.parsed || expandedParts.has(partId)) return;
    const refOp = result.parsed.ops.find((op) => op.partId === partId);
    const update = (entry: ExpandedPart) => {
      const next = new Map(get().expandedParts);
      next.set(partId, entry);
      set({ expandedParts: next });
    };
    update({ loading: true });
    try {
      const props = (await connection.elements.loadProps(partId, { wantGeometry: true, wantBRepData: get().wantBRep })) as GeometryPartProps | undefined;
      if (!props?.geom) throw new Error("The part has no geometry stream.");
      const parsed = parseGeometryStream(props.geom, { kind: "part", params: refOp?.partParams, transform: refOp?.partToWorld }, result.baseline);
      update({ loading: false, parsed });
    } catch (e) {
      update({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  collapsePart(partId: string): void {
    const next = new Map(get().expandedParts);
    next.delete(partId);
    set({ expandedParts: next });
  },

  selectOp(index: number | undefined): void {
    set({ selectedOp: index === get().selectedOp ? undefined : index });
  },

  setFollow(follow: boolean): void {
    set({ follow });
    if (follow) syncToSelection();
  },

  /** Re-fetches the current element with or without BRep data included. */
  setWantBRep(wantBRep: boolean): void {
    if (wantBRep === get().wantBRep) return;
    set({ wantBRep });
    const target = get().target;
    if (target) void geometryActions.inspect(target);
  },

  setShowDecoration(showDecoration: boolean): void {
    set({ showDecoration });
  },

  reset(): void {
    generation++;
    set({ target: undefined, loading: false, error: undefined, result: undefined, expandedParts: new Map(), selectedOp: undefined });
  },
};

function syncToSelection(): void {
  const s = useGraphStore.getState();
  if (s.selection?.kind !== "node") return;
  const node = s.graph.nodes.get(s.selection.key);
  const id = node?.id ?? parseNodeKey(s.selection.key).id;
  if (id === get().target?.id) return;
  void geometryActions.inspect({ id, label: node?.label, className: node?.className });
}

useGraphStore.subscribe((s, prev) => {
  if (s.engine !== prev.engine) geometryActions.reset();
  else if (s.selection !== prev.selection && get().follow) syncToSelection();
});
