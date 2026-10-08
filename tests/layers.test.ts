import assert from "node:assert/strict";
import { deleteLayer } from "../src/lib/motion/edit";
import { MAX_LAYERS, addLayer, canAddLayer, createLayer, duplicateLayer, reorderLayer, type LayerReorder, type NewLayerKind } from "../src/lib/motion/layers";
import { boxCorners, hitTest, layerBox } from "../src/lib/motion/manipulate";
import { normalizeScene } from "../src/lib/motion/sanitize";
import { isBackdropLayer } from "../src/lib/motion/selection";
import { FRAMES, type AspectRatio, type EllipseLayer, type Layer, type MediaLayer, type MotionScene, type RectLayer, type TextLayer } from "../src/lib/motion/types";

let n = 0, failed = 0;
const test = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };

// ---------- fixtures ----------

const RATIOS: AspectRatio[] = ["16:9", "9:16"];
const KINDS: NewLayerKind[] = ["text", "rect", "ellipse"];
const ORDERS: LayerReorder[] = ["front", "back", "forward", "backward"];

const common = { start: 0, end: null as number | null, x: 960, y: 540, rotation: 0, scale: 1, opacity: 1 };
const sceneOf = (duration: number, ...layers: Layer[]): MotionScene => ({
  uid: "scene-uid", id: 1, voiceOver: "", visualPrompt: "", duration,
  background: { type: "solid", color: "#000000" }, transition: { type: "none", duration: 0.5 }, layers,
});
const media = (ratio: AspectRatio): MediaLayer => ({ id: "media", type: "media", ...common, w: FRAMES[ratio].width, h: FRAMES[ratio].height, anchor: "center" });
const dim = (ratio: AspectRatio): RectLayer => ({ id: "dim", type: "rect", ...common, w: FRAMES[ratio].width, h: FRAMES[ratio].height, radius: 0, fill: "#000000", stroke: null, strokeWidth: 0, anchor: "center", opacity: 0.45 });
const withId = (layer: Layer, id: string): Layer => ({ ...layer, id });
/** A scene as the AI makes it: media, its dim veil, then a few layers of ours on top. */
const backdropScene = (ratio: AspectRatio, duration = 10): MotionScene => {
  let s = sceneOf(duration, media(ratio), dim(ratio));
  for (const kind of KINDS) s = addLayer(s, createLayer(kind, s, ratio, 1));
  return s;
};

const deepFreeze = <T,>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ids = (s: MotionScene) => s.layers.map((l) => l.id);
const unique = (s: MotionScene) => new Set(ids(s)).size === s.layers.length;
const noId = (l: Layer) => { const { id, ...rest } = l; void id; return rest; };
const onGrid = (t: number) => Math.abs(t * 30 - Math.round(t * 30)) < 0.02;

