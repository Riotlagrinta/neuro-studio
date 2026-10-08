import assert from "node:assert/strict";
import { deleteLayer, keyTimes, layerEnd, moveKeyframes, moveLayer, setSceneDuration, snapToFrame, snapToTenth, trimLayer, updateLayer } from "../src/lib/motion/edit";
import { normalizeScene } from "../src/lib/motion/sanitize";
import * as H from "../src/lib/history";

let n = 0, failed = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 300)); } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// A small scene whose numbers are easy to reason about.
const scene = () => normalizeScene({
  duration: 10,
  layers: [
    { type: "text", text: "Title", start: 1, x: [{ t: 1, v: 0 }, { t: 2, v: 100 }, { t: 3, v: 200 }], opacity: [{ t: 2, v: 0 }, { t: 3, v: 1 }] },
    { type: "rect", start: 2, end: 6, w: [{ t: 2, v: 0 }, { t: 4, v: 400 }] },
    { type: "ellipse" },
  ],
}, 0, "16:9", false);
const L = (s: ReturnType<typeof scene>, i: number) => s.layers[i];

console.log("edit.ts");
t("snapping: frame (1/30 s) and tenth", () => {
  assert.ok(Math.abs(snapToFrame(0.51) - 15 / 30) < 1e-9);
  assert.ok(Math.abs(snapToFrame(1.0167) - 31 / 30) < 1e-9);
  assert.equal(snapToTenth(4.56), 4.6);
});
t("moveLayer: window and ALL keyframes travel together", () => {
  const s = moveLayer(scene(), L(scene(), 0).id, -0.5);
  const l = L(s, 0) as any;
  assert.equal(l.start, 0.5);
  assert.equal(l.end, 9.5, "an open-ended layer gets an explicit end when it moves left");
  assert.deepEqual(l.x.map((k: any) => k.t), [0.5, 1.5, 2.5]);
  assert.deepEqual(l.opacity.map((k: any) => k.t), [1.5, 2.5]);
  assert.deepEqual(l.x.map((k: any) => k.v), [0, 100, 200], "values are untouched");
});
t("moveLayer: moving back restores the open end (null)", () => {
  const s0 = scene();
  const s = moveLayer(moveLayer(s0, L(s0, 0).id, -0.5), L(s0, 0).id, 0.5);
  assert.deepEqual(clone(L(s, 0)), clone(L(s0, 0)));
});
t("moveLayer: stays inside the scene (can't start before 0 or end after the scene)", () => {
  const s0 = scene();
  assert.equal((L(moveLayer(s0, L(s0, 0).id, -99), 0) as any).start, 0);
  assert.equal(moveLayer(s0, L(s0, 0).id, +5), s0, "an open-ended layer is already at the end: nothing to do");
    const r = L(moveLayer(s0, L(s0, 1).id, +99), 1);
  assert.equal(r.start, 6);
  assert.equal(r.end, null, "reaching the scene end becomes open-ended");
});
t("moveLayer: a no-op returns the very same scene object (no needless re-render)", () => {
  const s0 = scene();
  assert.equal(moveLayer(s0, L(s0, 0).id, 0), s0 as any);
});
t("every no-op edit returns the very same scene (a drag back to the start leaves no undo step)", () => {
  const s0 = scene(); const id = L(s0, 1).id; const open = L(s0, 0).id;
  assert.equal(moveLayer(s0, id, 0), s0, "moveLayer 0");
  assert.equal(trimLayer(s0, id, "start", 2), s0, "trim start to itself");
  assert.equal(trimLayer(s0, id, "end", 6), s0, "trim end to itself");
  assert.equal(trimLayer(s0, open, "end", 999), s0, "already open-ended");
  assert.equal(moveKeyframes(s0, id, 2, 2), s0, "keyframes onto themselves");
  assert.equal(moveKeyframes(s0, id, 9.9, 3), s0, "no keyframe at that time");
  assert.equal(updateLayer(s0, open, { text: "Title" }), s0, "same text");
  assert.equal(setSceneDuration(s0, 10), s0, "same duration");
});
t("trimLayer: clamps, and reaching the end re-opens it", () => {
  const s0 = scene();
  const id = L(s0, 1).id; // 2 -> 6
  assert.equal(L(trimLayer(s0, id, "start", 5.99), 1).start, 5.9, "can't trim below the minimum length");
  assert.equal(L(trimLayer(s0, id, "start", -3), 1).start, 0);
  assert.equal(L(trimLayer(s0, id, "end", 2.01), 1).end, 2.1);
  assert.equal(L(trimLayer(s0, id, "end", 99), 1).end, null);
  assert.deepEqual(clone((L(trimLayer(s0, id, "start", 3), 1) as any).w), clone((L(s0, 1) as any).w), "trimming doesn't move keyframes");
});
t("moveKeyframes: every track keyed at that time moves, sorted, moved key wins a collision", () => {
  const s0 = scene();
  const s = moveKeyframes(s0, L(s0, 0).id, 2, 3);
  const l = L(s, 0) as any;
  assert.deepEqual(l.x, [{ t: 1, v: 0 }, { t: 3, v: 100 }], "x: the pose from t=2 replaced the one at t=3");
  assert.deepEqual(l.opacity, [{ t: 3, v: 0 }], "opacity: same");
});
t("moveKeyframes: moving earlier keeps order; clamped to the scene", () => {
  const s0 = scene();
  const l = L(moveKeyframes(s0, L(s0, 0).id, 3, 0.2), 0) as any;
  assert.deepEqual(l.x.map((k: any) => k.t), [0.2, 1, 2]);
  const m = L(moveKeyframes(s0, L(s0, 0).id, 1, 99), 0) as any;
  assert.equal(m.x[m.x.length - 1].t, 10, "clamped to the scene length");
});
t("moveKeyframes: unknown time or id changes nothing", () => {
  const s0 = scene();
  assert.deepEqual(clone(L(moveKeyframes(s0, L(s0, 0).id, 7.7, 1), 0)), clone(L(s0, 0)));
  assert.equal(moveKeyframes(s0, "nope", 1, 2), s0);
});
t("setSceneDuration: clamps 1.5–40; open layers follow; explicit ends beyond the new end open up", () => {
  const s0 = scene();
  const short = setSceneDuration(s0, 4);
  assert.equal(short.duration, 4);
  assert.equal(L(short, 1).end, null, "6 > 4: runs to the (new) end");
  assert.equal(L(short, 1).start, 2);
  const longer = setSceneDuration(s0, 20);
  assert.equal(L(longer, 1).end, 6, "an explicit end inside the scene stays");
  assert.equal(setSceneDuration(s0, 0).duration, 1.5);
  assert.equal(setSceneDuration(s0, 999).duration, 40);
  assert.equal(setSceneDuration(s0, 10), s0);
  assert.equal(L(setSceneDuration(s0, 1.5), 0).start, 1, "start 1 is still before the new end");
  assert.ok(L(setSceneDuration(setSceneDuration(s0, 10), 1.5), 1).start <= 1.4, "a layer starting after the new end is pulled back into view");
});
t("deleteLayer: removes one; the last layer can't be removed", () => {
  const s0 = scene();
  const s1 = deleteLayer(s0, L(s0, 1).id);
  assert.equal(s1.layers.length, 2);
  const s2 = deleteLayer(deleteLayer(s1, L(s0, 0).id), L(s0, 2).id);
  assert.equal(s2.layers.length, 1);
  assert.equal(deleteLayer(s0, "nope"), s0);
});
t("updateLayer: sets static props; id and type can't be changed", () => {
  const s0 = scene();
  const s = updateLayer(s0, L(s0, 0).id, { text: "Hello", color: "#ff0000", id: "hacked", type: "rect" });
  const l = L(s, 0) as any;
  assert.deepEqual([l.text, l.color, l.id, l.type], ["Hello", "#ff0000", L(s0, 0).id, "text"]);
});
t("nothing mutates its input", () => {
  const s0 = scene(); const before = clone(s0); const id = L(s0, 0).id;
  moveLayer(s0, id, -0.4); trimLayer(s0, id, "end", 5); moveKeyframes(s0, id, 2, 2.5); setSceneDuration(s0, 3); deleteLayer(s0, id); updateLayer(s0, id, { text: "x" });
  assert.deepEqual(clone(s0), before);
});
t("keyTimes: unique, sorted, across tracks; layerEnd", () => {
  const s0 = scene();
  assert.deepEqual(keyTimes(L(s0, 0)), [1, 2, 3]);
  assert.deepEqual(keyTimes(L(s0, 1)), [2, 4]);
  assert.deepEqual(keyTimes(L(s0, 2)), []);
  assert.equal(layerEnd(s0, L(s0, 0)), 10);
  assert.equal(layerEnd(s0, L(s0, 1)), 6);
});

