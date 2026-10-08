import assert from "node:assert/strict";
import { musicGainCurve } from "../src/lib/motion/audio-mix";
import { moveScene } from "../src/lib/motion/scenes";
import {
  ZOOM_MAX, ZOOM_MIN, clampSceneShift, clampZoom, gainShape, isDragMove, sceneDropIndex, wheelZoomFactor, zoomAnchor, zoomScrollLeft,
} from "../src/lib/motion/timeline-math";
import { sceneStart, type MotionProject, type MotionScene } from "../src/lib/motion/types";

let n = 0, failed = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };
const near = (actual: number, expected: number, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

// ---------- fixtures ----------

const scene = (i: number, duration: number, narrated = false): MotionScene => ({
  uid: `scene-${i}-abcdef`,
  id: i + 1,
  voiceOver: "",
  visualPrompt: "",
  duration,
  background: { type: "solid", color: "#000000" },
  transition: { type: "none", duration: 0.5 },
  layers: [],
  ...(narrated ? { audioUrl: "https://x.test/voice.mp3" } : {}),
});
/** "2 3n 4" = scenes of 2, 3 (narrated) and 4 seconds. */
const proj = (spec: string, music: Partial<NonNullable<MotionProject["music"]>> | null = null): MotionProject => ({
  title: "Titre",
  category: "Catégorie",
  ratio: "16:9",
  palette: [],
  scenes: spec.split(/\s+/).map((tok, i) => scene(i, parseFloat(tok), tok.endsWith("n"))),
  music: music && { url: "https://x.test/m.mp3", name: "m", volume: 1, fadeIn: 0, fadeOut: 0, duck: false, ...music },
});
const durations = (p: MotionProject) => p.scenes.map((s) => s.duration);
/** The "x,y" pairs of an SVG points string. */
const pairs = (points: string) => points.split(" ").map((p) => p.split(",").map(Number));

console.log("drag threshold");
t("a press under 4 px is a click, from 4 px on it is a drag (any direction)", () => {
  assert.equal(isDragMove(0, 0), false);
  assert.equal(isDragMove(3.99, 0), false);
  assert.equal(isDragMove(0, -3.99), false);
  assert.equal(isDragMove(4, 0), true);
  assert.equal(isDragMove(-4, 0), true);
  assert.equal(isDragMove(0, 4), true);
  assert.equal(isDragMove(2.9, 2.9), true, "the distance counts, not each axis");
  assert.equal(isDragMove(NaN, 10), false);
});

console.log("sceneDropIndex");
// Blocks of 2, 3 and 4 s: midpoints at 1, 3.5 and 7.
t("shift 0 is always 'stay', whatever the layout", () => {
  for (const spec of ["5", "2 3 4", "0.3 40 0.3 7 7 7", "1 1 1 1"]) {
    const d = durations(proj(spec));
    d.forEach((_, from) => assert.equal(sceneDropIndex(d, from, 0), from, `${spec} @${from}`));
  }
  assert.equal(sceneDropIndex([0, 0, 0], 1, 0), 1, "even with zero-length blocks");
});
t("moving right: the target flips when the centre crosses the next midpoint, ties stay put", () => {
  const d = [2, 3, 4];
  assert.equal(sceneDropIndex(d, 0, 2.5), 0, "centre 3.5 = midpoint of block 1: tie");
  assert.equal(sceneDropIndex(d, 0, 2.6), 1);
  assert.equal(sceneDropIndex(d, 0, 6), 1, "centre 7 = midpoint of block 2: tie");
  assert.equal(sceneDropIndex(d, 0, 6.1), 2);
});
t("moving left: same rule mirrored", () => {
  const d = [2, 3, 4]; // block 2 spans 5..9, centre 7
  assert.equal(sceneDropIndex(d, 2, -3.5), 2, "centre 3.5: tie");
  assert.equal(sceneDropIndex(d, 2, -3.6), 1);
  assert.equal(sceneDropIndex(d, 2, -4.9), 1, "centre 2.1, still right of the first midpoint");
  assert.equal(sceneDropIndex(d, 2, -5), 0, "its left edge reached 0");
});
t("middle block: pushed flush against an end it takes the first / last slot", () => {
  const d = [2, 3, 4]; // block 1 spans 2..5, centre 3.5; the others' midpoints are 1 and 7
  assert.equal(sceneDropIndex(d, 1, -1.9), 1, "centre 1.6 is right of 1: still second");
  assert.equal(sceneDropIndex(d, 1, -2), 0, "its left edge reached 0");
  assert.equal(sceneDropIndex(d, 1, 3.4), 1, "centre 6.9 < 7");
  assert.equal(sceneDropIndex(d, 1, 3.6), 2, "centre 7.1 > 7 (the end is at shift 4)");
});
t("pushed against an end of the video = first / last slot, even for a block longer than its neighbours", () => {
  assert.equal(sceneDropIndex([10, 2], 0, 2), 1, "the long block can't go further right; its centre (7) never reaches 11");
  assert.equal(sceneDropIndex([10, 2], 0, 100), 1);
  assert.equal(sceneDropIndex([2, 10], 1, -2), 0);
  assert.equal(sceneDropIndex([2, 10], 1, -100), 0);
  assert.equal(sceneDropIndex([10, 2], 0, 1.9), 0, "not there yet");
});
t("an unusable input never moves anything", () => {
  assert.equal(sceneDropIndex([2, 3, 4], 1, NaN), 1);
  assert.equal(sceneDropIndex([2, NaN, 4], 0, 1), 0);
  assert.equal(sceneDropIndex([], 0, 3), 0);
  assert.equal(sceneDropIndex([2, 3], 5, 3), 5, "unknown scene: handed back, moveScene() refuses it");
  assert.equal(sceneDropIndex([2, 3], -1, 3), -1);
  assert.equal(sceneDropIndex([2, 3], 0.5, 3), 0.5);
  assert.equal(sceneDropIndex([7], 0, 50), 0, "a single scene");
});
t("the index is monotone in the shift and reaches both ends", () => {
  const d = durations(proj("2 3 4 0.3 6 1.5"));
  d.forEach((_, from) => {
    let last = -1;
    const seen = new Set<number>();
    for (let shift = -30; shift <= 30; shift += 0.05) {
      const to = sceneDropIndex(d, from, shift);
      assert.ok(to >= last, `from ${from}: ${to} after ${last} at shift ${shift}`);
      last = to;
      seen.add(to);
    }
    assert.equal(last, d.length - 1);
    assert.equal(sceneDropIndex(d, from, -30), 0);
    assert.equal(seen.size, d.length, `from ${from}: every slot can be reached`);
  });
});

console.log("clampSceneShift");
t("the block stays inside the video", () => {
  const d = [2, 3, 4];
  assert.equal(clampSceneShift(d, 1, 0.5), 0.5);
  assert.equal(clampSceneShift(d, 1, -99), -2, "can't go before 0");
  assert.equal(clampSceneShift(d, 1, 99), 4, "can't go past the end (9 - 5)");
  near(clampSceneShift(d, 0, -1), 0);
  near(clampSceneShift(d, 2, 1), 0);
});
t("unusable input gives no move", () => {
  assert.equal(clampSceneShift([2, 3], 0, NaN), 0);
  assert.equal(clampSceneShift([2, 3], 9, 1), 0);
  assert.equal(clampSceneShift([2, Infinity], 0, 1), 0);
  assert.equal(clampSceneShift([], 0, 1), 0);
});

console.log("a whole drag, pointer move by pointer move");
t("each move is computed from the project at drag start: no drift, back at the start = the very same project", () => {
  const base = proj("2 3 4 5");
  const d = durations(base);
  const PPS = 28;
  const from = 1;
  const orders: string[] = [];
  let target = from;
  let applied = 0;
  // out to the far right then all the way back, 1 px at a time
  const xs = [...Array.from({ length: 700 }, (_, i) => i), ...Array.from({ length: 700 }, (_, i) => 699 - i)];
  for (const dx of xs) {
    const to = sceneDropIndex(d, from, dx / PPS);
    const next = moveScene(base, from, to);
    if (to !== target) { target = to; applied++; }
    assert.equal(next.scenes[to].uid, base.scenes[from].uid, "the dragged scene is where the target says");
    assert.deepEqual(next.scenes.map((s) => s.id), [1, 2, 3, 4]);
    orders.push(next.scenes.map((s) => s.uid.split("-")[1]).join(""));
    if (to === from) assert.equal(next, base, "no move = the same object (the history sees no change)");
  }
  assert.equal(moveScene(base, from, sceneDropIndex(d, from, 0)), base);
  assert.deepEqual([...new Set(orders)], ["0123", "0213", "0231"], "the order is always one of the three, base included");
  assert.equal(applied, 4, "out: 1->2->3, back: 3->2->1");
});
t("drag left past everything, then Esc (= back to base): untouched", () => {
  const base = proj("2 3 4 5");
  const d = durations(base);
  const during = moveScene(base, 3, sceneDropIndex(d, 3, -999));
  assert.deepEqual(during.scenes.map((s) => s.duration), [5, 2, 3, 4]);
  assert.deepEqual(base.scenes.map((s) => s.duration), [2, 3, 4, 5], "base is not mutated");
});
t("the slot the marker shows is where the scene lands", () => {
  const base = proj("2 3 4 5");
  const d = durations(base);
  const to = sceneDropIndex(d, 0, 6.2); // centre 7.2 beyond block 1 (3.5) and block 2 (7)
  assert.equal(to, 2);
  const next = moveScene(base, 0, to);
  assert.equal(sceneStart(next, to), 3 + 4);
});

console.log("zoom");
t("clampZoom: [1, 8], NaN = fitted", () => {
  assert.equal(clampZoom(3), 3);
  assert.equal(clampZoom(0.2), ZOOM_MIN);
  assert.equal(clampZoom(-5), ZOOM_MIN);
  assert.equal(clampZoom(12), ZOOM_MAX);
  assert.equal(clampZoom(Infinity), ZOOM_MAX);
  assert.equal(clampZoom(-Infinity), ZOOM_MIN);
  assert.equal(clampZoom(NaN), ZOOM_MIN);
});
t("wheelZoomFactor: wheel up zooms in, by the same amount it zooms out, in any unit", () => {
  assert.ok(wheelZoomFactor(-100, 0) > 1);
  assert.ok(wheelZoomFactor(100, 0) < 1);
  near(wheelZoomFactor(-100, 0) * wheelZoomFactor(100, 0), 1);
  assert.equal(wheelZoomFactor(0, 0), 1);
  near(wheelZoomFactor(-5, 1), wheelZoomFactor(-80, 0), 1e-12);
  assert.ok(wheelZoomFactor(-1, 2) > wheelZoomFactor(-1, 1));
  assert.ok(wheelZoomFactor(-2, 0) < wheelZoomFactor(-100, 0), "a pinch event is gentler than a mouse notch");
});
t("wheelZoomFactor: one huge or broken event can't jump", () => {
  assert.equal(wheelZoomFactor(-1e9, 0), wheelZoomFactor(-150, 0));
  assert.equal(wheelZoomFactor(NaN, 0), 1);
  assert.equal(wheelZoomFactor(Infinity, 0), 1);
  assert.ok(wheelZoomFactor(-1e9, 0) < 2);
});
t("zoomScrollLeft: the instant under the anchor stays under the anchor", () => {
  const LABEL = 148;
  const cases: [number, number, number, number][] = [
    [0, 500, 28, 56], [120, 300, 28, 224], [1000, 148, 56, 28], [1000, 800, 224, 28], [37.5, 600, 31.7, 99.9],
  ];
  for (const [scroll, anchor, oldPps, newPps] of cases) {
    const before = (scroll + anchor - LABEL) / oldPps;
    const next = zoomScrollLeft(scroll, anchor, LABEL, oldPps, newPps);
    if (next > 0) near((next + anchor - LABEL) / newPps, before, 1e-9);
    else assert.ok((anchor - LABEL) / newPps >= before - 1e-9, "clamped at the left edge: the instant can only have moved right");
  }
});
t("zoomScrollLeft: same scale = same scroll; never negative; round trip", () => {
  assert.equal(zoomScrollLeft(300, 500, 148, 56, 56), 300);
  assert.equal(zoomScrollLeft(0, 148, 148, 28, 224), 0, "anchored on the very start");
  assert.equal(zoomScrollLeft(0, 600, 148, 224, 28), 0, "zooming out from the start can't scroll before it");
  const there = zoomScrollLeft(300, 500, 148, 56, 168);
  near(zoomScrollLeft(there, 500, 148, 168, 56), 300, 1e-9);
});
t("zoomScrollLeft: an anchor over the labels counts as the left edge of the tracks", () => {
  assert.equal(zoomScrollLeft(200, 30, 148, 28, 56), zoomScrollLeft(200, 148, 148, 28, 56));
});
t("zoomScrollLeft: broken numbers leave the scroll alone", () => {
  assert.equal(zoomScrollLeft(300, 500, 148, 0, 56), 300);
  assert.equal(zoomScrollLeft(300, 500, 148, 28, NaN), 300);
  assert.equal(zoomScrollLeft(300, NaN, 148, 28, 56), 300);
  assert.equal(zoomScrollLeft(NaN, 500, 148, 28, 56), 0);
  assert.equal(zoomScrollLeft(-40, 500, 148, 28, NaN), 0);
});
t("zoomAnchor: the playhead if it is on screen, else the middle of the tracks", () => {
  assert.equal(zoomAnchor(400, 148, 900), 400);
  assert.equal(zoomAnchor(148, 148, 900), 148);
  assert.equal(zoomAnchor(900, 148, 900), 900);
  assert.equal(zoomAnchor(50, 148, 900), 524, "hidden under the labels");
  assert.equal(zoomAnchor(1400, 148, 900), 524, "past the right edge");
  assert.equal(zoomAnchor(NaN, 148, 900), 524);
});

console.log("gainShape (music envelope)");
t("no music, one point or no duration: nothing to draw", () => {
  assert.equal(gainShape(null, 10), null);
  assert.equal(gainShape([{ t: 0, gain: 1 }], 10), null);
  assert.equal(gainShape([{ t: 0, gain: 1 }, { t: 10, gain: 1 }], 0), null);
  assert.equal(gainShape([{ t: 0, gain: 1 }, { t: 10, gain: 1 }], NaN), null);
  assert.equal(gainShape(musicGainCurve(proj("2 3", null)), 5), null, "a project without music has no curve");
  assert.equal(gainShape(musicGainCurve(proj("2 3", { volume: 1 })), 0), null);
});
t("full volume, no fades, no ducking: a flat line along the top", () => {
  const p = proj("2 3", { volume: 1 });
  const shape = gainShape(musicGainCurve(p), 5);
  assert.deepEqual(shape && pairs(shape.line), [[0, 0], [5, 0]]);
  assert.equal(shape?.area, "0,0 5,0 5,1 0,1", "closed along the bottom edge");
});
t("volume sets the height of the plateau (gain 1 at the top)", () => {
  const shape = gainShape(musicGainCurve(proj("2 3", { volume: 0.25 })), 5);
  assert.deepEqual(shape && pairs(shape.line), [[0, 0.75], [5, 0.75]]);
});
t("fades are ramps from silence (bottom) to the plateau", () => {
  const shape = gainShape(musicGainCurve(proj("2 3", { volume: 1, fadeIn: 1, fadeOut: 2 })), 5);
  assert.deepEqual(shape && pairs(shape.line), [[0, 1], [1, 0], [3, 0], [5, 1]]);
});
t("ducking draws dips under the narrated scenes, and the curve spans the whole video", () => {
  // 2 s silent, 3 s narrated, 2 s silent: gain 0.3 (y 0.7) between 2 and 5, 0.25 s ramps either side
  const p = proj("2 3n 2", { volume: 1, duck: true });
  const total = 7;
  const shape = gainShape(musicGainCurve(p), total);
  assert.ok(shape);
  const pts = pairs(shape.line);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[pts.length - 1], [total, 0]);
  assert.ok(pts.some(([x, y]) => x === 2 && Math.abs(y - 0.7) < 1e-9), "down at the start of the narration");
  assert.ok(pts.some(([x, y]) => x === 5 && Math.abs(y - 0.7) < 1e-9), "still down at its end");
  assert.ok(pts.every(([x], i) => i === 0 || x > pts[i - 1][0]), "x only goes forward");
  assert.ok(pts.every(([x, y]) => x >= 0 && x <= total && y >= 0 && y <= 1));
  assert.equal(shape.area, `${shape.line} ${total},1 0,1`);
});
t("points that aren't finite are skipped, gains outside 0-1 are held to the box", () => {
  const shape = gainShape([{ t: 0, gain: 2 }, { t: NaN, gain: 0.5 }, { t: 5, gain: -1 }, { t: 10, gain: Infinity }], 10);
  assert.deepEqual(shape && pairs(shape.line), [[0, 0], [5, 1]]);
  assert.equal(gainShape([{ t: 0, gain: NaN }, { t: 4, gain: 1 }], 4), null, "one usable point is not a curve");
  const clipped = gainShape([{ t: -3, gain: 1 }, { t: 20, gain: 1 }], 10);
  assert.deepEqual(clipped && pairs(clipped.line), [[0, 0], [10, 0]], "times outside the video are held to its ends");
});
t("many-point curves stay compact (coordinates are rounded)", () => {
  const shape = gainShape([{ t: 0, gain: 1 / 3 }, { t: 1 / 3, gain: 2 / 3 }], 1);
  assert.equal(shape?.line, "0,0.6667 0.333,0.3333");
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
