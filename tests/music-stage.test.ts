import assert from "node:assert/strict";
import { gainAt, musicGainCurve } from "../src/lib/motion/audio-mix";
import { loopDrift, loopPosition, MusicStage } from "../src/lib/motion/music-stage";
import type { Music, MotionProject, MotionScene } from "../src/lib/motion/types";

// Tests run one after the other (some wait for a promise), so the shared fake stays predictable.
const queue: (() => Promise<void>)[] = [];
let n = 0, failed = 0;
const section = (title: string) => { queue.push(async () => { console.log(title); }); };
const test = (name: string, fn: () => void | Promise<void>) => {
  queue.push(async () => {
    try { await fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); }
  });
};

// ---------- a fake <audio> that records what is done to it ----------

class FakeAudio {
  static all: FakeAudio[] = [];
  /** What happened, in order: the order of crossOrigin and src matters. */
  log: string[] = [];
  preload = "";
  loop = true; // browsers default to false: the stage has to set it
  volume = 1;
  duration = NaN;
  paused = true;
  ended = false;
  seeking = false;
  seeks: number[] = [];
  playCalls = 0;
  loads = 0;
  failPlay = false;
  failSeek = false;
  private position = 0;
  private source = "";
  private listeners = new Map<string, (() => void)[]>();
  private cors: string | null = null;
  constructor() { FakeAudio.all.push(this); }
  get crossOrigin() { return this.cors; }
  set crossOrigin(v: string | null) { this.cors = v; this.log.push(`crossOrigin=${v}`); }
  get src() { return this.source; }
  set src(v: string) { this.source = v; this.log.push(`src=${v}`); }
  get currentTime() { return this.position; }
  set currentTime(v: number) { if (this.failSeek) throw new Error("InvalidStateError"); if (!Number.isFinite(v)) throw new TypeError("not finite"); this.position = v; this.seeks.push(v); }
  removeAttribute(name: string) { if (name === "src") this.source = ""; }
  load() { this.loads++; }
  play() { this.playCalls++; if (this.failPlay) return Promise.reject(new Error("NotAllowedError")); this.paused = false; this.ended = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  emit(type: string) { for (const fn of this.listeners.get(type) ?? []) fn(); }
  /** The browser moved the playhead of the file (playing), without anyone assigning currentTime. */
  advance(to: number) { this.position = to; }
}
(globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
const fresh = () => { FakeAudio.all = []; return new MusicStage(); };
const audio = () => { assert.equal(FakeAudio.all.length >= 1, true, "an element was created"); return FakeAudio.all[FakeAudio.all.length - 1]; };

// ---------- projects ----------

const scene = (duration: number, narrated = false): MotionScene => ({
  uid: `s${Math.random()}`, id: 1, voiceOver: "", visualPrompt: "", duration,
  background: { type: "solid", color: "#000" }, transition: { type: "none", duration: 0.5 }, layers: [],
  ...(narrated ? { audioUrl: "https://x.test/voice.mp3" } : {}),
});
const music = (o: Partial<Music> = {}): Music => ({ url: "https://x.test/m.mp3", name: "m", volume: 0.5, fadeIn: 0, fadeOut: 0, duck: false, ...o });
const projectOf = (scenes: MotionScene[], m: Music | null | undefined): MotionProject => ({ title: "t", category: "c", ratio: "16:9", palette: [], scenes, music: m });
const near = (a: number, b: number, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);

// ---------- helpers ----------

section("loopPosition / loopDrift");

test("a file loops: the position is the time modulo its length, and an unknown length doesn't loop", () => {
  near(loopPosition(3, 10), 3);
  near(loopPosition(23, 10), 3);
  near(loopPosition(10, 10), 0);
  near(loopPosition(0, 10), 0);
  near(loopPosition(25, NaN), 25);
  near(loopPosition(25, 0), 25);
  near(loopPosition(25, Infinity), 25);
  near(loopPosition(25, -4), 25);
});

test("drift is measured round the loop: just before the end is close to just after the start", () => {
  near(loopDrift(9.99, 0.02, 10), 0.03);
  near(loopDrift(0.02, 9.99, 10), 0.03);
  near(loopDrift(4, 6, 10), 2);
  near(loopDrift(1, 9, 10), 2);
  near(loopDrift(2, 7, NaN), 5);
});

// ---------- the element ----------

section("MusicStage: the element");

test("no music: no element, and every call is harmless", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], null));
  stage.sync(projectOf([scene(10)], undefined));
  stage.seek(3, true);
  stage.update(4);
  stage.pause();
  stage.dispose();
  assert.equal(FakeAudio.all.length, 0);
});

