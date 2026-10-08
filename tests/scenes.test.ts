import assert from "node:assert/strict";
import { musicGainCurve, narrationIntervals, sceneAudioSchedule } from "../src/lib/motion/audio-mix";
import { captionTimings } from "../src/lib/motion/captions";
import { sample } from "../src/lib/motion/easing";
import { moveLayer, setSceneDuration, snapToFrame, updateLayer } from "../src/lib/motion/edit";
import * as H from "../src/lib/history";
import { buildSampleProject } from "../src/lib/motion/sample";
import { ensureMediaLayer, normalizeScene } from "../src/lib/motion/sanitize";
import { addScene, deleteScene, duplicateScene, moveScene, sceneIndexByUid, splitScene } from "../src/lib/motion/scenes";
import { EASES, FRAMES, locate, projectDuration, sceneStart, type AspectRatio, type Layer, type MotionProject, type MotionScene, type Track } from "../src/lib/motion/types";

let n = 0, failed = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** Any write to a frozen object throws (the suite runs as an ES module, i.e. in strict mode): that is how mutation is caught. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---------- fixtures ----------

const MUSIC = { url: "https://x.test/m.mp3", name: "m", volume: 0.5, fadeIn: 1, fadeOut: 2, duck: true };
const proj = (scenes: MotionScene[], ratio: AspectRatio = "16:9"): MotionProject => ({
  title: "Titre",
  category: "Catégorie",
  ratio,
  palette: ["#111111", "#eeeeee"],
  scenes: scenes.map((s, i) => ({ ...s, id: i + 1 })),
  music: MUSIC,
});
/** Four distinct scenes (durations 2, 3, 4, 5), each with one text layer. */
const four = (): MotionProject =>
  proj([0, 1, 2, 3].map((i) => normalizeScene({ uid: `scene-${i}-abcdef`, duration: 2 + i, voiceOver: `voix ${i}`, layers: [{ type: "text", text: `T${i}` }] }, i, "16:9", true)));
const uids = (p: MotionProject) => p.scenes.map((s) => s.uid);
const ids = (p: MotionProject) => p.scenes.map((s) => s.id);
const durations = (p: MotionProject) => p.scenes.map((s) => s.duration);
/** The scene minus the two fields that legitimately differ between a scene and its copy. */
const bare = (s: MotionScene) => { const { uid, id, ...rest } = clone(s); void [uid, id]; return rest; };
const layer = (s: MotionScene, id: string): any => s.layers.find((l) => l.id === id);

const TRACKS = ["x", "y", "rotation", "scale", "opacity", "w", "h"] as const;
const tracksOf = (l: Layer): [string, Track][] => TRACKS.filter((k) => k in l).map((k) => [k, (l as unknown as Record<string, Track>)[k]]);

console.log("moveScene");
t("reorders, renumbers (ids 1..n) and keeps every uid attached to its scene", () => {
  const p = deepFreeze(four());
  const m = moveScene(p, 0, 2);
  assert.deepEqual(m.scenes.map((s) => s.voiceOver), ["voix 1", "voix 2", "voix 0", "voix 3"]);
  assert.deepEqual(ids(m), [1, 2, 3, 4]);
  assert.deepEqual(uids(m), [p.scenes[1].uid, p.scenes[2].uid, p.scenes[0].uid, p.scenes[3].uid]);
  assert.equal(sceneIndexByUid(m, p.scenes[0].uid), 2);
  assert.deepEqual(durations(m), [3, 4, 2, 5]);
});
t("moves in both directions, to either end", () => {
  const p = four();
  assert.deepEqual(moveScene(p, 3, 0).scenes.map((s) => s.voiceOver), ["voix 3", "voix 0", "voix 1", "voix 2"]);
  assert.deepEqual(moveScene(p, 2, 1).scenes.map((s) => s.voiceOver), ["voix 0", "voix 2", "voix 1", "voix 3"]);
  assert.deepEqual(ids(moveScene(p, 3, 0)), [1, 2, 3, 4]);
});
t("a move there and back restores the project", () => {
  const p = four();
  assert.deepEqual(clone(moveScene(moveScene(p, 0, 3), 3, 0)), clone(p));
});
t("no-ops return the very same project (from === to, out of range, not an integer)", () => {
  const p = four();
  for (const [from, to] of [[1, 1], [-1, 2], [0, 4], [4, 0], [0, 99], [0.5, 2], [1, NaN], [NaN, NaN], [1, Infinity]]) assert.equal(moveScene(p, from, to), p, `${from} -> ${to}`);
});
t("scenes that keep their position keep their identity; the rest of the project is untouched", () => {
  const p = four();
  const m = moveScene(p, 0, 1);
  assert.equal(m.scenes[2], p.scenes[2]);
  assert.equal(m.scenes[3], p.scenes[3]);
  assert.deepEqual([m.title, m.category, m.ratio, m.palette, m.music], [p.title, p.category, p.ratio, p.palette, p.music]);
});

console.log("duplicateScene");
t("the copy sits right after the original with a NEW uid; the original keeps its own", () => {
  const p = deepFreeze(four());
  const d = duplicateScene(p, 1);
  assert.equal(d.scenes.length, 5);
  assert.equal(d.scenes[1].uid, p.scenes[1].uid);
  assert.notEqual(d.scenes[2].uid, p.scenes[1].uid);
  assert.equal(new Set(uids(d)).size, 5);
  assert.deepEqual(ids(d), [1, 2, 3, 4, 5]);
  assert.deepEqual(durations(d), [2, 3, 3, 4, 5]);
  assert.equal(d.scenes[3].uid, p.scenes[2].uid, "the following scene is the same one, one place later");
  assert.equal(projectDuration(d), projectDuration(p) + 3);
});
t("the copy keeps everything else: assets, offsets, layers (same ids), narration, background, transition", () => {
  const rich = normalizeScene({
    uid: "rich-scene-uid", duration: 6, voiceOver: "Bonjour tout le monde", visualPrompt: "a prompt",
    background: { type: "radial", from: "#000000", to: "#222222" }, transition: { type: "wipe", duration: 0.8 },
    imageUrl: "https://x.test/i.png", videoUrl: "https://x.test/v.mp4", audioUrl: "https://x.test/a.mp3", audioOffset: 2.5, mediaOffset: 1.25,
    layers: [{ type: "text", text: "A", x: [{ t: 0, v: 0 }, { t: 1, v: 9 }] }, { type: "rect", w: 12 }],
  }, 0, "16:9", true);
  assert.equal(rich.audioOffset, 2.5);
  const p = proj([rich, four().scenes[0]]);
  const d = duplicateScene(p, 0);
  assert.deepEqual(bare(d.scenes[1]), bare(rich));
  assert.deepEqual(d.scenes[1].layers.map((l) => l.id), rich.layers.map((l) => l.id));
  assert.equal(d.scenes[1].audioUrl, rich.audioUrl);
  assert.equal(d.scenes[1].audioOffset, 2.5);
  assert.equal(d.scenes[1].mediaOffset, 1.25);
});
t("duplicating the last scene appends; invalid index changes nothing", () => {
  const p = four();
  assert.equal(duplicateScene(p, 3).scenes[4].voiceOver, "voix 3");
  for (const i of [-1, 4, 99, 1.5, NaN]) assert.equal(duplicateScene(p, i), p, String(i));
});

console.log("deleteScene");
t("removes the scene, renumbers, leaves the other uids alone", () => {
  const p = deepFreeze(four());
  const d = deleteScene(p, 1);
  assert.deepEqual(d.scenes.map((s) => s.voiceOver), ["voix 0", "voix 2", "voix 3"]);
  assert.deepEqual(ids(d), [1, 2, 3]);
  assert.deepEqual(uids(d), [p.scenes[0].uid, p.scenes[2].uid, p.scenes[3].uid]);
  assert.equal(sceneIndexByUid(d, p.scenes[1].uid), -1);
  assert.equal(deleteScene(p, 0).scenes[0].voiceOver, "voix 1");
  assert.equal(deleteScene(p, 3).scenes.length, 3);
});
t("refuses to delete the last scene; invalid index changes nothing", () => {
  const p = four();
  const one = deleteScene(deleteScene(deleteScene(p, 0), 0), 0);
  assert.equal(one.scenes.length, 1);
  assert.equal(deleteScene(one, 0), one, "a project always has a scene");
  for (const i of [-1, 4, 1.5, NaN]) assert.equal(deleteScene(p, i), p, String(i));
});

