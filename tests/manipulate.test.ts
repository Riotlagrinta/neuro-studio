import assert from "node:assert/strict";
import { sample } from "../src/lib/motion/easing";
import {
  boxCorners,
  defaultMeasure,
  hitTest,
  layerBox,
  pointInBox,
  resizeFromCorner,
  rotateFromHandle,
  rotateHandle,
  rotateLayer,
  sampleAt,
  scaleLayer,
  setTrackAt,
  translateLayer,
  type Box,
  type Corner,
  type Measure,
  type Point,
} from "../src/lib/motion/manipulate";
import { renderFrame, SYSTEM_FONTS } from "../src/lib/motion/render";
import type { Anchor, CaptionsLayer, EllipseLayer, Keyframe, Layer, MediaLayer, MotionScene, RectLayer, TextLayer, Track } from "../src/lib/motion/types";

let n = 0, failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };

// ---------- fixtures ----------

const common = { start: 0, end: null as number | null, x: 960, y: 540, rotation: 0, scale: 1, opacity: 1 };
const rect = (o: Partial<RectLayer> = {}): RectLayer => ({ id: "rect", type: "rect", ...common, w: 400, h: 200, radius: 0, fill: "#fff", stroke: null, strokeWidth: 0, anchor: "center", ...o });
const ellipse = (o: Partial<EllipseLayer> = {}): EllipseLayer => ({ id: "ellipse", type: "ellipse", ...common, w: 400, h: 200, fill: "#fff", stroke: null, strokeWidth: 0, anchor: "center", ...o });
const media = (o: Partial<MediaLayer> = {}): MediaLayer => ({ id: "media", type: "media", ...common, w: 1920, h: 1080, anchor: "center", ...o });
const text = (o: Partial<TextLayer> = {}): TextLayer => ({ id: "text", type: "text", ...common, text: "Hello world", size: 60, weight: 700, color: "#fff", font: "sans", align: "center", maxWidth: 1000, lineHeight: 1.2, letterSpacing: 0, reveal: "none", revealDuration: 0.8, ...o });
const captions = (o: Partial<CaptionsLayer> = {}): CaptionsLayer => ({ id: "captions", type: "captions", ...common, text: "Bonjour tout le monde", style: "karaoke", size: 60, weight: 800, font: "sans", color: "#fff", highlight: "#fbbf24", uppercase: false, maxWidth: 1536, lineHeight: 1.25, ...o });
const sceneOf = (...layers: Layer[]): MotionScene => ({
  uid: "scene-uid", id: 1, voiceOver: "", visualPrompt: "", duration: 10,
  background: { type: "solid", color: "#000000" }, transition: { type: "none", duration: 0.5 }, layers,
});
/** Block size from the text length only, so the expected numbers are easy to reason about. */
const fake: Measure = (l) => ({ w: l.text.length * 10, h: l.size * l.lineHeight });

const ANCHORS: Anchor[] = ["center", "left", "right", "top", "bottom"];
const CORNERS: Corner[] = ["tl", "tr", "br", "bl"];
const ROTATIONS = [0, 30, 90, -45, 137, 200, -170];
const first = (s: MotionScene) => s.layers[0];