test("calls before any sync don't throw either", () => {
  const stage = fresh();
  stage.seek(1, true);
  stage.update(2);
  stage.pause();
  stage.dispose();
});

test("one element per URL: crossOrigin is set before src, it preloads and doesn't loop on its own", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], music()));
  const a = audio();
  assert.equal(FakeAudio.all.length, 1);
  assert.deepEqual(a.log.slice(0, 2), ["crossOrigin=anonymous", "src=https://x.test/m.mp3"]);
  assert.equal(a.preload, "auto");
  assert.equal(a.loop, false);
  // an edit that doesn't change the URL keeps the same element, even when the music object is new
  stage.sync(projectOf([scene(10)], music({ volume: 0.9, fadeIn: 1 })));
  stage.sync(projectOf([scene(12)], music()));
  assert.equal(FakeAudio.all.length, 1);
  assert.equal(a.loads, 0);
});

test("a new URL replaces the element and releases the old one; no music releases it", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], music()));
  const old = audio();
  old.paused = false;
  stage.sync(projectOf([scene(10)], music({ url: "https://x.test/other.mp3" })));
  assert.equal(FakeAudio.all.length, 2);
  assert.equal(old.paused, true, "the old one is stopped");
  assert.equal(old.src, "", "and emptied");
  assert.equal(old.loads, 1);
  const second = audio();
  assert.equal(second.src, "https://x.test/other.mp3");
  stage.sync(projectOf([scene(10)], null));
  assert.equal(second.src, "");
  assert.equal(second.paused, true);
  stage.sync(projectOf([scene(10)], music({ url: "https://x.test/other.mp3" })));
  assert.equal(FakeAudio.all.length, 3, "music comes back: a fresh element");
});

test("an empty URL is no music", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], music({ url: "" })));
  assert.equal(FakeAudio.all.length, 0);
});

test("dispose releases the element and ignores everything after", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], music()));
  const a = audio();
  stage.seek(1, true);
  stage.dispose();
  assert.equal(a.src, "");
  assert.equal(a.paused, true);
  stage.sync(projectOf([scene(10)], music()));
  stage.seek(1, true);
  stage.update(2);
  assert.equal(FakeAudio.all.length, 1, "no new element after dispose");
  a.emit("loadedmetadata");
  a.emit("error");
  assert.equal(a.playCalls, 1, "a late event from the old element does nothing");
});

// ---------- volume ----------

section("MusicStage: volume");

test("the volume is the export's curve at that time: music.volume is in the curve, not applied twice", () => {
  const project = projectOf([scene(10)], music({ volume: 0.5, fadeIn: 2, fadeOut: 2 }));
  const curve = musicGainCurve(project)!;
  const stage = fresh();
  stage.sync(project);
  const a = audio();
  stage.seek(5, true);
  near(a.volume, 0.5);
  assert.equal(a.volume, gainAt(curve, 5));
  for (const t of [0, 0.5, 1, 1.9, 2, 4, 8, 9, 9.5]) {
    stage.update(t);
    near(a.volume, gainAt(curve, t), 1e-12, `t=${t}`);
  }
  stage.update(1);
  near(a.volume, 0.25, 1e-12, "halfway up the fade in");
});

