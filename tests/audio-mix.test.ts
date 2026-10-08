import assert from "node:assert/strict";
import { gainAt, musicGainCurve, musicLoopPlan, narrationIntervals, sceneAudioSchedule, scheduleGain, type GainParam, type GainPoint } from "../src/lib/motion/audio-mix";
import { projectDuration, sceneStart, type MotionProject, type MotionScene, type Music } from "../src/lib/motion/types";

let n = 0, failed = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };
/** Any write to a frozen object throws (the suite runs as an ES module, i.e. in strict mode): that is how mutation is caught. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}
const nearly = (actual: number, expected: number, tol = 1e-9, what = "") => assert.ok(Math.abs(actual - expected) <= tol, `${what} expected ${expected}, got ${actual}`);

// ---------- fixtures ----------

const VOICE = "https://x.test/voice.mp3";
const music = (over: Partial<Music> = {}): Music => ({ url: "https://x.test/m.mp3", name: "m", volume: 0.5, fadeIn: 0, fadeOut: 0, duck: true, ...over });
const scene = (i: number, duration: number, narrated = false, audioOffset?: number): MotionScene => ({
  uid: `scene-${i}-abcdef`,
  id: i + 1,
  voiceOver: "",
  visualPrompt: "",
  duration,
  background: { type: "solid", color: "#000000" },
  transition: { type: "none", duration: 0.5 },
  layers: [],
  ...(narrated ? { audioUrl: VOICE } : {}),
  ...(audioOffset !== undefined ? { audioOffset } : {}),
});
/** "2n 0.5 3n" = a 2 s narrated scene, a 0.5 s silent one, a 3 s narrated one. */
const scenes = (spec: string, offsets: Record<number, number> = {}): MotionScene[] =>
  spec.split(/\s+/).map((tok, i) => scene(i, parseFloat(tok), tok.endsWith("n"), offsets[i]));
const proj = (list: MotionScene[], m?: Music | null): MotionProject => ({
  title: "Titre",
  category: "Catégorie",
  ratio: "16:9",
  palette: [],
  scenes: list.map((s, i) => ({ ...s, id: i + 1 })),
  ...(m === undefined ? {} : { music: m }),
});
/** A project with music (fades off and ducking on, unless overridden). */
const mp = (spec: string, over: Partial<Music> = {}) => proj(scenes(spec), music(over));

/** Intervals with their floating-point noise rounded off (2 + 0.39 + 2 is 4.390000000000001). */
const rounded = (list: { start: number; end: number; sceneIndex: number }[]) => list.map((iv) => ({ ...iv, start: Math.round(iv.start * 1e9) / 1e9, end: Math.round(iv.end * 1e9) / 1e9 }));
const pairs = (curve: GainPoint[] | null) => (curve ?? []).map((p) => [p.t, p.gain]);
function assertCurve(curve: GainPoint[] | null, expected: [number, number][], tol = 1e-12) {
  assert.ok(curve, "a curve");
  assert.equal(curve.length, expected.length, `expected ${expected.length} points, got ${JSON.stringify(pairs(curve))}`);
  curve.forEach((p, i) => {
    nearly(p.t, expected[i][0], tol, `point ${i} t:`);
    nearly(p.gain, expected[i][1], tol, `point ${i} gain:`);
  });
}
/** Every curve musicGainCurve returns: from 0 to total, strictly increasing, gains finite and in [0, 1]. */
function assertValid(curve: GainPoint[] | null, total: number) {
  assert.ok(curve && curve.length >= 1, "a non-empty curve");
  assert.equal(curve[0].t, 0, "starts at 0");
  assert.equal(curve[curve.length - 1].t, total, "ends at the total");
  for (let i = 0; i < curve.length; i++) {
    assert.ok(Number.isFinite(curve[i].t) && Number.isFinite(curve[i].gain), `point ${i} is finite`);
    assert.ok(curve[i].gain >= 0 && curve[i].gain <= 1, `point ${i} gain ${curve[i].gain} is in [0, 1]`);
    if (i > 0) assert.ok(curve[i].t > curve[i - 1].t, `t strictly increases at point ${i}: ${curve[i - 1].t} -> ${curve[i].t}`);
  }
}

console.log("audio-mix.ts");

// ---------- narrationIntervals ----------