console.log("addScene");
t("inserts a blank scene at the start (-1), in the middle and at the end", () => {
  const p = deepFreeze(four());
  const start = addScene(p, -1);
  const mid = addScene(p, 1);
  const end = addScene(p, 3);
  assert.equal(start.scenes.length, 5);
  assert.equal(start.scenes[0].layers[0].type, "text");
  assert.deepEqual(start.scenes.slice(1).map((s) => s.uid), uids(p));
  assert.equal(mid.scenes[2].voiceOver, "");
  assert.deepEqual([mid.scenes[1].uid, mid.scenes[3].uid], [p.scenes[1].uid, p.scenes[2].uid]);
  assert.equal(end.scenes[4].duration, 3);
  for (const r of [start, mid, end]) assert.deepEqual(ids(r), [1, 2, 3, 4, 5]);
  assert.equal(new Set(uids(mid)).size, 5, "the new uid is new");
});
t("the blank scene: dark linear gradient, 3 s, fade 0.5, empty narration, ONE title centred in the frame of the ratio", () => {
  for (const ratio of ["16:9", "9:16"] as const) {
    const s = addScene({ ...four(), ratio }, 0).scenes[1];
    const { width, height } = FRAMES[ratio];
    assert.equal(s.background.type, "linear");
    assert.equal(s.duration, 3);
    assert.deepEqual(s.transition, { type: "fade", duration: 0.5 });
    assert.deepEqual([s.voiceOver, s.visualPrompt], ["", ""]);
    assert.equal(s.layers.length, 1);
    const l: any = s.layers[0];
    assert.deepEqual([l.type, l.text, l.size, l.font, l.reveal, l.revealDuration], ["text", "Nouvelle scène", 96, "display", "words", 0.8]);
    assert.deepEqual([l.x, l.y], [width / 2, height / 2]);
    assert.deepEqual([l.start, l.end], [0, null]);
    assert.deepEqual([s.imageUrl, s.videoUrl, s.audioUrl], [undefined, undefined, undefined]);
  }
});
t("the blank scene survives a save/reload unchanged (it already is what the sanitizer would produce)", () => {
  for (const ratio of ["16:9", "9:16"] as const) {
    const s = addScene({ ...four(), ratio }, 0).scenes[1];
    assert.deepEqual(clone(normalizeScene(clone(s), 1, ratio, true)), clone(s));
  }
});
t("invalid position changes nothing", () => {
  const p = four();
  for (const i of [-2, 4, 99, 1.5, NaN]) assert.equal(addScene(p, i), p, String(i));
});

console.log("sceneIndexByUid");
t("finds the scene wherever it is; -1 when it is gone or unknown", () => {
  const p = four();
  assert.equal(sceneIndexByUid(p, p.scenes[2].uid), 2);
  assert.equal(sceneIndexByUid(moveScene(p, 2, 0), p.scenes[2].uid), 0);
  assert.equal(sceneIndexByUid(deleteScene(p, 2), p.scenes[2].uid), -1);
  assert.equal(sceneIndexByUid(p, "nope"), -1);
});

// ---------- splitScene ----------

console.log("splitScene: the cut itself");
const plain = () => proj([normalizeScene({
  uid: "plain-scene-uid", duration: 4.5, voiceOver: "Un deux trois quatre cinq six sept huit neuf dix onze douze",
  visualPrompt: "prompt", background: { type: "linear", from: "#000000", to: "#333333", angle: 90 }, transition: { type: "slide", duration: 0.6 },
  imageUrl: "https://x.test/i.png", layers: [{ type: "rect" }],
}, 0, "16:9", true), ...four().scenes.slice(1)]);

t("refused (same project) for a bad index, a bad time, or a half shorter than 0.3 s", () => {
  const p = plain();
  for (const [i, at] of [[-1, 1], [4, 1], [0.5, 1], [NaN, 1], [0, NaN], [0, Infinity], [0, -Infinity], [0, 0], [0, -1], [0, 0.1], [0, 0.2], [0, 4.4], [0, 4.3], [0, 4.5], [0, 99]]) assert.equal(splitScene(p, i, at), p, `${i} @ ${at}`);
});
t("the shortest legal halves are exactly 0.3 s (float noise must not refuse them)", () => {
  const p = plain();
  const early = splitScene(p, 0, 0.3);
  const late = splitScene(p, 0, 4.2);
  assert.notEqual(early, p);
  assert.notEqual(late, p);
  assert.ok(near(early.scenes[0].duration, 0.3) && near(late.scenes[1].duration, 0.3, 1e-6));
  assert.ok(near(late.scenes[0].duration + late.scenes[1].duration, 4.5));
});
t("the cut snaps to the 30 fps grid (a time that rounds under 0.3 s is allowed once snapped)", () => {
  const p = plain();
  assert.ok(near(splitScene(p, 0, 1.0167).scenes[0].duration, 31 / 30));
  assert.ok(near(splitScene(p, 0, 1.99).scenes[0].duration, 2));
  assert.ok(near(splitScene(p, 0, 0.29).scenes[0].duration, 0.3));
  for (const at of [0.77, 1.234, 2.718, 3.1415]) assert.ok(near(splitScene(p, 0, at).scenes[0].duration, snapToFrame(at)), String(at));
  assert.ok(near(splitScene(p, 0, 1.23).scenes[0].duration * 30, Math.round(splitScene(p, 0, 1.23).scenes[0].duration * 30)), "a whole number of frames");
});
t("two scenes where there was one: first keeps uid and transition, second is new with a hard cut", () => {
  const p = deepFreeze(plain());
  const s = splitScene(p, 0, 1.5);
  assert.equal(s.scenes.length, p.scenes.length + 1);
  const [a, b] = s.scenes;
  assert.equal(a.uid, p.scenes[0].uid);
  assert.notEqual(b.uid, a.uid);
  assert.deepEqual(a.transition, { type: "slide", duration: 0.6 });
  assert.deepEqual(b.transition, { type: "none", duration: 0.5 });
  assert.deepEqual([a.duration, b.duration], [1.5, 3]);
  assert.deepEqual(ids(s), [1, 2, 3, 4, 5]);
  assert.equal(new Set(uids(s)).size, 5);
  assert.deepEqual(s.scenes.slice(2).map((x) => x.uid), p.scenes.slice(1).map((x) => x.uid));
  assert.equal(s.scenes[2].transition, p.scenes[1].transition, "the next scene is untouched");
  assert.ok(near(projectDuration(s), projectDuration(p)), "the video lasts exactly as long");
  assert.deepEqual([s.title, s.category, s.ratio, s.palette, s.music], [p.title, p.category, p.ratio, p.palette, p.music]);
});
t("what is not time-dependent is copied to both halves", () => {
  const [a, b] = splitScene(plain(), 0, 1.5).scenes;
  for (const x of [a, b]) assert.deepEqual([x.imageUrl, x.visualPrompt, x.background], ["https://x.test/i.png", "prompt", { type: "linear", from: "#000000", to: "#333333", angle: 90 }]);
});
t("a transition may not swallow the first half: clamped to half its length (as sanitize does on reload); 'none' left alone", () => {
  const p = plain();
  assert.deepEqual(splitScene(p, 0, 0.5).scenes[0].transition, { type: "slide", duration: 0.25 });
  assert.equal(splitScene(p, 0, 2).scenes[0].transition, p.scenes[0].transition, "fits: same object");
  const none = proj([{ ...p.scenes[0], transition: { type: "none", duration: 0.5 } }]);
  assert.equal(splitScene(none, 0, 0.4).scenes[0].transition, none.scenes[0].transition);
});

console.log("splitScene: narration and assets");
t("voiceOver is split on word boundaries in proportion to the cut; the rest goes to the second half", () => {
  const p = plain(); // 12 words, 4.5 s
  const half = splitScene(p, 0, 2.25).scenes;
  assert.deepEqual([half[0].voiceOver, half[1].voiceOver], ["Un deux trois quatre cinq six", "sept huit neuf dix onze douze"]);
  const third = splitScene(p, 0, 1.5).scenes; // ratio 1/3 -> 4 words
  assert.deepEqual([third[0].voiceOver, third[1].voiceOver], ["Un deux trois quatre", "cinq six sept huit neuf dix onze douze"]);
  for (const at of [0.3, 0.8, 1.7, 3.3, 4.2]) {
    const [a, b] = splitScene(p, 0, at).scenes;
    assert.equal(`${a.voiceOver} ${b.voiceOver}`.trim(), p.scenes[0].voiceOver, `lossless @ ${at}`);
    assert.equal(a.voiceOver.split(" ").length, Math.round(12 * a.duration / 4.5));
  }
});
t("at least one word in the first half; a tail that is all words may leave the second empty; empty stays empty", () => {
  const few = proj([{ ...plain().scenes[0], voiceOver: "un deux trois" }]);
  assert.deepEqual(splitScene(few, 0, 0.5).scenes.map((s) => s.voiceOver), ["un", "deux trois"], "round(0.33) = 0, but the first half never starts mute");
  const two = proj([{ ...plain().scenes[0], voiceOver: "un deux" }]);
  assert.deepEqual(splitScene(two, 0, 4).scenes.map((s) => s.voiceOver), ["un deux", ""]);
  const none = proj([{ ...plain().scenes[0], voiceOver: "" }]);
  assert.deepEqual(splitScene(none, 0, 2).scenes.map((s) => s.voiceOver), ["", ""]);
});
t("each half keeps the spacing inside its words (newlines, double spaces, punctuation) and loses only the outer blanks", () => {
  const p = proj([{ ...plain().scenes[0], voiceOver: "  Salut,  le\nmonde, ça va bien  " }]); // 6 words
  assert.deepEqual(splitScene(p, 0, 2.25).scenes.map((s) => s.voiceOver), ["Salut,  le\nmonde,", "ça va bien"]);
});
t("audio: shared file, the second half starts t seconds further in (offsets accumulate over successive cuts)", () => {
  const base = plain().scenes[0];
  const voiced = proj([{ ...base, audioUrl: "https://x.test/a.mp3" }]);
  const [a, b] = splitScene(voiced, 0, 1.5).scenes;
  assert.deepEqual([a.audioUrl, b.audioUrl, a.audioOffset, b.audioOffset], ["https://x.test/a.mp3", "https://x.test/a.mp3", 0, 1.5]);
  const [b1, b2] = splitScene(splitScene(voiced, 0, 1.5), 1, 1).scenes.slice(1);
  assert.deepEqual([b1.audioOffset, b2.audioOffset], [1.5, 2.5]);
  const resumed = proj([{ ...base, audioUrl: "https://x.test/a.mp3", audioOffset: 4 }]);
  const [c, d] = splitScene(resumed, 0, 2).scenes;
  assert.deepEqual([c.audioOffset, d.audioOffset], [4, 6]);
});
t("video: the second half continues the clip; the first keeps its own offset", () => {
  const base = plain().scenes[0];
  const clip = proj([{ ...base, videoUrl: "https://x.test/v.mp4" }]);
  const [a, b] = splitScene(clip, 0, 1.5).scenes;
  assert.deepEqual([a.videoUrl, b.videoUrl, a.mediaOffset, b.mediaOffset], ["https://x.test/v.mp4", "https://x.test/v.mp4", undefined, 1.5]);
  const resumed = proj([{ ...base, videoUrl: "https://x.test/v.mp4", mediaOffset: 2 }]);
  const [c, d] = splitScene(resumed, 0, 1.5).scenes;
  assert.deepEqual([c.mediaOffset, d.mediaOffset], [2, 3.5]);
});
t("no asset, no offset (not even a 0)", () => {
  const [a, b] = splitScene(plain(), 0, 1.5).scenes;
  for (const x of [a, b]) {
    assert.ok(!("audioOffset" in x) && !("mediaOffset" in x), "no offsets without audio/video");
    assert.deepEqual([x.audioUrl, x.videoUrl], [undefined, undefined]);
  }
  const [c, d] = splitScene(proj([{ ...plain().scenes[0], audioUrl: "https://x.test/a.mp3" }]), 0, 1.5).scenes;
  assert.ok(!("mediaOffset" in c) && !("mediaOffset" in d), "audio only: no video offset");
});

