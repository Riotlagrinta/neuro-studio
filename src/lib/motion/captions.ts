import type { FontStacks } from "./render";
import type { CaptionsLayer } from "./types";

/**
 * Draws animated subtitles. `t` is the scene-local time; `sceneDuration` bounds layers that have no explicit end.
 * (Implemented by the captions engine; this placeholder draws nothing.)
 */
export function drawCaptions(ctx: CanvasRenderingContext2D, layer: CaptionsLayer, t: number, fonts: FontStacks, sceneDuration: number): void {
  void [ctx, layer, t, fonts, sceneDuration];
}
