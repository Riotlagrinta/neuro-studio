// The pure half of the monitor's direct manipulation (MonitorOverlay.tsx is the DOM half): what a press picks,
// where the selection frame and its handles are on screen, and what each pointer move does to the project.
// Everything is a function of its arguments so a whole pointer sequence can be replayed in a test.
//
// Two coordinate systems meet here. FRAME pixels are the virtual 1920x1080 / 1080x1920 frame the engines work in;
// CSS pixels are the monitor on screen, `factor` = cssWidth / frameWidth of them per frame pixel. While a scene's
// transition plays, the scene is laid over the frame scaled or shifted (see transitionPlacement): the screen shows
// the *placed* scene, the engines want the scene as it is, and these functions convert between the two.

import { ease } from "./easing";
import { snapToFrame } from "./edit";
import {
  boxCorners,
  defaultMeasure,
  layerBox,
  pointInBox,
  resizeFromCorner,
  rotateFromHandle,
  rotateHandle,
  sampleAt,
  translateLayer,
  type Box,
  type Corner,
  type Measure,
  type Point,
} from "./manipulate";
import type { MeasureMoment } from "./render";
import { isBackdropLayer, type Selection } from "./selection";
import { snapMove, type SnapGuide } from "./snap";
import { FRAMES, locate, type AspectRatio, type CaptionsLayer, type Layer, type MotionProject, type MotionScene, type TextLayer } from "./types";

// ---------- sizes on screen (CSS pixels) ----------

/** Side of the square that catches a press on a handle; the handle itself is drawn smaller. */
export const HANDLE_HIT = 24;
/** How far the rotation handle floats beyond the top edge. */
export const ROTATE_STEM = 28;
/** How close an edge has to come to a guide line to be pulled onto it. */
export const SNAP_PX = 8;
/** A press that moves less than this is a click, not a drag. */
export const DRAG_PX = 4;
/** Shift while rotating. */
export const ROTATE_STEP = 15;

/** A finger is less precise than a mouse: its press picks a layer from a little further away. */
export function pickSlack(pointerType: string): number {
  return pointerType === "touch" ? 10 : pointerType === "pen" ? 4 : 2;
}

// ---------- frame <-> screen ----------

type Frame = { width: number; height: number };

/** CSS pixels per frame pixel for a monitor `cssWidth` wide; 0 while it has no usable size. */
export function monitorScale(cssWidth: number, ratio: AspectRatio): number {
  const factor = cssWidth / FRAMES[ratio].width;
  return Number.isFinite(factor) && factor > 0 ? factor : 0;
}

export const frameToCss = (p: Point, factor: number): Point => ({ x: p.x * factor, y: p.y * factor });
/** A factor of 0 gives points that are not finite, which every engine treats as "nothing to do". */
export const cssToFrame = (p: Point, factor: number): Point => ({ x: p.x / factor, y: p.y / factor });

/** Where a scene sits over the frame: scaled about the frame's centre by `scale`, then moved by (dx, dy). */
export interface Placement {
  scale: number;
  dx: number;
  dy: number;
}

export const RESTING: Placement = { scale: 1, dx: 0, dy: 0 };
const isResting = (p: Placement) => p.scale === 1 && p.dx === 0 && p.dy === 0;

/**
 * How renderFrame lays the scene `index` over the frame at scene-local time `local`: only the slide (the scene comes
 * in from the right) and zoom (it settles from 125 %) transitions move things; a fade or a wipe changes the pixels
 * but not where they are. Same formulas as renderFrame, which a test replays to keep them from drifting apart.
 */
export function transitionPlacement(project: MotionProject, index: number, local: number): Placement {
  const scene = project.scenes[index];
  if (!scene || index === 0) return RESTING;
  const tr = scene.transition;
  if (tr.type === "none" || !(local < tr.duration)) return RESTING;
  const p = ease("easeInOut", local / tr.duration);
  if (tr.type === "slide") return { scale: 1, dx: (1 - p) * FRAMES[project.ratio].width, dy: 0 };
  if (tr.type === "zoom") return { scale: 1.25 - 0.25 * p, dx: 0, dy: 0 };
  return RESTING;
}