console.log("splitScene: layers");
// duration 10, cut at 3. Each layer is there to pin down one rule.
const rules = () => proj([normalizeScene({
  uid: "rules-scene-uid", duration: 10, voiceOver: "x",
  layers: [
    { type: "rect", x: [{ t: 0, v: 0 }, { t: 4, v: 400, ease: "linear" }] },                                      // l0 runs through, cut inside a segment
    { type: "ellipse", end: 1.5, x: [{ t: 0, v: 10 }, { t: 5, v: 50 }] },                                         // l1 over before the cut
    { type: "rect", start: 2, end: 6, w: [{ t: 2, v: 0 }, { t: 4, v: 400, ease: "linear" }] },                    // l2 starts before, ends after
    { type: "text", text: "Late", start: 5, reveal: "words", x: [{ t: 1, v: 0 }, { t: 4, v: 90 }, { t: 7, v: 100 }] }, // l3 starts after; keys on both sides of the cut
    { type: "text", text: "Early", start: 1, reveal: "chars", revealDuration: 1 },                                 // l4 reveal already played
    { type: "text", text: "Right on", start: 3, reveal: "fade" },                                                 // l5 starts exactly on the cut
    { type: "rect", opacity: [{ t: 0, v: 0 }, { t: 2, v: 1 }] },                                                  // l6 all keys before the cut
    { type: "rect", y: [{ t: 5, v: 10 }, { t: 8, v: 20 }] },                                                      // l7 all keys after the cut
    { type: "ellipse", end: 3 },                                                                                  // l8 ends exactly on the cut
    { type: "rect", w: 50 },                                                                                      // l9 static, whole scene
  ],
}, 0, "16:9", true)]);
const cutRules = (at = 3) => splitScene(rules(), 0, at).scenes;

t("first half: layers that start before the cut; the ones that run past it now end with the scene", () => {
  const [a] = cutRules();
  assert.deepEqual(a.layers.map((l) => l.id), ["l0", "l1", "l2", "l4", "l6", "l7", "l8", "l9"], "l3 and l5 start at/after the cut");
  assert.equal(layer(a, "l0").end, null);
  assert.equal(layer(a, "l2").end, null, "was 6, past the cut");
  assert.equal(layer(a, "l2").start, 2);
  assert.equal(layer(a, "l8").end, null, "ending exactly on the cut = running to the end of the shorter scene");
  assert.equal(layer(a, "l1").end, 1.5, "a layer over before the cut is not touched");
});
t("first half: keyframes after the cut are dropped; the pose at the cut is pinned so the half ends where the original stood", () => {
  const p = rules();
  const [a] = splitScene(p, 0, 3).scenes;
  assert.deepEqual(layer(a, "l0").x, [{ t: 0, v: 0 }, { t: 3, v: 300, ease: "linear" }]);
  assert.deepEqual(layer(a, "l2").w, [{ t: 2, v: 0 }, { t: 3, v: 200, ease: "linear" }]);
  assert.equal(layer(a, "l7").y, 10, "the motion hasn't begun at the cut: only its first pose is ever seen");
  assert.equal(layer(a, "l6").opacity, (p.scenes[0].layers[6] as any).opacity, "all keys before the cut: the very same track");
  assert.deepEqual(layer(a, "l1").x, [{ t: 0, v: 10 }, { t: 5, v: 50 }], "dead keys of a finished layer are left alone");
});
t("second half: layers still visible at the cut or starting later, shifted by -t; layers that ended don't exist", () => {
  const [, b] = cutRules();
  assert.deepEqual(b.layers.map((l) => l.id), ["l0", "l2", "l3", "l4", "l5", "l6", "l7", "l9"], "l1 (ended 1.5) and l8 (ended on the cut) are gone");
  assert.deepEqual([layer(b, "l0").start, layer(b, "l0").end], [0, null]);
  assert.deepEqual([layer(b, "l2").start, layer(b, "l2").end], [0, 3], "end 6 -> 3");
  assert.deepEqual([layer(b, "l3").start, layer(b, "l3").end], [2, null], "start 5 -> 2");
  assert.deepEqual([layer(b, "l5").start, layer(b, "l5").end], [0, null], "starting on the cut = starting at 0");
  assert.deepEqual([layer(b, "l7").start, layer(b, "l7").end], [0, null]);
});
t("second half: a running track continues seamlessly (ONE key at 0 = the value at the cut, next key keeps its ease)", () => {
  const [, b] = cutRules();
  assert.deepEqual(layer(b, "l0").x, [{ t: 0, v: 300 }, { t: 1, v: 400, ease: "linear" }]);
  assert.deepEqual(layer(b, "l2").w, [{ t: 0, v: 200 }, { t: 1, v: 400, ease: "linear" }]);
  assert.equal(layer(b, "l6").opacity, 1, "everything has played out: constant");
  assert.deepEqual(layer(b, "l7").y, [{ t: 2, v: 10 }, { t: 5, v: 20 }], "nothing happened yet: a plain shift");
  assert.equal(layer(b, "l9").w, 50, "a static number stays");
});
t("second half: a layer starting after the cut never gets a negative key time", () => {
  const [, b] = cutRules();
  const original = rules().scenes[0].layers[3].x as Track;
  assert.deepEqual(layer(b, "l3").x, [{ t: 0, v: sample(original, 3) }, { t: 1, v: 90 }, { t: 4, v: 100 }]);
  for (const l of b.layers) for (const [, tr] of tracksOf(l)) if (Array.isArray(tr)) assert.ok(tr.every((k) => k.t >= 0), l.id);
});
t("a text whose reveal started before the cut does not replay it; one starting at/after the cut keeps it", () => {
  const [a, b] = cutRules();
  assert.equal(layer(a, "l4").reveal, "chars", "the first half is untouched");
  assert.equal(layer(b, "l4").reveal, "none");
  assert.equal(layer(b, "l3").reveal, "words");
  assert.equal(layer(b, "l5").reveal, "fade", "starts exactly on the cut: its reveal plays in the second half");
  assert.equal(layer(b, "l4").text, "Early", "only the animation changes, not the text");
});
t("layers that need no change are shared, not copied", () => {
  const p = rules();
  const [a, b] = splitScene(p, 0, 3).scenes;
  const src = p.scenes[0].layers;
  assert.equal(layer(a, "l1"), src[1], "over before the cut");
  assert.equal(layer(a, "l9"), src[9], "static whole-scene layer, first half");
  assert.equal(layer(b, "l9"), src[9], "static whole-scene layer, second half");
});
t("a cut before every layer leaves the first half empty; a cut after every layer leaves the second empty (no crash, no phantom layer)", () => {
  const p = proj([normalizeScene({ duration: 10, layers: [{ type: "text", text: "A", start: 6, end: 8 }] }, 0, "16:9", true)]);
  const early = splitScene(p, 0, 2).scenes;
  assert.deepEqual([early[0].layers.length, early[1].layers.length], [0, 1]);
  assert.equal(early[1].layers[0].start, 4);
  assert.equal(early[1].layers[0].end, 6);
  const late = splitScene(p, 0, 9).scenes;
  assert.deepEqual([late[0].layers.length, late[1].layers.length], [1, 0]);
  assert.equal(late[0].layers[0].end, 8, "it was over before the cut");
});

console.log("splitScene: captions");
const captionScene = (text: string, extra: Record<string, unknown> = {}) =>
  proj([normalizeScene({ duration: 10, layers: [{ type: "captions", text, style: "pop", highlight: "#ff0000", uppercase: true, size: 70, ...extra }] }, 0, "16:9", true)]);
