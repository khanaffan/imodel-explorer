import { create } from "zustand";
import { MENU_GROUPS, type MenuGroup } from "../../common/menuIpc";
import { notify } from "./notify";

export type CommandGroup = MenuGroup;
export const COMMAND_GROUPS: readonly CommandGroup[] = MENU_GROUPS;

/** `mod` is ⌘ on macOS and Ctrl elsewhere. */
export interface Shortcut {
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export type CommandSource = "keyboard" | "menu" | "palette" | "ui";

export interface AppCommand {
  readonly id: string;
  readonly title: string;
  readonly group: CommandGroup;
  readonly shortcut?: Shortcut;
  /** Extra words the palette matches on. */
  readonly keywords?: string;
  /** Why the command cannot run now; undefined when it can. */
  readonly disabledReason?: () => string | undefined;
  /** The shortcut also fires while a text field or dialog has focus. */
  readonly inInputs?: boolean;
  /** Defaults to true. */
  readonly inMenu?: boolean;
  /** Defaults to true. */
  readonly inPalette?: boolean;
  /** Entries listed under this command in the menu (e.g. Open Recent); chosen with their `arg`. */
  readonly children?: () => ReadonlyArray<{ readonly label: string; readonly arg: string }>;
  run(source: CommandSource, arg?: string): void | Promise<void>;
}

interface CommandState {
  /** Registration order is display order. */
  readonly commands: ReadonlyMap<string, AppCommand>;
}

export const useCommandStore = create<CommandState>(() => ({ commands: new Map() }));

/** Adds or replaces commands by id. The returned function removes only these registrations, so a
 * component unmounting after another one re-registered the same id leaves the newer one in place. */
export function registerCommands(list: readonly AppCommand[]): () => void {
  const commands = new Map(useCommandStore.getState().commands);
  for (const c of list) commands.set(c.id, c);
  useCommandStore.setState({ commands });
  return () => {
    const current = new Map(useCommandStore.getState().commands);
    let changed = false;
    for (const c of list)
      if (current.get(c.id) === c) { current.delete(c.id); changed = true; }
    if (changed) useCommandStore.setState({ commands: current });
  };
}

export function getCommand(id: string): AppCommand | undefined {
  return useCommandStore.getState().commands.get(id);
}

/** Runs a command; says why it could not run, or how it failed, instead of failing silently. */
export async function runCommand(id: string, source: CommandSource, arg?: string): Promise<boolean> {
  const command = getCommand(id);
  if (!command) {
    notify.warning(`"${id}" is not available here.`);
    return false;
  }
  const reason = command.disabledReason?.();
  if (reason) {
    notify.info(reason);
    return false;
  }
  try {
    await command.run(source, arg);
    return true;
  } catch (e) {
    notify.error(`${command.title} failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return typeof el?.closest === "function" && !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

const NAMED_OR_ALNUM = /^[a-z0-9]$|^arrow|^enter$|^escape$/i;

export function matchesShortcut(s: Shortcut, e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac = isMac): boolean {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (!!s.mod !== mod || otherMod || !!s.alt !== e.altKey) return false;
  // Symbols such as "?" need Shift on most layouts, so only letters, digits and named keys check it.
  if (NAMED_OR_ALNUM.test(s.key) && !!s.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === s.key.toLowerCase();
}

const KEY_LABELS: Record<string, readonly [mac: string, other: string]> = {
  arrowleft: ["←", "Left"], arrowright: ["→", "Right"], arrowup: ["↑", "Up"], arrowdown: ["↓", "Down"],
  escape: ["Esc", "Esc"], enter: ["↵", "Enter"],
};

export function formatShortcut(s: Shortcut, mac = isMac): string {
  const [macKey, otherKey] = KEY_LABELS[s.key.toLowerCase()] ?? [s.key.toUpperCase(), s.key.toUpperCase()];
  if (mac) return `${s.mod ? "⌘" : ""}${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}${macKey}`;
  return [s.mod && "Ctrl", s.alt && "Alt", s.shift && "Shift", otherKey].filter(Boolean).join("+");
}

const ACCELERATOR_KEYS: Record<string, string> = { arrowleft: "Left", arrowright: "Right", arrowup: "Up", arrowdown: "Down", enter: "Return" };

/** Electron accelerator for chorded shortcuts only: a bare key in the menu would also fire while
 * typing whenever the page does not consume it. */
export function toAccelerator(s: Shortcut | undefined): string | undefined {
  if (!s || (!s.mod && !s.alt)) return undefined;
  const key = ACCELERATOR_KEYS[s.key.toLowerCase()] ?? (/^[a-z0-9,.]$/i.test(s.key) ? s.key.toUpperCase() : undefined);
  if (!key) return undefined;
  return [s.mod && "CmdOrCtrl", s.alt && "Alt", s.shift && "Shift", key].filter(Boolean).join("+");
}

/** The one window-level handler for every registered shortcut. It runs after component handlers
 * (React listens on its root), so a focused widget that consumes a key keeps it. Handling a key
 * calls preventDefault, which also stops the native menu accelerator from firing it again. */
export function installShortcutHandler(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target as HTMLElement | null;
    const guarded = isEditable(target) || (typeof target?.closest === "function" && !!target.closest("[aria-modal='true']"));
    for (const c of useCommandStore.getState().commands.values()) {
      if (!c.shortcut || !matchesShortcut(c.shortcut, e)) continue;
      if ((guarded && !c.inInputs) || c.disabledReason?.()) return;
      e.preventDefault();
      void runCommand(c.id, "keyboard");
      return;
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