export function placePoint(p: Point, placement: Placement, frame: Frame): Point {
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return { x: placement.scale * (p.x - cx) + cx + placement.dx, y: placement.scale * (p.y - cy) + cy + placement.dy };
}

export function unplacePoint(p: Point, placement: Placement, frame: Frame): Point {
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return { x: (p.x - placement.dx - cx) / placement.scale + cx, y: (p.y - placement.dy - cy) / placement.scale + cy };
}

/** A box of the scene as the screen shows it. */
export function placeBox(box: Box, placement: Placement, frame: Frame): Box {
  const centre = placePoint({ x: box.cx, y: box.cy }, placement, frame);
  return { ...box, cx: centre.x, cy: centre.y, w: box.w * placement.scale, h: box.h * placement.scale, scale: box.scale * placement.scale };
}

// ---------- measuring ----------

/** Real text metrics (render.ts measureLayer, on the player's canvas). Without one, defaultMeasure's estimate is used. */
export type TextMeasurer = (layer: TextLayer | CaptionsLayer, moment: MeasureMoment) => { w: number; h: number };

/** The Measure manipulate.ts wants, for one scene at one moment. */
export function measureAt(measurer: TextMeasurer | undefined, scene: MotionScene, local: number): Measure {
  return measurer ? (layer) => measurer(layer, { t: local, sceneDuration: scene.duration }) : defaultMeasure;
}

// ---------- picking ----------

/**
 * The topmost layer under the point (frame pixels of the scene), or null. Backdrop layers (the AI media, the dim
 * veil, anything covering the frame) are never picked: they would take every click on empty space. Unlike
 * manipulate.hitTest this does not fall back to the backdrop when nothing else is under the point.
 */
export function pickLayer(scene: MotionScene, ratio: AspectRatio, local: number, x: number, y: number, measure: Measure, margin = 0): string | null {
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i];
    if (isBackdropLayer(layer, ratio)) continue;
    const box = layerBox(layer, scene, local, measure);
    if (box && pointInBox(box, x, y, margin)) return layer.id;
  }
  return null;
}

/** pickLayer for a point of the monitor in CSS pixels, seen through the scene's transition; `slack` is in CSS pixels too. */
export function pickAt(project: MotionProject, index: number, local: number, css: Point, factor: number, measure: Measure, slack = 0): string | null {
  const scene = project.scenes[index];
  if (!scene || !(factor > 0)) return null;
  const placement = transitionPlacement(project, index, local);
  const p = unplacePoint(cssToFrame(css, factor), placement, FRAMES[project.ratio]);
  return pickLayer(scene, project.ratio, local, p.x, p.y, measure, slack / (factor * placement.scale));
}

// ---------- the selection frame ----------

export type SelectionView =
  /** Nothing to show: no selection, or it isn't in the scene under the playhead. */
  | { kind: "none" }
  /** The selected layer exists in this scene but isn't on screen at this instant. */
  | { kind: "hidden" }
  | {
      kind: "frame";
      index: number;
      /** Scene-local time of the playhead. */
      local: number;
      layer: Layer;
      /** The layer's box in the scene's own frame coordinates (what the engines take). */
      box: Box;
      placement: Placement;
      /** The same box as the screen shows it (differs from `box` while a slide or zoom transition plays). */
      screen: Box;
    };

const NONE: SelectionView = { kind: "none" };
const HIDDEN: SelectionView = { kind: "hidden" };

/** What the selection looks like at global time `t`. `measureFor` gives the Measure of a scene at a scene-local time. */
export function selectionView(project: MotionProject, selection: Selection | null, t: number, measureFor: (scene: MotionScene, local: number) => Measure): SelectionView {
  if (!selection) return NONE;
  const { index, local } = locate(project, t);
  const scene = project.scenes[index];
  if (!scene || scene.uid !== selection.scene) return NONE;
  const layer = scene.layers.find((l) => l.id === selection.layer);
  if (!layer) return NONE;
  const box = layerBox(layer, scene, local, measureFor(scene, local));
  if (!box) return HIDDEN;
  const placement = transitionPlacement(project, index, local);
  return { kind: "frame", index, local, layer, box, placement, screen: placeBox(box, placement, FRAMES[project.ratio]) };
}