const cap = (s: MotionScene): any => s.layers.find((l) => l.type === "captions");

t("the words already shown stay in the first half, the rest go to the second: nothing restarts", () => {
  const text = "aa bb cc dd ee ff gg hh ii jj";
  const [a, b] = splitScene(captionScene(text), 0, 4).scenes;
  assert.equal(cap(a).text, "aa bb cc dd");
  assert.equal(cap(b).text, "ee ff gg hh ii jj");
  assert.equal(`${cap(a).text} ${cap(b).text}`, text, "lossless, in order");
  assert.deepEqual([cap(a).start, cap(a).end, cap(b).start, cap(b).end], [0, null, 0, null]);
});
t("the style (and every other setting) of the captions is kept on both sides", () => {
  const p = captionScene("aa bb cc dd ee ff gg hh ii jj");
  const [a, b] = splitScene(p, 0, 5).scenes;
  const src = p.scenes[0].layers[0] as any;
  for (const x of [cap(a), cap(b)]) assert.deepEqual({ ...x, text: "", end: null, start: 0 }, { ...src, text: "", end: null, start: 0 });
  assert.deepEqual([cap(a).style, cap(a).highlight, cap(a).uppercase, cap(b).style], ["pop", "#ff0000", true, "pop"]);
});
t("words are weighted by length, like the captions are timed: the cut lands on the nearest word boundary", () => {
  const [a, b] = splitScene(captionScene("a b cccccccccccc d"), 0, 6).scenes; // boundaries at 1/15, 2/15, 14/15 of the window; 60% played
  assert.deepEqual([cap(a).text, cap(b).text], ["a b cccccccccccc", "d"]);
});
t("it follows the captions engine's own timing and words: pauses after punctuation count, and a lone ? or ! never starts a half", () => {
  const text = "Bonjour. Ça va bien ? Oui ! Très bien : merci beaucoup.";
  const timings = captionTimings(text, 0, 10);
  const blanks = (s: string) => s.replace(/\s+/g, "");
  let checked = 0;
  for (let frame = 9; frame <= 291; frame++) {
    const at = frame / 30;
    const [a, b] = splitScene(captionScene(text), 0, at).scenes;
    const head = cap(a).text as string;
    const tail = cap(b)?.text as string | undefined;
    assert.equal(blanks(head + (tail ?? "")), blanks(text), `lossless @ ${at}`);
    assert.ok(!/^[?!:.,;]/.test(tail ?? "x"), `the second half starts with a mark @ ${at}: "${tail}"`);
    // The head is exactly the first k words of the engine, with k the word boundary nearest to the cut.
    const k = timings.reduce((best, w, i) => (Math.abs(w.end - at) < Math.abs(timings[best].end - at) ? i : best), 0) + 1;
    assert.equal(blanks(head), timings.slice(0, k).map((w) => w.text).join(""), `engine boundary @ ${at}`);
    checked++;
  }
  assert.equal(checked, 283);
});
t("the window of the captions layer counts, not the scene: a layer from 2 s to 6 s cut at 4 s is half played", () => {
  const [a, b] = splitScene(captionScene("aa bb cc dd ee ff", { start: 2, end: 6 }), 0, 4).scenes;
  assert.deepEqual([cap(a).text, cap(b).text], ["aa bb cc", "dd ee ff"]);
  assert.deepEqual([cap(a).start, cap(a).end], [2, null]);
  assert.deepEqual([cap(b).start, cap(b).end], [0, 2], "6 s -> 2 s into the second half");
});
t("a captions layer with nothing left to say is dropped from the second half; one still to come is untouched; one over is untouched", () => {
  const one = splitScene(captionScene("Bonjour"), 0, 5).scenes;
  assert.equal(cap(one[0]).text, "Bonjour");
  assert.equal(cap(one[1]), undefined);
  const later = captionScene("aa bb cc", { start: 6 });
  const [a, b] = splitScene(later, 0, 4).scenes;
  assert.equal(cap(a), undefined);
  assert.equal(cap(b).text, "aa bb cc");
  assert.equal(cap(b).start, 2);
  const over = captionScene("aa bb cc", { end: 3 });
  const [c, d] = splitScene(over, 0, 4).scenes;
  assert.equal(cap(c), over.scenes[0].layers[0], "same object");
  assert.equal(cap(d), undefined);
});
t("the captions keep a non-empty text on each side that has them", () => {
  const text = "un deux trois quatre cinq six sept huit neuf dix onze douze";
  for (const at of [0.3, 0.7, 1.4, 2.9, 4.4, 5, 7.3, 9.7]) for (const x of splitScene(captionScene(text), 0, at).scenes) if (cap(x)) assert.ok(cap(x).text.trim().length > 0, String(at));
});

console.log("splitScene: the backdrop and continuity");
const withMedia = (ratio: AspectRatio = "16:9") => { const p = buildSampleProject(ratio); return { ...p, scenes: p.scenes.map((s) => ensureMediaLayer(s, ratio)) }; };

t("the media layer lives in both halves and its slow push-in carries on without a jump (linear, so exactly)", () => {
  const p = deepFreeze(withMedia());
  const scene = p.scenes[0]; // 4.5 s, scale 1 -> 1.12
  const [a, b] = splitScene(p, 0, 1.5).scenes;
  const src = layer(scene, "media").scale as Track;
  for (const x of [a, b]) assert.ok(x.layers.some((l) => l.type === "media") && x.layers.some((l) => l.id === "dim"));
  for (let i = 0; i <= 20; i++) {
    const tau = (1.5 * i) / 20;
    assert.ok(near(sample(layer(a, "media").scale, tau), sample(src, tau)), `first half @ ${tau}`);
    const tau2 = (3 * i) / 20;
    assert.ok(near(sample(layer(b, "media").scale, tau2), sample(src, 1.5 + tau2)), `second half @ ${tau2}`);
  }
});

const CUTS = [0.3, 0.5, 0.7, 0.77, 1, 1.1, 1.234, 1.5, 1.9, 2, 2.2, 2.5, 2.718, 2.8, 3, 3.1415, 3.3, 3.7, 4, 4.2];
/** Is the cut inside a segment (between two keys)? Then the halves reshape the ease a little; elsewhere they are exact. */
const insideSegment = (track: Track, cut: number) => Array.isArray(track) && track[0].t < cut - 1e-6 && track[track.length - 1].t > cut + 1e-6 && !track.some((k) => Math.abs(k.t - cut) <= 1e-6);

t("CONTINUITY: for every layer and track present on both sides, the value just before the cut = the value at local time 0 of the second half", () => {
  let tracks = 0, exact = 0, cuts = 0;
  for (const ratio of ["16:9", "9:16"] as const) {
    const p = deepFreeze(withMedia(ratio));
    p.scenes.forEach((scene, i) => {
      for (const at of CUTS) {
        const result = splitScene(p, i, at);
        if (result === p) continue;
        cuts++;
        const [a, b] = result.scenes.slice(i, i + 2);
        const cut = a.duration;
        assert.ok(near(cut + b.duration, scene.duration));
        for (const l2 of b.layers) {
          const src = scene.layers.find((l) => l.id === l2.id);
          assert.ok(src, `${l2.id} exists in the original`);
          const l1 = a.layers.find((l) => l.id === l2.id);
          for (const [name, track] of tracksOf(src)) {
            const before = sample(track, cut - 1e-9); // the ORIGINAL just before the cut
            // expoOut (1/1024 of its range) and elasticOut (about 1/2500) have a small built-in step at their very end: a cut exactly on such a key is a step in the original itself.
            const step = Array.isArray(track) && track.some((k) => (k.ease === "expoOut" || k.ease === "elasticOut") && Math.abs(k.t - cut) <= 1e-6);
            const tol = step ? 1e-4 + 2e-3 * Math.max(...track.map((k) => Math.abs(k.v))) : 1e-4;
            const second = tracksOf(l2).find(([k]) => k === name)![1];
            assert.ok(near(sample(second, 0), before, tol), `${scene.id}/${l2.id}.${name} @ ${at}: second half starts at ${sample(second, 0)}, original had ${before}`);
            tracks++;
            if (l1) {
              const first = tracksOf(l1).find(([k]) => k === name)![1];
              assert.ok(near(sample(first, cut), before, tol), `${scene.id}/${l1.id}.${name} @ ${at}: first half ends at ${sample(first, cut)}, original had ${before}`);
              // Away from a segment the halves are not an approximation: they ARE the original, frame for frame.
              if (!insideSegment(track, cut)) {
                exact++;
                for (let k = 0; k <= 12; k++) {
                  assert.ok(near(sample(first, (cut * k) / 12), sample(track, (cut * k) / 12), 1e-9), `${l1.id}.${name} head`);
                  assert.ok(near(sample(second, (b.duration * k) / 12), sample(track, cut + (b.duration * k) / 12), 1e-9), `${l2.id}.${name} tail`);
                }
              }
            }
          }
        }
      }
    });
  }
  assert.ok(cuts > 100 && tracks > 2000 && exact > 1000, `not vacuous (${cuts} cuts, ${tracks} tracks, ${exact} exact)`);
});