t("narrationIntervals: no narrated scene gives []", () => {
  assert.deepEqual(narrationIntervals(proj(scenes("3 4 5"), music())), []);
  assert.deepEqual(narrationIntervals(proj([])), []);
});
t("narrationIntervals: start = scene start, end = start + duration, with the scene index", () => {
  assert.deepEqual(narrationIntervals(proj(scenes("2 3n 4"))), [{ start: 2, end: 5, sceneIndex: 1 }]);
  assert.deepEqual(narrationIntervals(proj(scenes("2 3n 4 5n"))), [{ start: 2, end: 5, sceneIndex: 1 }, { start: 9, end: 14, sceneIndex: 3 }]);
});
t("narrationIntervals: it does not need music, and a lone interval starts exactly at sceneStart()", () => {
  const list = scenes("1.7n 2.3 0.9n 4.1 3.3n");
  assert.deepEqual(narrationIntervals(proj(list, null)), narrationIntervals(proj(list, music())));
  const p = proj(list);
  for (const iv of narrationIntervals(p)) assert.equal(iv.start, sceneStart(p, iv.sceneIndex), "bit-for-bit the same sums");
});
t("narrationIntervals: consecutive narrated scenes are ONE interval (the first scene's index)", () => {
  assert.deepEqual(narrationIntervals(proj(scenes("2n 3n 1n 4"))), [{ start: 0, end: 6, sceneIndex: 0 }]);
});
t("narrationIntervals: a gap shorter than 0.4 s is merged, 0.4 s or more is not (even with rounding noise)", () => {
  assert.deepEqual(rounded(narrationIntervals(proj(scenes("2n 0.3 2n")))), [{ start: 0, end: 4.3, sceneIndex: 0 }], "0.3 s: merged");
  assert.deepEqual(rounded(narrationIntervals(proj(scenes("2n 0.39 2n")))), [{ start: 0, end: 4.39, sceneIndex: 0 }], "0.39 s: merged");
  assert.equal(narrationIntervals(proj(scenes("2n 0.4 2n"))).length, 2, "exactly 0.4 s: (2 + 0.4) - 2 is 0.3999999999999999 in floating point, still a gap");
  assert.equal(narrationIntervals(proj(scenes("2n 0.5 2n"))).length, 2, "0.5 s: separate");
  assert.equal(narrationIntervals(proj(scenes("2n 5 2n"))).length, 2, "5 s: separate");
});
t("narrationIntervals: several short silent scenes add up to one gap; merging chains", () => {
  assert.equal(narrationIntervals(proj(scenes("2n 0.15 0.15 2n"))).length, 1, "0.3 s in two pieces");
  assert.equal(narrationIntervals(proj(scenes("2n 0.2 0.2 2n"))).length, 2, "0.4 s in two pieces");
  assert.deepEqual(rounded(narrationIntervals(proj(scenes("1n 0.3 1n 0.3 1n 2 1n")))), [{ start: 0, end: 3.6, sceneIndex: 0 }, { start: 5.6, end: 6.6, sceneIndex: 6 }]);
});
t("narrationIntervals: one narrated scene covering the whole video", () => {
  assert.deepEqual(narrationIntervals(proj(scenes("7.5n"))), [{ start: 0, end: 7.5, sceneIndex: 0 }]);
});
t("narrationIntervals: an empty audioUrl is no narration; broken durations are ignored without throwing", () => {
  const silent: MotionScene = { ...scene(0, 3), audioUrl: "" };
  assert.deepEqual(narrationIntervals(proj([silent])), []);
  const odd = proj([scene(0, NaN, true), scene(1, 3, true), scene(2, -2, true), scene(3, Infinity, true), scene(4, 2, true)]);
  assert.deepEqual(narrationIntervals(odd), [{ start: 0, end: 5, sceneIndex: 1 }], "NaN, negative and infinite scenes last 0 s and play nothing");
});

// ---------- gainAt ----------

t("gainAt: empty curve is 0; one point is a constant", () => {
  assert.equal(gainAt([], 3), 0);
  assert.equal(gainAt([{ t: 2, gain: 0.7 }], -5), 0.7);
  assert.equal(gainAt([{ t: 2, gain: 0.7 }], 99), 0.7);
});
t("gainAt: linear between points, clamped before the first and after the last", () => {
  const c: GainPoint[] = [{ t: 1, gain: 0 }, { t: 3, gain: 1 }, { t: 4, gain: 0.5 }];
  assert.equal(gainAt(c, 0), 0);
  assert.equal(gainAt(c, 1), 0);
  assert.equal(gainAt(c, 2), 0.5);
  assert.equal(gainAt(c, 3), 1);
  assert.equal(gainAt(c, 3.5), 0.75);
  assert.equal(gainAt(c, 4), 0.5);
  assert.equal(gainAt(c, 100), 0.5);
});
t("gainAt: NaN reads as the start, infinities clamp, two points sharing a t make a step", () => {
  const c: GainPoint[] = [{ t: 0, gain: 0.2 }, { t: 1, gain: 0.2 }, { t: 1, gain: 0.9 }, { t: 2, gain: 0.9 }];
  assert.equal(gainAt(c, NaN), 0.2);
  assert.equal(gainAt(c, -Infinity), 0.2);
  assert.equal(gainAt(c, Infinity), 0.9);
  assert.equal(gainAt(c, 0.999), 0.2);
  assert.equal(gainAt(c, 1), 0.9);
  assert.equal(gainAt(c, 1.5), 0.9);
});
t("gainAt: the binary search agrees with a linear scan on a long curve", () => {
  const rand = mulberry32(7);
  const c: GainPoint[] = [];
  for (let i = 0, time = 0; i < 300; i++) { time += 0.01 + rand(); c.push({ t: time, gain: rand() }); }
  const scan = (x: number) => {
    if (x <= c[0].t) return c[0].gain;
    for (let i = 1; i < c.length; i++) if (x <= c[i].t) return c[i - 1].gain + ((c[i].gain - c[i - 1].gain) * (x - c[i - 1].t)) / (c[i].t - c[i - 1].t);
    return c[c.length - 1].gain;
  };
  for (let k = 0; k < 2000; k++) { const x = -5 + rand() * (c[c.length - 1].t + 10); nearly(gainAt(c, x), scan(x), 1e-12, `t=${x}`); }
});

