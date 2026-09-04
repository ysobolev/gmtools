export const DISPLAY_THEMES = ["system", "dark", "light"] as const;
export type DisplayTheme = (typeof DISPLAY_THEMES)[number];

export const DEFAULT_DISPLAY_THEME: DisplayTheme = "system";

export function isDisplayTheme(value: unknown): value is DisplayTheme {
  return (
    typeof value === "string" &&
    DISPLAY_THEMES.includes(value as DisplayTheme)
  );
}

export function resolveDisplayTheme(
  preference: DisplayTheme,
  systemPrefersDark: boolean,
): "dark" | "light" {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyDisplayTheme(preference: DisplayTheme): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    document.documentElement.dataset.theme = resolveDisplayTheme(
      preference,
      media.matches,
    );
  };
  apply();
  if (preference === "system") media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}
