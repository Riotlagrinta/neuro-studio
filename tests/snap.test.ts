import assert from "node:assert/strict";
import type { Box } from "../src/lib/motion/manipulate";
import { snapLines, snapMove, type SnapOptions } from "../src/lib/motion/snap";

let n = 0, failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };

// 16:9 frame: x lines at 0, 96, 192, 640, 960, 1280, 1728, 1824, 1920 and y lines at 0, 54, 108, 360, 540, 720, 972, 1026, 1080.
const FRAME = { width: 1920, height: 1080 };
const opts = (o: Partial<SnapOptions> = {}): SnapOptions => ({ frame: FRAME, threshold: 8, ...o });
const box = (o: Partial<Box> = {}): Box => ({ cx: 500, cy: 300, w: 200, h: 100, rotation: 0, scale: 1, ...o });
/** A box with no size: every edge and the centre are the same point, so the shift to a line is exact. */
const dot = (cx: number, cy: number): Box => box({ cx, cy, w: 0, h: 0 });

const near = (a: number, b: number, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const deepFreeze = <T,>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
const xs = (g: { axis: string; at: number }[]) => g.filter((x) => x.axis === "x").map((x) => x.at);
const ys = (g: { axis: string; at: number }[]) => g.filter((x) => x.axis === "y").map((x) => x.at);

console.log("snapLines");

test("edges, 5 % and 10 % margins, thirds and centre of an axis", () => {
  const lines = snapLines(1920);
  [0, 96, 192, 640, 960, 1280, 1728, 1824, 1920].forEach((v, i) => near(lines[i], v, 1e-9, `line ${i}`));
  assert.equal(lines.length, 9);
});

test("a portrait frame has its own lines, per axis", () => {
  near(snapLines(1080)[1], 54);
  near(snapLines(1920)[3], 640);
});

test("an axis with no usable length has no lines", () => {
  for (const bad of [0, -5, NaN, Infinity]) assert.deepEqual(snapLines(bad), []);
});

console.log("snapMove");

test("far from every line: the move is untouched and there are no guides", () => {
  const r = snapMove(box(), 20, -10, opts());
  assert.deepEqual(r, { dx: 20, dy: -10, guides: [] });
});

test("an edge or the centre within the threshold is pulled onto the line, and the line is reported", () => {
  // centre at 965, 5 px right of the centre line
  const r = snapMove(box({ cx: 965, w: 200 }), 0, -10, opts());
  near(r.dx, -5);
  assert.deepEqual(xs(r.guides), [960]);
  // the right edge of a 200 px box centred at 1215 is at 1315: 35 away from 1280, so no snap; at 1285 it is 5 away
  const edge = snapMove(box({ cx: 1185, w: 200 }), 0, -10, opts());
  near(edge.dx, -5, 1e-9, "right edge 1285 -> 1280");
  assert.ok(xs(edge.guides).includes(1280));
});

test("the move is measured from where the box is plus the requested delta", () => {
  // box centred at 900 asked to move 55: its centre would be at 955, 5 short of the centre line
  const r = snapMove(box({ cx: 900 }), 55, -10, opts());
  near(r.dx, 60);
});

test("with several lines in range, the nearest one wins", () => {
  // a point at 130 with a 60 px pull: 96 is 34 away, 192 is 62
  const r = snapMove(dot(130, 200), 0, 0, opts({ threshold: 60 }));
  near(r.dx, -34);
  assert.deepEqual(xs(r.guides), [96]);
  // and the other way round
  const s = snapMove(dot(170, 200), 0, 0, opts({ threshold: 60 }));
  near(s.dx, 22);
  assert.deepEqual(xs(s.guides), [192]);
});

test("the nearest of the box's three features wins, not the first", () => {
  // 200 wide centred at 400: left 300, centre 400, right 500. Moved by 144 the right edge reaches 644: 4 from the third at 640
  const r = snapMove(box({ cx: 400 }), 144, -10, opts());
  near(r.dx, 140);
  assert.deepEqual(xs(r.guides), [640]);
});

test("each axis snaps on its own", () => {
  const x = snapMove(dot(963, 200), 0, 0, opts());
  near(x.dx, -3);
  near(x.dy, 0);
  assert.deepEqual(ys(x.guides), []);

  const y = snapMove(dot(300, 545), 0, 0, opts());
  near(y.dx, 0);
  near(y.dy, -5);
  assert.deepEqual(xs(y.guides), []);
  assert.deepEqual(ys(y.guides), [540]);

  const both = snapMove(dot(963, 545), 0, 0, opts());
  near(both.dx, -3);
  near(both.dy, -5);
  assert.deepEqual(both.guides, [{ axis: "x", at: 960 }, { axis: "y", at: 540 }]);
});

test("every kind of line pulls: frame edges, 5 % and 10 % margins, thirds, centre, on both axes", () => {
  for (const line of snapLines(1920)) {
    for (const side of [-3, 3]) {
      const r = snapMove(dot(line + side, 200), 0, 0, opts());
      near(r.dx, -side, 1e-9, `x line ${line} from ${side}`);
      assert.ok(xs(r.guides).some((g) => Math.abs(g - line) < 1e-6), `guide on x ${line}`);
    }
  }
  for (const line of snapLines(1080)) {
    for (const side of [-3, 3]) {
      const r = snapMove(dot(300, line + side), 0, 0, opts());
      near(r.dy, -side, 1e-9, `y line ${line} from ${side}`);
      assert.ok(ys(r.guides).some((g) => Math.abs(g - line) < 1e-6), `guide on y ${line}`);
    }
  }
});

test("exactly at the threshold snaps, just beyond does not", () => {
  near(snapMove(dot(968, 200), 0, 0, opts()).dx, -8);
  near(snapMove(dot(968.01, 200), 0, 0, opts()).dx, 0);
});

test("a rotated box counts by its axis-aligned bounds", () => {
  // 100 x 100 turned 45 degrees spans +-70.71 around its centre: its left bound is 4 px from the frame edge
  const half = 50 * Math.SQRT2;
  const turned = box({ cx: half + 4, cy: 200, w: 100, h: 100, rotation: 45 });
  const r = snapMove(turned, 0, 0, opts());
  near(r.dx, -4, 1e-9, "snaps by its bound");
  assert.ok(xs(r.guides).includes(0));
  // the same box unturned has its edge 24.7 px from the line, out of reach
  const flat = snapMove({ ...turned, rotation: 0 }, 0, 0, opts());
  near(flat.dx, 0);
  // 90 degrees swaps the sides of a 200 x 100 box: it is 100 wide, 200 tall
  const upright = snapMove(box({ cx: 1000, cy: 540 - 100 - 6, w: 200, h: 100, rotation: 90 }), 0, 0, opts());
  near(upright.dy, 6, 1e-9, "its bottom bound at 534 goes to the centre line");
});

test("the threshold is in frame pixels: 8 screen px is more of the frame on a small monitor", () => {
  const gap = dot(960 + 12, 200);
  // a monitor at half size: 8 screen px = 16 frame px, so a 12 px gap snaps
  near(snapMove(gap, 0, 0, opts({ threshold: 8 / 0.5 })).dx, -12);
  // at double size 8 screen px = 4 frame px: it doesn't
  near(snapMove(gap, 0, 0, opts({ threshold: 8 / 2 })).dx, 0);
});

test("Alt (disabled) leaves the move exactly as asked, even right on a line", () => {
  const r = snapMove(dot(963, 545), 0, 0, opts({ disabled: true }));
  assert.deepEqual(r, { dx: 0, dy: 0, guides: [] });
  const moved = snapMove(dot(960, 540), 3.5, -2.25, opts({ disabled: true }));
  assert.deepEqual(moved, { dx: 3.5, dy: -2.25, guides: [] });
});

test("a box that is already on a line shows its guides without moving", () => {
  const r = snapMove(box({ cx: 960, cy: 540 }), 0, 0, opts());
  near(r.dx, 0);
  near(r.dy, 0);
  assert.deepEqual(r.guides, [{ axis: "x", at: 960 }, { axis: "y", at: 540 }]);
});

test("a box spanning the frame lights up its edges and centre", () => {
  const r = snapMove(box({ cx: 960, cy: 540, w: 1920, h: 1080 }), 3, -4, opts());
  near(r.dx, 0);
  near(r.dy, 0);
  assert.deepEqual(xs(r.guides), [0, 960, 1920]);
  assert.deepEqual(ys(r.guides), [0, 540, 1080]);
});

test("snapping is stable: asking again for the snapped move gives the same move", () => {
  for (const [cx, cy, dx, dy] of [[500, 300, 463, 241], [960, 540, 7, -6], [100, 100, 90, 60]]) {
    const first = snapMove(box({ cx, cy }), dx, dy, opts());
    const again = snapMove(box({ cx, cy }), first.dx, first.dy, opts());
    near(again.dx, first.dx, 1e-9);
    near(again.dy, first.dy, 1e-9);
  }
});

test("never mutates its arguments", () => {
  const b = deepFreeze(box({ rotation: 30 }));
  const o = deepFreeze(opts());
  snapMove(b, 12, 7, o);
});

test("a move far outside the frame still works and stays finite", () => {
  const r = snapMove(box(), 5000, -4000, opts());
  assert.ok(Number.isFinite(r.dx) && Number.isFinite(r.dy));
  near(r.dx, 5000);
  near(r.dy, -4000);
});

console.log("snapMove: degenerate input");

test("a box with no size, and a frame with no size", () => {
  for (const b of [dot(960, 540), box({ w: 0 }), box({ h: 0 }), box({ w: 0, h: 0, scale: 0 })]) {
    const r = snapMove(b, 3, 4, opts());
    assert.ok(Number.isFinite(r.dx) && Number.isFinite(r.dy));
  }
  const none = snapMove(box(), 3, 4, opts({ frame: { width: 0, height: 0 } }));
  assert.deepEqual(none, { dx: 3, dy: 4, guides: [] });
  const half = snapMove(dot(963, 545), 0, 0, opts({ frame: { width: 1920, height: NaN } }));
  near(half.dx, -3);
  near(half.dy, 0);
});

test("a box that is not finite gives the move back", () => {
  for (const b of [box({ cx: NaN }), box({ cy: Infinity }), box({ w: NaN }), box({ rotation: NaN }), box({ h: -Infinity })]) {
    assert.deepEqual(snapMove(b, 3, 4, opts()), { dx: 3, dy: 4, guides: [] });
  }
});

test("a move that is not finite becomes 0 on that axis", () => {
  const r = snapMove(box(), NaN, Infinity, opts());
  assert.deepEqual(r, { dx: 0, dy: 0, guides: [] });
  const half = snapMove(dot(963, 545), NaN, 0, opts());
  assert.ok(Number.isFinite(half.dx) && Number.isFinite(half.dy));
});

test("a threshold that is zero, negative, NaN or infinite does not snap", () => {
  for (const threshold of [0, -8, NaN, Infinity]) {
    assert.deepEqual(snapMove(dot(963, 545), 0, 0, opts({ threshold })), { dx: 0, dy: 0, guides: [] }, `threshold ${threshold}`);
  }
});

test("huge numbers don't overflow into NaN", () => {
  const r = snapMove(box({ cx: 1e300, w: 1e300 }), 1e308, -1e308, opts());
  assert.ok(Number.isFinite(r.dx) && Number.isFinite(r.dy));
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
