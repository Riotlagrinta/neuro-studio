import assert from "node:assert/strict";
import { boxCorners, defaultMeasure, hitTest, layerBox, rotateHandle, type Box, type Measure, type Point } from "../src/lib/motion/manipulate";
import {
  beginGesture,
  cornerCursor,
  cssToFrame,
  formatReadout,
  frameGeometry,
  frameToCss,
  measureAt,
  monitorScale,
  pastThreshold,
  pickAt,
  pickLayer,
  pickSlack,
  placeBox,
  placePoint,
  readoutOrigin,
  READOUT_HEIGHT,
  replaceScene,
  RESTING,
  ROTATE_STEM,
  selectionView,
  stepGesture,
  transitionPlacement,
  unplacePoint,
  type Gesture,
  type GestureKind,
} from "../src/lib/motion/overlay-math";
import { measureLayer, renderFrame, SYSTEM_FONTS } from "../src/lib/motion/render";
import type { Selection } from "../src/lib/motion/selection";
import { FRAMES, type CaptionsLayer, type EllipseLayer, type Keyframe, type Layer, type MediaLayer, type MotionProject, type MotionScene, type RectLayer, type TextLayer, type TransitionType } from "../src/lib/motion/types";

let n = 0, failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };

// ---------- fixtures ----------

const common = { start: 0, end: null as number | null, x: 960, y: 540, rotation: 0, scale: 1, opacity: 1 };
const rect = (o: Partial<RectLayer> = {}): RectLayer => ({ id: "rect", type: "rect", ...common, w: 400, h: 200, radius: 0, fill: "#fff", stroke: null, strokeWidth: 0, anchor: "center", ...o });
const ellipse = (o: Partial<EllipseLayer> = {}): EllipseLayer => ({ id: "ellipse", type: "ellipse", ...common, w: 400, h: 200, fill: "#fff", stroke: null, strokeWidth: 0, anchor: "center", ...o });
const media = (o: Partial<MediaLayer> = {}): MediaLayer => ({ id: "media", type: "media", ...common, w: 1920, h: 1080, anchor: "center", ...o });
const text = (o: Partial<TextLayer> = {}): TextLayer => ({ id: "text", type: "text", ...common, text: "Hello world", size: 60, weight: 700, color: "#fff", font: "sans", align: "center", maxWidth: 1000, lineHeight: 1.2, letterSpacing: 0, reveal: "none", revealDuration: 0.8, ...o });
const captions = (o: Partial<CaptionsLayer> = {}): CaptionsLayer => ({ id: "captions", type: "captions", ...common, text: "Bonjour tout le monde", style: "karaoke", size: 60, weight: 800, font: "sans", color: "#fff", highlight: "#fbbf24", uppercase: false, maxWidth: 1536, lineHeight: 1.25, ...o });
let uidCount = 0;
const sceneOf = (layers: Layer[], o: Partial<MotionScene> = {}): MotionScene => ({
  uid: `scene-${++uidCount}`, id: 1, voiceOver: "", visualPrompt: "", duration: 3,
  background: { type: "solid", color: "#000000" }, transition: { type: "none", duration: 1 }, layers, ...o,
});
const projectOf = (scenes: MotionScene[], ratio: MotionProject["ratio"] = "16:9"): MotionProject => ({ title: "t", category: "c", ratio, palette: [], scenes });
const withTransition = (type: TransitionType, duration = 1) => ({ transition: { type, duration } });
const sel = (scene: MotionScene, layer: string): Selection => ({ scene: scene.uid, layer });