test("ducking under the narration lowers it and brings it back", () => {
  const project = projectOf([scene(4), scene(4, true), scene(4)], music({ volume: 1, duck: true }));
  const curve = musicGainCurve(project)!;
  const stage = fresh();
  stage.sync(project);
  const a = audio();
  stage.seek(0, true);
  near(a.volume, 1);
  stage.update(6);
  near(a.volume, 0.3, 1e-9, "in the narrated scene");
  assert.equal(a.volume, gainAt(curve, 6));
  stage.update(11);
  near(a.volume, 1, 1e-9);
});

test("a change to the project moves the volume without waiting for the next frame", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], music({ volume: 0.5 })));
  const a = audio();
  stage.seek(5, true);
  near(a.volume, 0.5);
  stage.sync(projectOf([scene(10)], music({ volume: 0.8 })));
  near(a.volume, 0.8);
  stage.sync(projectOf([scene(10)], music({ volume: 0 })));
  near(a.volume, 0);
});

test("volume stays between 0 and 1 and never throws, whatever the numbers", () => {
  for (const volume of [7, -3, NaN, Infinity]) {
    const stage = fresh();
    stage.sync(projectOf([scene(10)], music({ volume, fadeIn: NaN, fadeOut: Infinity })));
    const a = audio();
    for (const t of [0, 1, 5, 9.9, 50, -1, NaN]) {
      stage.seek(t, true);
      stage.update(t);
      assert.ok(a.volume >= 0 && a.volume <= 1 && Number.isFinite(a.volume), `volume ${volume} t=${t}: ${a.volume}`);
    }
  }
});

// ---------- playing and looping ----------

section("MusicStage: playing");

test("seek while playing puts the file at its place in the loop and plays it", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(23, true);
  assert.deepEqual(a.seeks, [3]);
  assert.equal(a.playCalls, 1);
  assert.equal(a.paused, false);
  stage.seek(23.01, true);
  assert.deepEqual(a.seeks, [3], "already there: no needless seek");
});

test("seeking while paused pauses and doesn't touch the position (it is placed when play starts)", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(23, true);
  stage.seek(8, false);
  assert.equal(a.paused, true);
  assert.deepEqual(a.seeks, [3], "scrubbing never moves the element");
  stage.update(9);
  assert.equal(a.playCalls, 1, "update doesn't start a paused stage");
  stage.seek(8, true);
  assert.deepEqual(a.seeks, [3, 8]);
  assert.equal(a.playCalls, 2);
});

test("update leaves the element alone while it is within 0.3 s, and corrects it when it drifts further", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(2, true);
  a.seeks.length = 0;
  for (let i = 1; i <= 60; i++) {
    const t = 2 + i / 60;
    a.advance(t + (i % 2 ? 0.2 : -0.2)); // jitter under the threshold
    stage.update(t);
  }
  assert.deepEqual(a.seeks, [], "no seek on any of 60 frames");
  a.advance(1); // the file stalled far behind
  stage.update(3.1);
  assert.equal(a.seeks.length, 1);
  near(a.seeks[0], 3.1);
  a.advance(3.1);
  stage.update(3.12);
  assert.equal(a.seeks.length, 1, "and then it is left alone again");
});

test("the loop point is not a drift: just before the end of the file is close to just after its start", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(9.5, true);
  a.seeks.length = 0;
  a.advance(9.99);
  stage.update(10.02); // the video is 0.02 into the second pass while the file is 0.01 from its end
  assert.deepEqual(a.seeks, []);
  assert.equal(a.playCalls, 1);
});

test("a file shorter than the video restarts when it ends, instead of falling silent", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(9, true);
  a.advance(10);
  a.ended = true;
  a.paused = true;
  stage.update(10.016);
  assert.equal(a.playCalls, 2, "played again");
  assert.equal(a.paused, false);
  assert.ok(Math.abs(a.currentTime - 0.016) < 0.06, `at the start of the file: ${a.currentTime}`);
  stage.update(10.032);
  assert.equal(a.playCalls, 2, "and once is enough");
});