t("CONTINUITY holds for every ease, cutting inside a segment (the case the halves can only approximate)", () => {
  for (const e of EASES) {
    const p = proj([normalizeScene({ duration: 8, layers: [{ type: "rect", x: [{ t: 0, v: 100 }, { t: 6, v: 900, ease: e }], opacity: [{ t: 1, v: 0 }, { t: 5, v: 1, ease: e }] }] }, 0, "16:9", true)]);
    for (const at of [0.5, 1.5, 2.5, 3, 4, 5.5, 7]) {
      const [a, b] = splitScene(p, 0, at).scenes;
      const src = p.scenes[0].layers[0] as any;
      for (const name of ["x", "opacity"] as const) {
        const before = sample(src[name], a.duration - 1e-9);
        assert.ok(near(sample(layer(b, "l0")[name], 0), before, 1e-4), `${e}.${name} @ ${at} second`);
        assert.ok(near(sample(layer(a, "l0")[name], a.duration), before, 1e-4), `${e}.${name} @ ${at} first`);
      }
    }
  }
});

t("a cut that lands on a keyframe splits the motion exactly (both halves ARE the original)", () => {
  const keys = [{ t: 0, v: 0 }, { t: 1, v: 100, ease: "easeOut" as const }, { t: 2, v: 50, ease: "backOut" as const }, { t: 4, v: 300, ease: "elasticOut" as const }];
  const p = proj([normalizeScene({ duration: 8, layers: [{ type: "rect", x: keys }] }, 0, "16:9", true)]);
  const [a, b] = splitScene(p, 0, 2).scenes;
  for (let i = 0; i <= 40; i++) {
    assert.ok(near(sample(layer(a, "l0").x, i * 0.05), sample(keys, i * 0.05)), `head ${i}`);
    assert.ok(near(sample(layer(b, "l0").x, i * 0.05), sample(keys, 2 + i * 0.05)), `tail ${i}`);
  }
  assert.deepEqual(layer(b, "l0").x, [{ t: 0, v: 50 }, { t: 2, v: 300, ease: "elasticOut" }]);
});

console.log("project-wide guarantees");
t("nothing mutates its input (deep-frozen projects go through every operation)", () => {
  const projects = [four(), plain(), rules(), captionScene("aa bb cc dd ee ff"), withMedia(), withMedia("9:16")];
  for (const p of projects) {
    const before = clone(p);
    deepFreeze(p);
    const last = p.scenes.length - 1;
    moveScene(p, 0, last); duplicateScene(p, 0); duplicateScene(p, last); deleteScene(p, 0); addScene(p, -1); addScene(p, last);
    p.scenes.forEach((s, i) => { for (const at of [0.3, 1, 2.5, 3, 4.2]) splitScene(p, i, at); });
    assert.deepEqual(clone(p), before);
  }
});
t("every no-op returns the very same project", () => {
  const p = deepFreeze(four());
  assert.equal(moveScene(p, 2, 2), p);
  assert.equal(deleteScene(proj([p.scenes[0]]), 0).scenes.length, 1);
  assert.equal(addScene(p, 10), p);
  assert.equal(duplicateScene(p, -1), p);
  assert.equal(splitScene(p, 0, 0.1), p);
});

// Seeded PRNG (mulberry32) so a failing run can be replayed.
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function invariants(p: MotionProject, label: string) {
  assert.ok(p.scenes.length >= 1, `${label}: at least one scene`);
  assert.deepEqual(ids(p), p.scenes.map((_, i) => i + 1), `${label}: ids are 1..n`);
  assert.equal(new Set(uids(p)).size, p.scenes.length, `${label}: uids are unique`);
  for (const s of p.scenes) {
    assert.ok(s.duration >= 0.3 - 1e-6, `${label}: scene ${s.id} lasts ${s.duration}`);
    assert.equal(new Set(s.layers.map((l) => l.id)).size, s.layers.length, `${label}: layer ids unique in scene ${s.id}`);
    for (const l of s.layers) {
      assert.ok(l.start >= 0 && l.start < s.duration, `${label}: ${s.id}/${l.id} starts at ${l.start} in a ${s.duration} s scene`);
      if (l.end !== null) assert.ok(l.end > l.start, `${label}: ${s.id}/${l.id} ends after it starts`);
      for (const [name, track] of tracksOf(l)) {
        if (!Array.isArray(track)) continue;
        assert.ok(track.every((k, i) => k.t >= 0 && (i === 0 || k.t >= track[i - 1].t)), `${label}: ${s.id}/${l.id}.${name} keys are sorted and non-negative`);
        if (l.end === null) assert.ok(track[track.length - 1].t <= s.duration + 1e-6, `${label}: ${s.id}/${l.id}.${name} has a key past the end of the scene`);
      }
    }
  }
}

t("FUZZ: 200 random operations x 6 seeds keep ids 1..n, unique uids, a consistent total duration and at least one scene", () => {
  const tally = { move: 0, duplicate: 0, delete: 0, add: 0, split: 0, refused: 0 };
  [1, 2, 3, 42, 2026, 31337].forEach((seed, run) => {
    const rnd = rng(seed);
    const pick = (k: number) => Math.floor(rnd() * k);
    let p = deepFreeze(withMedia(run % 2 ? "9:16" : "16:9"));
    const everSeen = new Set(uids(p));
    invariants(p, `seed ${seed} start`);
    for (let step = 0; step < 200; step++) {
      const count = p.scenes.length;
      const total = projectDuration(p);
      const kind = (["move", "duplicate", "delete", "add", "split"] as const)[pick(5)];
      const i = pick(count + 2) - 1; // -1..count: some of them invalid on purpose
      const j = pick(count + 2) - 1;
      const label = `seed ${seed} step ${step} ${kind}(${i},${j})`;
      const known = new Set(uids(p));
      let next: MotionProject;
      let allowed: boolean;
      let expectedCount = count;
      let expectedTotal = total;
      if (kind === "move") {
        next = moveScene(p, i, j);
        allowed = i >= 0 && i < count && j >= 0 && j < count && i !== j;
      } else if (kind === "duplicate") {
        next = duplicateScene(p, i);
        allowed = i >= 0 && i < count;
        if (allowed) { expectedCount++; expectedTotal += p.scenes[i].duration; }
      } else if (kind === "delete") {
        next = deleteScene(p, i);
        allowed = i >= 0 && i < count && count > 1;
        if (allowed) { expectedCount--; expectedTotal -= p.scenes[i].duration; }
      } else if (kind === "add") {
        next = addScene(p, i);
        allowed = i >= -1 && i < count;
        if (allowed) { expectedCount++; expectedTotal += 3; }
      } else {
        const at = rnd() * ((p.scenes[Math.max(0, Math.min(count - 1, i))].duration) + 1) - 0.5;
        next = splitScene(p, i, at);
        const cut = snapToFrame(at);
        const dur = i >= 0 && i < count ? p.scenes[i].duration : 0;
        allowed = i >= 0 && i < count && cut >= 0.3 - 1e-6 && dur - cut >= 0.3 - 1e-6;
        if (allowed) expectedCount++;
      }
      assert.equal(next !== p, allowed, `${label}: ${allowed ? "should apply" : "should be a no-op returning the same project"}`);
      if (!allowed) { tally.refused++; continue; }
      tally[kind]++;
      invariants(next, label);
      assert.equal(next.scenes.length, expectedCount, `${label}: scene count`);
      assert.ok(near(projectDuration(next), expectedTotal, 1e-9), `${label}: total ${projectDuration(next)} vs ${expectedTotal}`);
      const fresh = uids(next).filter((u) => !known.has(u));
      if (kind === "duplicate" || kind === "add" || kind === "split") {
        assert.equal(fresh.length, 1, `${label}: exactly one new uid`);
        assert.ok(!everSeen.has(fresh[0]), `${label}: the new uid was never used, even by a deleted scene`);
      } else assert.equal(fresh.length, 0, `${label}: no new uid`);
      if (kind === "move") assert.equal(sceneIndexByUid(next, p.scenes[i].uid), j, `${label}: the scene is where it was sent`);
      if (kind === "split") assert.deepEqual([next.scenes[i].uid, next.scenes[i + 1].uid === p.scenes[i].uid], [p.scenes[i].uid, false], `${label}: first half keeps the uid`);
      if (kind === "delete") assert.equal(sceneIndexByUid(next, p.scenes[i].uid), -1, `${label}: gone`);
      for (const u of fresh) everSeen.add(u);
      p = deepFreeze(next);
    }
  });
  for (const [kind, count] of Object.entries(tally)) assert.ok(count >= 20, `the fuzz exercised ${kind} only ${count} times`);
});

// =====================================================================================================================
// Adversarial review. Everything below is checked against references that do not use scenes.ts: the renderer's own
// visibility rule, plain arrays, brute-force sampling frame by frame.
// =====================================================================================================================
console.log("adversarial review");

const choose = <T,>(rnd: () => number, from: readonly T[]): T => from[Math.floor(rnd() * from.length)];

/**
 * A random but LEGAL scene (it goes through the sanitizer): every layer type, keyframes with every ease, windows that start
 * or end anywhere (even past the end of the scene), punctuated narration, audio and video assets. Key times strictly
 * increase: two keys at one instant are a step, and a cut exactly on a step keeps the value before it (see the report).
 */