/** The corners, in the order boxCorners gives them. */
export const CORNER_ORDER: readonly Corner[] = ["tl", "tr", "br", "bl"];

export interface FrameGeometry {
  /** CSS pixels, in CORNER_ORDER. */
  corners: [Point, Point, Point, Point];
  /** The middle of the top edge, where the stem to the rotation handle starts. */
  stemFrom: Point;
  rotate: Point;
}

/** Where the frame's corners and rotation handle are on screen for a box as the screen shows it. */
export function frameGeometry(screen: Box, factor: number): FrameGeometry {
  const css = (p: Point) => frameToCss(p, factor);
  const [tl, tr, br, bl] = boxCorners(screen);
  return {
    corners: [css(tl), css(tr), css(br), css(bl)],
    stemFrom: css({ x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 }),
    // The stem is as long on screen whatever the monitor's size, so its length is converted to frame pixels.
    rotate: css(rotateHandle(screen, ROTATE_STEM / factor)),
  };
}

const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;
/** Direction (degrees, clockwise on screen) of each corner from the centre of an unrotated box, folded to [0, 180). */
const CORNER_AXIS: Record<Corner, number> = { tl: 45, tr: 135, br: 45, bl: 135 };

/** The resize cursor that lines up with a corner of a box turned by `rotation` degrees. */
export function cornerCursor(corner: Corner, rotation: number): (typeof CURSORS)[number] {
  const axis = (((CORNER_AXIS[corner] + (Number.isFinite(rotation) ? rotation : 0)) % 180) + 180) % 180;
  return CURSORS[Math.round(axis / 45) % 4];
}

const whole = (v: number) => Math.round(v) + 0; // + 0 turns -0 into 0

/** "x 960 · y 540 · 100 % · 0°": the layer's own values at scene-local time `t`. */
export function formatReadout(layer: Layer, t: number): string {
  const rotation = Math.round(sampleAt(layer.rotation, t) * 10) / 10 + 0;
  return `x ${whole(sampleAt(layer.x, t))} · y ${whole(sampleAt(layer.y, t))} · ${whole(sampleAt(layer.scale, t) * 100)} % · ${rotation}°`;
}

const READOUT_CHAR = 6.2;
const READOUT_PAD = 14;
export const READOUT_HEIGHT = 20;
const EDGE = 4;

/**
 * Top-left of the readout label (CSS pixels): centred under the frame, or above it when there is no room below,
 * and always inside the monitor. The width is estimated from the number of characters (a mono face).
 */
export function readoutOrigin(corners: readonly Point[], chars: number, viewport: { w: number; h: number }): Point {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const width = chars * READOUT_CHAR + READOUT_PAD;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let y = Math.max(...ys) + 10;
  if (y + READOUT_HEIGHT > viewport.h - EDGE) y = Math.min(...ys) - 10 - READOUT_HEIGHT;
  return { x: clamp((Math.min(...xs) + Math.max(...xs)) / 2 - width / 2, EDGE, viewport.w - width - EDGE), y: clamp(y, EDGE, viewport.h - READOUT_HEIGHT - EDGE) };
}

// ---------- gestures ----------

export type GestureKind = { type: "move" } | { type: "resize"; corner: Corner } | { type: "rotate" };

/** A drag in progress. Built once when the pointer goes down; every move is computed from it, never from the previous move. */
export interface Gesture {
  kind: GestureKind;
  /** The project as it was when the drag began. */
  base: MotionProject;
  sceneIndex: number;
  layerId: string;
  /** Scene-local time keys are written at: the playhead on the frame grid. */
  t: number;
  /** The layer's box at `t`, in scene coordinates. */
  box: Box;
  placement: Placement;
  factor: number;
  /** Where the pointer went down, CSS pixels. */
  press: Point;
  /** For handles: how far from the handle's centre the press landed (scene frame pixels), so grabbing it off-centre doesn't jump. */
  grab: Point;
}

export interface GestureMods {
  /** Rotation snaps to 15 degrees. */
  shift: boolean;
  /** No magnetic guides. */
  alt: boolean;
}

