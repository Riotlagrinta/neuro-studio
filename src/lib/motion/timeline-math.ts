// Pure maths behind the timeline: where a dragged scene lands, how the view stays put while zooming, and the
// outline of the music envelope. The component only reads pointers and the DOM; every number comes from here.
// Lengths are in seconds unless a name says otherwise (pps = pixels per second, X = pixels).

import type { GainPoint } from "./audio-mix";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------- reordering scenes ----------

/** Pointer travel (px) under which a press on a scene block is a click; from there on it is a drag. */
export const DRAG_THRESHOLD = 4;

/** True once a press has travelled far enough to count as a drag (NaN never does). */
export const isDragMove = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_THRESHOLD;

const isScene = (durations: readonly number[], i: number) => Number.isInteger(i) && i >= 0 && i < durations.length;

/** Where scene `from` starts and ends, and how long the whole video is. Left-to-right sums, like sceneStart(). */
function extent(durations: readonly number[], from: number): { start: number; end: number; total: number } {
  let acc = 0;
  let start = 0;
  let end = 0;
  durations.forEach((d, i) => {
    if (i === from) start = acc;
    acc += d;
    if (i === from) end = acc;
  });
  return { start, end, total: acc };
}

/** `shift` (how far the pointer moved the block) limited so that the block stays inside the video. NaN means no move. */
export function clampSceneShift(durations: readonly number[], from: number, shift: number): number {
  if (!isScene(durations, from) || Number.isNaN(shift)) return 0;
  const { start, end, total } = extent(durations, from);
  if (!Number.isFinite(total)) return 0;
  return clamp(shift, -start, total - end);
}

/**
 * The index a scene ends up at when its block is dragged by `shift` seconds, to feed moveScene(project, from, index).
 *
 * `durations` is the layout AT DRAG START, whatever the live project looks like since: the block's centre is compared
 * with the midpoint of every OTHER block, and the answer is how many of them lie before it. That is exactly the index
 * moveScene() gives the scene. At shift 0 the answer is always `from` (ties go to the scene staying where it is), so
 * returning to the starting point restores the starting order.
 *
 * Pushing the block against an end of the video means the first / last position, even when the block is longer than its
 * neighbours and its centre could never reach their midpoints.
 */
export function sceneDropIndex(durations: readonly number[], from: number, shift: number): number {
  if (!isScene(durations, from)) return from;
  const { start, end, total } = extent(durations, from);
  if (!Number.isFinite(total)) return from;
  if (start > 0 && shift <= -start) return 0;
  if (total - end > 0 && shift >= total - end) return durations.length - 1;
  const centre = start + (end - start) / 2 + clampSceneShift(durations, from, shift);
  let before = 0;
  let acc = 0;
  durations.forEach((d, i) => {
    const mid = acc + d / 2;
    acc += d;
    if (i !== from && (i < from ? mid <= centre : mid < centre)) before++;
  });
  return before;
}

// ---------- zoom ----------

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

/** A zoom inside [ZOOM_MIN, ZOOM_MAX]; NaN is the fitted view. */
export const clampZoom = (zoom: number): number => (Number.isNaN(zoom) ? ZOOM_MIN : clamp(zoom, ZOOM_MIN, ZOOM_MAX));

/** px of wheel delta per line / per page, when the browser reports the wheel in those units. */
const LINE_PX = 16;
const PAGE_PX = 400;
/** One mouse-wheel notch (100 px) is about 20 %; a trackpad pinch sends many small deltas. */
const WHEEL_ZOOM_RATE = 0.002;
const MAX_WHEEL_DELTA = 150;

/** The factor a Ctrl/Cmd + wheel event multiplies the zoom by: wheel up (negative delta) zooms in. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
  if (!Number.isFinite(px)) return 1;
  return Math.exp(-clamp(px, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA) * WHEEL_ZOOM_RATE);
}

/**
 * The scrollLeft that keeps the instant under `anchorX` where it is when the scale goes from `oldPps` to `newPps`.
 * `anchorX` is measured from the left edge of the scroller (the sticky label column covers its first `labelW` px, so
 * an anchor over the labels counts as the left edge of the tracks). The result is not capped on the right: the
 * browser does that once the content is wide enough.
 */
export function zoomScrollLeft(scrollLeft: number, anchorX: number, labelW: number, oldPps: number, newPps: number): number {
  if (!(oldPps > 0) || !(newPps > 0) || !Number.isFinite(oldPps) || !Number.isFinite(newPps) || !Number.isFinite(scrollLeft) || !Number.isFinite(anchorX)) {
    return Math.max(0, scrollLeft || 0);
  }
  const anchor = Math.max(anchorX, labelW);
  const instant = (scrollLeft + anchor - labelW) / oldPps;
  return Math.max(0, instant * newPps + labelW - anchor);
}

/**
 * Where a zoom that wasn't started by the pointer is anchored (X from the scroller's left edge): on the playhead when
 * it is on screen, otherwise on the middle of the tracks.
 */
export function zoomAnchor(playheadX: number, labelW: number, viewportW: number): number {
  return playheadX >= labelW && playheadX <= viewportW ? playheadX : labelW + (viewportW - labelW) / 2;
}

// ---------- music envelope ----------

export interface GainShape {
  /** The gain curve as SVG points. */
  line: string;
  /** The same curve closed along the bottom edge, to fill it. */
  area: string;
}

const round = (v: number, scale: number) => Math.round(v * scale) / scale;

/**
 * SVG points for a gain curve (musicGainCurve) in a box `total` units wide and 1 unit high: x is the project time in
 * seconds, y = 0 is full gain (top) and y = 1 silence (bottom). Null when there is nothing to draw (no music, one
 * point, no duration). Points that aren't finite are skipped.
 */
export function gainShape(curve: readonly GainPoint[] | null, total: number): GainShape | null {
  if (!curve || !(total > 0) || !Number.isFinite(total)) return null;
  const points = curve.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.gain));
  if (points.length < 2) return null;
  const xs = points.map((p) => round(clamp(p.t, 0, total), 1000));
  const line = points.map((p, i) => `${xs[i]},${round(1 - clamp(p.gain, 0, 1), 10000)}`).join(" ");
  return { line, area: `${line} ${xs[xs.length - 1]},1 ${xs[0]},1` };
}
