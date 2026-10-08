"use client";

import { SYSTEM_FONTS, type FontStacks } from "./render";

// Canvas can't read CSS variables, so resolve the next/font families declared in layout.tsx
// once and hand them to the renderer. Falls back to system fonts if a variable is missing.
const VARIABLES: Record<keyof FontStacks, string> = {
  sans: "--font-geist-sans",
  serif: "--font-playfair",
  mono: "--font-geist-mono",
  display: "--font-anton",
};

export function resolveFontStacks(): FontStacks {
  const style = getComputedStyle(document.body);
  const out = { ...SYSTEM_FONTS };
  for (const key of Object.keys(VARIABLES) as (keyof FontStacks)[]) {
    const value = style.getPropertyValue(VARIABLES[key]).trim();
    if (value) out[key] = `${value}, ${SYSTEM_FONTS[key]}`;
  }
  return out;
}

/** next/font only fetches a face once the DOM uses it; canvas text doesn't count, so load explicitly. */
export async function loadFonts(stacks: FontStacks): Promise<void> {
  await Promise.all(
    Object.values(stacks).flatMap((stack) => [
      document.fonts.load(`400 48px ${stack}`).catch(() => []),
      document.fonts.load(`700 48px ${stack}`).catch(() => []),
    ]),
  );
}
