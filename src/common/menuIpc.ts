/** Contract between the renderer's command registry and the native application menu. The
 * renderer owns the commands; the backend only renders them and reports clicks back. */
export const MENU_MODEL_CHANNEL = "imodel-explorer.menu-model";
export const MENU_COMMAND_CHANNEL = "imodel-explorer.menu-command";

export const MENU_GROUPS = ["File", "Edit", "View", "Graph", "Help"] as const;
export type MenuGroup = typeof MENU_GROUPS[number];

export interface MenuItemModel {
  readonly id: string;
  readonly label: string;
  readonly group: MenuGroup;
  readonly enabled: boolean;
  readonly accelerator?: string;
  readonly children?: ReadonlyArray<{ readonly label: string; readonly arg: string }>;
}

export interface MenuModel {
  readonly items: readonly MenuItemModel[];
}

const isString = (v: unknown): v is string => typeof v === "string";

/** The backend validates what the renderer sends before building a menu from it. */
export function parseMenuModel(value: unknown): MenuModel {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error("Menu model has no items");
  return {
    items: items.map((raw, i) => {
      const v = raw as Partial<Record<keyof MenuItemModel, unknown>> | null;
      if (!v || !isString(v.id) || !isString(v.label) || typeof v.enabled !== "boolean" || !MENU_GROUPS.includes(v.group as MenuGroup))
        throw new Error(`Menu item ${i} is malformed`);
      if (v.accelerator !== undefined && !isString(v.accelerator)) throw new Error(`Menu item ${v.id} has a malformed accelerator`);
      let children: MenuItemModel["children"];
      if (v.children !== undefined) {
        if (!Array.isArray(v.children)) throw new Error(`Menu item ${v.id} has malformed children`);
        children = v.children.map((c: { label?: unknown; arg?: unknown } | null) => {
          if (!c || !isString(c.label) || !isString(c.arg)) throw new Error(`Menu item ${v.id} has a malformed child`);
          return { label: c.label, arg: c.arg };
        });
      }
      return { id: v.id, label: v.label, group: v.group as MenuGroup, enabled: v.enabled, ...(v.accelerator ? { accelerator: v.accelerator } : {}), ...(children ? { children } : {}) };
    }),
  };
}