// ---------- musicGainCurve: shape ----------

t("musicGainCurve: no music (absent or null) gives null", () => {
  assert.equal(musicGainCurve(proj(scenes("3n 4"))), null);
  assert.equal(musicGainCurve(proj(scenes("3n 4"), null)), null);
});
t("musicGainCurve: fade in, plateau at the volume, fade out", () => {
  const c = musicGainCurve(mp("4 3 3", { fadeIn: 1, fadeOut: 2 }));
  assertCurve(c, [[0, 0], [1, 0.5], [8, 0.5], [10, 0]]);
  assertValid(c, 10);
  assert.equal(gainAt(c!, 0.5), 0.25);
  assert.equal(gainAt(c!, 9), 0.25);
});
t("musicGainCurve: fades of 0 start AT the volume and end at it (two points)", () => {
  assertCurve(musicGainCurve(mp("4 3 3", { volume: 0.8 })), [[0, 0.8], [10, 0.8]]);
  assertCurve(musicGainCurve(mp("4 6", { volume: 0.8, fadeIn: 2 })), [[0, 0], [2, 0.8], [10, 0.8]], 1e-12);
  assertCurve(musicGainCurve(mp("4 6", { volume: 0.8, fadeOut: 2 })), [[0, 0.8], [8, 0.8], [10, 0]], 1e-12);
});
t("musicGainCurve: fades longer than the video are scaled down in proportion and meet at the peak", () => {
  assertCurve(musicGainCurve(mp("1 1 1", { volume: 0.6, fadeIn: 6, fadeOut: 3 })), [[0, 0], [2, 0.6], [3, 0]]);
  assertCurve(musicGainCurve(mp("1 1 1", { volume: 0.6, fadeIn: 1, fadeOut: 3 })), [[0, 0], [0.75, 0.6], [3, 0]]);
  assertCurve(musicGainCurve(mp("1 1 1", { volume: 0.6, fadeIn: 2, fadeOut: 1 })), [[0, 0], [2, 0.6], [3, 0]], 1e-12);
  assertCurve(musicGainCurve(mp("1 1 1", { volume: 0.6, fadeIn: 4, fadeOut: 0 })), [[0, 0], [3, 0.6]], 1e-12);
  assertCurve(musicGainCurve(mp("1 1 1", { volume: 0.6, fadeIn: Infinity, fadeOut: Infinity })), [[0, 0], [1.5, 0.6], [3, 0]]);
});
t("musicGainCurve: volume 0 is silent everywhere; the volume is clamped to 0-1", () => {
  const c = musicGainCurve(mp("3n 4", { volume: 0, fadeIn: 1, fadeOut: 1 }));
  assertValid(c, 7);
  assert.ok(c!.every((p) => p.gain === 0));
  assert.equal(Math.max(...musicGainCurve(mp("3 4", { volume: 7 }))!.map((p) => p.gain)), 1);
  assert.equal(Math.max(...musicGainCurve(mp("3 4", { volume: -1 }))!.map((p) => p.gain)), 0);
});
t("musicGainCurve: very short videos (1.5 s) keep a valid curve", () => {
  assertCurve(musicGainCurve(mp("1.5", { fadeIn: 1, fadeOut: 2 })), [[0, 0], [0.5, 0.5], [1.5, 0]]);
  assertCurve(musicGainCurve(mp("1.5n", { fadeIn: 1, fadeOut: 2 })), [[0, 0], [0.5, 0.15], [1.5, 0]], 1e-12);
  assertValid(musicGainCurve(mp("1.5n", { fadeIn: 1, fadeOut: 2 })), 1.5);
});
t("musicGainCurve: no duration at all gives one silent point", () => {
  assert.deepEqual(musicGainCurve(proj([], music())), [{ t: 0, gain: 0 }]);
  assert.deepEqual(musicGainCurve(proj([scene(0, 0, true), scene(1, NaN)], music())), [{ t: 0, gain: 0 }]);
});

// ---------- musicGainCurve: ducking ----------