function randomScene(rnd: () => number, index: number): MotionScene {
  const d = choose(rnd, [1.5, 2, 3.3, 4.5, 6.04, 7.77, 10, 12.34, 20, 40]);
  const when = () => (rnd() < 0.4 ? Math.round(rnd() * d * 30) / 30 : Math.round(rnd() * d * 1000) / 1000);
  const track = (lo: number, hi: number) => {
    if (rnd() < 0.35) return lo + rnd() * (hi - lo);
    const times = [...new Set(Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => (rnd() < 0.1 ? d * (1 + rnd() * 0.3) : when())))].sort((a, b) => a - b);
    return times.map((time) => ({ t: time, v: lo + rnd() * (hi - lo), ...(rnd() < 0.8 ? { ease: choose(rnd, EASES) } : {}) }));
  };
  const layers = Array.from({ length: Math.floor(rnd() * 9) }, () => {
    const type = choose(rnd, ["rect", "ellipse", "text", "text", "media", "captions"] as const);
    const start = rnd() < 0.3 ? 0 : when();
    const raw: Record<string, unknown> = { type, start, end: rnd() < 0.5 ? null : start + 0.1 + rnd() * d, x: track(0, 1900), y: track(0, 1000), rotation: track(-90, 90), scale: track(0.2, 2), opacity: track(0, 1) };
    if (type === "rect" || type === "ellipse" || type === "media") Object.assign(raw, { w: track(10, 800), h: track(10, 800) });
    if (type === "text") Object.assign(raw, { text: `Titre ${index}`, reveal: choose(rnd, ["none", "fade", "words", "chars", "typewriter"]), revealDuration: 0.1 + rnd() * 2 });
    if (type === "captions") raw.text = "un deux trois, quatre ? cinq ! six sept huit. neuf dix onze douze";
    return raw;
  });
  const narration = Array.from({ length: Math.floor(rnd() * 30) }, (_, k) => `mot${k}${rnd() < 0.2 ? "," : ""}`).join(rnd() < 0.3 ? "  " : " ");
  return normalizeScene({
    uid: `random-${index}-${Math.floor(rnd() * 1e9)}`, duration: d, voiceOver: narration, layers,
    transition: { type: choose(rnd, ["none", "fade", "slide", "zoom", "wipe"]), duration: 0.2 + rnd() * 1.3 },
    ...(rnd() < 0.5 ? { audioUrl: "https://x.test/a.mp3", audioOffset: rnd() < 0.5 ? Math.round(rnd() * 50) / 10 : undefined } : {}),
    ...(rnd() < 0.5 ? { videoUrl: "https://x.test/v.mp4", mediaOffset: rnd() < 0.5 ? Math.round(rnd() * 50) / 10 : undefined } : {}),
  }, index, "16:9", true);
}

/** The renderer's rule (render.ts drawScene): a layer is drawn from its start to its end, both included. */
const visibleAt = (s: MotionScene, at: number) => s.layers.filter((l) => !(at < l.start || (l.end !== null && at > l.end)));
const sceneAt = (scenes: MotionScene[], time: number) => {
  let acc = 0;
  for (const s of scenes) {
    if (time < acc + s.duration) return { scene: s, local: time - acc };
    acc += s.duration;
  }
  throw new Error(`${time} is past the end`);
};
const onScreen = (ls: Layer[]) => ls.filter((l) => l.type !== "captions").map((l) => l.id);
/** What a layer is apart from time: identical on both sides of a cut. */
const statics = (l: Layer) => {
  const c = clone(l) as unknown as Record<string, unknown>;
  for (const key of ["id", "start", "end", "reveal", ...TRACKS]) delete c[key];
  return c;
};
/** Inside the one segment that holds the cut, both halves re-time the original's ease: only there are they not the original. */
const retimed = (track: Track, cut: number, time: number) => {
  if (!Array.isArray(track)) return false;
  const k = track.findIndex((key) => key.t > cut + 1e-6);
  return k > 0 && track[k - 1].t < cut - 1e-6 && time > track[k - 1].t - 1e-9 && time < track[k].t + 1e-9;
};
const words = (text: string) => text.split(/\s+/).filter(Boolean);

t("TIMELINE EQUIVALENCE (brute force): after a cut, every frame shows the same layers, in the same order, with the same values, outside the one re-timed segment", () => {
  let cuts = 0, compared = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const rnd = rng(seed);
    const scene = deepFreeze(randomScene(rnd, 0));
    const p = deepFreeze(proj([scene]));
    const result = splitScene(p, 0, rnd() < 0.5 ? Math.round(rnd() * scene.duration * 30) / 30 : rnd() * scene.duration);
    if (result === p) continue;
    cuts++;
    const [a, b] = result.scenes;
    const cut = a.duration;
    for (let time = 0.5 / 30; time < scene.duration; time += 1 / 30) {
      const before = visibleAt(scene, time);
      const { scene: half, local } = sceneAt(result.scenes, time);
      const after = visibleAt(half, local);
      assert.deepEqual(onScreen(after), onScreen(before), `seed ${seed} @ ${time.toFixed(3)} (cut ${cut.toFixed(3)}): the same layers are on screen`);
      for (const l of before) {
        if (l.type === "captions") continue;
        const twin = after.find((x) => x.id === l.id)!;
        assert.deepEqual(statics(twin), statics(l), `seed ${seed} ${l.id}: only the timing may change`);
        for (const [name, track] of tracksOf(l)) {
          if (retimed(track, cut, time)) continue;
          const want = sample(track, time);
          const got = sample(tracksOf(twin).find(([k]) => k === name)![1], local);
          assert.ok(near(got, want, 1e-6 * Math.max(1, Math.abs(want))), `seed ${seed} @ ${time.toFixed(3)} ${l.id}.${name}: ${got} instead of ${want}`);
          compared++;
        }
      }
    }
    // The scalar rules, recomputed from the assignment.
    assert.ok(near(a.duration + b.duration, scene.duration), `seed ${seed}: durations add up`);
    assert.equal(a.duration, snapToFrame(a.duration));
    assert.deepEqual([a.uid, b.uid === scene.uid, b.transition, a.id, b.id], [scene.uid, false, { type: "none", duration: 0.5 }, 1, 2]);
    const all = words(scene.voiceOver);
    const k = all.length === 0 ? 0 : Math.min(all.length, Math.max(1, Math.round((all.length * cut) / scene.duration)));
    assert.deepEqual([words(a.voiceOver), words(b.voiceOver)], [all.slice(0, k), all.slice(k)], `seed ${seed}: narration`);
    if (scene.audioUrl) assert.deepEqual([a.audioOffset, b.audioOffset], [scene.audioOffset ?? 0, (scene.audioOffset ?? 0) + cut]);
    else assert.ok(!("audioOffset" in a) && !("audioOffset" in b));
    if (scene.videoUrl) assert.deepEqual([a.mediaOffset, b.mediaOffset], [scene.mediaOffset, (scene.mediaOffset ?? 0) + cut]);
    else assert.ok(!("mediaOffset" in a) && !("mediaOffset" in b));
  }
  assert.ok(cuts > 60 && compared > 100000, `not vacuous (${cuts} cuts, ${compared} comparisons)`);
});

t("CHAIN OF CUTS: cutting again and again keeps the layers on screen at every frame, continuous seams, accumulated offsets and a lossless narration", () => {
  let pieces = 0;
  for (let seed = 201; seed <= 260; seed++) {
    const rnd = rng(seed);
    const scene = randomScene(rnd, 0);
    let p = deepFreeze(proj([scene]));
    for (let applied = 0, tries = 0; applied < 4 && tries < 40; tries++) {
      const i = Math.floor(rnd() * p.scenes.length);
      const next = splitScene(p, i, rnd() * p.scenes[i].duration);
      if (next === p) continue;
      p = deepFreeze(next);
      applied++;
    }
    const parts = p.scenes;
    if (parts.length < 2) continue;
    pieces += parts.length;
    assert.ok(near(projectDuration(p), scene.duration, 1e-9), `seed ${seed}: the video lasts as long`);
    assert.equal(parts[0].uid, scene.uid);
    assert.equal(new Set(uids(p)).size, parts.length);
    assert.ok(parts.every((x) => x.duration >= 0.3 - 1e-6));
    for (let time = 0.5 / 30; time < scene.duration; time += 1 / 30) {
      const { scene: part, local } = sceneAt(parts, time);
      assert.deepEqual(onScreen(visibleAt(part, local)), onScreen(visibleAt(scene, time)), `seed ${seed} @ ${time.toFixed(3)}`);
    }
    parts.slice(1).forEach((right, s) => {
      const left = parts[s];
      for (const l of right.layers) {
        const twin = left.layers.find((x) => x.id === l.id);
        if (!twin) continue;
        for (const [name, track] of tracksOf(twin)) {
          const here = sample(track, left.duration);
          const there = sample(tracksOf(l).find(([k]) => k === name)![1], 0);
          assert.ok(near(there, here, 1e-9 * Math.max(1, Math.abs(here))), `seed ${seed}: seam ${s}/${s + 1} ${l.id}.${name} jumps from ${here} to ${there}`);
        }
      }
    });
    let start = 0;
    for (const part of parts) {
      if (scene.audioUrl) assert.ok(near(part.audioOffset ?? NaN, (scene.audioOffset ?? 0) + start, 1e-9), `seed ${seed}: audio offset of a piece starting at ${start}`);
      if (scene.videoUrl && start > 0) assert.ok(near(part.mediaOffset ?? NaN, (scene.mediaOffset ?? 0) + start, 1e-9), `seed ${seed}: video offset`);
      start += part.duration;
    }
    assert.deepEqual(words(parts.map((x) => x.voiceOver).join(" ")), words(scene.voiceOver), `seed ${seed}: narration, in order, nothing lost`);
  }
  assert.ok(pieces > 150, `not vacuous (${pieces} pieces)`);
});