/**
 * The time a gesture acts at, and the layer's box then. Keys are written on the frame grid and the engines want the
 * box at that same moment, so the playhead is snapped to a frame (or kept as it is if the layer is not drawn on that
 * frame, i.e. the playhead sits on the very edge of its window).
 */
function gestureMoment(layer: Layer, scene: MotionScene, local: number, measure: Measure): { t: number; box: Box } | null {
  for (const t of [snapToFrame(local), local]) {
    const box = layerBox(layer, scene, t, measure);
    if (box) return { t, box };
  }
  return null;
}

/** Starts a gesture on a layer of the scene under the playhead, or null when there is nothing to grab (layer gone or not drawn). */
export function beginGesture(args: {
  kind: GestureKind;
  project: MotionProject;
  sceneIndex: number;
  layerId: string;
  /** Scene-local time of the playhead. */
  local: number;
  measure: Measure;
  /** CSS pixels. */
  press: Point;
  factor: number;
}): Gesture | null {
  const { kind, project, sceneIndex, layerId, local, press, factor } = args;
  const scene = project.scenes[sceneIndex];
  const layer = scene?.layers.find((l) => l.id === layerId);
  if (!scene || !layer || !(factor > 0)) return null;
  const moment = gestureMoment(layer, scene, local, args.measure);
  if (!moment) return null;

  const placement = transitionPlacement(project, sceneIndex, local);
  const pressed = unplacePoint(cssToFrame(press, factor), placement, FRAMES[project.ratio]);
  let handle: Point | null = null;
  if (kind.type === "resize") handle = boxCorners(moment.box)[CORNER_ORDER.indexOf(kind.corner)];
  else if (kind.type === "rotate") handle = rotateHandle(moment.box, ROTATE_STEM / (factor * placement.scale));
  const grab = handle ? { x: pressed.x - handle.x, y: pressed.y - handle.y } : { x: 0, y: 0 };
  return { kind, base: project, sceneIndex, layerId, t: moment.t, box: moment.box, placement, factor, press, grab };
}

/** The project with scene `index` replaced; the very same project when the scene is the same one (no undo step for a no-op). */
export function replaceScene(project: MotionProject, index: number, scene: MotionScene): MotionProject {
  if (!project.scenes[index] || scene === project.scenes[index]) return project;
  return { ...project, scenes: project.scenes.map((s, i) => (i === index ? scene : s)) };
}

/** Whether the pointer has travelled far enough from where it went down for the press to be a drag. */
export const pastThreshold = (from: Point, to: Point, px = DRAG_PX): boolean => Math.hypot(to.x - from.x, to.y - from.y) >= px;

/**
 * The project after the pointer reaches `pointer` (CSS pixels) in `gesture`, plus the guide lines to draw. Always
 * computed from the project the drag began with: dragging back to the start returns that very project.
 */
export function stepGesture(gesture: Gesture, pointer: Point, mods: GestureMods): { project: MotionProject; guides: SnapGuide[] } {
  const { base, sceneIndex, layerId, t, box, placement, factor, grab } = gesture;
  const scene = base.scenes[sceneIndex];
  const frame = FRAMES[base.ratio];
  const toScene = (css: Point) => unplacePoint(cssToFrame(css, factor), placement, frame);
  const at = toScene(pointer);

  let next = scene;
  let guides: SnapGuide[] = [];
  switch (gesture.kind.type) {
    case "move": {
      const from = toScene(gesture.press);
      // The guide lines are the frame's, so they only mean something while the scene sits in its place.
      const move = snapMove(box, at.x - from.x, at.y - from.y, { frame, threshold: SNAP_PX / factor, disabled: mods.alt || !isResting(placement) });
      next = translateLayer(scene, layerId, t, move.dx, move.dy);
      guides = move.guides;
      break;
    }
    case "resize":
      next = resizeFromCorner(scene, layerId, t, box, gesture.kind.corner, at.x - grab.x, at.y - grab.y);
      break;
    case "rotate":
      next = rotateFromHandle(scene, layerId, t, box, at.x - grab.x, at.y - grab.y, mods.shift ? ROTATE_STEP : 0);
      break;
  }
  return { project: replaceScene(base, sceneIndex, next), guides };
}