t("ducking, one narrated scene: ramps just before the start and just after the end", () => {
  const c = musicGainCurve(mp("4 2n 4"));
  assertCurve(c, [[0, 0.5], [3.75, 0.5], [4, 0.15], [6, 0.15], [6.25, 0.5], [10, 0.5]]);
  assertValid(c, 10);
  nearly(gainAt(c!, 3.875), 0.325, 1e-12, "halfway down the ramp");
  nearly(gainAt(c!, 5), 0.15, 1e-12, "under the voice");
});
t("ducking, narration at the very start or end of the video has no ramp outside the video", () => {
  assertCurve(musicGainCurve(mp("2n 4")), [[0, 0.15], [2, 0.15], [2.25, 0.5], [6, 0.5]]);
  assertCurve(musicGainCurve(mp("4 2n")), [[0, 0.5], [3.75, 0.5], [4, 0.15], [6, 0.15]]);
});
t("ducking, a narrated scene covering the whole video is flat at volume x duckGain (fades still shape it exactly)", () => {
  assertCurve(musicGainCurve(mp("3n 4n")), [[0, 0.15], [7, 0.15]]);
  assertCurve(musicGainCurve(mp("3n 4n", { fadeIn: 1, fadeOut: 2 })), [[0, 0], [1, 0.15], [5, 0.15], [7, 0]]);
});
t("ducking, adjacent narrated scenes: one trough, the music never pumps back up between them", () => {
  const c = musicGainCurve(mp("2n 3n 1"));
  assertCurve(c, [[0, 0.15], [5, 0.15], [5.25, 0.5], [6, 0.5]]);
  nearly(gainAt(c!, 2), 0.15, 1e-12, "at the boundary between the two scenes");
});
t("ducking, two narrated scenes with a gap >= 0.4 s: two troughs, the ramps meet at the middle of the gap", () => {
  const c = musicGainCurve(mp("2n 0.5 2n 1", { volume: 1 }));
  assertCurve(c, [[0, 0.3], [2, 0.3], [2.25, 1], [2.5, 0.3], [4.5, 0.3], [4.75, 1], [5.5, 1]]);
  assertValid(c, 5.5);
});
t("ducking, a gap under 0.4 s is one trough: the music does not come back up", () => {
  assertCurve(musicGainCurve(mp("2n 0.3 2n 1", { volume: 1 })), [[0, 0.3], [4.3, 0.3], [4.55, 1], [5.3, 1]]);
});
t("ducking: duck off ignores the narration; duckGain 1 is the same as no duck", () => {
  const off = musicGainCurve(mp("4 2n 4", { duck: false, fadeIn: 1, fadeOut: 1 }));
  assertCurve(off, [[0, 0], [1, 0.5], [9, 0.5], [10, 0]]);
  assert.deepEqual(musicGainCurve(mp("4 2n 4", { fadeIn: 1, fadeOut: 1 }), 1), off);
});
t("ducking: duckGain 0 is silence under the voice; duckGain is clamped to 0-1 and NaN means the default", () => {
  assertCurve(musicGainCurve(mp("4 2n 4", { volume: 1 }), 0), [[0, 1], [3.75, 1], [4, 0], [6, 0], [6.25, 1], [10, 1]]);
  assert.deepEqual(musicGainCurve(mp("4 2n 4"), -3), musicGainCurve(mp("4 2n 4"), 0));
  assert.deepEqual(musicGainCurve(mp("4 2n 4"), 9), musicGainCurve(mp("4 2n 4"), 1));
  assert.deepEqual(musicGainCurve(mp("4 2n 4"), NaN), musicGainCurve(mp("4 2n 4")));
});
t("ducking: a custom ramp; ramp 0 is floored to 5 ms; a huge ramp stops at the edges of the video", () => {
  assertCurve(musicGainCurve(mp("4 2n 4", { volume: 1 }), 0.3, 1), [[0, 1], [3, 1], [4, 0.3], [6, 0.3], [7, 1], [10, 1]]);
  assertCurve(musicGainCurve(mp("4 2n 4", { volume: 1 }), 0.3, 0), [[0, 1], [3.995, 1], [4, 0.3], [6, 0.3], [6.005, 1], [10, 1]]);
  assertCurve(musicGainCurve(mp("4 2n 4", { volume: 1 }), 0.3, 100), [[0, 1], [4, 0.3], [6, 0.3], [10, 1]]);
  assert.deepEqual(musicGainCurve(mp("4 2n 4"), 0.3, -2), musicGainCurve(mp("4 2n 4"), 0.3, 0), "negative = 0");
  assert.deepEqual(musicGainCurve(mp("4 2n 4"), 0.3, NaN), musicGainCurve(mp("4 2n 4")), "NaN = default");
  assert.deepEqual(musicGainCurve(mp("4 2n 4"), 0.3, Infinity), musicGainCurve(mp("4 2n 4"), 0.3, 100), "infinite = as long as the room allows");
});
t("ducking: ramps that would overlap are limited to half the gap each, whatever the ramp (the code does not rely on merging)", () => {
  for (const ramp of [0.25, 1, 5, 1e6, Infinity]) {
    const c = musicGainCurve(mp("2n 0.5 2n 1", { volume: 1 }), 0.3, ramp);
    assertValid(c, 5.5);
    // Between the two voices the ramps meet at the middle of the gap (2.25) and never cross; after the last one the ramp has 1 s of room.
    assertCurve(c, ramp < 1
      ? [[0, 0.3], [2, 0.3], [2.25, 1], [2.5, 0.3], [4.5, 0.3], [4.75, 1], [5.5, 1]]
      : [[0, 0.3], [2, 0.3], [2.25, 1], [2.5, 0.3], [4.5, 0.3], [5.5, 1]]);
  }
});