t("RELOAD: what a cut produces is what the sanitizer loads back (windows, keys, reveals, transitions), including halves down to the 0.3 s floor and halves left without layers", () => {
  const limits = { opacity: [0, 1], scale: [0, 30], w: [0, 6000], h: [0, 6000] } as const;
  /** Strips what a reload legitimately rewrites: layer ids (renumbered by position), an explicit audioOffset 0, the length of a hard cut, and values pinned by an overshooting ease outside the legal range (the renderer clamps those the same way). */
  const reloaded = (s: MotionScene) => {
    const c = clone(s) as any;
    if (c.audioOffset === 0) delete c.audioOffset;
    c.duration = Math.max(0.3, c.duration); // a half 1e-16 under the 0.3 s floor loads back at the floor
    if (c.transition.type === "none") c.transition.duration = 0;
    for (const l of c.layers) {
      l.id = "_";
      for (const [name, [lo, hi]] of Object.entries(limits)) {
        const track = l[name];
        if (typeof track === "number") l[name] = Math.min(hi, Math.max(lo, track));
        else if (Array.isArray(track)) for (const key of track) key.v = Math.min(hi, Math.max(lo, key.v));
      }
    }
    return c;
  };
  let checked = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rnd = rng(seed);
    const scene = randomScene(rnd, 0);
    const p = proj([scene]);
    const result = splitScene(p, 0, Math.round(rnd() * scene.duration * 30) / 30);
    for (const half of result === p ? [] : result.scenes) {
      assert.deepEqual(reloaded(normalizeScene(clone(half), half.id - 1, "16:9", true)), reloaded(half), `seed ${seed} half ${half.id}`);
      checked++;
    }
  }
  assert.ok(checked > 150, `not vacuous (${checked} halves)`);
});

t("captions: hostile punctuation, exotic spaces and emoji never lose, repeat or reorder a character, and a cut never lands inside a word", () => {
  const TOKENS = ["a", "bb", "ccc", "dddd", "?", "!", ":", "«", "»", "(", ")", "...", ".", ",", "–", "😀", "é", "​", "%", "&", "'", "\"", "Bonjour,", "ça?", "(oui)", "l'idée"];
  const SPACES = [" ", "  ", "\n", "\t", " ", " ", " \n ", " "];
  let cut = 0;
  for (let seed = 1; seed <= 800; seed++) {
    const rnd = rng(seed);
    const count = 1 + Math.floor(rnd() * 14);
    let text = rnd() < 0.2 ? " " : "";
    for (let i = 0; i < count; i++) text += choose(rnd, TOKENS) + (i < count - 1 || rnd() < 0.3 ? choose(rnd, SPACES) : "");
    if (!text.trim()) continue;
    const start = rnd() < 0.5 ? 0 : Math.round(rnd() * 500) / 100;
    const p = captionScene(text, { start, end: rnd() < 0.5 ? null : start + 0.2 + rnd() * 6 });
    const at = Math.round((0.3 + rnd() * 9.4) * 30) / 30;
    const result = splitScene(p, 0, at);
    if (result === p) continue;
    const layer = p.scenes[0].layers[0] as any;
    if (layer.start >= at - 1e-6 || (layer.end !== null && layer.end < at - 1e-6)) continue; // not running at the cut: untouched, checked elsewhere
    const head = cap(result.scenes[0]).text as string;
    const tail = (cap(result.scenes[1])?.text ?? "") as string;
    const whole = text.trim();
    assert.ok(head.length > 0 && head === head.trim() && tail === tail.trim(), `seed ${seed}: trimmed, head never empty`);
    assert.ok(whole.startsWith(head) && whole.endsWith(tail) && head.length + tail.length <= whole.length, `seed ${seed}: head is a prefix and tail a suffix of ${JSON.stringify(text)}`);
    const between = whole.slice(head.length, whole.length - tail.length);
    assert.ok(/^\s*$/.test(between) && (tail === "" || between !== ""), `seed ${seed}: only blanks between the halves, and at least one: ${JSON.stringify([head, between, tail])}`);
    cut++;
  }
  assert.ok(cut > 400, `not vacuous (${cut} cuts)`);
});

t("captions: a captions layer without a single word is dropped on both sides rather than crashing or lingering", () => {
  const p = captionScene("aa bb");
  const blank = proj([{ ...p.scenes[0], layers: [{ ...(p.scenes[0].layers[0] as any), text: "   " }, ...four().scenes[0].layers] }]);
  const [a, b] = splitScene(blank, 0, 5).scenes;
  assert.equal(cap(a), undefined);
  assert.equal(cap(b), undefined);
  assert.equal(a.layers.length, 1, "the title is still there");
});

t("corrupt or extreme input is refused, never turned into two corrupt scenes", () => {
  const p = four();
  const withDuration = (duration: number) => proj([{ ...p.scenes[0], duration }, p.scenes[1]]);
  for (const duration of [NaN, Infinity, -Infinity, 0, -3, 1e-9, 0.5]) {
    const q = withDuration(duration);
    assert.equal(splitScene(q, 0, 0.3), q, `duration ${duration}`);
    assert.equal(splitScene(q, 0, 1), q, `duration ${duration}`);
  }
  for (const at of [1e308, Number.MAX_VALUE, 2 ** 53, -1e-9, -0, Number.MIN_VALUE]) assert.equal(splitScene(p, 1, at), p, String(at));
  assert.equal(moveScene(p, 0, 2 ** 53), p);
  assert.equal(duplicateScene(p, 1e21), p);
  assert.equal(addScene(p, Infinity), p);
  const empty = { ...p, scenes: [] };
  assert.equal(moveScene(empty, 0, 0), empty);
  assert.equal(duplicateScene(empty, 0), empty);
  assert.equal(deleteScene(empty, 0), empty);
  assert.equal(splitScene(empty, 0, 1), empty);
  assert.equal(sceneIndexByUid(empty, "x"), -1);
  const first = addScene(empty, -1);
  assert.deepEqual([first.scenes.length, first.scenes[0].id, first.scenes[0].duration], [1, 1, 3], "a project with no scene can be started from a blank one");
  assert.equal(addScene(empty, 0), empty, "afterIndex 0 means after a scene that does not exist");
});

t("addScene: a dark gradient, a light title, and every field the brief leaves open is the sanitizer's default", () => {
  const luma = (hex: string) => 0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16);
  for (const ratio of ["16:9", "9:16"] as const) {
    const blank = addScene({ ...four(), ratio }, -1).scenes[0];
    const bg = blank.background;
    assert.equal(bg.type, "linear");
    if (bg.type === "linear") assert.ok(luma(bg.from) < 64 && luma(bg.to) < 64, "both stops of the gradient are dark");
    assert.ok(luma((blank.layers[0] as any).color) > 200, "the title is light");
    const reference = normalizeScene({ duration: 3, layers: [{ type: "text", text: "Nouvelle scène", size: 96, font: "display", reveal: "words", revealDuration: 0.8 }] }, 0, ratio, true);
    assert.deepEqual(clone(blank.layers), clone(reference.layers), `${ratio}: the title is exactly what the sanitizer makes of the brief`);
  }
});

t("a track that stops exactly on the cut, and layers that need no change, are shared with the original", () => {
  const p = proj([normalizeScene({ duration: 10, layers: [{ type: "rect", x: [{ t: 0, v: 0 }, { t: 3, v: 100 }] }, { type: "rect", start: 1, end: 2 }] }, 0, "16:9", true)]);
  const [a] = splitScene(p, 0, 3).scenes;
  assert.equal(layer(a, "l0").x, (p.scenes[0].layers[0] as any).x, "last key on the cut: the very same track");
  assert.equal(a.layers[1], p.scenes[0].layers[1], "over before the cut: the very same layer");
});

t("a key typed a hair off the frame (0.3333333 or 0.3333334 for frame 10) is ON the cut: no phantom key, no near-duplicate key", () => {
  for (const typed of [0.3333333, 0.3333334]) {
    const p = proj([normalizeScene({ duration: 5, layers: [{ type: "rect", x: [{ t: typed, v: 5 }, { t: 2, v: 9 }] }] }, 0, "16:9", true)]);
    const [a, b] = splitScene(p, 0, 10 / 30).scenes;
    assert.equal(layer(a, "l0").x, 5, `${typed}: the first half stops on that pose, a constant`);
    const tail = layer(b, "l0").x as { t: number; v: number }[];
    assert.equal(tail.length, 2, `${typed}: one key at 0 and the next one`);
    assert.deepEqual([tail[0].t, near(tail[0].v, 5)], [0, true], `${typed}: the pose starts at exactly 0`);
    assert.ok(near(tail[1].t, 2 - 10 / 30) && tail[1].v === 9);
  }
});

t("an explicit end that is the end of the scene, or lies beyond it, becomes open-ended on both sides", () => {
  const p = proj([normalizeScene({ duration: 10, layers: [{ type: "rect", end: 10 }, { type: "rect", end: 12 }, { type: "rect", end: 7 }] }, 0, "16:9", true)]);
  const [a, b] = splitScene(p, 0, 3).scenes;
  assert.deepEqual(a.layers.map((l) => l.end), [null, null, null], "all three run past the cut");
  assert.deepEqual(b.layers.map((l) => l.end), [null, null, 4], "10 and 12 are 'until the scene ends'; 7 is 4 s into the second half");
});

