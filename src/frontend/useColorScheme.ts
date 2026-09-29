import { useSyncExternalStore } from "react";

export type ColorScheme = "light" | "dark";

const darkQuery = typeof window === "undefined" ? undefined : window.matchMedia("(prefers-color-scheme: dark)");

/** Resolves an AppUI theme id (as written to `<html data-theme>`) to a light/dark scheme. */
export function resolveColorScheme(themeId: string | null | undefined, systemPrefersDark: boolean): ColorScheme {
  if (!themeId || themeId === "SYSTEM_PREFERRED" || themeId === "os" || themeId === "inherit")
    return systemPrefersDark ? "dark" : "light";
  return themeId.includes("dark") ? "dark" : "light";
}

function current(): ColorScheme {
  return resolveColorScheme(document.documentElement.getAttribute("data-theme"), darkQuery?.matches ?? false);
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  darkQuery?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    darkQuery?.removeEventListener("change", onChange);
  };
}

/** The scheme AppUI's ThemeManager is showing, so StrataKit-based widgets (the visibility trees) match it. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, current, () => "light");
}
