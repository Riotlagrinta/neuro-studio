import { FRAMES, type AspectRatio, type Layer } from "./types";

/** A layer chosen for editing: the scene by its stable uid (indexes move when scenes are reordered), the layer by id. */
export interface Selection {
  scene: string;
  layer: string;
}

/**
 * Layers that make up the scene's backdrop: the AI media, the dim veil above it, any shape covering the frame.
 * Clicking the picture must not grab them (they would be picked by every click on empty space and dragged by accident);
 * they stay selectable from the timeline.
 */
export function isBackdropLayer(layer: Layer, ratio: AspectRatio): boolean {
  if (layer.type === "media" || layer.id === "dim") return true;
  if (layer.type !== "rect" && layer.type !== "ellipse") return false;
  const { width, height } = FRAMES[ratio];
  return typeof layer.w === "number" && typeof layer.h === "number" && layer.w >= width * 0.95 && layer.h >= height * 0.95;
}