t("a duplicate shares its layers with the original, yet nothing done to one reaches the other", () => {
  const p = deepFreeze(four());
  const d = deepFreeze(duplicateScene(p, 1));
  const copy = d.scenes[2];
  setSceneDuration(copy, 9);
  moveLayer(copy, copy.layers[0].id, 0.5);
  updateLayer(copy, copy.layers[0].id, { text: "changed" });
  const cut = splitScene(d, 2, 1);
  assert.equal(cut.scenes[1], d.scenes[1], "the original is the very same object after its copy is cut");
  assert.deepEqual(clone(d.scenes[1]), clone(p.scenes[1]));
  assert.equal((cut.scenes[1].layers[0] as any).text, "T1");
});

t("cross-engine (audio-mix): a cut changes nothing the audio plan says: the file plays straight through the seam, one narration interval, the same music ducking", () => {
  const base = four();
  const voiced = proj(base.scenes.map((s, i) => (i === 1 || i === 2 ? { ...s, audioUrl: `https://x.test/a${i}.mp3`, ...(i === 2 ? { audioOffset: 1.5 } : {}) } : s)));
  const curveBefore = musicGainCurve(voiced)!;
  const intervalsBefore = narrationIntervals(voiced);
  const [, whole] = sceneAudioSchedule(voiced);
  let cuts = 0;
  for (const at of [0.3, 0.7, 1.1, 2, 2.5, 3.7]) {
    const cut = splitScene(voiced, 2, at);
    assert.notEqual(cut, voiced);
    cuts++;
    const clips = sceneAudioSchedule(cut);
    assert.equal(clips.length, 3, "one more clip");
    const [a, b] = clips.slice(1);
    assert.ok(near(a.startAt, whole.startAt) && near(a.offset, 1.5), "the first half plays from where the scene did");
    assert.ok(near(b.startAt, a.startAt + a.length) && near(b.offset, a.offset + a.length), "the second half resumes the very next second of the file");
    assert.ok(near(a.length + b.length, whole.length));
    assert.ok(near(b.startAt - b.offset, whole.startAt - whole.offset), "startAt - offset is constant: the audio never slips against the picture");
    assert.deepEqual(narrationIntervals(cut).map((i) => i.sceneIndex), intervalsBefore.map((i) => i.sceneIndex));
    narrationIntervals(cut).forEach((i, k) => assert.ok(near(i.start, intervalsBefore[k].start) && near(i.end, intervalsBefore[k].end)));
    const curve = musicGainCurve(cut)!;
    assert.equal(curve.length, curveBefore.length);
    curve.forEach((point, k) => assert.ok(near(point.t, curveBefore[k].t) && near(point.gain, curveBefore[k].gain, 1e-9), `ducking point ${k} @ ${at}`));
  }
  assert.equal(cuts, 6);
});

t("a CapCut session: cutting at the playhead on every single frame of the project", () => {
  const p = deepFreeze(withMedia());
  const total = projectDuration(p);
  let applied = 0, refused = 0;
  for (let frame = 0; frame <= Math.round(total * 30); frame++) {
    const { index, local } = locate(p, frame / 30);
    const scene = p.scenes[index];
    const cut = snapToFrame(local);
    const legal = cut >= 0.3 - 1e-6 && scene.duration - cut >= 0.3 - 1e-6;
    const result = splitScene(p, index, local);
    if (!legal) {
      assert.equal(result, p, `frame ${frame}: a half under 0.3 s is refused`);
      refused++;
      continue;
    }
    applied++;
    assert.equal(result.scenes.length, p.scenes.length + 1);
    assert.equal(sceneIndexByUid(result, scene.uid), index, `frame ${frame}: the first half keeps its place and uid`);
    assert.ok(!p.scenes.some((s) => s.uid === result.scenes[index + 1].uid), `frame ${frame}: the second half is new`);
    assert.ok(near(projectDuration(result), total, 1e-9));
    assert.ok(near(sceneStart(result, index + 1), sceneStart(p, index) + cut, 1e-9), `frame ${frame}: the seam is exactly under the playhead`);
  }
  assert.ok(applied > 400 && refused > 40, `not vacuous (${applied} applied, ${refused} refused)`);
});

t("history: a refused edit leaves no undo step, an applied one exactly one, and undo gives back the very same project", () => {
  const p = four();
  let h = H.createHistory(p);
  for (const refused of [splitScene(p, 0, 0.1), moveScene(p, 1, 1), deleteScene(p, 99), addScene(p, 99), duplicateScene(p, -1)]) h = H.commit(h, refused, { now: 1 });
  assert.equal(h.past.length, 0);
  h = H.commit(h, splitScene(h.present, 0, 1), { now: 2 });
  assert.equal(h.past.length, 1);
  assert.equal(h.present.scenes.length, 5);
  assert.equal(H.undo(h).present, p, "undo restores the very object it left");
  assert.equal(H.redo(H.undo(h)).present, h.present);
});

t("moveScene equals plain array splice for every (from, to) pair, on projects of 1 to 6 scenes", () => {
  for (let count = 1; count <= 6; count++) {
    const p = proj(Array.from({ length: count }, (_, i) => normalizeScene({ uid: `mv-${i}-abcdef`, duration: 2 + i, voiceOver: `v${i}`, layers: [{ type: "text", text: "x" }] }, i, "16:9", true)));
    for (let from = -2; from <= count + 1; from++) {
      for (let to = -2; to <= count + 1; to++) {
        const result = moveScene(p, from, to);
        if (from < 0 || to < 0 || from >= count || to >= count || from === to) {
          assert.equal(result, p, `${count}: ${from} -> ${to} is a no-op`);
          continue;
        }
        const expected = uids(p);
        expected.splice(to, 0, ...expected.splice(from, 1));
        assert.deepEqual(uids(result), expected, `${count}: ${from} -> ${to}`);
        assert.deepEqual(ids(result), expected.map((_, i) => i + 1));
        assert.deepEqual(result.scenes.map((s) => s.voiceOver), expected.map((u) => p.scenes.find((s) => s.uid === u)!.voiceOver), "every scene travelled with its own content");
      }
    }
  }
});

t("MODEL-BASED FUZZ: move / duplicate / delete / add / split leave exactly the scene list a plain-array model predicts", () => {
  for (const seed of [11, 12, 13, 14]) {
    const rnd = rng(seed);
    const pick = (k: number) => Math.floor(rnd() * k);
    let p = deepFreeze(proj([0, 1, 2].map((i) => normalizeScene({ uid: `model-${i}-abcdef`, duration: 2 + i, voiceOver: `v${i}`, layers: [{ type: "text", text: `T${i}` }] }, i, "16:9", true))));
    const model = p.scenes.map((s) => ({ uid: s.uid, voiceOver: s.voiceOver, duration: s.duration }));
    const everUsed = new Set(model.map((m) => m.uid));
    for (let step = 0; step < 150; step++) {
      const count = model.length;
      const i = pick(count);
      const j = pick(count);
      const kind = pick(5);
      const label = `seed ${seed} step ${step} kind ${kind} (${i}, ${j})`;
      let next: MotionProject;
      const fresh = (at: number) => {
        const u = next.scenes[at].uid;
        assert.ok(!everUsed.has(u), `${label}: a uid that was never used`);
        everUsed.add(u);
        return u;
      };
      if (kind === 0) {
        next = moveScene(p, i, j);
        const [m] = model.splice(i, 1);
        model.splice(j, 0, m);
        if (i === j) assert.equal(next, p);
      } else if (kind === 1) {
        next = duplicateScene(p, i);
        model.splice(i + 1, 0, { ...model[i], uid: fresh(i + 1) });
      } else if (kind === 2) {
        next = deleteScene(p, i);
        if (count > 1) model.splice(i, 1);
        else assert.equal(next, p, `${label}: the last scene stays`);
      } else if (kind === 3) {
        next = addScene(p, i - 1 + pick(2)); // -1 .. count - 1
        const at = next === p ? -1 : next.scenes.findIndex((s) => !model.some((m) => m.uid === s.uid));
        assert.ok(at >= 0, `${label}: a new scene appeared`);
        model.splice(at, 0, { uid: fresh(at), voiceOver: "", duration: 3 });
        assert.equal(next.scenes.length, count + 1);
      } else {
        const time = rnd() * model[i].duration;
        next = splitScene(p, i, time);
        const cut = snapToFrame(time);
        if (cut >= 0.3 - 1e-6 && model[i].duration - cut >= 0.3 - 1e-6) {
          assert.equal(next.scenes[i].uid, model[i].uid, `${label}: the first half keeps the uid`);
          model.splice(i, 1, { uid: model[i].uid, voiceOver: next.scenes[i].voiceOver, duration: cut }, { uid: fresh(i + 1), voiceOver: next.scenes[i + 1].voiceOver, duration: model[i].duration - cut });
        } else assert.equal(next, p, `${label}: refused`);
      }
      assert.deepEqual(next.scenes.map((s) => [s.uid, s.voiceOver, s.duration]), model.map((m) => [m.uid, m.voiceOver, m.duration]), label);
      assert.deepEqual(ids(next), model.map((_, k) => k + 1), label);
      p = deepFreeze(next);
    }
  }
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
