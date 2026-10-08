// Direct manipulation in the video monitor: pick a layer by clicking it, drag to move it, drag a corner to
// scale it, drag the handle to rotate it. This file is only the geometry and the edit rules behind those
// gestures; the pointer events and the drawing of the handles belong to the UI.
//
// Coordinates are FRAME pixels (the 1920x1080 / 1080x1920 virtual frame, y pointing down), time is
// scene-local seconds. Every edit returns a new scene, never mutates its input, and returns the very same
// scene when it changes nothing (a drag that ends where it began must leave no undo step).
//
// A gesture acts at one moment: on an animated property it writes a keyframe at the playhead (After Effects'
// stopwatch), on a static one it just changes the value. Pass the playhead on the frame grid, as the timeline
// does: the key is written on the nearest frame, and the box you resized is the box at that frame.

import { sample } from "./easing";
import { layerEnd, snapToFrame, updateLayer } from "./edit";
import type { Anchor, CaptionsLayer, Ease, Keyframe, Layer, MotionScene, TextLayer, Track } from "./types";

// ---------- shared ----------

const EPS = 1e-6;
/** Keyframes closer than this are the same pose (same rule as edit.ts). */
const SAME_KEY = 0.004;
/** drawLayer skips a layer below these, so a click must not select what isn't drawn. */
const HIDDEN = 0.001;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
/**
 * Decimals kept per property. Positions and angles are fine to the hundredth, but a scale is a ratio: 0.01 on a
 * 1920 px layer is a 19 px jump, which makes dragging a corner step visibly.
 */
const DECIMALS = { x: 2, y: 2, rotation: 2, scale: 3 } as const;

