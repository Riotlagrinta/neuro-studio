// Layers made by hand: the toolbar's "Texte" / "Forme" / "Cercle", "Dupliquer le calque" and the stacking order.
// Like edit.ts every function is pure: it returns a new scene, never mutates its input, and returns the very same
// scene when the request changes nothing (a click on a dead button must not leave an undo step).
//
// Coordinates are FRAME pixels (the 1920x1080 / 1080x1920 virtual frame) and times are scene-local seconds. Positions
// and sizes are kept to the hundredth, times to the millisecond on the frame grid, like the rest of the editing code.

import { FPS, snapToFrame } from "./edit";
import { isBackdropLayer } from "./selection";
import { FRAMES, type AspectRatio, type Keyframe, type Layer, type MotionScene, type Track } from "./types";

/** sanitize.ts keeps the first 40 layers of a stored scene: a 41st would silently vanish on reload. */
export const MAX_LAYERS = 40;
/** A new layer starts early enough to be on screen for at least this long. */
const MIN_VISIBLE = 0.5;
const EPS = 1e-6;
/** How far a copy sits from its original, as a fraction of the frame. */
const COPY_OFFSET = 0.03;
/** Legal range of x and y in sanitize.ts: [-3, 4] frames. */
const POSITION_RANGE: [number, number] = [-3, 4];

export type NewLayerKind = "text" | "rect" | "ellipse";
export type LayerReorder = "front" | "back" | "forward" | "backward";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** `+ 0` turns -0 into 0, which would otherwise end up in the project JSON and trip strict equality. */
const round2 = (v: number) => Math.round(v * 100) / 100 + 0;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The scene has room for one more layer. */
export const canAddLayer = (scene: MotionScene): boolean => scene.layers.length < MAX_LAYERS;

/** Layer ids only have to be unique within their scene: take the first free "l0", "l1", "l2"… (what a reload gives them). */
function freeId(layers: readonly Layer[]): string {
  const taken = new Set(layers.map((l) => l.id));
  let n = 0;
  while (taken.has(`l${n}`)) n++;
  return `l${n}`;
}

/** The playhead on the frame grid, pulled back so the layer stays on screen for MIN_VISIBLE (a scene shorter than that: 0). */
function startAt(scene: MotionScene, atLocalTime: number): number {
  const room = scene.duration - MIN_VISIBLE;
  // Floor on the frame grid: rounding up could leave the layer less than MIN_VISIBLE on screen.
  const latest = room > 0 ? Math.floor(room * FPS + EPS) / FPS : 0;
  const wanted = Number.isFinite(atLocalTime) ? snapToFrame(atLocalTime) : 0;
  return round3(clamp(wanted, 0, latest));
}

/**
 * A new layer, centred in the frame and sized for it, appearing at `atLocalTime` (the playhead, seconds from the
 * scene start) and lasting until the scene ends. Its id is the first free "l0", "l1"… of `scene`. Nothing is added:
 * pass the result to addLayer.
 *
 * - text: "Votre texte", 7 % of the short side tall, bold white, wrapped at 80 % of the width, fades in.
 * - rect: 36 % x 25 % of the frame, rounded corners, in the accent colour.
 * - ellipse: a circle 20 % of the short side across, pink.
 */
export function createLayer(kind: NewLayerKind, scene: MotionScene, ratio: AspectRatio, atLocalTime: number): Layer {
  const { width, height } = FRAMES[ratio];
  const short = Math.min(width, height);
  const base = {
    id: freeId(scene.layers),
    start: startAt(scene, atLocalTime),
    end: null,
    x: width / 2,
    y: height / 2,
    rotation: 0,
    scale: 1,
    opacity: 1,
  };
  switch (kind) {
    case "text":
      return {
        ...base,
        type: "text",
        text: "Votre texte",
        size: Math.round(short * 0.07),
        weight: 700,
        color: "#ffffff",
        font: "sans",
        align: "center",
        maxWidth: round2(width * 0.8),
        lineHeight: 1.15,
        letterSpacing: 0,
        reveal: "none",
        revealDuration: 0.8,
      };
    case "rect": {
      const w = round2(width * 0.36);
      const h = round2(height * 0.25);
      return { ...base, type: "rect", w, h, radius: Math.round(Math.min(w, h) * 0.12), fill: "#6366f1", stroke: null, strokeWidth: 0, anchor: "center" };
    }
    case "ellipse": {
      const diameter = round2(short * 0.2);
      return { ...base, type: "ellipse", w: diameter, h: diameter, fill: "#f472b6", stroke: null, strokeWidth: 0, anchor: "center" };
    }
  }
}