const near = (a: number, b: number, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a} (tolerance ${tol})`);
const nearPoint = (p: Point, x: number, y: number, tol = 1e-9, msg = "") => { near(p.x, x, tol, `${msg} x:`); near(p.y, y, tol, `${msg} y:`); };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const deepFreeze = <T,>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
const numbersIn = (v: unknown): number[] => (typeof v === "number" ? [v] : Array.isArray(v) ? v.flatMap(numbersIn) : v && typeof v === "object" ? Object.values(v).flatMap(numbersIn) : []);
const boxOf = (layer: Layer, t = 1, measure: Measure = defaultMeasure) => { const b = layerBox(layer, sceneOf(layer), t, measure); assert.ok(b, "layer should be visible"); return b; };
const keys = (track: Track): Keyframe[] => { assert.ok(Array.isArray(track), "expected keyframes"); return track; };

// ---------- the real renderer, recorded ----------
// A fake canvas that tracks the transform and records the shapes drawn. Comparing the engine with what
// renderFrame really draws is what keeps the boxes honest if the renderer's geometry ever changes.

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, k: Matrix): Matrix => [
  m[0] * k[0] + m[2] * k[1], m[1] * k[0] + m[3] * k[1],
  m[0] * k[2] + m[2] * k[3], m[1] * k[2] + m[3] * k[3],
  m[0] * k[4] + m[2] * k[5] + m[4], m[1] * k[4] + m[3] * k[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
interface Call { kind: "rect" | "ellipse" | "text"; args: number[]; m: Matrix }

function record(scene: MotionScene, time: number): Call[] {
  const calls: Call[] = [];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    save: () => { stack.push(m); },
    restore: () => { m = stack.pop() ?? m; },
    setTransform: (...a: number[]) => { m = a as Matrix; },
    translate: (x: number, y: number) => { m = mul(m, [1, 0, 0, 1, x, y]); },
    rotate: (r: number) => { m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]); },
    scale: (x: number, y: number) => { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rect: (...args: number[]) => { calls.push({ kind: "rect", args, m }); },
    ellipse: (...args: number[]) => { calls.push({ kind: "ellipse", args, m }); },
    fillText: (_s: string, x: number, y: number) => { calls.push({ kind: "text", args: [x, y], m }); },
    measureText: (s: string) => ({ width: s.length * 10 }),
  };
  const ctx = new Proxy(target, { get: (o, p) => (p in o ? o[p as string] : () => undefined), set: (o, p, v) => { o[p as string] = v; return true; } });
  const backdrop = () => ({ width: 100, height: 100 }) as unknown as CanvasImageSource;
  renderFrame(ctx as unknown as CanvasRenderingContext2D, { title: "t", category: "c", ratio: "16:9", palette: [], scenes: [scene] }, time, backdrop, SYSTEM_FONTS);
  return calls;
}

/** Corners of a layer-space rectangle on the frame, in the order tl, tr, br, bl. */
function frameCorners(m: Matrix, x: number, y: number, w: number, h: number): Point[] {
  return [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)];
}

/** What renderFrame draws for a rect / ellipse / media layer: the last shape it fills in layer space. */
function drawnShape(layer: Layer, time = 1): Point[] {
  const shapes = record(sceneOf(layer), time).filter((c) => c.kind !== "text");
  const c = shapes[shapes.length - 1];
  assert.ok(shapes.length >= 2, "the layer should have been drawn (the first rect is the scene clip)");
  if (c.kind === "ellipse") return frameCorners(c.m, c.args[0] - c.args[2], c.args[1] - c.args[3], 2 * c.args[2], 2 * c.args[3]);
  return frameCorners(c.m, c.args[0], c.args[1], c.args[2], c.args[3]);
}
const wasDrawn = (layer: Layer, time = 1) => record(sceneOf(layer), time).filter((c) => c.kind !== "text").length >= 2;

console.log("layerBox");

test("rect: centre anchor puts the box around (x, y)", () => {
  const b = boxOf(rect());
  assert.deepEqual(b, { cx: 960, cy: 540, w: 400, h: 200, rotation: 0, scale: 1 });
});

test("rect / ellipse / media: every anchor, by hand (the point (x, y) is the middle of that edge)", () => {
  const expected: Record<Anchor, [number, number]> = { center: [960, 540], left: [1160, 540], right: [760, 540], top: [960, 640], bottom: [960, 440] };
  for (const anchor of ANCHORS) {
    for (const layer of [rect({ anchor }), ellipse({ anchor }), media({ anchor, w: 400, h: 200 })]) {
      const b = boxOf(layer);
      assert.deepEqual([b.cx, b.cy, b.w, b.h], [...expected[anchor], 400, 200], `${layer.type} ${anchor}`);
    }
  }
});

test("scale multiplies the size and the anchor offset around (x, y)", () => {
  const b = boxOf(rect({ anchor: "left", scale: 2 }));
  assert.deepEqual([b.cx, b.cy, b.w, b.h, b.scale], [960 + 400, 540, 800, 400, 2]);
  const t = boxOf(rect({ anchor: "bottom", scale: 0.5 }));
  assert.deepEqual([t.cx, t.cy, t.w, t.h], [960, 540 - 50, 200, 100]);
});

test("rotation turns the box about (x, y), clockwise: a left-anchored box swings below the point at 90 degrees", () => {
  const b = boxOf(rect({ anchor: "left", rotation: 90 }));
  nearPoint({ x: b.cx, y: b.cy }, 960, 540 + 200);
  assert.equal(b.rotation, 90);
  const c = boxOf(rect({ anchor: "top", rotation: 180 }));
  nearPoint({ x: c.cx, y: c.cy }, 960, 540 - 100);
});

test("matches renderFrame exactly: rect, ellipse and media at every anchor, scale and rotation", () => {
  const poses: [number, number][] = [[1, 0], [2, 0], [0.5, 30], [1.5, -75], [1, 90], [3, 200], [0.25, -170]];
  type Shape = { anchor: Anchor; scale: number; rotation: number; x: number; y: number; w: number; h: number };
  const makers: ((o: Shape) => Layer)[] = [(o) => rect(o), (o) => ellipse(o), (o) => media(o)];
  for (const make of makers) {
    for (const anchor of ANCHORS) {
      for (const [scale, rotation] of poses) {
        const layer = make({ anchor, scale, rotation, x: 700, y: 400, w: 300, h: 120 });
        const got = boxCorners(boxOf(layer));
        const want = drawnShape(layer);
        got.forEach((p, i) => nearPoint(p, want[i].x, want[i].y, 1e-6, `${layer.type} ${anchor} scale ${scale} rot ${rotation} corner ${i}`));
      }
    }
  }
});

test("matches renderFrame with animated tracks (position, size, scale, rotation sampled at t)", () => {
  const layer = rect({
    anchor: "right",
    x: [{ t: 0, v: 100 }, { t: 2, v: 900, ease: "easeOut" }],
    y: [{ t: 0, v: 300 }, { t: 2, v: 500 }],
    w: [{ t: 0, v: 100 }, { t: 2, v: 500, ease: "linear" }],
    h: 160,
    rotation: [{ t: 0, v: 0 }, { t: 2, v: 80, ease: "backOut" }],
    scale: [{ t: 0, v: 1 }, { t: 2, v: 2, ease: "linear" }],
  });
  for (const time of [0.3, 1, 1.7]) {
    const got = boxCorners(boxOf(layer, time));
    const want = drawnShape(layer, time);
    got.forEach((p, i) => nearPoint(p, want[i].x, want[i].y, 1e-6, `t=${time} corner ${i}`));
  }
});

test("text: the block is centred, or starts at / ends at the point according to align (fake measure: 110 x 72)", () => {
  const w = "Hello world".length * 10;
  assert.equal(w, 110);
  const center = boxOf(text(), 1, fake);
  assert.deepEqual([center.cx, center.cy, center.w, center.h], [960, 540, 110, 72]);
  assert.deepEqual([boxOf(text({ align: "left" }), 1, fake).cx, boxOf(text({ align: "right" }), 1, fake).cx], [960 + 55, 960 - 55]);
  const big = boxOf(text({ align: "left", scale: 2 }), 1, fake);
  assert.deepEqual([big.cx, big.w, big.h], [960 + 110, 220, 144], "scale applies to the block and to its offset");
  const turned = boxOf(text({ align: "left", rotation: 90 }), 1, fake);
  nearPoint({ x: turned.cx, y: turned.cy }, 960, 540 + 55);
});

test("text matches renderFrame for every align, with scale and rotation", () => {
  const measure: Measure = (l) => ({ w: l.text.length * 10, h: l.size * l.lineHeight });
  for (const align of ["left", "center", "right"] as const) {
    for (const [scale, rotation] of [[1, 0], [1.5, 30], [0.7, -120]]) {
      const layer = text({ text: "Hello", align, scale, rotation, x: 800, y: 300 });
      const drawn = record(sceneOf(layer), 1).find((c) => c.kind === "text");
      assert.ok(drawn, "text should have been drawn");
      const [x0, y0] = drawn.args;
      const lh = layer.size * layer.lineHeight;
      const want = frameCorners(drawn.m, x0, y0 - lh / 2, 50, lh);
      boxCorners(boxOf(layer, 1, measure)).forEach((p, i) => nearPoint(p, want[i].x, want[i].y, 1e-6, `${align} scale ${scale} rot ${rotation} corner ${i}`));
    }
  }
});

test("captions are always centred on the point", () => {
  const b = boxOf(captions({ x: 500, y: 800, scale: 2 }), 1, fake);
  assert.deepEqual([b.cx, b.cy, b.w, b.h], [500, 800, 21 * 10 * 2, 75 * 2]);
});

test("the measure is only asked for text and captions", () => {
  const asked: string[] = [];
  const spy: Measure = (l) => { asked.push(l.type); return { w: 10, h: 10 }; };
  const scene = sceneOf(rect(), text(), captions(), media(), ellipse());
  scene.layers.forEach((l) => layerBox(l, scene, 1, spy));
  assert.deepEqual(asked, ["text", "captions"]);
});

console.log("layerBox: visibility");

test("window edges: hidden before start, visible from start to end inclusive, hidden after", () => {
  const layer = rect({ start: 1, end: 3 });
  const scene = sceneOf(layer);
  assert.equal(layerBox(layer, scene, 0.99), null);
  assert.ok(layerBox(layer, scene, 1));
  assert.ok(layerBox(layer, scene, 3));
  assert.equal(layerBox(layer, scene, 3.01), null);
});

test("an open end lasts until the scene ends, and not a moment longer", () => {
  const layer = rect({ start: 2, end: null });
  const scene = sceneOf(layer);
  assert.ok(layerBox(layer, scene, 10));
  assert.equal(layerBox(layer, scene, 10.01), null);
  assert.equal(layerBox(layer, scene, 1.99), null);
});

test("transparent or scaled to nothing: no box (same thresholds as the renderer)", () => {
  const scene = sceneOf(rect());
  assert.equal(layerBox(rect({ opacity: 0 }), scene, 1), null);
  assert.equal(layerBox(rect({ scale: 0 }), scene, 1), null);
  assert.equal(layerBox(rect({ scale: -1 }), scene, 1), null);
  assert.ok(layerBox(rect({ opacity: 0.01 }), scene, 1));
  assert.ok(layerBox(rect({ scale: 0.01 }), scene, 1));
});

test("visibility agrees with what renderFrame draws, for windows, opacities and scales", () => {
  const cases: Partial<RectLayer>[] = [
    { start: 1.01 }, { start: 1 }, { start: 0.5, end: 0.99 }, { end: 1 }, { end: null },
    { opacity: 0 }, { opacity: 0.0005 }, { opacity: 0.001 }, { opacity: 0.002 }, { opacity: 1 },
    { scale: 0 }, { scale: 0.0005 }, { scale: 0.001 }, { scale: 0.002 }, { scale: -2 }, { scale: 1 },
    { opacity: [{ t: 0, v: 0 }, { t: 2, v: 1 }] }, { opacity: [{ t: 0, v: 0 }, { t: 1, v: 0 }, { t: 2, v: 1 }] },
  ];
  for (const c of cases) {
    const layer = rect(c);
    assert.equal(layerBox(layer, sceneOf(layer), 1) !== null, wasDrawn(layer), JSON.stringify(c));
  }
});

test("an animated opacity or scale decides visibility at that moment", () => {
  const layer = rect({ opacity: [{ t: 0, v: 0 }, { t: 1, v: 0 }, { t: 2, v: 1 }], scale: [{ t: 0, v: 0 }, { t: 2, v: 1, ease: "linear" }] });
  const scene = sceneOf(layer);
  assert.equal(layerBox(layer, scene, 0.5), null, "opacity still 0");
  assert.equal(layerBox(layer, scene, 1), null, "opacity 0 and scale 0.5");
  assert.ok(layerBox(layer, scene, 1.5));
});

test("non-finite values give no box rather than a NaN one", () => {
  const scene = sceneOf(rect());
  assert.equal(layerBox(rect(), scene, NaN), null);
  assert.equal(layerBox(rect(), scene, Infinity), null);
  assert.equal(layerBox(rect({ x: NaN }), scene, 1), null);
  assert.equal(layerBox(rect({ w: Infinity }), scene, 1), null);
  assert.equal(layerBox(rect({ rotation: NaN }), scene, 1), null);
  assert.equal(layerBox(text(), sceneOf(text()), 1, () => ({ w: NaN, h: 10 })), null);
});

console.log("defaultMeasure");

test("one line: half the font size per character, one line tall", () => {
  assert.deepEqual(defaultMeasure(text({ text: "Hello", size: 60, lineHeight: 1.2 })), { w: 150, h: 72 });
  assert.deepEqual(defaultMeasure(text({ text: "" })), { w: 0, h: 72 }, "empty text still has a line");
});

test("wraps at maxWidth: width is capped, lines = ceil(natural width / maxWidth)", () => {
  const long = defaultMeasure(text({ text: "x".repeat(100), size: 60, maxWidth: 1000, lineHeight: 1.2 }));
  assert.deepEqual(long, { w: 1000, h: 3 * 72 });
  assert.deepEqual(defaultMeasure(text({ text: "x".repeat(34), size: 60, maxWidth: 1000 })), { w: 1000, h: 2 * 72 }, "1020 > 1000: two lines");
  assert.deepEqual(defaultMeasure(text({ text: "x".repeat(33), size: 60, maxWidth: 1000 })), { w: 990, h: 72 });
});

test("explicit line breaks add lines; the widest paragraph sets the width; whitespace runs collapse like in the renderer", () => {
  assert.deepEqual(defaultMeasure(text({ text: "ab\ncdef\n\ngh", size: 20, lineHeight: 1 })), { w: 40, h: 4 * 20 });
  assert.deepEqual(defaultMeasure(text({ text: "  a    b  ", size: 20, lineHeight: 1 })), { w: 30, h: 20 });
});

test("captions are sized for one page (their first four words), not the whole narration", () => {
  const narration = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(" ");
  const m = defaultMeasure(captions({ text: narration, size: 60, lineHeight: 1.25, maxWidth: 1536 }));
  assert.deepEqual(m, { w: "mot0 mot1 mot2 mot3".length * 30, h: 75 });
});

test("a box from the default measure is finite and positive for any sanitized text", () => {
  for (const l of [text({ text: "a" }), text({ text: "mot ".repeat(200), maxWidth: 50 }), captions({ text: "x" })]) {
    const m = defaultMeasure(l);
    assert.ok(m.w > 0 && m.h > 0 && Number.isFinite(m.w) && Number.isFinite(m.h));
  }
});

console.log("boxCorners / rotateHandle / pointInBox");

const unit: Box = { cx: 100, cy: 100, w: 40, h: 20, rotation: 0, scale: 1 };

test("corners come as tl, tr, br, bl", () => {
  const [tl, tr, br, bl] = boxCorners(unit);
  assert.deepEqual([tl, tr, br, bl], [{ x: 80, y: 90 }, { x: 120, y: 90 }, { x: 120, y: 110 }, { x: 80, y: 110 }]);
});

test("corners turn clockwise with the rotation: at 90 degrees the top-left goes to the top-right", () => {
  const [tl, tr, br, bl] = boxCorners({ ...unit, rotation: 90 });
  nearPoint(tl, 110, 80);
  nearPoint(tr, 110, 120);
  nearPoint(br, 90, 120);
  nearPoint(bl, 90, 80);
});

test("rotated corners stay at the same distance from the centre", () => {
  for (const r of ROTATIONS) boxCorners({ ...unit, rotation: r }).forEach((p) => near(Math.hypot(p.x - 100, p.y - 100), Math.hypot(20, 10), 1e-9));
});

test("rotate handle: 40 px above the middle of the top edge by default, following the rotation", () => {
  nearPoint(rotateHandle(unit), 100, 100 - 10 - 40);
  nearPoint(rotateHandle(unit, 25), 100, 100 - 10 - 25);
  nearPoint(rotateHandle({ ...unit, rotation: 90 }), 100 + 10 + 40, 100);
  nearPoint(rotateHandle({ ...unit, rotation: 180 }), 100, 100 + 10 + 40);
  const h = rotateHandle({ ...unit, rotation: 37 });
  near(Math.hypot(h.x - 100, h.y - 100), 50, 1e-9);
});

test("rotate handle: a distance that is not finite falls back to the default", () => {
  for (const d of [NaN, Infinity, -Infinity]) nearPoint(rotateHandle(unit, d), 100, 50);
});

test("pointInBox: inside, outside, edges count", () => {
  assert.ok(pointInBox(unit, 100, 100));
  assert.ok(pointInBox(unit, 80, 90), "a corner");
  assert.ok(pointInBox(unit, 120, 100), "an edge");
  assert.ok(!pointInBox(unit, 120.01, 100));
  assert.ok(!pointInBox(unit, 100, 89.99));
});

test("pointInBox: a rotated box is not its axis-aligned bounds", () => {
  const diamond: Box = { cx: 0, cy: 0, w: 200, h: 20, rotation: 45, scale: 1 };
  assert.ok(pointInBox(diamond, 70, 70), "along the long axis");
  assert.ok(!pointInBox(diamond, 70, -70), "across it: inside the bounding square, outside the box");
  assert.ok(pointInBox({ ...diamond, rotation: 0 }, 70, 0));
  assert.ok(!pointInBox({ ...diamond, rotation: 90 }, 70, 0));
  assert.ok(pointInBox({ ...diamond, rotation: 90 }, 0, 70));
});

test("pointInBox: margin widens every side, in frame pixels", () => {
  assert.ok(!pointInBox(unit, 125, 100));
  assert.ok(pointInBox(unit, 125, 100, 5));
  assert.ok(!pointInBox(unit, 125.01, 100, 5));
  assert.ok(pointInBox(unit, 100, 114, 5), "also vertically");
  const turned: Box = { ...unit, rotation: 90 };
  assert.ok(pointInBox(turned, 100, 124, 5), "turned a quarter, the box is 40 tall: its half is 20, plus the margin");
  assert.ok(!pointInBox(turned, 100, 126, 5));
});

test("pointInBox: non-finite point or margin is simply a miss", () => {
  assert.ok(!pointInBox(unit, NaN, 100));
  assert.ok(!pointInBox(unit, 100, Infinity));
  assert.ok(!pointInBox(unit, 100, 100, NaN));
});

console.log("hitTest");

test("the topmost layer wins where boxes overlap (later in the list is drawn on top)", () => {
  const scene = sceneOf(rect({ id: "a" }), rect({ id: "b", x: 1060 }));
  assert.equal(hitTest(scene, 1, 1000, 540), "b");
  assert.equal(hitTest(scene, 1, 800, 540), "a", "only a is there");
  assert.equal(hitTest(scene, 1, 1200, 540), "b");
  assert.equal(hitTest(sceneOf(rect({ id: "b", x: 1060 }), rect({ id: "a" })), 1, 1000, 540), "a", "swap the order, swap the winner");
});

test("a media layer is picked only when nothing else is under the point, whatever its position in the list", () => {
  const behind = sceneOf(media(), rect({ id: "a" }));
  assert.equal(hitTest(behind, 1, 960, 540), "a");
  assert.equal(hitTest(behind, 1, 50, 50), "media");
  const inFront = sceneOf(rect({ id: "a" }), media());
  assert.equal(hitTest(inFront, 1, 960, 540), "a", "even drawn above, the backdrop doesn't steal the click");
  assert.equal(hitTest(inFront, 1, 50, 50), "media");
});

test("several media layers: the topmost one", () => {
  const scene = sceneOf(media({ id: "m1" }), media({ id: "m2", w: 400, h: 400 }));
  assert.equal(hitTest(scene, 1, 960, 540), "m2");
  assert.equal(hitTest(scene, 1, 100, 100), "m1");
});

test("text and captions are hit through the injected measure", () => {
  const scene = sceneOf(text({ x: 300, y: 200 }), captions({ x: 960, y: 900 }));
  assert.equal(hitTest(scene, 1, 300 + 54, 200, fake), "text", "inside the 110 px block");
  assert.equal(hitTest(scene, 1, 300 + 56, 200, fake), null);
  assert.equal(hitTest(scene, 1, 960, 900 + 30, fake), "captions");
  assert.equal(hitTest(scene, 1, 300 + 56, 200, () => ({ w: 400, h: 100 })), "text", "a different measure, a different box");
});

test("rotated boxes: hit along their own axes, miss in the corners of their bounding square", () => {
  const scene = sceneOf(rect({ rotation: 45 }));
  assert.equal(hitTest(scene, 1, 1060, 640), "rect", "on the long axis, 141 px from the centre");
  assert.equal(hitTest(scene, 1, 1160, 540), null, "inside the unrotated box's extent but off the rotated one");
  assert.equal(hitTest(scene, 1, 1060, 440), null);
});

test("layers not visible at t are not hit", () => {
  const scene = sceneOf(rect({ id: "a" }), rect({ id: "b", start: 2, end: 4 }), rect({ id: "c", opacity: 0 }));
  assert.equal(hitTest(scene, 1, 960, 540), "a");
  assert.equal(hitTest(scene, 3, 960, 540), "b");
  assert.equal(hitTest(scene, 5, 960, 540), "a");
});

test("misses give null; so does an empty scene", () => {
  const scene = sceneOf(rect());
  assert.equal(hitTest(scene, 1, 10, 10), null);
  assert.equal(hitTest(scene, 1, 1161, 540), null);
  assert.equal(hitTest(sceneOf(), 1, 960, 540), null);
});

test("margin turns near misses into hits, and the topmost still wins", () => {
  const scene = sceneOf(rect({ id: "a" }), rect({ id: "b", x: 1400 }));
  assert.equal(hitTest(scene, 1, 1165, 540), null);
  assert.equal(hitTest(scene, 1, 1165, 540, undefined, 10), "a");
  assert.equal(hitTest(scene, 1, 1170, 540, undefined, 40), "b", "the point is within 40 px of both: b is on top");
  assert.equal(hitTest(scene, 1, 1170, 540, undefined, 5), null);
});

test("non-finite coordinates, time or margin hit nothing", () => {
  const scene = sceneOf(rect(), media());
  assert.equal(hitTest(scene, 1, NaN, 540), null);
  assert.equal(hitTest(scene, 1, 960, Infinity), null);
  assert.equal(hitTest(scene, NaN, 960, 540), null);
  assert.equal(hitTest(scene, 1, 960, 540, undefined, NaN), null);
});

console.log("setTrackAt");

const K: Keyframe[] = [{ t: 0, v: 0 }, { t: 1, v: 100, ease: "easeOut" }, { t: 2, v: 200, ease: "linear" }];

test("a plain number stays a plain number and takes the new value", () => {
  assert.equal(setTrackAt(5, 1, 7), 7);
  assert.equal(setTrackAt(5, 99, 7), 7, "time is irrelevant for a static value");
});

test("values are rounded to two decimals; -0 never appears", () => {
  assert.equal(setTrackAt(5, 1, 7.126), 7.13);
  assert.equal(setTrackAt(5, 1, 7.124), 7.12);
  assert.ok(Object.is(setTrackAt(5, 1, -0.001), 0));
  assert.equal(keys(setTrackAt(K, 0.5, 30.456))[1].v, 30.46);
});

test("the number of decimals can be raised (scales are kept to three)", () => {
  assert.equal(setTrackAt(1, 0, 1.23456, undefined, 3), 1.235);
  assert.equal(keys(setTrackAt(K, 0.5, 1.23456, undefined, 3))[1].v, 1.235);
});

test("a value that is already there returns the very same track", () => {
  assert.equal(setTrackAt(K, 1, 100), K, "on the key");
  assert.equal(setTrackAt(K, 1, 100.0000001), K, "within 1e-6");
  assert.equal(setTrackAt(K, 1, 100, "easeOut"), K, "same ease too");
  const odd: Keyframe[] = [{ t: 0, v: 10.123456 }, { t: 1, v: 20 }];
  assert.equal(setTrackAt(odd, 0, 10.123456), odd, "a value with more decimals than we keep, set back unchanged");
  assert.equal(setTrackAt(7, 3, 7.004), 7, "a plain number that rounds to itself");
  assert.equal(setTrackAt(K, NaN, 5), K);
});

test("between keys a key is written even at the value the curve already gives there: that pins the pose", () => {
  const pinned = keys(setTrackAt(K, 1.5, sampleAt(K, 1.5)));
  assert.deepEqual(pinned.map((k) => [k.t, k.v]), [[0, 0], [1, 100], [1.5, 150], [2, 200]]);
});

test("a new key is inserted in sorted order, at the start, the middle and the end", () => {
  const mid = keys(setTrackAt(K, 1.5, 150));
  assert.deepEqual(mid.map((k) => k.t), [0, 1, 1.5, 2]);
  const end = keys(setTrackAt(K, 3, 250));
  assert.deepEqual(end.map((k) => k.t), [0, 1, 2, 3]);
  const start = keys(setTrackAt([{ t: 1, v: 10 }, { t: 2, v: 20 }], 0.5, 5));
  assert.deepEqual(start.map((k) => k.v), [5, 10, 20]);
  assert.deepEqual(keys(setTrackAt([{ t: 1, v: 5 }], 0.5, 9)).map((k) => k.t), [0.5, 1]);
});

test("the key time snaps to the 1/30 s grid, to the millisecond", () => {
  assert.deepEqual(keys(setTrackAt(K, 1.0167, 130)).map((k) => k.t), [0, 1, 1.033, 2]);
  assert.deepEqual(keys(setTrackAt(K, 1.4999, 130)).map((k) => k.t), [0, 1, 1.5, 2]);
  assert.deepEqual(keys(setTrackAt(K, 0.0167, 7)).map((k) => k.t), [0, 0.033, 1, 2]);
  assert.deepEqual(keys(setTrackAt(K, 0.01, 7)).map((k) => k.t), [0, 1, 2], "0.01 s snaps to frame 0: that is the key at 0, updated");
});

test("a key within 4 ms of the time is updated, not duplicated, and keeps its own time", () => {
  const moved = keys(setTrackAt(K, 1.002, 150));
  assert.deepEqual(moved, [{ t: 0, v: 0 }, { t: 1, v: 150, ease: "easeOut" }, { t: 2, v: 200, ease: "linear" }]);
  const offGrid: Keyframe[] = [{ t: 0, v: 0 }, { t: 1.002, v: 10 }];
  assert.deepEqual(keys(setTrackAt(offGrid, 1, 20)), [{ t: 0, v: 0 }, { t: 1.002, v: 20 }]);
  assert.equal(keys(setTrackAt(K, 1.0167, 150)).length, 4, "a frame away is another key");
  assert.deepEqual(keys(setTrackAt(K, -5, 9))[0], { t: 0, v: 9 }, "before the scene: the key at 0");
});

test("updating a key with a given ease sets it; without one, the key keeps its own", () => {
  assert.equal(keys(setTrackAt(K, 1, 150, "linear"))[1].ease, "linear");
  assert.equal(keys(setTrackAt(K, 1, 150))[1].ease, "easeOut");
  const same = setTrackAt(K, 1, 100, "linear");
  assert.notEqual(same, K, "only the ease changed: still an edit");
  assert.deepEqual(keys(same)[1], { t: 1, v: 100, ease: "linear" });
});

test("a new key's ease: the one given, else the following key's, else none", () => {
  assert.equal(keys(setTrackAt(K, 0.5, 30, "backOut"))[1].ease, "backOut");
  assert.equal(keys(setTrackAt(K, 0.5, 30))[1].ease, "easeOut", "inherits from the key it was cut out of");
  assert.equal(keys(setTrackAt(K, 1.5, 150))[2].ease, "linear");
  const last = keys(setTrackAt(K, 3, 250))[3];
  assert.deepEqual(last, { t: 3, v: 250 });
  assert.ok(!("ease" in last), "no ease property at all, not even undefined");
  const plain = keys(setTrackAt([{ t: 1, v: 10 }, { t: 2, v: 20 }], 0.5, 5))[0];
  assert.ok(!("ease" in plain), "the following key has no ease: neither does the new one");
});

test("non-finite time or value changes nothing", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(setTrackAt(K, bad, 5), K);
    assert.equal(setTrackAt(K, 1, bad), K);
    assert.equal(setTrackAt(5, 1, bad), 5);
    assert.equal(setTrackAt(5, bad, 6), 5);
  }
});

test("never mutates its input", () => {
  const frozen = deepFreeze(JSON.parse(JSON.stringify(K)) as Keyframe[]);
  setTrackAt(frozen, 0.5, 30); setTrackAt(frozen, 1, 150, "linear"); setTrackAt(frozen, 3, 1);
  assert.deepEqual(frozen, K);
});

console.log("sampleAt");

test("sampleAt reads a track like the renderer does", () => {
  assert.equal(sampleAt(42, 3), 42);
  for (const time of [-1, 0, 0.25, 1, 1.5, 2, 9]) assert.equal(sampleAt(K, time), sample(K, time));
  assert.equal(sampleAt(K, 0), 0);
  assert.equal(sampleAt(K, 5), 200);
  assert.equal(sampleAt([{ t: 0, v: 0 }, { t: 2, v: 10, ease: "linear" }], 1), 5);
});

console.log("translateLayer");

test("a static layer just moves", () => {
  const scene = sceneOf(rect(), rect({ id: "other" }));
  const next = translateLayer(scene, "rect", 1, 30, -20);
  assert.equal(first(next).x, 990);
  assert.equal(first(next).y, 520);
  assert.equal(next.layers[1], scene.layers[1], "other layers are the same objects");
  assert.equal(first(scene).x, 960, "the input is untouched");
});

test("an animated position gets a key at the playhead; the other keys stay put", () => {
  const scene = sceneOf(rect({ x: [{ t: 0, v: 100 }, { t: 2, v: 300, ease: "easeOut" }], y: [{ t: 0, v: 500 }, { t: 2, v: 500 }] }));
  const next = translateLayer(scene, "rect", 1, 50, 0);
  const x = keys(first(next).x);
  assert.deepEqual(x.map((k) => k.t), [0, 1, 2]);
  assert.equal(x[1].v, sampleAt(first(scene).x, 1) + 50);
  assert.deepEqual([x[0], x[2]], keys(first(scene).x).slice(0, 1).concat(keys(first(scene).x).slice(1)), "the original keys are unchanged");
  assert.equal(x[1].ease, "easeOut", "the new key arrives with the curve it was cut out of");
  assert.equal(first(next).y, first(scene).y, "y didn't move: its track is the very same one, no key was added");
});

test("moving on an existing key updates it", () => {
  const scene = sceneOf(rect({ x: [{ t: 0, v: 100 }, { t: 2, v: 300 }] }));
  const next = translateLayer(scene, "rect", 2, -10, 0);
  assert.deepEqual(keys(first(next).x), [{ t: 0, v: 100 }, { t: 2, v: 290 }]);
});

test("positions are rounded to the hundredth", () => {
  const scene = sceneOf(rect());
  assert.equal(first(translateLayer(scene, "rect", 1, 0.006, 0)).x, 960.01);
  assert.equal(translateLayer(scene, "rect", 1, 0.004, 0.004), scene, "less than the rounding step: not an edit");
});

test("no movement, an unknown layer, or non-finite input: the very same scene", () => {
  const scene = sceneOf(rect({ x: [{ t: 0, v: 1 }, { t: 2, v: 5 }] }));
  assert.equal(translateLayer(scene, "rect", 1, 0, 0), scene);
  assert.equal(translateLayer(scene, "nope", 1, 5, 5), scene);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(translateLayer(scene, "rect", 1, bad, 5), scene);
    assert.equal(translateLayer(scene, "rect", 1, 5, bad), scene);
    assert.equal(translateLayer(scene, "rect", bad, 5, 5), scene);
  }
});

test("a drag back to where it started is a no-op on the scene it started from", () => {
  const scene = sceneOf(rect({ x: [{ t: 0, v: 100 }, { t: 2, v: 300 }], y: [{ t: 0, v: 100 }, { t: 2, v: 300 }] }));
  const there = translateLayer(scene, "rect", 1, 40, 25);
  assert.notEqual(there, scene);
  assert.equal(translateLayer(scene, "rect", 1, 0, 0), scene);
});

console.log("scaleLayer / rotateLayer");

test("scaleLayer multiplies the scale", () => {
  const scene = sceneOf(rect({ scale: 1.5 }));
  assert.equal(first(scaleLayer(scene, "rect", 1, 2)).scale, 3);
  assert.equal(first(scaleLayer(scene, "rect", 1, 0.5)).scale, 0.75);
  assert.equal(first(scaleLayer(sceneOf(rect()), "rect", 1, 1.23456)).scale, 1.235, "kept to three decimals");
});

test("scaleLayer clamps the result to [0.05, 20]", () => {
  const scene = sceneOf(rect());
  assert.equal(first(scaleLayer(scene, "rect", 1, 1000)).scale, 20);
  assert.equal(first(scaleLayer(scene, "rect", 1, 0.0001)).scale, 0.05);
  assert.equal(first(scaleLayer(scene, "rect", 1, 0)).scale, 0.05);
  assert.equal(first(scaleLayer(scene, "rect", 1, -3)).scale, 0.05);
  assert.equal(first(scaleLayer(sceneOf(rect({ scale: 20 })), "rect", 1, 2)).scale, 20);
});

test("scaleLayer on an animated scale writes a key at the playhead", () => {
  const scene = sceneOf(rect({ scale: [{ t: 0, v: 1 }, { t: 2, v: 2, ease: "linear" }] }));
  const next = scaleLayer(scene, "rect", 1, 2);
  assert.deepEqual(keys(first(next).scale), [{ t: 0, v: 1 }, { t: 1, v: 3, ease: "linear" }, { t: 2, v: 2, ease: "linear" }]);
});

test("scaleLayer: no-ops return the same scene", () => {
  const scene = sceneOf(rect({ scale: 2 }));
  assert.equal(scaleLayer(scene, "rect", 1, 1), scene);
  assert.equal(scaleLayer(scene, "nope", 1, 2), scene);
  for (const bad of [NaN, Infinity, -Infinity]) { assert.equal(scaleLayer(scene, "rect", 1, bad), scene); assert.equal(scaleLayer(scene, "rect", bad, 2), scene); }
});

test("rotateLayer SETS the rotation (it doesn't add to it)", () => {
  const scene = sceneOf(rect({ rotation: 30 }));
  assert.equal(first(rotateLayer(scene, "rect", 1, 100)).rotation, 100);
  assert.equal(first(rotateLayer(scene, "rect", 1, -45.678)).rotation, -45.68);
});

test("rotateLayer normalizes to [-360, 360]: inside is kept, beyond wraps", () => {
  const scene = sceneOf(rect());
  const rot = (d: number) => first(rotateLayer(scene, "rect", 1, d)).rotation;
  assert.equal(rot(360), 360);
  assert.equal(rot(-360), -360);
  assert.equal(rot(450), 90);
  assert.equal(rot(-450), -90);
  assert.equal(rot(361), 1);
  assert.equal(rot(720), 0);
  assert.equal(rot(1000), 280);
  assert.equal(rot(-1000), -280);
});

test("rotateLayer on an animated rotation writes a key; the same angle is a no-op", () => {
  const scene = sceneOf(rect({ rotation: [{ t: 0, v: 0 }, { t: 2, v: 90 }] }));
  const next = rotateLayer(scene, "rect", 1, 10);
  assert.deepEqual(keys(first(next).rotation).map((k) => [k.t, k.v]), [[0, 0], [1, 10], [2, 90]]);
  assert.equal(rotateLayer(next, "rect", 1, 10), next);
  assert.equal(rotateLayer(sceneOf(rect({ rotation: 33 })), "rect", 1, 33).layers[0].rotation, 33);
});

test("rotateLayer: unknown layer or non-finite input returns the same scene", () => {
  const scene = sceneOf(rect());
  assert.equal(rotateLayer(scene, "nope", 1, 5), scene);
  assert.equal(rotateLayer(scene, "rect", 1, 0), scene, "already 0");
  for (const bad of [NaN, Infinity, -Infinity]) { assert.equal(rotateLayer(scene, "rect", 1, bad), scene); assert.equal(rotateLayer(scene, "rect", bad, 5), scene); }
});

console.log("resizeFromCorner");

const opposite = (corners: Point[], corner: Corner) => corners[(CORNERS.indexOf(corner) + 2) % 4];
const cornerOf = (corners: Point[], corner: Corner) => corners[CORNERS.indexOf(corner)];

interface Subject { name: string; layer: Layer; measure: Measure }
function subjects(rotation: number): Subject[] {
  const out: Subject[] = [];
  for (const anchor of ANCHORS) {
    out.push({ name: `rect ${anchor}`, layer: rect({ anchor, rotation, x: 700, y: 400, scale: 1.25 }), measure: defaultMeasure });
    out.push({ name: `ellipse ${anchor}`, layer: ellipse({ anchor, rotation, x: 1100, y: 600, w: 300, h: 500 }), measure: defaultMeasure });
    out.push({ name: `media ${anchor}`, layer: media({ anchor, rotation, w: 800, h: 450, scale: 0.8 }), measure: defaultMeasure });
  }
  for (const align of ["left", "center", "right"] as const) out.push({ name: `text ${align}`, layer: text({ align, rotation, x: 900, y: 300, scale: 2 }), measure: fake });
  out.push({ name: "captions", layer: captions({ rotation, x: 960, y: 900 }), measure: fake });
  return out;
}

test("the opposite corner stays fixed (< 0.01 px): every layer type, anchor, corner, rotation, grow and shrink", () => {
  let checked = 0;
  for (const rotation of ROTATIONS) {
    for (const { name, layer, measure } of subjects(rotation)) {
      const scene = sceneOf(layer);
      const box = layerBox(layer, scene, 1, measure)!;
      const before = boxCorners(box);
      for (const corner of CORNERS) {
        for (const factor of [0.4, 0.93, 1.7, 3.2]) {
          // The pointer on the diagonal, from the fixed corner, plus a little sideways wobble.
          const fixed = opposite(before, corner);
          const dragged = cornerOf(before, corner);
          const px = fixed.x + (dragged.x - fixed.x) * factor + 6;
          const py = fixed.y + (dragged.y - fixed.y) * factor - 4;
          const next = resizeFromCorner(scene, layer.id, 1, box, corner, px, py);
          const after = layerBox(first(next), next, 1, measure)!;
          const where = `${name} rot ${rotation} ${corner} x${factor}`;
          assert.ok(dist(opposite(boxCorners(after), corner), fixed) < 0.01, `${where}: fixed corner moved by ${dist(opposite(boxCorners(after), corner), fixed)}`);
          near(after.w / after.h, box.w / box.h, 1e-9, `${where}: aspect ratio`);
          near(after.rotation, box.rotation, 0, `${where}: rotation`);
          checked++;
        }
      }
    }
  }
  assert.equal(checked, ROTATIONS.length * 19 * CORNERS.length * 4, "every combination was exercised");
});

test("the scale follows the pointer along the diagonal", () => {
  const layer = rect({ rotation: 30, scale: 1 });
  const scene = sceneOf(layer);
  const box = boxOf(layer);
  const [tl, , br] = boxCorners(box);
  for (const factor of [0.5, 1.5, 2.25]) {
    const next = resizeFromCorner(scene, "rect", 1, box, "br", tl.x + (br.x - tl.x) * factor, tl.y + (br.y - tl.y) * factor);
    near(first(next).scale as number, factor, 1e-9, `factor ${factor}`);
    const after = boxCorners(layerBox(first(next), next, 1)!);
    assert.ok(dist(after[2], { x: tl.x + (br.x - tl.x) * factor, y: tl.y + (br.y - tl.y) * factor }) < 0.01, "the dragged corner lands on the pointer");
  }
});

test("a pointer off the diagonal is projected onto it: uniform scale, no shear", () => {
  const layer = rect({ x: 500, y: 400 }); // corners (300, 300) to (700, 500): the diagonal is (400, 200)
  const scene = sceneOf(layer);
  const next = resizeFromCorner(scene, "rect", 1, boxOf(layer), "br", 700, 300);
  // From the top-left the pointer is at (400, 0): 400 * 400 / (400^2 + 200^2) = 0.8 of the diagonal.
  assert.equal(first(next).scale, 0.8);
  const after = layerBox(first(next), next, 1)!;
  assert.deepEqual([after.w, after.h], [320, 160]);
  nearPoint(boxCorners(after)[0], 300, 300, 0.01);
});

test("dragging toward and past the fixed corner shrinks to the minimum scale without moving it", () => {
  for (const rotation of [0, 50, -130]) {
    const layer = rect({ rotation, anchor: "left" });
    const scene = sceneOf(layer);
    const box = boxOf(layer);
    const [fixed, , dragged] = boxCorners(box);
    // Along the diagonal: onto the fixed corner, a hair from it, and beyond it on the other side.
    for (const along of [0, 0.01, -0.5, -3]) {
      const next = resizeFromCorner(scene, "rect", 1, box, "br", fixed.x + (dragged.x - fixed.x) * along, fixed.y + (dragged.y - fixed.y) * along);
      assert.equal(first(next).scale, 0.05);
      assert.ok(dist(boxCorners(layerBox(first(next), next, 1)!)[0], fixed) < 0.01);
    }
  }
});

test("a pointer miles away stops at the maximum scale, the opposite corner still fixed", () => {
  const layer = rect({ rotation: 20, anchor: "top" });
  const scene = sceneOf(layer);
  const box = boxOf(layer);
  const fixed = boxCorners(box)[2];
  const next = resizeFromCorner(scene, "rect", 1, box, "tl", -99999, -99999);
  assert.equal(first(next).scale, 20);
  assert.ok(dist(boxCorners(layerBox(first(next), next, 1)!)[2], fixed) < 0.01);
});

test("a pointer on the dragged corner is not an edit: same scene", () => {
  for (const rotation of [0, 33, -100]) {
    const layer = rect({ rotation, scale: 1.25, anchor: "bottom" });
    const scene = sceneOf(layer);
    const box = boxOf(layer);
    const corners = boxCorners(box);
    for (const corner of CORNERS) {
      const p = cornerOf(corners, corner);
      assert.equal(resizeFromCorner(scene, "rect", 1, box, corner, p.x, p.y), scene, `${corner} at ${rotation}`);
    }
  }
});

test("animated tracks: scale, x and y each get a key at the playhead and the fixed corner holds at that moment", () => {
  const layer = rect({
    rotation: 25,
    anchor: "left",
    scale: [{ t: 0, v: 1 }, { t: 2, v: 1.5, ease: "linear" }],
    x: [{ t: 0, v: 400 }, { t: 2, v: 800 }],
    y: [{ t: 0, v: 300 }, { t: 2, v: 500 }],
  });
  const scene = sceneOf(layer);
  const box = boxOf(layer, 1);
  const before = boxCorners(box);
  const fixed = before[3];
  const next = resizeFromCorner(scene, "rect", 1, box, "tr", before[1].x + 90, before[1].y - 60);
  for (const track of [first(next).scale, first(next).x, first(next).y]) assert.deepEqual(keys(track).map((k) => k.t), [0, 1, 2]);
  assert.equal(keys(first(next).scale)[1].ease, "linear", "the new scale key inherits the ease");
  assert.ok(dist(boxCorners(layerBox(first(next), next, 1)!)[3], fixed) < 0.01);
  assert.deepEqual([keys(first(next).x)[0], keys(first(next).x)[2]], [keys(first(scene).x)[0], keys(first(scene).x)[1]], "the keys that were there are untouched");
});

test("a property the resize leaves where it is keeps its track (no key that would reshape its curve)", () => {
  // Left-anchored and unrotated, dragging br about the top-left corner: the layer's point is on the fixed corner's
  // vertical, so x doesn't change while y (the middle of the left edge) does.
  const layer = rect({ anchor: "left", x: [{ t: 0, v: 300 }, { t: 2, v: 500 }] });
  const scene = sceneOf(layer);
  const box = boxOf(layer, 1);
  const [, , br] = boxCorners(box);
  const next = resizeFromCorner(scene, "rect", 1, box, "br", br.x + 80, br.y + 40);
  assert.equal(first(next).x, first(scene).x, "x: same track object");
  assert.notEqual(first(next).scale, first(scene).scale);
  assert.notEqual(first(next).y, first(scene).y);
});

test("the same drag applied again from the starting scene gives the same result (the gesture is stateless)", () => {
  const layer = rect({ rotation: 60, anchor: "right", x: [{ t: 0, v: 400 }, { t: 2, v: 800 }] });
  const scene = sceneOf(layer);
  const box = boxOf(layer, 1);
  const a = resizeFromCorner(scene, "rect", 1, box, "bl", 100, 700);
  assert.notEqual(a, scene);
  assert.deepEqual(a, resizeFromCorner(scene, "rect", 1, box, "bl", 100, 700));
  assert.notDeepEqual(a, resizeFromCorner(scene, "rect", 1, box, "bl", 130, 700));
});

test("an incremental drag (each move starting from the previous result) keeps the fixed corner too", () => {
  const layer = ellipse({ rotation: 70, anchor: "bottom", x: 1000, y: 600 });
  let scene = sceneOf(layer);
  const fixed = boxCorners(boxOf(layer))[0];
  for (const [px, py] of [[1400, 900], [1500, 950], [1300, 800], [1600, 1000]]) {
    const box = layerBox(first(scene), scene, 1)!;
    scene = resizeFromCorner(scene, "ellipse", 1, box, "br", px, py);
    assert.ok(dist(boxCorners(layerBox(first(scene), scene, 1)!)[0], fixed) < 0.01);
  }
});

test("degenerate or foreign input: the same scene", () => {
  const layer = rect();
  const scene = sceneOf(layer);
  const box = boxOf(layer);
  assert.equal(resizeFromCorner(scene, "nope", 1, box, "br", 1500, 800), scene);
  assert.equal(resizeFromCorner(scene, "rect", 1, { ...box, w: 0, h: 0 }, "br", 1500, 800), scene, "a box with no diagonal");
  assert.equal(resizeFromCorner(scene, "rect", 1, { ...box, scale: 0 }, "br", 1500, 800), scene);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(resizeFromCorner(scene, "rect", 1, box, "br", bad, 800), scene);
    assert.equal(resizeFromCorner(scene, "rect", 1, box, "br", 1500, bad), scene);
    assert.equal(resizeFromCorner(scene, "rect", bad, box, "br", 1500, 800), scene);
    assert.equal(resizeFromCorner(scene, "rect", 1, { ...box, cx: bad }, "br", 1500, 800), scene);
  }
});

console.log("rotateFromHandle");

test("the handle ends up pointing at the pointer: up is 0, right 90, down 180, left -90", () => {
  const layer = rect({ rotation: 20 });
  const scene = sceneOf(layer);
  const box = boxOf(layer);
  const rot = (px: number, py: number) => first(rotateFromHandle(scene, "rect", 1, box, px, py)).rotation;
  assert.equal(rot(960, 340), 0);
  assert.equal(rot(1160, 540), 90);
  assert.equal(rot(960, 740), 180);
  assert.equal(rot(760, 540), -90);
  assert.equal(rot(1060, 440), 45);
  assert.equal(rot(860, 440), -45);
  assert.equal(rot(1060, 640), 135);
});

test("after rotating, the handle really is on the line from the centre to the pointer", () => {
  const layer = rect({ rotation: 0, scale: 1.5 });
  const scene = sceneOf(layer);
  const box = boxOf(layer);
  for (const [px, py] of [[1300, 300], [500, 400], [700, 900], [1500, 800], [961, 100]]) {
    const next = rotateFromHandle(scene, "rect", 1, box, px, py);
    const after = layerBox(first(next), next, 1)!;
    const handle = rotateHandle(after);
    const cross = (handle.x - after.cx) * (py - after.cy) - (handle.y - after.cy) * (px - after.cx);
    const dot = (handle.x - after.cx) * (px - after.cx) + (handle.y - after.cy) * (py - after.cy);
    assert.ok(dot > 0, "same direction");
    assert.ok(Math.abs(cross) / (Math.hypot(handle.x - after.cx, handle.y - after.cy) * Math.hypot(px - after.cx, py - after.cy)) < 1e-4, "collinear");
  }
});

test("snapping rounds to multiples of the step, both ways round", () => {
  const scene = sceneOf(rect());
  const box = boxOf(rect());
  const at = (deg: number) => [960 + Math.sin((deg * Math.PI) / 180) * 300, 540 - Math.cos((deg * Math.PI) / 180) * 300];
  const snapped = (deg: number, step: number) => first(rotateFromHandle(scene, "rect", 1, box, ...(at(deg) as [number, number]), step)).rotation;
  assert.equal(snapped(37, 15), 30);
  assert.equal(snapped(38, 15), 45);
  assert.equal(snapped(-37, 15), -30);
  assert.equal(snapped(-38, 15), -45);
  assert.equal(snapped(88, 15), 90);
  assert.equal(snapped(73.3, 15), 75);
  assert.equal(snapped(52, 45), 45);
  assert.equal(snapped(37, 0), 37, "no snapping");
  assert.equal(snapped(37, -15), 37, "a negative step is no snapping");
  assert.equal(snapped(37, NaN), 37);
  assert.equal(snapped(37, Infinity), 37, "an infinite step is no snapping");
});

test("the layer turns about the centre of its box: a left-anchored box or right-aligned text doesn't swing around its point", () => {
  for (const layer of [rect({ anchor: "left", x: 500, y: 300, rotation: 15 }), rect({ anchor: "bottom", x: 900, y: 700, scale: 1.4 }), text({ align: "right", x: 800, y: 400, scale: 2, rotation: -40 }), text({ align: "left", x: 300, y: 300 })]) {
    const scene = sceneOf(layer);
    const box = layerBox(layer, scene, 1, fake)!;
    for (const [px, py] of [[box.cx + 300, box.cy], [box.cx - 100, box.cy + 250], [box.cx + 20, box.cy - 400]]) {
      const next = rotateFromHandle(scene, layer.id, 1, box, px, py);
      const after = layerBox(first(next), next, 1, fake)!;
      assert.ok(Math.hypot(after.cx - box.cx, after.cy - box.cy) < 0.01, `${layer.type} ${layer.id}: centre moved`);
      assert.notEqual(first(next).rotation, layer.rotation);
      near(after.w, box.w, 1e-9);
    }
  }
});

test("a layer whose point is its centre keeps its x and y tracks (no needless edit)", () => {
  const layer = rect({ x: [{ t: 0, v: 400 }, { t: 2, v: 800 }], y: 300 });
  const scene = sceneOf(layer);
  const next = rotateFromHandle(scene, "rect", 1, boxOf(layer, 1), 1500, 900);
  assert.equal(first(next).x, first(scene).x);
  assert.equal(first(next).y, first(scene).y);
  assert.notEqual(first(next).rotation, first(scene).rotation);
});

test("it takes the equivalent angle nearest the current rotation: no flip the long way round", () => {
  const at = (cx: number, cy: number, deg: number) => [cx + Math.sin((deg * Math.PI) / 180) * 300, cy - Math.cos((deg * Math.PI) / 180) * 300] as const;
  const run = (rotation: number, pointed: number) => {
    const layer = rect({ rotation });
    const [px, py] = at(960, 540, pointed);
    return first(rotateFromHandle(sceneOf(layer), "rect", 1, boxOf(layer), px, py)).rotation as number;
  };
  assert.equal(run(170, -170), 190);
  assert.equal(run(-170, 170), -190);
  assert.equal(run(10, 170), 170);
  assert.equal(run(0, -170), -170);
  assert.equal(run(350, 10), 10, "370 is out of range: the range wins");
  assert.equal(run(300, -100), 260, "-100 and 260 are the same direction; 260 is nearer 300");
});

test("on an animated rotation it writes a key at the playhead with the continuous angle", () => {
  const layer = rect({ rotation: [{ t: 0, v: 0 }, { t: 2, v: 170, ease: "linear" }] });
  const scene = sceneOf(layer);
  const box = boxOf(layer, 2);
  const next = rotateFromHandle(scene, "rect", 2, box, 960 + Math.sin((-175 * Math.PI) / 180) * 200, 540 - Math.cos((-175 * Math.PI) / 180) * 200);
  assert.deepEqual(keys(first(next).rotation).map((k) => [k.t, k.v]), [[0, 0], [2, 185]]);
});

test("a pointer on the centre, the same angle, an unknown layer or non-finite input: the same scene", () => {
  const layer = rect({ rotation: 90 });
  const scene = sceneOf(layer);
  const box = boxOf(layer);
  assert.equal(rotateFromHandle(scene, "rect", 1, box, 960, 540), scene, "no direction");
  assert.equal(rotateFromHandle(scene, "rect", 1, box, 1160, 540), scene, "already pointing there");
  assert.equal(rotateFromHandle(scene, "nope", 1, box, 1500, 900), scene);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(rotateFromHandle(scene, "rect", 1, box, bad, 900), scene);
    assert.equal(rotateFromHandle(scene, "rect", 1, box, 900, bad), scene);
    assert.equal(rotateFromHandle(scene, "rect", bad, box, 1500, 900), scene);
    assert.equal(rotateFromHandle(scene, "rect", 1, { ...box, cx: bad }, 1500, 900), scene);
  }
});

console.log("immutability and numeric safety");

test("nothing mutates its input (deep-frozen scene and box through every operation)", () => {
  const layer = rect({ anchor: "left", rotation: 20, x: [{ t: 0, v: 400 }, { t: 2, v: 800 }], scale: [{ t: 0, v: 1 }, { t: 2, v: 2 }] });
  const scene = deepFreeze(sceneOf(layer, text({ id: "t" }), media({ id: "m" })));
  const before = JSON.stringify(scene);
  const box = deepFreeze({ ...boxOf(layer, 1) });
  hitTest(scene, 1, 700, 500); hitTest(scene, 1, 5, 5);
  layerBox(layer, scene, 1); boxCorners(box); rotateHandle(box); pointInBox(box, 1, 2);
  translateLayer(scene, "rect", 1, 12, 7); scaleLayer(scene, "rect", 1, 1.4); rotateLayer(scene, "rect", 1, 77);
  for (const corner of CORNERS) resizeFromCorner(scene, "rect", 1, box, corner, 1200, 800);
  rotateFromHandle(scene, "rect", 1, box, 1200, 800, 15);
  setTrackAt(layer.x, 1, 5); setTrackAt(layer.x, 2, 5);
  assert.equal(JSON.stringify(scene), before);
});

test("NaN and Infinity never reach the output, whatever the argument", () => {
  const layer = rect({ rotation: 25, x: [{ t: 0, v: 400 }, { t: 2, v: 800 }] });
  const scene = sceneOf(layer, text({ id: "t" }));
  const box = boxOf(layer, 1);
  const bads = [NaN, Infinity, -Infinity];
  const outputs: unknown[] = [];
  for (const bad of bads) {
    outputs.push(
      layerBox(layer, scene, bad), hitTest(scene, bad, 5, 5), hitTest(scene, 1, bad, bad), hitTest(scene, 1, 5, 5, undefined, bad),
      setTrackAt(layer.x, bad, 5), setTrackAt(layer.x, 1, bad), sampleAt(layer.x, bad),
      translateLayer(scene, "rect", bad, 1, 1), translateLayer(scene, "rect", 1, bad, bad), scaleLayer(scene, "rect", 1, bad), rotateLayer(scene, "rect", 1, bad),
      rotateHandle(box, bad), pointInBox(box, bad, bad),
    );
    for (const corner of CORNERS) outputs.push(resizeFromCorner(scene, "rect", 1, box, corner, bad, bad), resizeFromCorner(scene, "rect", bad, box, corner, 5, 5));
    outputs.push(rotateFromHandle(scene, "rect", 1, box, bad, bad), rotateFromHandle(scene, "rect", 1, box, 1500, 900, bad));
  }
  for (const out of outputs) for (const v of numbersIn(out)) assert.ok(Number.isFinite(v), `non-finite number in ${JSON.stringify(out)?.slice(0, 120)}`);
  // And a long random walk of gestures never produces one either.
  let s = scene;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 400; i++) {
    const b = layerBox(first(s), s, 1);
    if (!b) break;
    const k = Math.floor(rnd() * 4);
    if (k === 0) s = translateLayer(s, "rect", 1, (rnd() - 0.5) * 400, (rnd() - 0.5) * 400);
    else if (k === 1) s = scaleLayer(s, "rect", 1, 0.5 + rnd() * 1.5);
    else if (k === 2) s = resizeFromCorner(s, "rect", 1, b, CORNERS[Math.floor(rnd() * 4)], rnd() * 1920, rnd() * 1080);
    else s = rotateFromHandle(s, "rect", 1, b, rnd() * 1920, rnd() * 1080, rnd() < 0.5 ? 15 : 0);
    for (const v of numbersIn(s)) assert.ok(Number.isFinite(v), `non-finite after step ${i}`);
  }
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
