import { IpcApp } from "@itwin/core-frontend";
import { MENU_COMMAND_CHANNEL, MENU_MODEL_CHANNEL, type MenuModel } from "../../common/menuIpc";
import { onSessionsChanged } from "../services/sessionStore";
import { useAppThemeStore } from "../state/appTheme";
import { useClassGraphStore } from "../state/classGraphStore";
import { useFeatureStore } from "../state/featureStore";
import { useGraphStore } from "../state/graphStore";
import { runCommand, toAccelerator, useCommandStore } from "./registry";

export function buildMenuModel(): MenuModel {
  const items = [...useCommandStore.getState().commands.values()]
    .filter((c) => c.inMenu !== false)
    .map((c) => {
      const accelerator = toAccelerator(c.shortcut);
      return {
        id: c.id, label: c.title, group: c.group, enabled: !c.disabledReason?.(),
        ...(accelerator ? { accelerator } : {}),
        ...(c.children ? { children: c.children().map(({ label, arg }) => ({ label, arg })) } : {}),
      };
    });
  return { items };
}

/** Keeps the native menu in step with the registry and the state its enablement reads, and runs
 * the commands the menu reports. */
export function startMenuSync(): () => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const push = () => {
    timer = undefined;
    const model = buildMenuModel();
    const json = JSON.stringify(model);
    if (json === last) return;
    last = json;
    IpcApp.send(MENU_MODEL_CHANNEL, model);
  };
  const schedule = () => { timer ??= setTimeout(push, 150); };
  const unsubscribers: Array<() => unknown> = [useCommandStore, useGraphStore, useClassGraphStore, useFeatureStore, useAppThemeStore].map((store) => store.subscribe(schedule));
  unsubscribers.push(onSessionsChanged(schedule)); // "Compare with session" lists them
  const stopListening = IpcApp.addListener(MENU_COMMAND_CHANNEL, (_evt, id: unknown, arg: unknown) => {
    if (typeof id !== "string" || (arg !== undefined && arg !== null && typeof arg !== "string")) return;
    void runCommand(id, "menu", typeof arg === "string" ? arg : undefined);
  });
  push();
  return () => {
    if (timer) clearTimeout(timer);
    for (const u of unsubscribers) u();
    stopListening();
  };
}