/**
 * Puts a layer on top of the stack (the end of the list is drawn last). A layer whose id is already taken in this
 * scene gets the first free one, so ids stay unique: read the id of the result's LAST layer, not of the argument.
 * A scene that already holds MAX_LAYERS layers is returned as it is (check canAddLayer to tell the user why).
 */
export function addLayer(scene: MotionScene, layer: Layer): MotionScene {
  if (!canAddLayer(scene)) return scene;
  const added = scene.layers.some((l) => l.id === layer.id) ? { ...layer, id: freeId(scene.layers) } : layer;
  return { ...scene, layers: [...scene.layers, added] };
}

const shiftTrack = (track: Track, delta: number, lo: number, hi: number): Track => {
  const move = (v: number) => round2(clamp(v + delta, lo, hi));
  return typeof track === "number" ? move(track) : track.map((k): Keyframe => ({ ...k, v: move(k.v) }));
};

/**
 * Copies a layer right above the original, 3 % of the frame (width for x, height for y) down and to the right so the
 * copy can be seen. An animated position moves as a whole: every keyframe is shifted, so the copy follows the same
 * path. The copy gets a new id: it is the layer right above `id` in the result. The same scene comes back when `id`
 * is unknown or the scene is full (MAX_LAYERS). `ratio` is the project's: the offset depends on the frame.
 */
export function duplicateLayer(scene: MotionScene, id: string, ratio: AspectRatio): MotionScene {
  const index = scene.layers.findIndex((l) => l.id === id);
  if (index < 0 || !canAddLayer(scene)) return scene;
  const { width, height } = FRAMES[ratio];
  const original = scene.layers[index];
  const copy: Layer = {
    ...original,
    id: freeId(scene.layers),
    x: shiftTrack(original.x, width * COPY_OFFSET, width * POSITION_RANGE[0], width * POSITION_RANGE[1]),
    y: shiftTrack(original.y, height * COPY_OFFSET, height * POSITION_RANGE[0], height * POSITION_RANGE[1]),
  };
  return { ...scene, layers: [...scene.layers.slice(0, index + 1), copy, ...scene.layers.slice(index + 1)] };
}

/**
 * Moves a layer in the stack: to the very top ("front"), to the bottom ("back"), or one place up ("forward") or down
 * ("backward"). Layers that already are where they are asked to go, and unknown ids, give back the same scene.
 *
 * The backdrop is never covered by what you add: the layers at the bottom of the stack that isBackdropLayer calls
 * backdrop (the AI media, its dim veil, shapes covering the frame) form a floor, and any OTHER layer stops just above
 * it, so "back" means "just above the backdrop". A backdrop layer itself moves freely, which is what lets you send a
 * full-frame shape behind your text after having put it in front. `ratio` is the project's (it tells what covers the frame).
 */
export function reorderLayer(scene: MotionScene, id: string, to: LayerReorder, ratio: AspectRatio): MotionScene {
  const from = scene.layers.findIndex((l) => l.id === id);
  if (from < 0) return scene;
  const top = scene.layers.length - 1;
  // The floor is the first layer that is not backdrop; a layer that isn't backdrop itself is therefore at or above it.
  const floor = isBackdropLayer(scene.layers[from], ratio) ? 0 : scene.layers.findIndex((l) => !isBackdropLayer(l, ratio));
  let target: number;
  switch (to) {
    case "front":
      target = top;
      break;
    case "back":
      target = floor;
      break;
    case "forward":
      target = Math.min(from + 1, top);
      break;
    case "backward":
      target = Math.max(from - 1, floor);
      break;
    default:
      return scene; // the value comes from the UI: anything else asks for nothing
  }
  if (target === from) return scene;
  const layers = [...scene.layers];
  const [moved] = layers.splice(from, 1);
  layers.splice(target, 0, moved);
  return { ...scene, layers };
}