export interface Point {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
const finite = (...values: number[]) => values.every(Number.isFinite);
/**
 * `+ 0` turns -0 into 0, which would otherwise end up in the project JSON and trip strict equality. A value so large
 * that scaling it by 10^decimals overflows has no decimals left to round: it is kept, not turned into Infinity.
 */
function roundTo(v: number, decimals: number): number {
  const rounded = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return Number.isFinite(rounded) ? rounded + 0 : v;
}

/** Vector (x, y) turned by `degrees` the way ctx.rotate turns it (clockwise on screen, since y points down). */
function turn(x: number, y: number, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

const findLayer = (scene: MotionScene, id: string) => scene.layers.find((l) => l.id === id);

/** Value of a track at scene-local time `t`: what is on screen, and what a drag starts from. */
export const sampleAt = (track: Track, t: number): number => sample(track, t);

// ---------- measuring text ----------

/** Size of a text or captions block in layer units, i.e. before the layer's scale. */
export type Measure = (layer: TextLayer | CaptionsLayer) => { w: number; h: number };

const CHAR_WIDTH = 0.5;
/** Captions show a few words at a time (captions.ts pages them by four); the whole narration is never on screen. */
const CAPTION_WORDS = 4;

/**
 * Rough size without a canvas, for tests and a first draw: every character is half the font size wide, text wraps
 * at maxWidth, lines are `size * lineHeight` tall. The UI should inject a measure based on the real font. Captions
 * are sized for one page (their first words) rather than the whole narration, which would be a huge hit area.
 */
export const defaultMeasure: Measure = (layer) => {
  // The renderer collapses runs of whitespace, so count the text the same way.
  const words = (s: string) => s.split(/\s+/).filter(Boolean);
  const paragraphs = layer.type === "captions" ? [words(layer.text).slice(0, CAPTION_WORDS).join(" ")] : layer.text.split("\n").map((p) => words(p).join(" "));
  let width = 0;
  let lines = 0;
  for (const paragraph of paragraphs) {
    const natural = paragraph.length * layer.size * CHAR_WIDTH;
    width = Math.max(width, natural);
    lines += Math.max(1, Math.ceil(natural / layer.maxWidth));
  }
  return { w: Math.min(layer.maxWidth, width), h: lines * layer.size * layer.lineHeight };
};

// ---------- a layer's box ----------

/** The rectangle a layer covers in the frame, rotation included. */
export interface Box {
  /** Centre, in frame pixels. */
  cx: number;
  cy: number;
  /** Size AFTER the layer's scale. */
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** The layer's scale at that moment (w and h already include it). */
  scale: number;
}

/** Offset from the layer's point (x, y) to the centre of its box. Mirrors anchorOffset in render.ts. */
function anchorOffset(anchor: Anchor, w: number, h: number): [number, number] {
  switch (anchor) {
    case "left":
      return [w / 2, 0];
    case "right":
      return [-w / 2, 0];
    case "top":
      return [0, h / 2];
    case "bottom":
      return [0, -h / 2];
    default:
      return [0, 0];
  }
}

/** The layer's box in its own units (before scale) and where its centre sits relative to (x, y). */
function localBox(layer: Layer, t: number, measure: Measure): { w: number; h: number; offset: [number, number] } {
  switch (layer.type) {
    case "text": {
      // The renderer starts the block at the origin when left-aligned and ends it there when right-aligned.
      // The offset comes from the clamped width, so a nonsensical negative measure can't shift the box.
      const measured = measure(layer);
      const w = Math.max(0, measured.w);
      return { w, h: Math.max(0, measured.h), offset: [layer.align === "left" ? w / 2 : layer.align === "right" ? -w / 2 : 0, 0] };
    }
    case "captions": {
      const { w, h } = measure(layer);
      return { w: Math.max(0, w), h: Math.max(0, h), offset: [0, 0] };
    }
    default: {
      const w = Math.max(0, sampleAt(layer.w, t));
      const h = Math.max(0, sampleAt(layer.h, t));
      return { w, h, offset: anchorOffset(layer.anchor, w, h) };
    }
  }
}

/**
 * Where a layer is on screen at time `t`, or null when it isn't drawn then (outside its window, transparent,
 * scaled to nothing, or a non-finite value somewhere). Same transform as drawLayer: translate to (x, y), rotate,
 * scale, then the box sits around that point according to its anchor.
 */
export function layerBox(layer: Layer, scene: MotionScene, t: number, measure: Measure = defaultMeasure): Box | null {
  if (!Number.isFinite(t) || t < layer.start || t > layerEnd(scene, layer)) return null;
  const scale = sampleAt(layer.scale, t);
  if (!(sampleAt(layer.opacity, t) > HIDDEN && scale > HIDDEN)) return null;

  const { w, h, offset } = localBox(layer, t, measure);
  const rotation = sampleAt(layer.rotation, t);
  const shift = turn(offset[0] * scale, offset[1] * scale, rotation);
  const box: Box = { cx: sampleAt(layer.x, t) + shift.x, cy: sampleAt(layer.y, t) + shift.y, w: w * scale, h: h * scale, rotation, scale };
  return finite(box.cx, box.cy, box.w, box.h, box.rotation, box.scale) ? box : null;
}

/** The four corners after rotation: top-left, top-right, bottom-right, bottom-left (as the box is when unrotated). */
export function boxCorners(box: Box): [Point, Point, Point, Point] {
  const corner = (sx: number, sy: number): Point => {
    const o = turn((sx * box.w) / 2, (sy * box.h) / 2, box.rotation);
    return { x: box.cx + o.x, y: box.cy + o.y };
  };
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

const HANDLE_DISTANCE = 40;

/**
 * Where the rotate handle sits: `distance` frame pixels beyond the middle of the top edge, along the box's own "up".
 * A distance that is not finite (a zoom of 0 divides into one) falls back to the default instead of poisoning the point.
 */
export function rotateHandle(box: Box, distance = HANDLE_DISTANCE): Point {
  const o = turn(0, -box.h / 2 - (Number.isFinite(distance) ? distance : HANDLE_DISTANCE), box.rotation);
  return { x: box.cx + o.x, y: box.cy + o.y };
}

/** Whether the point is inside the box, `margin` frame pixels of slack all around included (the box's edges count). */
export function pointInBox(box: Box, x: number, y: number, margin = 0): boolean {
  if (!finite(x, y, margin)) return false;
  const p = turn(x - box.cx, y - box.cy, -box.rotation);
  return Math.abs(p.x) <= box.w / 2 + margin && Math.abs(p.y) <= box.h / 2 + margin;
}

/**
 * The topmost layer under the point (layers later in the list are drawn on top), or null. Boxes are what is
 * tested, not the pixels, as in a video editor. A media layer is the backdrop: it is picked only when nothing
 * else is under the point, so the picture behind your text never steals the click.
 */
export function hitTest(scene: MotionScene, t: number, x: number, y: number, measure: Measure = defaultMeasure, margin = 0): string | null {
  if (!finite(x, y)) return null;
  let backdrop: string | null = null;
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i];
    const box = layerBox(layer, scene, t, measure);
    if (!box || !pointInBox(box, x, y, margin)) continue;
    if (layer.type !== "media") return layer.id;
    backdrop ??= layer.id;
  }
  return backdrop;
}

// ---------- keyframes ----------

/** The frame a key is written on: the nearest frame, to the millisecond, and not before the scene starts. */
const keyTime = (t: number) => Math.round(snapToFrame(Math.max(0, t)) * 1000) / 1000;

/** Setting `value` would change nothing: `current` already is that, as asked or as it would be stored. */
const unchanged = (current: number, value: number, decimals: number) => same(current, value) || same(current, roundTo(value, decimals));

/**
 * Sets a track to `value` at time `t`, the way a stopwatch-on property behaves. A plain number stays a plain
 * number (it just takes the new value); keyframes get a key on the nearest frame, inserted in order, or the key
 * already there (within 4 ms) updated. A new key arrives with `ease`, else with the ease of the key that follows
 * it, so cutting a segment in two keeps the curve it had. Values are rounded to `decimals`.
 *
 * The same track comes back when the value is already the one stored (a plain number, or the key at that time).
 * Between keys a new key is always written, even at the value the curve gives there: that pins the pose.
 */
export function setTrackAt(track: Track, t: number, value: number, ease?: Ease, decimals = 2): Track {
  if (!finite(t, value)) return track;
  const target = roundTo(value, decimals);
  if (typeof track === "number") return unchanged(track, value, decimals) ? track : target;

  const at = keyTime(t);
  const existing = track.findIndex((k) => Math.abs(k.t - at) <= SAME_KEY);
  if (existing >= 0) {
    const key = track[existing];
    if (unchanged(key.v, value, decimals) && (ease === undefined || ease === key.ease)) return track;
    const updated: Keyframe = { ...key, v: target };
    if (ease !== undefined) updated.ease = ease;
    return track.map((k, i) => (i === existing ? updated : k));
  }

  const following = track.findIndex((k) => k.t > at);
  const inherited = ease ?? (following >= 0 ? track[following].ease : undefined);
  const key: Keyframe = inherited === undefined ? { t: at, v: target } : { t: at, v: target, ease: inherited };
  const index = following >= 0 ? following : track.length;
  return [...track.slice(0, index), key, ...track.slice(index)];
}

type Pose = Partial<Record<keyof typeof DECIMALS, number>>;

/**
 * Writes the given values of x, y, scale and rotation at `t` in one go. A property the gesture leaves where it is
 * gets no key, and keeps its track: dragging along x must not add a key to y, since on an eased track even a key
 * of the same value reshapes the curve. Unchanged tracks keep their identity, so a no-op gesture is the same scene.
 */
function setPose(scene: MotionScene, layer: Layer, t: number, pose: Pose): MotionScene {
  const patch: Partial<Record<keyof typeof DECIMALS, Track>> = {};
  for (const prop of Object.keys(pose) as (keyof typeof DECIMALS)[]) {
    const value = pose[prop];
    if (value === undefined || unchanged(sampleAt(layer[prop], t), value, DECIMALS[prop])) continue;
    patch[prop] = setTrackAt(layer[prop], t, value, undefined, DECIMALS[prop]);
  }
  return updateLayer(scene, layer.id, patch);
}

// ---------- gestures ----------

/** Moves a layer by (dx, dy) frame pixels at time `t`. */
export function translateLayer(scene: MotionScene, layerId: string, t: number, dx: number, dy: number): MotionScene {
  const layer = findLayer(scene, layerId);
  if (!layer || !finite(t, dx, dy) || (dx === 0 && dy === 0)) return scene;
  return setPose(scene, layer, t, { x: sampleAt(layer.x, t) + dx, y: sampleAt(layer.y, t) + dy });
}

/** Multiplies a layer's scale at time `t` by `factor`, kept between 0.05 and 20. */
export function scaleLayer(scene: MotionScene, layerId: string, t: number, factor: number): MotionScene {
  const layer = findLayer(scene, layerId);
  if (!layer || !finite(t, factor)) return scene;
  return setPose(scene, layer, t, { scale: clamp(sampleAt(layer.scale, t) * factor, MIN_SCALE, MAX_SCALE) });
}

/** Past a full turn either way an angle wraps; inside [-360, 360] it is kept as it is (animations may spin that far). */
const wrapAngle = (degrees: number) => (Math.abs(degrees) > 360 ? degrees % 360 : degrees);

/** Sets a layer's rotation (degrees) at time `t`. */
export function rotateLayer(scene: MotionScene, layerId: string, t: number, degrees: number): MotionScene {
  const layer = findLayer(scene, layerId);
  if (!layer || !finite(t, degrees)) return scene;
  return setPose(scene, layer, t, { rotation: wrapAngle(degrees) });
}

export type Corner = "tl" | "tr" | "br" | "bl";
const CORNERS: Record<Corner, [number, number]> = { tl: [-1, -1], tr: [1, -1], br: [1, 1], bl: [-1, 1] };

/**
 * Drags a corner of the layer's box to the pointer (px, py). The opposite corner stays where it is and the
 * aspect ratio is kept: the scale becomes whatever puts the dragged corner nearest the pointer along the box's
 * diagonal, and x and y move so the layer really grows from that fixed corner, rotation included.
 *
 * `box` must be layerBox() of this same layer in this same scene at `t` (take it when the drag starts and pass
 * the scene from then too). The scale is kept between 0.05 and 20; past either limit the corner stops following
 * the pointer but the opposite one never moves.
 */
export function resizeFromCorner(scene: MotionScene, layerId: string, t: number, box: Box, corner: Corner, px: number, py: number): MotionScene {
  const layer = findLayer(scene, layerId);
  if (!layer || !finite(t, px, py, box.cx, box.cy, box.w, box.h, box.rotation, box.scale) || box.scale <= 0) return scene;

  const [sx, sy] = CORNERS[corner];
  // The fixed corner, then the pointer and the dragged corner as seen from it in the box's own axes.
  const opposite = turn((-sx * box.w) / 2, (-sy * box.h) / 2, box.rotation);
  const fx = box.cx + opposite.x;
  const fy = box.cy + opposite.y;
  const pointer = turn(px - fx, py - fy, -box.rotation);
  const dragged = { x: sx * box.w, y: sy * box.h };
  const length2 = dragged.x * dragged.x + dragged.y * dragged.y;
  if (length2 === 0) return scene;

  // Projecting on the diagonal keeps the shape uniform and moves smoothly, even when the pointer wanders off it.
  const wanted = (pointer.x * dragged.x + pointer.y * dragged.y) / length2;
  // Stored scales are rounded: work from the stored value so the fixed corner doesn't drift by the rounding.
  const scale = roundTo(clamp(box.scale * wanted, MIN_SCALE, MAX_SCALE), DECIMALS.scale);
  const grow = scale / box.scale;
  // The layer's point (x, y) is rigid with the box, so growing the box about the fixed corner moves it the same way.
  return setPose(scene, layer, t, { scale, x: fx + grow * (sampleAt(layer.x, t) - fx), y: fy + grow * (sampleAt(layer.y, t) - fy) });
}

/** The angle equal to `angle` (mod 360) that lies in [-360, 360] and is nearest to `reference`: no long way round. */
function nearestTurn(angle: number, reference: number): number {
  let best = angle;
  for (const candidate of [angle - 360, angle + 360]) {
    if (Math.abs(candidate) <= 360 && Math.abs(candidate - reference) < Math.abs(best - reference)) best = candidate;
  }
  return best;
}

/**
 * Turns the layer so that its rotate handle points at the pointer (px, py), seen from the centre of `box`.
 * `snapDegrees` > 0 rounds the angle to a multiple of it (Shift: 15). The layer turns about the centre of its box
 * (x and y are adjusted for layers whose point is not the centre: left-aligned text, edge anchors), and among the
 * equivalent angles the one nearest the current rotation is used, so an animated rotation doesn't flip the long
 * way round when the pointer crosses straight down. `box` must be layerBox() of this layer in this scene at `t`.
 */
export function rotateFromHandle(scene: MotionScene, layerId: string, t: number, box: Box, px: number, py: number, snapDegrees = 0): MotionScene {
  const layer = findLayer(scene, layerId);
  if (!layer || !finite(t, px, py, box.cx, box.cy, box.rotation)) return scene;
  const dx = px - box.cx;
  const dy = py - box.cy;
  // Straight on the centre there is no direction (and atan2(0, -0) would claim 180 degrees).
  if (dx === 0 && dy === 0) return scene;

  // The handle points along the box's "up", so rotation 0 is straight up and 90 is to the right.
  const pointed = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const angle = finite(snapDegrees) && snapDegrees > 0 ? Math.round(pointed / snapDegrees) * snapDegrees : pointed;
  // Rounded to what is stored BEFORE the centre is compensated: the compensation turns a vector as long as the
  // distance from the layer's point to the centre (thousands of pixels for a wide layer), so the 0.005 degrees
  // lost to rounding afterwards would swing the centre by several hundredths of a pixel.
  const rotation = roundTo(wrapAngle(nearestTurn(angle, box.rotation)), DECIMALS.rotation);

  // The vector from the layer's point to the box centre turns with the layer; keep the centre where it is.
  const x = sampleAt(layer.x, t);
  const y = sampleAt(layer.y, t);
  const centre = turn(box.cx - x, box.cy - y, rotation - box.rotation);
  return setPose(scene, layer, t, { rotation, x: box.cx - centre.x, y: box.cy - centre.y });
}