// ---------- musicGainCurve: fade x duck ----------

t("fade x duck: where a fade ramp crosses a duck ramp the product is a parabola, so the stretch is subdivided to stay within 1e-4", () => {
  // The voice comes in at 1 s while the music is still fading in (0-2 s): the pre-ramp (0.75-1) lies inside the fade.
  const p = mp("1 3n 4", { volume: 1, fadeIn: 2 });
  const c = musicGainCurve(p)!;
  assertValid(c, 8);
  const exact = (x: number) => Math.min(1, x / 2) * (x < 0.75 ? 1 : x < 1 ? 1 - 0.7 * ((x - 0.75) / 0.25) : x <= 4 ? 0.3 : x < 4.25 ? 0.3 + 0.7 * ((x - 4) / 0.25) : 1);
  let worst = 0;
  for (let x = 0; x <= 8 + 1e-9; x += 0.001) worst = Math.max(worst, Math.abs(gainAt(c, x) - exact(x)));
  assert.ok(worst <= 1e-4 + 1e-9, `worst deviation ${worst}`);
  assert.ok(worst > 1e-9, "(without the subdivision this stretch would not be a straight line)");
  for (const pt of c) nearly(pt.gain, exact(pt.t), 1e-9, `exact at its own points (t=${pt.t})`);
  const inRamp = c.filter((pt) => pt.t > 0.75 && pt.t < 1).length;
  assert.ok(inRamp >= 5 && inRamp < 100, `${inRamp} points inside the 0.25 s ramp`);
  assert.ok(c.length < 200, `${c.length} points in all`);
});
t("fade x duck: only the overlap pays for extra points (a plain project stays tiny)", () => {
  assert.equal(musicGainCurve(mp("4 2n 4", { fadeIn: 1, fadeOut: 2 }))!.length, 8, "knots only: 0, 1, 3.75, 4, 6, 6.25, 8, 10");
});

