import type { ThemeId } from "@itwin/appui-react";
import { create } from "zustand";

export const APP_THEMES = [
  { value: "SYSTEM_PREFERRED", label: "System preference" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "high-contrast-light", label: "High contrast light" },
  { value: "high-contrast-dark", label: "High contrast dark" },
] as const satisfies ReadonlyArray<{ value: ThemeId; label: string }>;

export type AppTheme = typeof APP_THEMES[number]["value"];

export const DEFAULT_APP_THEME: AppTheme = "SYSTEM_PREFERRED";
const STORAGE_KEY = "instanceGraph.appTheme";
const validThemes = new Set<string>(APP_THEMES.map((option) => option.value));

export function loadAppTheme(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): AppTheme {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value && validThemes.has(value) ? value as AppTheme : DEFAULT_APP_THEME;
  } catch {
    return DEFAULT_APP_THEME;
  }
}

export function saveAppTheme(theme: AppTheme, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): string | undefined {
  try {
    storage?.setItem(STORAGE_KEY, theme);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

interface AppThemeState {
  readonly theme: AppTheme;
  readonly storageError?: string;
}

export const useAppThemeStore = create<AppThemeState>(() => ({
  theme: loadAppTheme(),
}));

export const appThemeActions = {
  setTheme(theme: AppTheme): void {
    useAppThemeStore.setState({ theme, storageError: saveAppTheme(theme) });
  },

  resetDefault(): void {
    this.setTheme(DEFAULT_APP_THEME);
  },
};