console.log("history.ts");
const ev = (h: H.History<number>, v: number, key?: string, now = 0) => H.commit(h, v, { key, now });
t("commit / undo / redo walk the steps; a new edit clears the future", () => {
  let h = H.createHistory(0);
  h = ev(h, 1); h = ev(h, 2); h = ev(h, 3);
  assert.deepEqual([h.present, h.past.length], [3, 3]);
  h = H.undo(h); h = H.undo(h);
  assert.equal(h.present, 1);
  assert.ok(H.canRedo(h));
  h = H.redo(h);
  assert.equal(h.present, 2);
  h = ev(h, 99);
  assert.ok(!H.canRedo(h), "branching clears redo");
  assert.equal(H.undo(h).present, 2);
});
t("undo/redo at the ends do nothing", () => {
  const h = H.createHistory(5);
  assert.equal(H.undo(h), h);
  assert.equal(H.redo(h), h);
  assert.ok(!H.canUndo(h) && !H.canRedo(h));
});
t("typing coalesces: same key within the window = one step; other key or a pause = new step", () => {
  let h = H.createHistory(0);
  h = ev(h, 1, "text", 1000); h = ev(h, 2, "text", 1200); h = ev(h, 3, "text", 1500);
  assert.equal(h.past.length, 1, "three keystrokes, one step");
  assert.equal(H.undo(h).present, 0, "undo goes back to before the typing");
  h = ev(h, 4, "color", 1600);
  assert.equal(h.past.length, 2, "another field starts a new step");
  h = ev(h, 5, "color", 1600 + H.COALESCE_MS + 1);
  assert.equal(h.past.length, 3, "a pause starts a new step");
});
t("an edit with no key never coalesces; no-op edits add nothing", () => {
  let h = H.createHistory(0);
  h = ev(h, 1, undefined, 1); h = ev(h, 2, undefined, 2);
  assert.equal(h.past.length, 2);
  assert.equal(ev(h, 2), h);
});
t("drag: many live updates, ONE undo step back to where it started", () => {
  let h = H.createHistory(10);
  h = H.begin(h);
  for (const v of [11, 12, 13, 14]) h = H.update(h, v);
  assert.equal(h.past.length, 0, "nothing recorded while dragging");
  h = H.end(h);
  assert.deepEqual([h.present, h.past.length], [14, 1]);
  assert.equal(H.undo(h).present, 10);
  assert.equal(H.redo(H.undo(h)).present, 14);
});
t("a drag that ends where it began adds no step; begin twice keeps the first base", () => {
  let h = H.createHistory(10);
  h = H.begin(h); h = H.update(h, 12); h = H.begin(h); h = H.update(h, 10);
  h = H.end(h);
  assert.equal(h.past.length, 0);
  h = H.begin(H.createHistory(1)); h = H.update(h, 2); h = H.begin(h); h = H.update(h, 3); h = H.end(h);
  assert.equal(H.undo(h).present, 1, "first base wins");
});
t("patchAll reaches every step, so undo can't take a paid asset away", () => {
  let h = H.createHistory(1);
  h = ev(h, 2, undefined, 1); h = ev(h, 3, undefined, 2);
  h = H.undo(h);
  h = H.patchAll(h, (v) => v + 100);
  assert.deepEqual([h.past, h.present, h.future], [[101], 102, [103]]);
});
t("history is capped at 100 steps (oldest dropped)", () => {
  let h = H.createHistory(0);
  for (let i = 1; i <= 130; i++) h = ev(h, i);
  assert.equal(h.past.length, 100);
  assert.equal(h.past[0], 30);
});
console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