// ---------- musicGainCurve: brute force against a reference ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** Reference narration intervals, built from the project scene by scene. */
function refRuns(p: MotionProject) {
  const runs: { start: number; end: number }[] = [];
  let clock = 0;
  for (const s of p.scenes) {
    if (s.audioUrl) {
      const last = runs[runs.length - 1];
      if (last && clock - last.end < 0.4 - 1e-9) last.end = clock + s.duration;
      else runs.push({ start: clock, end: clock + s.duration });
    }
    clock += s.duration;
  }
  return runs;
}
/** Reference fade envelope: the product of a rising and a falling ramp (they never overlap once scaled to fit). */
function refFade(m: Music, total: number, x: number) {
  let fi = m.fadeIn, fo = m.fadeOut;
  if (fi + fo > total) { const k = total / (fi + fo); fi *= k; fo *= k; }
  return m.volume * (fi > 0 ? Math.min(1, x / fi) : 1) * (fo > 0 ? Math.min(1, (total - x) / fo) : 1);
}
/** Reference duck envelope: how deep each interval pulls the music down at x (a distance-based trapezoid), the deepest wins. */
function refDuck(runs: { start: number; end: number }[], total: number, duckGain: number, ramp: number, x: number) {
  const r = Math.max(ramp, 0.005);
  let depth = 0;
  runs.forEach((run, k) => {
    const pre = Math.min(r, k === 0 ? run.start : (run.start - runs[k - 1].end) / 2);
    const post = Math.min(r, k === runs.length - 1 ? total - run.end : (runs[k + 1].start - run.end) / 2);
    const d = x >= run.start && x <= run.end ? 1 : x < run.start ? (pre > 0 ? Math.max(0, 1 - (run.start - x) / pre) : 0) : post > 0 ? Math.max(0, 1 - (x - run.end) / post) : 0;
    depth = Math.max(depth, d);
  });
  return 1 - (1 - duckGain) * depth;
}
function randomCase(rand: () => number) {
  const list: MotionScene[] = [];
  const count = 1 + Math.floor(rand() * 8);
  for (let i = 0; i < count; i++) {
    if (rand() < 0.25) list.push(scene(i, Math.round((0.1 + rand() * 0.55) * 100) / 100)); // a short silent scene: gaps around the 0.4 s rule
    else list.push(scene(i, Math.round((1.5 + rand() * 6) * 100) / 100, rand() < 0.55));
  }
  const pick = <T,>(options: T[]) => options[Math.floor(rand() * options.length)];
  const fade = () => (rand() < 0.3 ? 0 : rand() * 5);
  const m = music({ volume: pick([0, 1, rand(), rand()]), fadeIn: fade(), fadeOut: fade(), duck: rand() < 0.8 });
  return { project: proj(list, m), duckGain: pick([0, 1, rand(), rand(), 0.3]), ramp: pick([0, 0.05, 0.25, 0.25, 1, 4]) };
}
t("brute force: 400 random projects, curve vs the product of both envelopes, every 10 ms", () => {
  const rand = mulberry32(20240607);
  let exactCases = 0, bentCases = 0, bentWorst = 0, samples = 0;
  for (let k = 0; k < 400; k++) {
    const { project, duckGain, ramp } = randomCase(rand);
    const m = project.music as Music;
    const total = projectDuration(project);
    const curve = musicGainCurve(project, duckGain, ramp);
    assertValid(curve, total);
    const runs = refRuns(project);
    const reference = (x: number) => refFade(m, total, x) * (m.duck ? refDuck(runs, total, duckGain, ramp, x) : 1);
    // A fade ramp and a duck ramp can only multiply into a curve if both exist.
    const straight = !m.duck || runs.length === 0 || duckGain === 1 || (m.fadeIn === 0 && m.fadeOut === 0);
    let worst = 0;
    for (const pt of curve!) nearly(pt.gain, reference(pt.t), 1e-9, `project ${k}, own point t=${pt.t}:`);
    for (let step = 0; step * 0.01 <= total; step++) { const x = Math.min(step * 0.01, total); worst = Math.max(worst, Math.abs(gainAt(curve!, x) - reference(x))); samples++; }
    if (straight) { exactCases++; assert.ok(worst <= 1e-9, `project ${k}: deviation ${worst} (the product is piecewise linear here)`); }
    else { bentCases++; bentWorst = Math.max(bentWorst, worst); assert.ok(worst <= 1e-4 + 1e-9, `project ${k}: deviation ${worst}`); }
  }
  assert.ok(exactCases > 100 && bentCases > 100, `both families are exercised (${exactCases} straight, ${bentCases} bent)`);
  console.log(`       ${samples} samples; straight cases exact to 1e-9; ${bentCases} cases where ramps cross, worst deviation ${bentWorst.toExponential(2)}`);
});
t("brute force: inside every narration interval, first and last instant included, the music is fully ducked", () => {
  const rand = mulberry32(99);
  for (let k = 0; k < 200; k++) {
    const { project, duckGain, ramp } = randomCase(rand);
    if (!project.music) continue;
    const curve = musicGainCurve({ ...project, music: { ...project.music, duck: true, fadeIn: 0, fadeOut: 0 } }, duckGain, ramp)!;
    for (const iv of narrationIntervals(project)) for (const x of [iv.start, (iv.start + iv.end) / 2, iv.end]) {
      nearly(gainAt(curve, x), project.music.volume * duckGain, 1e-9, `project ${k}, t=${x}: fully ducked inside the interval`);
    }
  }
});

// ---------- musicGainCurve: robustness ----------

t("robustness: NaN, negative and infinite music fields never throw and never leave [0, 1]", () => {
  const bad = [NaN, -1, -Infinity, Infinity, 1e300, 0];
  for (const volume of bad) for (const fadeIn of bad) for (const fadeOut of bad) for (const duck of [true, false]) {
    const c = musicGainCurve(mp("2n 0.5 3 1.5n", { volume, fadeIn, fadeOut, duck }));
    assertValid(c, 7);
  }
  assert.ok(musicGainCurve(mp("3 3", { volume: NaN }))!.every((p) => p.gain === 0), "NaN volume is silence");
  assertCurve(musicGainCurve(mp("3 3", { volume: 0.5, fadeIn: NaN, fadeOut: -4 })), [[0, 0.5], [6, 0.5]], 1e-12);
});
t("robustness: broken scene durations never produce NaN times; surviving scenes keep their place", () => {
  const p = proj([scene(0, NaN, true), scene(1, 2, true), scene(2, -5), scene(3, Infinity, true), scene(4, 3)], music());
  const c = musicGainCurve(p);
  assertValid(c, 5);
  assertCurve(c, [[0, 0.15], [2, 0.15], [2.25, 0.5], [5, 0.5]]);
});
t("robustness: a ramp or gain argument of any size gives a valid curve", () => {
  for (const duckGain of [NaN, -1, 0, 0.3, 1, 2, Infinity, -Infinity]) for (const ramp of [NaN, -1, 0, 0.001, 0.25, 3, 1e9, Infinity, -Infinity]) {
    assertValid(musicGainCurve(mp("1 2n 0.45 1n 3 2n", { fadeIn: 1, fadeOut: 1 }), duckGain, ramp), 9.45);
  }
});
t("robustness: the very small and the very large", () => {
  assertValid(musicGainCurve(mp("0.0001n 0.0001", { fadeIn: 1, fadeOut: 1 })), 0.0002);
  assertValid(musicGainCurve(mp("1e-300n 1e-300n", { fadeIn: 1e-300, fadeOut: 1e-300 })), 2e-300);
  assertValid(musicGainCurve(mp("1e15n 1e15", { fadeIn: 1e14, fadeOut: 1e14 })), 2e15);
});
t("no function mutates the project (frozen deep) and each call returns fresh data", () => {
  const p = deepFreeze(proj(scenes("2 3n 0.5 2n 1", { 1: 0.5 }), music({ fadeIn: 1, fadeOut: 2 })));
  const a = musicGainCurve(p);
  const b = musicGainCurve(p);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  const i1 = narrationIntervals(p);
  narrationIntervals(p)[0].end = 99;
  assert.deepEqual(narrationIntervals(p), i1, "mutating a returned interval cannot leak into the next call");
  sceneAudioSchedule(p);
});