/** Small deterministic PRNG (mulberry32) so a failing sequence can be replayed. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const asText = (l: Layer) => { assert.equal(l.type, "text"); return l as TextLayer; };
const asRect = (l: Layer) => { assert.equal(l.type, "rect"); return l as RectLayer; };
const asEllipse = (l: Layer) => { assert.equal(l.type, "ellipse"); return l as EllipseLayer; };

// ---------- createLayer ----------

console.log("layers.ts");
test("createLayer: text defaults, sized for the frame, in both ratios", () => {
  for (const ratio of RATIOS) {
    const { width, height } = FRAMES[ratio];
    const l = asText(createLayer("text", sceneOf(10), ratio, 2));
    assert.deepEqual([l.x, l.y, l.rotation, l.scale, l.opacity, l.end], [width / 2, height / 2, 0, 1, 1, null]);
    assert.deepEqual([l.text, l.size, l.weight, l.color, l.font, l.align, l.reveal], ["Votre texte", 76, 700, "#ffffff", "sans", "center", "none"]);
    assert.equal(l.maxWidth, width * 0.8);
    assert.equal(l.size, Math.round(Math.min(width, height) * 0.07), "7 % of the SHORT side, whatever the ratio");
  }
});
test("createLayer: rect is 36 % x 25 % of the frame with rounded corners, ellipse a circle of 20 % of the short side", () => {
  const r169 = asRect(createLayer("rect", sceneOf(10), "16:9", 0));
  assert.deepEqual([r169.w, r169.h, r169.radius, r169.fill, r169.stroke, r169.strokeWidth, r169.anchor], [691.2, 270, 32, "#6366f1", null, 0, "center"]);
  const r916 = asRect(createLayer("rect", sceneOf(10), "9:16", 0));
  assert.deepEqual([r916.w, r916.h, r916.radius], [388.8, 480, 47]);
  for (const ratio of RATIOS) {
    const e = asEllipse(createLayer("ellipse", sceneOf(10), ratio, 0));
    assert.deepEqual([e.w, e.h, e.fill, e.stroke, e.strokeWidth, e.anchor], [216, 216, "#f472b6", null, 0, "center"]);
    assert.deepEqual([e.x, e.y], [FRAMES[ratio].width / 2, FRAMES[ratio].height / 2]);
  }
});
test("createLayer: starts at the playhead on the frame grid, never later than 0.5 s before the end", () => {
  const durations = [0.3, 0.5, 0.6, 1, 3, 3.25, 3.3, 10, 40];
  const times = [-5, -0, 0, 0.1, 0.333, 1.27, 2.9, 5, 39.9, 100, NaN, Infinity, -Infinity];
  for (const kind of KINDS) {
    for (const duration of durations) {
      for (const t of times) {
        const l = createLayer(kind, sceneOf(duration), "16:9", t);
        assert.ok(Number.isFinite(l.start) && l.start >= 0, `${kind} ${duration}s @${t}: start ${l.start}`);
        assert.ok(!Object.is(l.start, -0), `${kind} ${duration}s @${t}: start is -0`);
        assert.ok(onGrid(l.start), `${kind} ${duration}s @${t}: ${l.start} is not on a frame`);
        if (duration >= 0.5) assert.ok(duration - l.start >= 0.5 - 1e-9, `${kind} ${duration}s @${t}: only ${duration - l.start}s left`);
        else assert.equal(l.start, 0, "a scene shorter than 0.5 s: the layer starts with it");
        assert.equal(l.end, null);
      }
    }
  }
  assert.equal(createLayer("text", sceneOf(10), "16:9", 1.27).start, 1.267, "the nearest frame, to the millisecond");
  assert.equal(createLayer("text", sceneOf(10), "16:9", 2).start, 2, "on a frame already: untouched");
  assert.equal(createLayer("text", sceneOf(10), "16:9", 99).start, 9.5);
  assert.equal(createLayer("text", sceneOf(10), "16:9", -1).start, 0);
  assert.equal(createLayer("text", sceneOf(10), "16:9", NaN).start, 0);
  assert.equal(createLayer("text", sceneOf(3.25), "16:9", 99).start, 2.733, "3.25 - 0.5 = 2.75 isn't a frame: rounded DOWN so 0.5 s remain");
});
test("createLayer: a corrupt scene duration can't poison the start", () => {
  for (const duration of [NaN, -3, 0]) assert.equal(createLayer("rect", sceneOf(duration), "16:9", 4).start, 0);
});
test("createLayer: no undefined, NaN or extra fields (the layer is plain JSON)", () => {
  for (const kind of KINDS) for (const ratio of RATIOS) {
    const l = createLayer(kind, sceneOf(10), ratio, 1.5);
    assert.deepEqual(clone(l), l);
  }
});
test("createLayer: the id is the first free l<n>", () => {
  const some = (...names: string[]) => sceneOf(10, ...names.map((id) => withId(createLayer("rect", sceneOf(10), "16:9", 0), id)));
  const idOf = (s: MotionScene) => createLayer("text", s, "16:9", 0).id;
  assert.equal(idOf(sceneOf(10)), "l0");
  assert.equal(idOf(some("l0", "l1", "l3")), "l2", "a gap is filled");
  assert.equal(idOf(some("l1")), "l0");
  assert.equal(idOf(some("media", "dim", "caption", "captions2")), "l0", "ids of the other families don't count");
  assert.equal(idOf(some("l0", "l1", "l2")), "l3");
});
test("createLayer: it is on screen and pickable where it was put, inside the frame", () => {
  for (const kind of KINDS) for (const ratio of RATIOS) for (const t of [0, 1.2, 9.9]) {
    const { width, height } = FRAMES[ratio];
    const scene = sceneOf(10);
    const layer = createLayer(kind, scene, ratio, t);
    const s = addLayer(scene, layer);
    const at = layer.start + 0.1;
    const box = layerBox(layer, s, at);
    assert.ok(box, `${kind} ${ratio} @${t}: not drawn`);
    for (const c of boxCorners(box)) assert.ok(c.x >= 0 && c.x <= width && c.y >= 0 && c.y <= height, `${kind} ${ratio}: corner out of the frame ${c.x},${c.y}`);
    assert.equal(hitTest(s, at, width / 2, height / 2), layer.id);
  }
});

// ---------- addLayer ----------

test("addLayer: goes on top of the stack, the rest untouched", () => {
  const s0 = backdropScene("16:9");
  const layer = createLayer("text", s0, "16:9", 0);
  const s1 = addLayer(s0, layer);
  assert.equal(s1.layers.length, s0.layers.length + 1);
  assert.equal(s1.layers[s1.layers.length - 1], layer, "the very layer passed in");
  s0.layers.forEach((l, i) => assert.equal(s1.layers[i], l, "same objects, same order"));
  assert.notEqual(s1, s0);
});
test("addLayer: a taken id is replaced by a free one, so ids stay unique", () => {
  const s0 = backdropScene("16:9");
  const clash = withId(createLayer("rect", s0, "16:9", 0), "media");
  const s1 = addLayer(s0, clash);
  assert.ok(unique(s1));
  const added = s1.layers[s1.layers.length - 1];
  assert.notEqual(added.id, "media");
  assert.deepEqual(noId(added), noId(clash));
  assert.equal(clash.id, "media", "the argument isn't touched");
});
test("addLayer: a full scene is returned as it is; canAddLayer says so", () => {
  let s = sceneOf(10);
  for (let i = 0; i < MAX_LAYERS; i++) {
    assert.ok(canAddLayer(s));
    s = addLayer(s, createLayer("ellipse", s, "16:9", 0));
  }
  assert.equal(s.layers.length, MAX_LAYERS);
  assert.ok(!canAddLayer(s));
  assert.equal(addLayer(s, createLayer("text", s, "16:9", 0)), s);
  assert.equal(duplicateLayer(s, s.layers[0].id, "16:9"), s);
  assert.ok(unique(s));
});

// ---------- duplicateLayer ----------

test("duplicateLayer: the copy is 3 % of the frame away, right above the original, with a new id", () => {
  for (const ratio of RATIOS) {
    const { width, height } = FRAMES[ratio];
    const s0 = backdropScene(ratio);
    const original = s0.layers[3]; // the text
    const s1 = duplicateLayer(s0, original.id, ratio);
    assert.equal(s1.layers.length, s0.layers.length + 1);
    const copy = s1.layers[4];
    assert.ok(unique(s1));
    assert.notEqual(copy.id, original.id);
    assert.equal(s1.layers[3], original, "the original is still where it was");
    assert.equal(s1.layers[5], s0.layers[4], "what was above it is still above");
    assert.equal(copy.x, Math.round((width / 2 + width * 0.03) * 100) / 100);
    assert.equal(copy.y, Math.round((height / 2 + height * 0.03) * 100) / 100);
    assert.deepEqual({ ...noId(copy), x: 0, y: 0 }, { ...noId(original), x: 0, y: 0 }, "everything else is the same");
  }
});
test("duplicateLayer: an animated position moves as a whole, keys keep their time and ease", () => {
  const animated: Layer = { ...createLayer("ellipse", sceneOf(10), "16:9", 0), x: [{ t: 0, v: 100 }, { t: 1, v: 800.555, ease: "backOut" }], y: [{ t: 0.5, v: 200 }] };
  const s1 = duplicateLayer(sceneOf(10, animated), animated.id, "16:9");
  const copy = s1.layers[1];
  assert.deepEqual(copy.x, [{ t: 0, v: 157.6 }, { t: 1, v: 858.16, ease: "backOut" }]);
  assert.deepEqual(copy.y, [{ t: 0.5, v: 232.4 }]);
  assert.deepEqual(animated.x, [{ t: 0, v: 100 }, { t: 1, v: 800.555, ease: "backOut" }], "the original's keys are untouched");
  assert.notEqual(copy.x, animated.x);
});
test("duplicateLayer: the copy stays inside what the sanitizer accepts", () => {
  const edge: Layer = { ...createLayer("rect", sceneOf(10), "16:9", 0), x: 4 * 1920 - 10, y: -3 * 1080 };
  const copy = duplicateLayer(sceneOf(10, edge), edge.id, "16:9").layers[1];
  assert.equal(copy.x, 4 * 1920, "clamped to the right limit");
  assert.equal(copy.y, -3 * 1080 + 32.4);
});
test("duplicateLayer: a position that lands on zero is 0, not -0", () => {
  const near: Layer = { ...createLayer("rect", sceneOf(10), "16:9", 0), x: -57.601, y: [{ t: 0, v: -32.4004 }] };
  const copy = duplicateLayer(sceneOf(10, near), near.id, "16:9").layers[1];
  assert.equal(copy.x, 0);
  assert.deepEqual(copy.y, [{ t: 0, v: 0 }]);
});
test("duplicateLayer: a copy can be duplicated again, ids never collide", () => {
  let s = sceneOf(10, createLayer("text", sceneOf(10), "9:16", 0));
  let id = s.layers[0].id;
  for (let i = 0; i < 12; i++) {
    s = duplicateLayer(s, id, "9:16");
    id = s.layers[s.layers.findIndex((l) => l.id === id) + 1].id;
    assert.ok(unique(s), `after ${i + 1} copies`);
  }
  assert.equal(s.layers.length, 13);
});
test("duplicateLayer: unknown id is the same scene", () => {
  const s = backdropScene("16:9");
  assert.equal(duplicateLayer(s, "nope", "16:9"), s);
});

// ---------- reorderLayer ----------

const order = (s: MotionScene) => ids(s).join(",");
const plain = (ratio: AspectRatio = "16:9") => {
  const s = sceneOf(10);
  return ["a", "b", "c", "d"].reduce((acc, id) => addLayer(acc, withId(createLayer("text", acc, ratio, 0), id)), s);
};

test("reorderLayer: front, back, forward, backward on a plain stack", () => {
  const s = plain();
  assert.equal(order(reorderLayer(s, "b", "front", "16:9")), "a,c,d,b");
  assert.equal(order(reorderLayer(s, "c", "back", "16:9")), "c,a,b,d");
  assert.equal(order(reorderLayer(s, "b", "forward", "16:9")), "a,c,b,d");
  assert.equal(order(reorderLayer(s, "c", "backward", "16:9")), "a,c,b,d");
  assert.equal(order(reorderLayer(s, "a", "front", "16:9")), "b,c,d,a");
  assert.equal(order(reorderLayer(s, "d", "back", "16:9")), "d,a,b,c");
});
test("reorderLayer: a layer already there, the ends, and unknown ids are the very same scene", () => {
  const s = plain();
  assert.equal(reorderLayer(s, "d", "front", "16:9"), s);
  assert.equal(reorderLayer(s, "d", "forward", "16:9"), s);
  assert.equal(reorderLayer(s, "a", "back", "16:9"), s);
  assert.equal(reorderLayer(s, "a", "backward", "16:9"), s);
  assert.equal(reorderLayer(s, "nope", "front", "16:9"), s);
  assert.equal(reorderLayer(s, "a", "sideways" as LayerReorder, "16:9"), s);
  const one = sceneOf(10, createLayer("rect", sceneOf(10), "16:9", 0));
  for (const to of ORDERS) assert.equal(reorderLayer(one, one.layers[0].id, to, "16:9"), one, `${to} on a lone layer`);
  const none = sceneOf(10);
  for (const to of ORDERS) assert.equal(reorderLayer(none, "l0", to, "16:9"), none, `${to} on an empty scene`);
});
test("reorderLayer: your layers never go below the media and its dim veil; 'back' means just above them", () => {
  for (const ratio of RATIOS) {
    const s = backdropScene(ratio); // media, dim, l0 (text), l1 (rect), l2 (ellipse)
    const [m, d, a, b, c] = s.layers;
    const back = reorderLayer(s, c.id, "back", ratio);
    assert.deepEqual(back.layers, [m, d, c, a, b], "just above the backdrop");
    assert.equal(reorderLayer(s, a.id, "back", ratio), s, "already just above it");
    assert.equal(reorderLayer(s, a.id, "backward", ratio), s, "can't step under the dim veil");
    assert.deepEqual(reorderLayer(s, b.id, "backward", ratio).layers, [m, d, b, a, c]);
    assert.deepEqual(reorderLayer(s, a.id, "front", ratio).layers, [m, d, b, c, a]);
  }
});
test("reorderLayer: the backdrop itself can be moved on purpose", () => {
  const s = backdropScene("16:9");
  const [m, d, a, b, c] = s.layers;
  assert.deepEqual(reorderLayer(s, d.id, "back", "16:9").layers, [d, m, a, b, c]);
  assert.deepEqual(reorderLayer(s, m.id, "forward", "16:9").layers, [d, m, a, b, c]);
  assert.deepEqual(reorderLayer(s, m.id, "front", "16:9").layers, [d, a, b, c, m]);
});
test("reorderLayer: a shape covering the frame is backdrop only at the bottom, so it never traps a layer", () => {
  const ratio: AspectRatio = "16:9";
  const cover: Layer = { ...asRect(createLayer("rect", sceneOf(10), ratio, 0)), id: "cover", w: 1920, h: 1080 };
  assert.ok(isBackdropLayer(cover, ratio));
  const text = withId(createLayer("text", sceneOf(10), ratio, 0), "text");
  // The cover hides the text: send it behind.
  const covering = sceneOf(10, text, cover);
  const behind = reorderLayer(covering, "cover", "back", ratio);
  assert.equal(order(behind), "cover,text");
  // Now it is the floor: the text can't go under it...
  assert.equal(reorderLayer(behind, "text", "back", ratio), behind);
  assert.equal(reorderLayer(behind, "text", "backward", ratio), behind);
  // ...but the cover itself can come back out.
  assert.equal(order(reorderLayer(behind, "cover", "front", ratio)), "text,cover");
  assert.equal(order(reorderLayer(behind, "cover", "forward", ratio)), "text,cover");
  // A scene made only of backdrop moves freely.
  const only = sceneOf(10, media(ratio), dim(ratio));
  assert.equal(order(reorderLayer(only, "media", "front", ratio)), "dim,media");
});
test("reorderLayer: random sequences keep every invariant", () => {
  for (const ratio of RATIOS) {
    const rand = prng(ratio === "16:9" ? 7 : 11);
    let s = backdropScene(ratio);
    for (let step = 0; step < 600; step++) {
      const before = s;
      const mover = s.layers[Math.floor(rand() * s.layers.length)];
      const to = ORDERS[Math.floor(rand() * ORDERS.length)];
      s = reorderLayer(s, mover.id, to, ratio);
      assert.ok(unique(s), "ids stay unique");
      assert.equal(s.layers.length, before.layers.length);
      assert.deepEqual([...s.layers].sort((a, b) => a.id.localeCompare(b.id)), [...before.layers].sort((a, b) => a.id.localeCompare(b.id)), "same layers, same objects");
      if (!isBackdropLayer(mover, ratio)) {
        // The backdrop run that was at the bottom is still there, in the same order.
        const run = before.layers.findIndex((l) => !isBackdropLayer(l, ratio));
        assert.deepEqual(s.layers.slice(0, run), before.layers.slice(0, run), `step ${step}: ${to} ${mover.id} went under the backdrop`);
      }
      const at = s.layers.indexOf(mover);
      const was = before.layers.indexOf(mover);
      if (to === "front" && s !== before) assert.equal(at, s.layers.length - 1);
      if (to === "forward") assert.ok(at === was || at === was + 1);
      if (to === "backward") assert.ok(at === was || at === was - 1);
      if (s === before) assert.equal(at, was);
      // Whatever it did, asking again for the same thing does nothing more (front/back) or is still legal.
      if (to === "front" || to === "back") assert.equal(reorderLayer(s, mover.id, to, ratio), s, `${to} twice`);
    }
  }
});

// ---------- the whole API ----------

test("random adds, duplicates, deletes and reorders keep ids unique and the scene within its cap", () => {
  for (const ratio of RATIOS) {
    const rand = prng(ratio === "16:9" ? 42 : 99);
    let s = backdropScene(ratio);
    for (let step = 0; step < 3000; step++) {
      const pick = s.layers.length ? s.layers[Math.floor(rand() * s.layers.length)].id : "l0";
      const action = rand();
      if (action < 0.3) s = addLayer(s, createLayer(KINDS[Math.floor(rand() * 3)], s, ratio, rand() * 12));
      else if (action < 0.55) s = duplicateLayer(s, pick, ratio);
      else if (action < 0.8) s = deleteLayer(s, pick);
      else s = reorderLayer(s, pick, ORDERS[Math.floor(rand() * 4)], ratio);
      assert.ok(unique(s), `step ${step}: duplicate ids ${order(s)}`);
      assert.ok(s.layers.length <= MAX_LAYERS);
    }
  }
});
test("nothing mutates its input (deep-frozen scenes)", () => {
  for (const ratio of RATIOS) {
    const s = deepFreeze(backdropScene(ratio));
    const before = clone(s);
    const layer = deepFreeze(createLayer("text", s, ratio, 2));
    addLayer(s, layer);
    addLayer(s, withId(layer, "media"));
    for (const l of s.layers) {
      duplicateLayer(s, l.id, ratio);
      for (const to of ORDERS) reorderLayer(s, l.id, to, ratio);
    }
    for (const kind of KINDS) createLayer(kind, s, ratio, 3);
    assert.deepEqual(clone(s), before);
  }
});

// ---------- sanitizer ----------

test("sanitizer round trip: created layers survive normalizeScene(keepAssets) unchanged, ids aside", () => {
  for (const ratio of RATIOS) {
    for (const duration of [0.3, 1, 3, 7.77, 40]) {
      for (const t of [-1, 0, 0.5, 2.31, 39, 100, NaN]) {
        let s = backdropScene(ratio, duration);
        for (const kind of KINDS) {
          s = addLayer(s, createLayer(kind, s, ratio, t));
          s = duplicateLayer(s, s.layers[s.layers.length - 1].id, ratio);
        }
        const loaded = normalizeScene(clone(s), 0, ratio, true);
        assert.equal(loaded.layers.length, s.layers.length, `${ratio} ${duration}s @${t}: a layer was dropped`);
        assert.deepEqual(loaded.layers.map(noId), s.layers.map(noId), `${ratio} ${duration}s @${t}`);
        assert.deepEqual(ids(loaded), s.layers.map((_, i) => `l${i}`), "ids are renumbered by position");
        assert.equal(loaded.duration, duration);
      }
    }
  }
});
test("sanitizer round trip: a duplicate of a keyframed layer too", () => {
  const raw = {
    duration: 6,
    layers: [{ type: "text", text: "Hello", start: 1, x: [{ t: 1, v: 100 }, { t: 3, v: 900, ease: "expoOut" }], y: 300, opacity: [{ t: 1, v: 0 }, { t: 2, v: 1 }], scale: [{ t: 0, v: 0.5 }, { t: 1, v: 1.2 }] }],
  };
  const s0 = normalizeScene(raw, 0, "16:9", true);
  const s1 = duplicateLayer(s0, s0.layers[0].id, "16:9");
  const loaded = normalizeScene(clone(s1), 0, "16:9", true);
  assert.deepEqual(loaded.layers.map(noId), s1.layers.map(noId));
});
test("MAX_LAYERS is what the sanitizer keeps", () => {
  const rect = { type: "rect" };
  const loaded = normalizeScene({ duration: 5, layers: Array.from({ length: MAX_LAYERS + 5 }, () => rect) }, 0, "16:9", true);
  assert.equal(loaded.layers.length, MAX_LAYERS);
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
