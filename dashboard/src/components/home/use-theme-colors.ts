import { useSyncExternalStore } from "react";

export interface ThemeColors {
  /** Hex form of the active `--background` token. */
  background: string;
  /** Hex form of the active `--primary` token. */
  square: string;
}

// Static sRGB rendering of the current shadcn neutral tokens
// (light: --background oklch(1 0 0), --primary oklch(0.205 0 0);
// dark: --background oklch(0.145 0 0), --primary oklch(0.922 0 0)).
// Used when the canvas normalization readback does not produce hex.
const FALLBACKS: Record<"light" | "dark", ThemeColors> = {
  light: { background: "#ffffff", square: "#171717" },
  dark: { background: "#0a0a0a", square: "#e5e5e5" },
};

const HEX = /^#[0-9a-f]{6}$/i;

// Assigning a CSS color to fillStyle and reading it back makes
// normalizing browsers return #rrggbb. Chromium's wide-gamut canvas
// instead returns the source color space (e.g. "oklch(...)") verbatim,
// so the readback must be validated and may not be passed to
// BlinkingSquares' hex-only parser.
function resolveHex(color: string, fallback: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    if (HEX.test(ctx.fillStyle)) return ctx.fillStyle;
  }
  return fallback;
}

let cachedClass: string | null = null;
let cachedColors: ThemeColors = { background: "#0a0a0a", square: "#e5e5e5" };

function recompute(): void {
  const fallback = document.documentElement.classList.contains("dark")
    ? FALLBACKS.dark
    : FALLBACKS.light;
  const styles = getComputedStyle(document.documentElement);
  const next: ThemeColors = {
    background: resolveHex(styles.getPropertyValue("--background").trim(), fallback.background),
    square: resolveHex(styles.getPropertyValue("--primary").trim(), fallback.square),
  };
  cachedClass = document.documentElement.className;
  if (next.background !== cachedColors.background || next.square !== cachedColors.square) {
    cachedColors = next;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(() => {
    recompute();
    onStoreChange();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getSnapshot(): ThemeColors {
  if (document.documentElement.className !== cachedClass) recompute();
  return cachedColors;
}

/**
 * Derive the hero palette from the active shadcn theme at runtime:
 * background from `--background`, squares from `--primary`. use-theme
 * toggles `.dark` on `<html>`, so a MutationObserver on its `class`
 * attribute re-derives both colors on every theme switch. The output is
 * always a `#rrggbb` hex (validated readback, per-theme fallback).
 */
export function useThemeColors(): ThemeColors {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