// ---------- sceneAudioSchedule ----------

t("sceneAudioSchedule: where each narration starts, which part of the file plays, and for how long", () => {
  const p = proj(scenes("2 3n 4n 1", { 1: 1.5 }));
  assert.deepEqual(sceneAudioSchedule(p), [
    { sceneIndex: 1, uid: "scene-1-abcdef", url: VOICE, startAt: 2, offset: 1.5, length: 3 },
    { sceneIndex: 2, uid: "scene-2-abcdef", url: VOICE, startAt: 5, offset: 0, length: 4 },
  ]);
});
t("sceneAudioSchedule: consecutive scenes stay separate clips (only the music treats them as one passage); no narration gives []", () => {
  assert.equal(sceneAudioSchedule(proj(scenes("1n 1n 1n"))).length, 3);
  assert.deepEqual(sceneAudioSchedule(proj(scenes("3 4"))), []);
  assert.deepEqual(sceneAudioSchedule(proj([])), []);
});
t("sceneAudioSchedule: startAt equals sceneStart(); bad offsets read as 0; empty urls and zero-length scenes are skipped", () => {
  const p = proj(scenes("1.7n 2.3n 0.9n 4.1n"));
  sceneAudioSchedule(p).forEach((c) => assert.equal(c.startAt, sceneStart(p, c.sceneIndex)));
  const odd = proj([
    { ...scene(0, 2, true), audioOffset: NaN },
    { ...scene(1, 2, true), audioOffset: -3 },
    { ...scene(2, 2, true), audioOffset: Infinity },
    { ...scene(3, 0, true) },
    { ...scene(4, NaN, true) },
    { ...scene(5, 2), audioUrl: "" },
    { ...scene(6, 2, true), audioOffset: 12.5 },
  ]);
  assert.deepEqual(sceneAudioSchedule(odd).map((c) => [c.sceneIndex, c.startAt, c.offset, c.length]), [[0, 0, 0, 2], [1, 2, 0, 2], [2, 4, 0, 2], [6, 8, 12.5, 2]]);
});

// ---------- musicLoopPlan ----------

t("musicLoopPlan: whole passes from offset 0, the last one cut at the total", () => {
  assert.deepEqual(musicLoopPlan(4, 10), [{ at: 0, offset: 0, length: 4 }, { at: 4, offset: 0, length: 4 }, { at: 8, offset: 0, length: 2 }]);
  assert.deepEqual(musicLoopPlan(2.5, 10), [0, 2.5, 5, 7.5].map((at) => ({ at, offset: 0, length: 2.5 })), "an exact multiple: no empty pass");
});
t("musicLoopPlan: a file at least as long as the video is one pass of the video's length", () => {
  assert.deepEqual(musicLoopPlan(30, 10), [{ at: 0, offset: 0, length: 10 }]);
  assert.deepEqual(musicLoopPlan(10, 10), [{ at: 0, offset: 0, length: 10 }]);
});
t("musicLoopPlan: a pass that would last 0 s through rounding is dropped (1.1 / 0.1 = 11.000000000000002)", () => {
  const plan = musicLoopPlan(0.1, 1.1);
  assert.equal(plan.length, 11);
  assert.ok(plan.every((s) => s.length > 0.09));
  assert.equal(musicLoopPlan(0.1, 0.3).length, 3);
  assert.equal(musicLoopPlan(0.2, 0.6).length, 3);
  assert.equal(musicLoopPlan(0.1, 1.1 + 1e-9).length, 11, "a last pass of a nanosecond is rounding noise, not audio");
  assert.equal(musicLoopPlan(0.1, 1.1 + 1e-3).length, 12, "a millisecond is still a pass");
});
t("musicLoopPlan: non-positive, NaN or infinite inputs plan nothing", () => {
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(musicLoopPlan(bad, 10), [], `duration ${bad}`);
    assert.deepEqual(musicLoopPlan(4, bad), [], `total ${bad}`);
  }
});
t("musicLoopPlan: a file so short it would need over 10 000 passes plans nothing instead of hanging", () => {
  assert.equal(musicLoopPlan(1, 10_000).length, 10_000);
  assert.deepEqual(musicLoopPlan(1, 10_001), []);
  assert.deepEqual(musicLoopPlan(1e-300, 100), []);
  assert.deepEqual(musicLoopPlan(5e-324, 100), []);
});
t("musicLoopPlan: 500 random cases tile the video exactly with no gap and no overlap", () => {
  const rand = mulberry32(5);
  for (let k = 0; k < 500; k++) {
    const duration = 0.05 + rand() * 60;
    const total = 0.05 + rand() * 800;
    const plan = musicLoopPlan(duration, total);
    assert.ok(plan.length > 0);
    let covered = 0;
    plan.forEach((s, i) => {
      nearly(s.at, covered, 1e-6, `pass ${i} starts where the previous ended (d=${duration}, total=${total})`);
      assert.equal(s.offset, 0);
      assert.ok(s.length > 0 && s.length <= duration, `pass ${i} length ${s.length}`);
      if (i < plan.length - 1) assert.equal(s.length, duration, "only the last pass is cut");
      covered += s.length;
    });
    nearly(covered, total, 1e-6, "covers the video");
  }
});

