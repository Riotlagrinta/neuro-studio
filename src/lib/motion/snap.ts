// Magnetic guides while a layer is dragged in the monitor. Pure maths over FRAME pixels (the 1920x1080 /
// 1080x1920 virtual frame): the box's edges and centre are pulled onto the lines an editor lines things up with.
// Those lines are the ones the safe-zone toggle draws (5 % and 10 % margins, the centre cross) plus the frame
// edges and the thirds.

import { boxCorners, type Box } from "./manipulate";

export interface SnapGuide {
  /** "x" is a vertical line at x, "y" a horizontal line at y. */
  axis: "x" | "y";
  /** Frame pixels. */
  at: number;
}

export interface SnapOptions {
  frame: { width: number; height: number };
  /** How close, in FRAME pixels, an edge has to come to a line to be pulled onto it (8 screen px is 8 / factor). */
  threshold: number;
  /** Alt held: the layer follows the pointer exactly. */
  disabled?: boolean;
}

export interface SnapResult {
  /** The move to apply, pulled onto the nearest line on each axis. */
  dx: number;
  dy: number;
  /** Every line the box ends up on. */
  guides: SnapGuide[];
}

/** Where the lines sit along an axis, as a fraction of its length. */
const LINES = [0, 0.05, 0.1, 1 / 3, 0.5, 2 / 3, 0.9, 0.95, 1];
/** Two positions closer than this are the same line (float error). */
const ON_LINE = 1e-3;

/** The positions the box is attracted to along an axis of the given length; none for a length that is not usable. */
export function snapLines(length: number): number[] {
  return Number.isFinite(length) && length > 0 ? LINES.map((fraction) => fraction * length) : [];
}

const finiteOr0 = (v: number) => (Number.isFinite(v) ? v : 0);

/**
 * Moves one axis by `delta`, pulling whichever of the box's `features` (low edge, centre, high edge) is nearest to a
 * line onto it, when that is within `threshold`.
 */
function snapAxis(features: readonly number[], delta: number, lines: readonly number[], threshold: number): { delta: number; at: number[] } {
  let shift = 0;
  let nearest = Infinity;
  for (const feature of features) {
    for (const line of lines) {
      const gap = line - (feature + delta);
      if (Math.abs(gap) < nearest) {
        nearest = Math.abs(gap);
        shift = gap;
      }
    }
  }
  const snapped = nearest <= threshold ? delta + shift : delta;
  return { delta: snapped, at: lines.filter((line) => features.some((feature) => Math.abs(feature + snapped - line) <= ON_LINE)) };
}

/**
 * Where to move `box` when the pointer asks for (dx, dy): the same move, corrected so the box's edges or centre sit
 * on the nearest line within `threshold` on each axis, independently. A rotated box counts by its axis-aligned
 * bounds (what an editor shows as its outline). `disabled`, a threshold that is not a positive finite number, or a
 * box that is not finite give the move back untouched. The result is always finite.
 */
export function snapMove(box: Box, dx: number, dy: number, options: SnapOptions): SnapResult {
  const move = { dx: finiteOr0(dx), dy: finiteOr0(dy), guides: [] as SnapGuide[] };
  const { frame, threshold } = options;
  if (options.disabled || !(threshold > 0) || !Number.isFinite(threshold)) return move;

  const corners = boxCorners(box);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  if (![...xs, ...ys].every(Number.isFinite)) return move;
  const features = (values: number[]) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    return [low, (low + high) / 2, high];
  };

  const x = snapAxis(features(xs), move.dx, snapLines(frame.width), threshold);
  const y = snapAxis(features(ys), move.dy, snapLines(frame.height), threshold);
  return {
    dx: x.delta,
    dy: y.delta,
    guides: [...x.at.map((at): SnapGuide => ({ axis: "x", at })), ...y.at.map((at): SnapGuide => ({ axis: "y", at }))],
  };
}