const near = (a: number, b: number, tol = 1e-6, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a} (tolerance ${tol})`);
const nearPoint = (p: Point, q: Point, tol = 1e-6, msg = "") => { near(p.x, q.x, tol, `${msg} x:`); near(p.y, q.y, tol, `${msg} y:`); };
const deepFreeze = <T,>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
const layerOf = (project: MotionProject, sceneIndex: number, id: string): Layer => { const l = project.scenes[sceneIndex].layers.find((x) => x.id === id); assert.ok(l, `layer ${id}`); return l; };
const boxIn = (project: MotionProject, sceneIndex: number, id: string, t: number, measure: Measure = defaultMeasure): Box => {
  const b = layerBox(layerOf(project, sceneIndex, id), project.scenes[sceneIndex], t, measure);
  assert.ok(b, "layer should be visible");
  return b;
};
const measureFor = (): Measure => defaultMeasure;

// ---------- the real renderer, recorded ----------

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, k: Matrix): Matrix => [
  m[0] * k[0] + m[2] * k[1], m[1] * k[0] + m[3] * k[1],
  m[0] * k[2] + m[2] * k[3], m[1] * k[2] + m[3] * k[3],
  m[0] * k[4] + m[2] * k[5] + m[4], m[1] * k[4] + m[3] * k[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): Point => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Every rect renderFrame fills at project time t, with the transform it was drawn under. */
function recordRects(project: MotionProject, t: number): { args: number[]; m: Matrix }[] {
  const calls: { args: number[]; m: Matrix }[] = [];
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
    rect: (...args: number[]) => { calls.push({ args, m }); },
  };
  const ctx = new Proxy(target, { get: (o, p) => (p in o ? o[p as string] : () => undefined), set: (o, p, v) => { o[p as string] = v; return true; } });
  renderFrame(ctx as unknown as CanvasRenderingContext2D, project, t, () => null, SYSTEM_FONTS);
  return calls;
}

// ---------- frame <-> screen ----------

console.log("frame <-> screen");

test("monitorScale: css pixels per frame pixel, 0 while the monitor has no size", () => {
  near(monitorScale(960, "16:9"), 0.5);
  near(monitorScale(540, "9:16"), 0.5);
  for (const bad of [0, -10, NaN, Infinity]) assert.equal(monitorScale(bad, "16:9"), 0, `${bad}`);
});

test("frameToCss and cssToFrame are inverses; a zero factor gives points no engine will act on", () => {
  const p = { x: 123.5, y: 456.25 };
  nearPoint(cssToFrame(frameToCss(p, 0.37), 0.37), p);
  const bad = cssToFrame(p, 0);
  assert.ok(!Number.isFinite(bad.x) && !Number.isFinite(bad.y));
});

test("placePoint / unplacePoint / placeBox: scale about the centre, then shift", () => {
  const frame = FRAMES["16:9"];
  const placement = { scale: 1.2, dx: 30, dy: -10 };
  nearPoint(placePoint({ x: 960, y: 540 }, placement, frame), { x: 990, y: 530 });
  nearPoint(placePoint({ x: 1060, y: 540 }, placement, frame), { x: 990 + 120, y: 530 });
  const p = { x: 211, y: 977 };
  nearPoint(unplacePoint(placePoint(p, placement, frame), placement, frame), p);
  assert.deepEqual(placePoint(p, RESTING, frame), p);
  const box: Box = { cx: 1060, cy: 440, w: 200, h: 100, rotation: 25, scale: 2 };
  const placed = placeBox(box, placement, frame);
  near(placed.w, 240); near(placed.h, 120); near(placed.scale, 2.4); near(placed.rotation, 25);
  nearPoint({ x: placed.cx, y: placed.cy }, placePoint({ x: 1060, y: 440 }, placement, frame));
});

// ---------- transitions ----------

console.log("transitions");

test("transitionPlacement: only slide and zoom move the scene, only while the transition plays, never for the first scene", () => {
  const layer = rect();
  const first = projectOf([sceneOf([layer], withTransition("slide"))]);
  assert.deepEqual(transitionPlacement(first, 0, 0), RESTING);
  const mk = (type: TransitionType) => projectOf([sceneOf([]), sceneOf([layer], withTransition(type))]);
  assert.deepEqual(transitionPlacement(mk("none"), 1, 0.2), RESTING);
  assert.deepEqual(transitionPlacement(mk("fade"), 1, 0.2), RESTING);
  assert.deepEqual(transitionPlacement(mk("wipe"), 1, 0.2), RESTING);
  assert.deepEqual(transitionPlacement(mk("slide"), 1, 1), RESTING);
  assert.deepEqual(transitionPlacement(mk("slide"), 1, 2), RESTING);
  assert.deepEqual(transitionPlacement(mk("zoom"), 1, 1), RESTING);
  assert.deepEqual(transitionPlacement(mk("slide"), 5, 0.2), RESTING, "no such scene");
  const slide = transitionPlacement(mk("slide"), 1, 0);
  near(slide.dx, 1920); assert.equal(slide.scale, 1);
  const zoom = transitionPlacement(mk("zoom"), 1, 0);
  near(zoom.scale, 1.25); assert.equal(zoom.dx, 0);
  assert.deepEqual(transitionPlacement(mk("slide"), 1, NaN), RESTING);
  assert.deepEqual(transitionPlacement(projectOf([sceneOf([]), sceneOf([layer], withTransition("slide", 0))]), 1, 0), RESTING, "a zero-length transition");
});

test("the screen box matches what renderFrame really draws, through every transition and at every moment", () => {
  const layer = rect({ x: 700, y: 400, rotation: 20, scale: 1.2, w: 400, h: 200 });
  const types: TransitionType[] = ["none", "fade", "slide", "zoom", "wipe"];
  for (const type of types) {
    const second = sceneOf([layer], withTransition(type, 1));
    const project = projectOf([sceneOf([]), second]);
    for (const local of [0, 0.05, 0.25, 0.5, 0.8, 0.99, 1, 1.7]) {
      const t = 3 + local;
      const view = selectionView(project, sel(second, "rect"), t, measureFor);
      assert.equal(view.kind, "frame", `${type} @${local}`);
      if (view.kind !== "frame") return;
      const drawn = recordRects(project, t).at(-1);
      assert.ok(drawn, "the layer is drawn");
      const [x, y, w, h] = drawn.args;
      const seen = [apply(drawn.m, x, y), apply(drawn.m, x + w, y), apply(drawn.m, x + w, y + h), apply(drawn.m, x, y + h)];
      boxCorners(view.screen).forEach((c, i) => nearPoint(c, seen[i], 1e-6, `${type} @${local} corner ${i}`));
    }
  }
});

test("pickAt sees the scene where the screen shows it: a sliding scene is not under the pointer it hasn't reached", () => {
  const layer = rect({ x: 100, y: 540, w: 200, h: 100 });
  const second = sceneOf([layer], withTransition("slide", 1));
  const project = projectOf([sceneOf([]), second]);
  // at 0.25 s the scene is 1800 px to the right (ease 0.0625): the layer is at 1900 on screen, i.e. css 950 at factor 0.5
  assert.equal(pickAt(project, 1, 0.25, { x: 950, y: 270 }, 0.5, defaultMeasure), "rect");
  assert.equal(pickAt(project, 1, 0.25, { x: 50, y: 270 }, 0.5, defaultMeasure), null, "where the layer would be without the slide");
  assert.equal(pickAt(project, 1, 2, { x: 50, y: 270 }, 0.5, defaultMeasure), "rect", "once it has arrived");
});

// ---------- picking ----------

console.log("picking");

test("pickLayer: the topmost layer wins, layers later in the list are drawn on top", () => {
  const scene = sceneOf([rect({ id: "under", w: 600, h: 600 }), ellipse({ id: "over", w: 300, h: 300 })]);
  assert.equal(pickLayer(scene, "16:9", 1, 960, 540, defaultMeasure), "over");
  assert.equal(pickLayer(scene, "16:9", 1, 960 + 250, 540, defaultMeasure), "under");
  assert.equal(pickLayer(scene, "16:9", 1, 10, 10, defaultMeasure), null);
});

test("pickLayer never picks the backdrop, even when it is the only thing under the pointer", () => {
  const dim = rect({ id: "dim", x: 960, y: 540, w: 1920, h: 1080 });
  const cover = rect({ id: "cover", w: 1900, h: 1060 });
  const m = media();
  const scene = sceneOf([m, dim, cover, text({ id: "title" })]);
  assert.equal(pickLayer(scene, "16:9", 1, 100, 100, defaultMeasure), null, "empty space is not the backdrop");
  assert.equal(pickLayer(scene, "16:9", 1, 960, 540, defaultMeasure), "title");
  assert.equal(hitTest(sceneOf([m]), 1, 100, 100), "media", "manipulate.hitTest would have returned the backdrop");
  assert.equal(pickLayer(sceneOf([m]), "16:9", 1, 100, 100, defaultMeasure), null);
  const portrait = sceneOf([rect({ id: "veil", x: 540, y: 960, w: 1080, h: 1920 })]);
  assert.equal(pickLayer(portrait, "9:16", 1, 500, 900, defaultMeasure), null, "covers the portrait frame");
  assert.equal(pickLayer(portrait, "16:9", 1, 500, 540, defaultMeasure), "veil", "but only a landscape one is not a backdrop here (1080 x 1920 in 1920 x 1080)");
});

test("pickLayer: a layer that isn't drawn at that moment can't be picked; the margin widens the target", () => {
  const scene = sceneOf([rect({ id: "late", start: 2 }), rect({ id: "early", end: 1, x: 300, y: 300 })]);
  assert.equal(pickLayer(scene, "16:9", 1, 960, 540, defaultMeasure), null);
  assert.equal(pickLayer(scene, "16:9", 2.5, 960, 540, defaultMeasure), "late");
  assert.equal(pickLayer(scene, "16:9", 2.5, 300, 300, defaultMeasure), null);
  const r = sceneOf([rect({ w: 400, h: 200 })]);
  assert.equal(pickLayer(r, "16:9", 1, 960 + 205, 540, defaultMeasure), null);
  assert.equal(pickLayer(r, "16:9", 1, 960 + 205, 540, defaultMeasure, 10), "rect");
});

test("pickAt converts css pixels to frame pixels and the slack is in css pixels", () => {
  const project = projectOf([sceneOf([rect({ w: 400, h: 200 })])]);
  // factor 0.5: the layer is css 380..580 x 220..320
  assert.equal(pickAt(project, 0, 1, { x: 480, y: 270 }, 0.5, defaultMeasure), "rect");
  assert.equal(pickAt(project, 0, 1, { x: 583, y: 270 }, 0.5, defaultMeasure), null);
  assert.equal(pickAt(project, 0, 1, { x: 583, y: 270 }, 0.5, defaultMeasure, pickSlack("touch")), "rect");
  assert.equal(pickAt(project, 0, 1, { x: 480, y: 270 }, 0, defaultMeasure), null, "a monitor without size picks nothing");
  assert.equal(pickAt(project, 4, 1, { x: 480, y: 270 }, 0.5, defaultMeasure), null, "no such scene");
  assert.ok(pickSlack("touch") > pickSlack("pen") && pickSlack("pen") > pickSlack("mouse"));
});

test("a project with no layers, and one with 60 scenes", () => {
  const empty = projectOf([sceneOf([])]);
  assert.equal(pickAt(empty, 0, 1, { x: 100, y: 100 }, 0.5, defaultMeasure), null);
  const many = projectOf(Array.from({ length: 60 }, (_, i) => sceneOf([rect({ id: `r${i}` })])));
  assert.equal(pickAt(many, 59, 1, { x: 480, y: 270 }, 0.5, defaultMeasure), "r59");
  const view = selectionView(many, sel(many.scenes[59], "r59"), 59 * 3 + 1, measureFor);
  assert.equal(view.kind, "frame");
});

// ---------- the selection frame ----------

console.log("selection frame");

test("selectionView: nothing, hidden, or a frame", () => {
  const a = sceneOf([rect({ id: "a" }), rect({ id: "late", start: 2 })]);
  const b = sceneOf([rect({ id: "b" })]);
  const project = projectOf([a, b]);
  assert.equal(selectionView(project, null, 1, measureFor).kind, "none");
  assert.equal(selectionView(project, sel(a, "a"), 4, measureFor).kind, "none", "the selection is in another scene than the one under the playhead");
  assert.equal(selectionView(project, sel(b, "a"), 4, measureFor).kind, "none", "no such layer in that scene");
  assert.equal(selectionView(project, { scene: "gone", layer: "a" }, 1, measureFor).kind, "none");
  assert.equal(selectionView(project, sel(a, "late"), 1, measureFor).kind, "hidden", "not drawn yet at 1 s");
  const view = selectionView(project, sel(a, "a"), 1, measureFor);
  assert.equal(view.kind, "frame");
  if (view.kind === "frame") {
    assert.equal(view.index, 0);
    near(view.local, 1);
    assert.deepEqual(view.box, view.screen, "no transition: the screen shows the scene as it is");
  }
  assert.equal(selectionView(project, sel(b, "b"), 4, measureFor).kind, "frame");
  assert.equal(selectionView(projectOf([]), sel(a, "a"), 0, measureFor).kind, "none", "a project with no scenes");
});

test("selectionView follows time: a keyframed layer is somewhere else at each moment, and invisible at opacity 0", () => {
  const moving = rect({ id: "m", x: [{ t: 0, v: 100, ease: "linear" }, { t: 2, v: 500, ease: "linear" }], opacity: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] });
  const scene = sceneOf([moving]);
  const project = projectOf([scene]);
  const at = (t: number) => selectionView(project, sel(scene, "m"), t, measureFor);
  assert.equal(at(0).kind, "hidden");
  const mid = at(1);
  assert.equal(mid.kind, "frame");
  if (mid.kind === "frame") near(mid.box.cx, 300);
  const end = at(2);
  if (end.kind === "frame") near(end.box.cx, 500);
});

test("the measure is asked for each scene and moment: the box of a text layer is its measured block", () => {
  const scene = sceneOf([text()]);
  const project = projectOf([scene]);
  const seen: number[] = [];
  const view = selectionView(project, sel(scene, "text"), 1, (_s, local) => { seen.push(local); return () => ({ w: 321, h: 45 }); });
  assert.deepEqual(seen, [1]);
  assert.equal(view.kind, "frame");
  if (view.kind === "frame") { near(view.box.w, 321); near(view.box.h, 45); }
});

test("frameGeometry: corners in css pixels, and a rotation handle a fixed distance above the top edge on screen", () => {
  const box: Box = { cx: 960, cy: 540, w: 400, h: 200, rotation: 0, scale: 1 };
  for (const factor of [0.25, 0.5, 1, 2]) {
    const g = frameGeometry(box, factor);
    nearPoint(g.corners[0], { x: 760 * factor, y: 440 * factor });
    nearPoint(g.corners[2], { x: 1160 * factor, y: 640 * factor });
    nearPoint(g.stemFrom, { x: 960 * factor, y: 440 * factor });
    nearPoint(g.rotate, { x: 960 * factor, y: 440 * factor - ROTATE_STEM }, 1e-6, `factor ${factor}`);
  }
  // turned a quarter: "up" now points right on screen
  const g = frameGeometry({ ...box, rotation: 90 }, 1);
  nearPoint(g.rotate, { x: 960 + 100 + ROTATE_STEM, y: 540 });
  nearPoint(g.stemFrom, { x: 960 + 100, y: 540 });
  // consistent with the engine's own handle
  const engine = rotateHandle(box, ROTATE_STEM / 0.5);
  nearPoint(frameGeometry(box, 0.5).rotate, frameToCss(engine, 0.5));
});

test("frameGeometry: a zero factor stays finite for the points that matter", () => {
  const g = frameGeometry({ cx: 960, cy: 540, w: 400, h: 200, rotation: 0, scale: 1 }, 0);
  for (const p of [...g.corners, g.stemFrom, g.rotate]) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("cornerCursor: the resize arrow follows the rotation of the frame", () => {
  assert.deepEqual((["tl", "tr", "br", "bl"] as const).map((c) => cornerCursor(c, 0)), ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]);
  assert.deepEqual((["tl", "tr", "br", "bl"] as const).map((c) => cornerCursor(c, 45)), ["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
  assert.deepEqual((["tl", "tr", "br", "bl"] as const).map((c) => cornerCursor(c, 90)), ["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]);
  assert.equal(cornerCursor("tl", 180), "nwse-resize");
  assert.equal(cornerCursor("tl", -90), "nesw-resize");
  assert.equal(cornerCursor("tl", 360 + 45), "ns-resize");
  assert.equal(cornerCursor("tl", NaN), "nwse-resize");
});

test("formatReadout: x, y, scale in percent and rotation, rounded, from the layer's tracks", () => {
  assert.equal(formatReadout(rect(), 0), "x 960 · y 540 · 100 % · 0°");
  assert.equal(formatReadout(rect({ x: 100.4, y: 99.5, scale: 1.234, rotation: 12.34 }), 0), "x 100 · y 100 · 123 % · 12.3°");
  assert.equal(formatReadout(rect({ x: -0.2, rotation: -0.04, y: -0.4 }), 0), "x 0 · y 0 · 100 % · 0°", "no negative zero");
  const keyed: Keyframe[] = [{ t: 0, v: 0, ease: "linear" }, { t: 2, v: 90, ease: "linear" }];
  assert.equal(formatReadout(rect({ rotation: keyed, x: [{ t: 0, v: 0, ease: "linear" }, { t: 2, v: 200, ease: "linear" }] }), 1), "x 100 · y 540 · 100 % · 45°");
});

test("readoutOrigin: under the frame, above it when there is no room, always inside the monitor", () => {
  const view = { w: 960, h: 540 };
  const corners = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const under = readoutOrigin(corners(300, 100, 200, 100), 26, view);
  assert.ok(under.y > 200 && under.y < 220, `${under.y}`);
  near(under.x + (26 * 6.2 + 14) / 2, 400, 1e-6);
  const bottom = readoutOrigin(corners(300, 400, 200, 120), 26, view);
  assert.ok(bottom.y + READOUT_HEIGHT < 400, "above the frame");
  const corner = readoutOrigin(corners(-300, -300, 100, 100), 26, view);
  assert.ok(corner.x >= 0 && corner.y >= 0, "clamped inside the top-left");
  const far = readoutOrigin(corners(2000, 2000, 100, 100), 26, view);
  assert.ok(far.x + 26 * 6.2 + 14 <= 960 && far.y + READOUT_HEIGHT <= 540, "clamped inside the bottom-right");
  const tiny = readoutOrigin(corners(0, 0, 10, 10), 26, { w: 50, h: 10 });
  assert.ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y), "a monitor too small for the label");
});

test("measureAt: the injected metrics get the moment and the scene's duration; without them the estimate", () => {
  const scene = sceneOf([], { duration: 7 });
  const calls: { t: number; sceneDuration: number }[] = [];
  const m = measureAt((_l, moment) => { calls.push(moment); return { w: 1, h: 2 }; }, scene, 1.5);
  assert.deepEqual(m(text()), { w: 1, h: 2 });
  assert.deepEqual(calls, [{ t: 1.5, sceneDuration: 7 }]);
  assert.equal(measureAt(undefined, scene, 1.5), defaultMeasure);
});

// ---------- gestures ----------

console.log("gestures");

const FACTOR = 0.5; // a 960 px wide monitor
const css = (framePoint: Point): Point => frameToCss(framePoint, FACTOR);
const start = (project: MotionProject, kind: GestureKind, press: Point, o: { sceneIndex?: number; layerId?: string; local?: number; factor?: number } = {}): Gesture => {
  const g = beginGesture({ kind, project, sceneIndex: o.sceneIndex ?? 0, layerId: o.layerId ?? "rect", local: o.local ?? 1, measure: defaultMeasure, press, factor: o.factor ?? FACTOR });
  assert.ok(g, "gesture should start");
  return g;
};
const NO_MODS = { shift: false, alt: false };
const solo = (layer: Layer, o: Partial<MotionScene> = {}) => { const scene = sceneOf([layer], o); return { scene, project: projectOf([scene]) }; };
const first = (p: MotionProject, id = "rect") => layerOf(p, 0, id);

test("moving: the pointer's travel in css pixels is the layer's travel in frame pixels divided by the scale", () => {
  const { project } = solo(rect());
  const g = start(project, { type: "move" }, css({ x: 960, y: 540 }));
  const step = stepGesture(g, css({ x: 1060, y: 600 }), NO_MODS);
  const moved = first(step.project) as RectLayer;
  assert.equal(moved.x, 1060);
  assert.equal(moved.y, 600);
  assert.notEqual(step.project, project);
  assert.equal(project.scenes[0].layers[0].x, 960, "the base project is untouched");
  assert.deepEqual(step.guides, []);
});

test("moving: each step is computed from the project at the start, so a path and its end point give the same project", () => {
  const { project } = solo(rect({ x: [{ t: 0, v: 100, ease: "linear" }, { t: 2, v: 900, ease: "linear" }] }));
  const g = start(project, { type: "move" }, css({ x: 500, y: 540 }));
  let walked = project;
  for (const px of [510, 560, 700, 640, 612]) walked = stepGesture(g, css({ x: px, y: 560 }), NO_MODS).project;
  assert.deepEqual(walked, stepGesture(g, css({ x: 612, y: 560 }), NO_MODS).project);
});

test("moving: back to the starting point is the very same project (no undo step for a drag that went nowhere)", () => {
  const { project } = solo(rect());
  const g = start(project, { type: "move" }, css({ x: 960, y: 540 }));
  stepGesture(g, css({ x: 1200, y: 800 }), NO_MODS);
  assert.equal(stepGesture(g, css({ x: 960, y: 540 }), NO_MODS).project, project);
  const animated = solo(rect({ y: [{ t: 0, v: 100 }, { t: 2, v: 500 }] })).project;
  const h = start(animated, { type: "move" }, css({ x: 960, y: 540 }));
  assert.equal(stepGesture(h, css({ x: 960, y: 540 }), NO_MODS).project, animated, "also on an animated track");
});

test("moving an animated layer writes a key at the playhead, on the frame grid, and the playhead's box is the one grabbed", () => {
  const { project } = solo(rect({ x: [{ t: 0, v: 100, ease: "linear" }, { t: 2, v: 900, ease: "linear" }] }));
  const g = start(project, { type: "move" }, css({ x: 500, y: 540 }), { local: 1.0123 });
  near(g.t, 1);
  near(g.box.cx, 500);
  const moved = first(stepGesture(g, css({ x: 700, y: 540 }), NO_MODS).project) as RectLayer;
  assert.ok(Array.isArray(moved.x));
  const keys = moved.x as Keyframe[];
  assert.deepEqual(keys.map((k) => k.t), [0, 1, 2]);
  assert.equal(keys[1].v, 700, "200 frame px right of 500");
  assert.equal(moved.y, 540, "an untouched static track stays as it was");
});

test("moving snaps to the guides unless Alt is held, and reports the guide lines", () => {
  const { project } = solo(rect());
  const g = start(project, { type: "move" }, css({ x: 960, y: 540 }));
  // 6 frame px away from the centre: inside the 16 frame px pull of a 0.5 monitor
  const near960 = stepGesture(g, css({ x: 966, y: 540 }), NO_MODS);
  assert.equal(first(near960.project), first(project), "pulled back onto the centre lines: nothing moved");
  assert.equal(near960.project, project);
  assert.ok(near960.guides.some((l) => l.axis === "x" && l.at === 960));
  const free = stepGesture(g, css({ x: 966, y: 540 }), { shift: false, alt: true });
  assert.equal((first(free.project) as RectLayer).x, 966);
  assert.deepEqual(free.guides, []);
});

test("moving: the pull is 8 screen pixels whatever the monitor's size", () => {
  const { project } = solo(rect());
  // 5 css px off the centre line: 10 frame px at 0.5, 2.5 at 2
  const small = start(project, { type: "move" }, { x: 480, y: 270 }, { factor: 0.5 });
  assert.equal(stepGesture(small, { x: 485, y: 270 }, NO_MODS).project, project, "snaps back");
  const big = start(project, { type: "move" }, { x: 1920, y: 1080 }, { factor: 2 });
  assert.equal(stepGesture(big, { x: 1925, y: 1080 }, NO_MODS).project, project, "5 css px is within 8 at any size: snaps back too");
  const far = start(project, { type: "move" }, { x: 1920, y: 1080 }, { factor: 2 });
  const r = stepGesture(far, { x: 1940, y: 1080 }, NO_MODS);
  assert.equal((first(r.project) as RectLayer).x, 970, "20 css px is 10 frame px at factor 2, more than the 4 frame px pull");
});

test("resizing from a corner: pressing off-centre doesn't jump, the opposite corner stays, the shape stays", () => {
  const { project } = solo(rect({ w: 400, h: 200 }));
  const corner = { x: 1160, y: 640 }; // bottom right
  const press = css({ x: corner.x + 12, y: corner.y + 12 }); // 6 css px off the handle's centre
  const g = start(project, { type: "resize", corner: "br" }, press);
  assert.equal(stepGesture(g, press, NO_MODS).project, project, "no movement, no change");
  const step = stepGesture(g, { x: press.x + 100, y: press.y + 100 }, NO_MODS);
  const grown = first(step.project) as RectLayer;
  near(grown.scale as number, 1.6, 1e-9);
  const box = boxIn(step.project, 0, "rect", 1);
  nearPoint(boxCorners(box)[0], { x: 760, y: 440 }, 1e-2, "top-left stays");
  near(box.w / box.h, 2, 1e-9);
});

test("resizing every corner of a turned layer keeps the opposite corner where it was", () => {
  const { project } = solo(rect({ rotation: 33, scale: 1.3 }));
  const box = boxIn(project, 0, "rect", 1);
  const corners = boxCorners(box);
  (["tl", "tr", "br", "bl"] as const).forEach((corner, i) => {
    const opposite = corners[(i + 2) % 4];
    const handle = corners[i];
    const g = start(project, { type: "resize", corner }, css(handle));
    // drag the corner 150 frame px towards the opposite corner and 40 px sideways
    const towards = { x: opposite.x - handle.x, y: opposite.y - handle.y };
    const len = Math.hypot(towards.x, towards.y);
    const to = { x: handle.x + (towards.x / len) * 150 + 20, y: handle.y + (towards.y / len) * 150 - 20 };
    const next = boxIn(stepGesture(g, css(to), NO_MODS).project, 0, "rect", 1);
    nearPoint(boxCorners(next)[(i + 2) % 4], opposite, 1e-2, `${corner}: opposite corner`);
    assert.ok(next.scale < box.scale, `${corner}: shrinks`);
  });
});

test("rotating: the handle follows the pointer, Shift snaps to 15 degrees, pressing it doesn't turn the layer", () => {
  const { project } = solo(rect({ w: 400, h: 200 }));
  const box = boxIn(project, 0, "rect", 1);
  const handle = rotateHandle(box, ROTATE_STEM / FACTOR);
  const g = start(project, { type: "rotate" }, css(handle));
  assert.equal(stepGesture(g, css(handle), NO_MODS).project, project, "pressed, not moved");
  // point at 80 degrees from straight up, 400 frame px from the centre
  const at80 = css({ x: 960 + 400 * Math.sin((80 * Math.PI) / 180), y: 540 - 400 * Math.cos((80 * Math.PI) / 180) });
  near((first(stepGesture(g, at80, NO_MODS).project) as RectLayer).rotation as number, 80, 1e-2);
  near((first(stepGesture(g, at80, { shift: true, alt: false }).project) as RectLayer).rotation as number, 75);
  const right = css({ x: 1360, y: 540 });
  near((first(stepGesture(g, right, NO_MODS).project) as RectLayer).rotation as number, 90, 1e-2);
  assert.equal(stepGesture(g, css(handle), NO_MODS).project, project, "and back");
});

test("rotating a grabbed handle off-centre doesn't snap the layer to the pointer's direction", () => {
  const { project } = solo(rect());
  const box = boxIn(project, 0, "rect", 1);
  const handle = rotateHandle(box, ROTATE_STEM / FACTOR);
  const press = { x: css(handle).x + 9, y: css(handle).y + 5 };
  const g = start(project, { type: "rotate" }, press);
  assert.equal(stepGesture(g, press, NO_MODS).project, project);
  assert.notEqual(stepGesture(g, { x: press.x + 60, y: press.y }, NO_MODS).project, project);
});

test("a gesture under a zoom transition: the pointer travels on the zoomed screen, the layer in its own frame", () => {
  const second = sceneOf([rect({ x: 960, y: 540 })], withTransition("zoom", 1));
  const project = projectOf([sceneOf([]), second]);
  const local = 0.2;
  const scale = transitionPlacement(project, 1, local).scale;
  near(scale, 1.25 - 0.25 * 0.032, 1e-9);
  const g = start(project, { type: "move" }, css({ x: 960, y: 540 }), { sceneIndex: 1, local });
  const step = stepGesture(g, css({ x: 965, y: 540 }), NO_MODS);
  assert.deepEqual(step.guides, [], "no guides on a moving scene");
  near((layerOf(step.project, 1, "rect") as RectLayer).x as number, 960 + 5 / scale, 1e-2);
  assert.equal(step.project.scenes[0], project.scenes[0], "other scenes keep their identity");
});

test("a gesture under a slide transition: the box is the screen's, shifted", () => {
  const second = sceneOf([rect({ x: 100, y: 540, w: 200, h: 100 })], withTransition("slide", 1));
  const project = projectOf([sceneOf([]), second]);
  const placement = transitionPlacement(project, 1, 0.25);
  const onScreen = placePoint({ x: 100, y: 540 }, placement, FRAMES["16:9"]);
  const g = start(project, { type: "move" }, css(onScreen), { sceneIndex: 1, local: 0.25 });
  const step = stepGesture(g, { x: css(onScreen).x + 40, y: css(onScreen).y }, NO_MODS);
  near((layerOf(step.project, 1, "rect") as RectLayer).x as number, 180, 1e-6);
});

test("beginGesture refuses what can't be grabbed", () => {
  const { project } = solo(rect({ end: 0.5 }));
  const base = { kind: { type: "move" } as GestureKind, project, sceneIndex: 0, layerId: "rect", local: 1, measure: defaultMeasure, press: { x: 0, y: 0 }, factor: FACTOR };
  assert.equal(beginGesture({ ...base, local: 1 }), null, "not drawn at that moment");
  assert.equal(beginGesture({ ...base, local: 0.2 })?.layerId, "rect");
  assert.equal(beginGesture({ ...base, layerId: "nope", local: 0.2 }), null);
  assert.equal(beginGesture({ ...base, sceneIndex: 3, local: 0.2 }), null);
  assert.equal(beginGesture({ ...base, factor: 0, local: 0.2 }), null);
  assert.equal(beginGesture({ ...base, factor: NaN, local: 0.2 }), null);
  assert.equal(beginGesture({ ...base, project: projectOf([sceneOf([])]), local: 0.2 }), null, "a scene with no layers");
});

test("a layer on the very edge of its window is grabbed at the playhead itself when the nearest frame is outside it", () => {
  const { project } = solo(rect({ end: 0.99995 }));
  const g = beginGesture({ kind: { type: "move" }, project, sceneIndex: 0, layerId: "rect", local: 0.9999, measure: defaultMeasure, press: { x: 0, y: 0 }, factor: FACTOR });
  assert.ok(g);
  near(g.t, 0.9999, 1e-12);
});

test("stepGesture works on a project of 60 scenes and leaves the other 59 untouched", () => {
  const scenes = Array.from({ length: 60 }, () => sceneOf([rect()]));
  const project = projectOf(scenes);
  const g = start(project, { type: "move" }, css({ x: 960, y: 540 }), { sceneIndex: 41 });
  const step = stepGesture(g, css({ x: 1100, y: 640 }), NO_MODS);
  step.project.scenes.forEach((s, i) => { if (i !== 41) assert.equal(s, scenes[i], `scene ${i}`); });
  assert.notEqual(step.project.scenes[41], scenes[41]);
});

test("never mutates its inputs", () => {
  const { project } = solo(rect({ x: [{ t: 0, v: 0 }, { t: 2, v: 900 }] }));
  deepFreeze(project);
  const g = start(project, { type: "move" }, css({ x: 500, y: 540 }));
  deepFreeze(g);
  stepGesture(g, css({ x: 700, y: 600 }), NO_MODS);
  const r = start(project, { type: "resize", corner: "tl" }, css({ x: 760, y: 440 }));
  stepGesture(r, css({ x: 800, y: 480 }), NO_MODS);
  const t = start(project, { type: "rotate" }, css({ x: 960, y: 384 }));
  stepGesture(t, css({ x: 1300, y: 500 }), { shift: true, alt: false });
});

test("every output is finite whatever the pointer does", () => {
  const { project } = solo(rect());
  for (const kind of [{ type: "move" }, { type: "resize", corner: "tl" }, { type: "rotate" }] as GestureKind[]) {
    const g = start(project, kind, css({ x: 960, y: 540 }));
    for (const p of [{ x: NaN, y: 3 }, { x: Infinity, y: -Infinity }, { x: 1e12, y: -1e12 }, { x: 480, y: 270 }]) {
      const step = stepGesture(g, p, NO_MODS);
      const l = first(step.project) as RectLayer;
      for (const v of [l.x, l.y, l.scale, l.rotation]) assert.ok(typeof v === "number" && Number.isFinite(v), `${kind.type} ${JSON.stringify(p)}`);
      for (const guide of step.guides) assert.ok(Number.isFinite(guide.at));
    }
  }
});

test("pastThreshold: a press is a click until the pointer has travelled 4 css pixels", () => {
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 10, y: 10 }), false);
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 12, y: 12 }), false);
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 13, y: 13 }), true);
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 6, y: 10 }), true);
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 12, y: 10 }, 1), true);
});

test("replaceScene: the same scene gives the same project, another one a new project that shares the rest", () => {
  const a = sceneOf([rect()]);
  const b = sceneOf([ellipse()]);
  const project = projectOf([a, b]);
  assert.equal(replaceScene(project, 1, b), project);
  const edited = { ...b, duration: 9 };
  const next = replaceScene(project, 1, edited);
  assert.notEqual(next, project);
  assert.equal(next.scenes[0], a);
  assert.equal(next.scenes[1], edited);
  assert.equal(project.scenes[1], b);
  assert.equal(replaceScene(project, 7, edited), project, "no such scene");
});

// ---------- real text boxes ----------

console.log("measureLayer");

interface Drawn { text: string; x: number; y: number }

/** A canvas whose text is 10 px per character, that records what is drawn. */
function fakeCanvas() {
  const drawn: Drawn[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 1920, height: 1080 },
    font: "",
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (s: string, x: number, y: number) => { drawn.push({ text: s, x, y }); },
  };
  const ctx = new Proxy(target, { get: (o, p) => (p in o ? o[p as string] : () => undefined), set: (o, p, v) => { o[p as string] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawn };
}

/** What drawText paints for a text layer, as a block: its widest line and the number of lines. */
function drawnBlock(layer: TextLayer) {
  const { ctx, drawn } = fakeCanvas();
  renderFrame(ctx, projectOf([sceneOf([layer])]), 1, () => null, SYSTEM_FONTS);
  const rows = [...new Set(drawn.map((d) => d.y))];
  const left = Math.min(...drawn.map((d) => d.x));
  // A letter takes its width plus the layer's letter spacing (the spacing only ever applies to single letters).
  const right = Math.max(...drawn.map((d) => d.x + d.text.length * (10 + layer.letterSpacing)));
  return { rows: rows.length, width: right - left, left, top: Math.min(...rows), bottom: Math.max(...rows) };
}

test("a text block is as wide as its widest line and as tall as its lines: one line", () => {
  const { ctx } = fakeCanvas();
  assert.deepEqual(measureLayer(ctx, text(), SYSTEM_FONTS), { w: 110, h: 72 });
});

test("it wraps at maxWidth exactly where drawText does, for every reveal and alignment", () => {
  const long = "Un deux trois quatre cinq six sept huit neuf dix onze douze\ntreize";
  for (const align of ["left", "center", "right"] as const) {
    for (const reveal of ["none", "fade", "words", "chars", "typewriter"] as const) {
      for (const letterSpacing of [0, 3]) {
        for (const maxWidth of [120, 300, 1000]) {
          const layer = text({ text: long, align, reveal, letterSpacing, maxWidth, size: 40, lineHeight: 1.5 });
          const { ctx } = fakeCanvas();
          const m = measureLayer(ctx, layer, SYSTEM_FONTS);
          const d = drawnBlock(layer);
          const label = `${align} ${reveal} ls=${letterSpacing} max=${maxWidth}`;
          near(m.h, d.rows * 40 * 1.5, 1e-9, `${label}: height ${m.h} for ${d.rows} lines`);
          near(m.w, d.width, 1e-9, `${label}: width`);
        }
      }
    }
  }
});

test("the measured block is centred where drawText centres it, for the box the engine builds", () => {
  const layer = text({ text: "Hello world foo", size: 50, maxWidth: 130, lineHeight: 1.2 });
  const { ctx } = fakeCanvas();
  const m = measureLayer(ctx, layer, SYSTEM_FONTS);
  const d = drawnBlock(layer);
  near((d.top + d.bottom) / 2, 0, 1e-9, "rows are centred on y");
  near(d.left, -m.w / 2, 1e-9, "the widest line starts at -w/2");
});

test("empty and blank text still have a line's height, and no width", () => {
  const { ctx } = fakeCanvas();
  assert.deepEqual(measureLayer(ctx, text({ text: "" }), SYSTEM_FONTS), { w: 0, h: 72 });
  assert.deepEqual(measureLayer(ctx, text({ text: "   \n  " }), SYSTEM_FONTS), { w: 0, h: 144 });
});

test("measuring saves and restores the context, and gives the same answer twice (the layout is cached)", () => {
  const calls: string[] = [];
  const target: Record<string, unknown> = { measureText: (s: string) => ({ width: s.length * 10 }), save: () => calls.push("save"), restore: () => calls.push("restore") };
  const ctx = new Proxy(target, { get: (o, p) => (p in o ? o[p as string] : () => undefined), set: (o, p, v) => { o[p as string] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  const layer = text({ text: "Hello world", weight: 900, font: "serif" });
  const a = measureLayer(ctx, layer, SYSTEM_FONTS);
  assert.deepEqual(calls, ["save", "restore"]);
  assert.deepEqual(measureLayer(ctx, layer, SYSTEM_FONTS), a);
  assert.deepEqual(measureLayer(ctx, captions(), SYSTEM_FONTS), measureLayer(ctx, captions(), SYSTEM_FONTS));
});

test("captions: the block is the page being shown, so it changes as the words are said", () => {
  // 8 words over 8 s: "Un deux trois quatre" (200 wide) then "cinq six sept huit" (180 wide)
  const layer = captions({ text: "Un deux trois quatre cinq six sept huit", end: null });
  const { ctx } = fakeCanvas();
  assert.deepEqual(measureLayer(ctx, layer, SYSTEM_FONTS), { w: 200, h: 75 }, "first page without a moment");
  assert.deepEqual(measureLayer(ctx, layer, SYSTEM_FONTS, { t: 0.5, sceneDuration: 8 }), { w: 200, h: 75 });
  assert.deepEqual(measureLayer(ctx, layer, SYSTEM_FONTS, { t: 7.5, sceneDuration: 8 }), { w: 180, h: 75 });
});

test("captions: wraps at maxWidth like drawCaptions, and an empty window or empty text is still measurable", () => {
  const { ctx } = fakeCanvas();
  // 20 + 10 + 40 = 70 fits in 100, "trois" (50) and "quatre" (60) each need a line of their own
  const wrapped = measureLayer(ctx, captions({ text: "Un deux trois quatre", maxWidth: 100 }), SYSTEM_FONTS, { t: 0.1, sceneDuration: 4 });
  assert.deepEqual(wrapped, { w: 70, h: 225 });
  const emptyWindow = measureLayer(ctx, captions({ text: "Un deux trois quatre", start: 2, end: 2 }), SYSTEM_FONTS, { t: 2, sceneDuration: 4 });
  assert.deepEqual(emptyWindow, { w: 200, h: 75 }, "falls back to the first page");
  assert.deepEqual(measureLayer(ctx, captions({ text: "" }), SYSTEM_FONTS, { t: 0, sceneDuration: 4 }), { w: 0, h: 0 });
});

test("the frame hugs the measured block: selectionView with the real measure", () => {
  const layer = text({ text: "Hello world", align: "left" });
  const scene = sceneOf([layer]);
  const project = projectOf([scene]);
  const { ctx } = fakeCanvas();
  const view = selectionView(project, sel(scene, "text"), 1, (s, local) => measureAt((l, moment) => measureLayer(ctx, l, SYSTEM_FONTS, moment), s, local));
  assert.equal(view.kind, "frame");
  if (view.kind === "frame") {
    near(view.box.w, 110); near(view.box.h, 72);
    near(view.box.cx, 960 + 55, 1e-9, "left-aligned text starts at its point");
  }
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