// ---------- scheduleGain ----------

type Call = ["cancel", number] | ["set", number, number] | ["ramp", number, number];
const recorder = () => {
  const calls: Call[] = [];
  const param: GainParam = {
    cancelScheduledValues: (time) => { calls.push(["cancel", time]); },
    setValueAtTime: (value, time) => { calls.push(["set", value, time]); },
    linearRampToValueAtTime: (value, time) => { calls.push(["ramp", value, time]); },
  };
  return { calls, param };
};
// Compile-time check (the file would not type-check otherwise): a real AudioParam fits GainParam, so `node.gain` goes straight to scheduleGain.
const audioParamFits: AudioParam extends GainParam ? true : never = true;

t("scheduleGain: a real AudioParam satisfies GainParam (checked by the compiler)", () => assert.ok(audioParamFits));

t("scheduleGain: cancel, set the first point, then one linear ramp per other point, in order, shifted by startTime", () => {
  const { calls, param } = recorder();
  scheduleGain(param, [{ t: 0, gain: 0 }, { t: 1, gain: 0.5 }, { t: 8, gain: 0.5 }, { t: 10, gain: 0 }], 2.5);
  assert.deepEqual(calls, [["cancel", 2.5], ["set", 0, 2.5], ["ramp", 0.5, 3.5], ["ramp", 0.5, 10.5], ["ramp", 0, 12.5]]);
});
t("scheduleGain: one point is just a set; an empty curve touches nothing, not even the cancel", () => {
  const one = recorder();
  scheduleGain(one.param, [{ t: 0, gain: 0.7 }], 1);
  assert.deepEqual(one.calls, [["cancel", 1], ["set", 0.7, 1]]);
  const none = recorder();
  scheduleGain(none.param, [], 1);
  assert.deepEqual(none.calls, []);
});
t("scheduleGain: a non-finite startTime schedules nothing; non-finite points are skipped; negative times are floored at 0", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const r = recorder();
    scheduleGain(r.param, [{ t: 0, gain: 1 }, { t: 1, gain: 0 }], bad);
    assert.deepEqual(r.calls, [], `startTime ${bad}`);
  }
  const skip = recorder();
  scheduleGain(skip.param, [{ t: NaN, gain: 1 }, { t: 0, gain: 0.2 }, { t: 1, gain: NaN }, { t: 2, gain: 0.4 }, { t: Infinity, gain: 0.1 }], 1);
  assert.deepEqual(skip.calls, [["cancel", 1], ["set", 0.2, 1], ["ramp", 0.4, 3]]);
  const allBad = recorder();
  scheduleGain(allBad.param, [{ t: NaN, gain: 1 }, { t: 0, gain: NaN }], 1);
  assert.deepEqual(allBad.calls, []);
  const neg = recorder();
  scheduleGain(neg.param, [{ t: 0, gain: 0.2 }, { t: 3, gain: 0.8 }], -1);
  assert.deepEqual(neg.calls, [["cancel", 0], ["set", 0.2, 0], ["ramp", 0.8, 2]]);
});
t("scheduleGain: replaying the recorded calls gives back gainAt() at every moment (preview and export agree)", () => {
  const curve = musicGainCurve(mp("1 3n 0.5 2n 2", { volume: 0.8, fadeIn: 2, fadeOut: 3 }))!;
  const start = 4;
  const { calls, param } = recorder();
  scheduleGain(param, curve, start);
  assert.deepEqual(calls.map((c) => c[0]), ["cancel", "set", ...Array(curve.length - 1).fill("ramp")]);
  const events = calls.filter((c): c is ["set" | "ramp", number, number] => c[0] !== "cancel").map((c) => ({ value: c[1], time: c[2] }));
  const replay = (time: number) => {
    if (time <= events[0].time) return events[0].value;
    for (let i = 1; i < events.length; i++) if (time <= events[i].time) return events[i - 1].value + ((events[i].value - events[i - 1].value) * (time - events[i - 1].time)) / (events[i].time - events[i - 1].time);
    return events[events.length - 1].value;
  };
  for (let x = -1; x <= 10; x += 0.01) nearly(replay(start + x), gainAt(curve, x), 1e-12, `project time ${x}`);
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