test("every pass is placed by the video's time, however late the end of the file was noticed", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(40)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(19, true);
  a.advance(10);
  a.ended = true;
  a.paused = true;
  stage.update(20.4);
  near(a.currentTime, 0.4, 1e-9);
});

test("silence past the end of the video: paused and muted, and a seek there doesn't play", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(10)], music()));
  const a = audio();
  a.duration = 30;
  stage.seek(9.9, true);
  assert.equal(a.paused, false);
  stage.update(10);
  assert.equal(a.paused, true);
  assert.equal(a.volume, 0);
  stage.update(10.5);
  assert.equal(a.playCalls, 1);
  stage.seek(10, true);
  assert.equal(a.playCalls, 1);
  stage.seek(-1, true);
  assert.equal(a.playCalls, 1, "nor before the start");
  assert.equal(a.volume, 0);
});

test("pause stops it and a later update doesn't restart it", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(2, true);
  stage.pause();
  assert.equal(a.paused, true);
  stage.update(3);
  stage.update(4);
  assert.equal(a.playCalls, 1);
  assert.deepEqual(a.seeks, [2]);
});

test("a project that gains music while playing starts it on the next frame; one that loses it goes quiet", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], null));
  stage.seek(5, true);
  assert.equal(FakeAudio.all.length, 0);
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.update(5.02);
  assert.equal(a.playCalls, 1);
  assert.deepEqual(a.seeks, [5.02]);
  stage.sync(projectOf([scene(25)], null));
  assert.equal(a.paused, true);
});

test("metadata arriving late: the file is placed by its real length when it is known", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  stage.seek(12, true);
  assert.deepEqual(a.seeks, [12], "length unknown: no wrapping yet");
  a.duration = 10;
  a.advance(10); // a browser clamps a position past the end of the file once it knows the length
  a.emit("loadedmetadata");
  assert.deepEqual(a.seeks, [12, 2]);
  assert.equal(a.playCalls, 2);
});

test("a sliver of a file that would need more than 10 000 loops is silence, as in the export", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(100)], music()));
  const a = audio();
  a.duration = 0.001;
  a.emit("loadedmetadata");
  stage.seek(5, true);
  assert.equal(a.playCalls, 0);
  assert.equal(a.volume, 0);
  a.duration = 20;
  a.emit("durationchange");
  assert.equal(a.playCalls, 1, "a real length: it starts, being asked to play");
});

// ---------- failure ----------

section("MusicStage: broken or blocked files");

test("a play() that is refused is silence, never an exception, and isn't retried on every frame", async () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  a.failPlay = true;
  stage.seek(2, true);
  await Promise.resolve();
  for (let i = 0; i < 30; i++) stage.update(2 + i / 30);
  assert.equal(a.playCalls, 1, "one attempt, not thirty");
  // the next user-driven start tries again, and works once the browser allows it
  a.failPlay = false;
  stage.seek(5, true);
  assert.equal(a.playCalls, 2);
  assert.equal(a.paused, false);
});

test("a broken file (error event) is left alone", async () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  stage.seek(2, true);
  a.paused = true;
  a.emit("error");
  for (let i = 0; i < 30; i++) stage.update(2 + i / 30);
  assert.equal(a.playCalls, 1);
});

test("an element that refuses to seek doesn't break the stage", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  a.failSeek = true;
  stage.seek(7, true);
  stage.update(7.5);
  stage.seek(NaN, true);
  stage.update(NaN);
  assert.equal(a.playCalls >= 1, true);
});

test("a time that is not a number can't reach the element", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(25)], music()));
  const a = audio();
  a.duration = 10;
  stage.seek(NaN, true);
  stage.update(NaN);
  stage.update(Infinity);
  assert.ok(a.paused, "no music at a time that doesn't exist");
});

test("a project with no duration plays nothing", () => {
  const stage = fresh();
  stage.sync(projectOf([scene(0)], music()));
  const a = audio();
  stage.seek(0, true);
  assert.equal(a.playCalls, 0);
  assert.equal(a.volume, 0);
});

for (const run of queue) await run();
console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
