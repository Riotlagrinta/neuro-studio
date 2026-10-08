import assert from "node:assert/strict";
import {
  AUDIO_BITRATE,
  EXPORT_FPS,
  EXPORT_PRESETS,
  MAX_FILE_BYTES,
  audioFrameCount,
  avcCodecString,
  backdropSampleTime,
  backdropsAt,
  chooseContainer,
  clipTime,
  containerFormat,
  estimateBytes,
  even,
  exportFilename,
  exportSize,
  frameCount,
  frameDurationUs,
  frameTimestampUs,
  vp9CodecString,
  type ContainerCapabilities,
  type ExportPreset,
} from "../src/lib/motion/export-plan";
import { renderFrame, SYSTEM_FONTS } from "../src/lib/motion/render";
import { FRAMES, projectDuration, type AspectRatio, type Layer, type MotionProject, type MotionScene, type TransitionType } from "../src/lib/motion/types";

let n = 0, failed = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 400)); } };

// ---------- sizes and presets ----------

const RATIOS: AspectRatio[] = ["16:9", "9:16"];

t("presets: 720p30 at 5 Mbps and 1080p30 at 14 Mbps", () => {
  assert.deepEqual(EXPORT_PRESETS["720p"], { id: "720p", shortSide: 720, fps: 30, videoBitrate: 5_000_000 });
  assert.deepEqual(EXPORT_PRESETS["1080p"], { id: "1080p", shortSide: 1080, fps: 30, videoBitrate: 14_000_000 });
  assert.equal(EXPORT_FPS, 30);
});

t("exportSize gives exactly the sizes the real-time exporter draws (export.ts)", () => {
  // The formula of export.ts, restated: short side, then the long side from the aspect ratio.
  const realtime = (short: number, ratio: AspectRatio) => {
    const width = ratio === "16:9" ? Math.round((short * 16) / 9) : short;
    return { width, height: Math.round((width * FRAMES[ratio].height) / FRAMES[ratio].width) };
  };
  for (const preset of Object.values(EXPORT_PRESETS)) {
    for (const ratio of RATIOS) assert.deepEqual(exportSize(preset, ratio), realtime(preset.shortSide, ratio), `${preset.id} ${ratio}`);
  }
  assert.deepEqual(exportSize(EXPORT_PRESETS["720p"], "16:9"), { width: 1280, height: 720 });
  assert.deepEqual(exportSize(EXPORT_PRESETS["720p"], "9:16"), { width: 720, height: 1280 });
  assert.deepEqual(exportSize(EXPORT_PRESETS["1080p"], "16:9"), { width: 1920, height: 1080 });
  assert.deepEqual(exportSize(EXPORT_PRESETS["1080p"], "9:16"), { width: 1080, height: 1920 });
});

t("exportSize always returns even numbers, whatever the short side", () => {
  for (let short = 100; short <= 1200; short += 7) {
    const preset: ExportPreset = { ...EXPORT_PRESETS["720p"], shortSide: short };
    for (const ratio of RATIOS) {
      const { width, height } = exportSize(preset, ratio);
      assert.equal(width % 2, 0, `width at ${short} ${ratio}`);
      assert.equal(height % 2, 0, `height at ${short} ${ratio}`);
    }
  }
});

t("even rounds to the nearest even number and never goes below 2", () => {
  assert.deepEqual([720, 721, 722, 1079, 1081, 1.2, 0, -5].map(even), [720, 722, 722, 1080, 1082, 2, 2, 2]);
});

// ---------- codec strings ----------

t("avcCodecString picks the level from size, frame rate and bitrate", () => {
  assert.equal(avcCodecString(1280, 720, 30, 5_000_000), "avc1.64001f"); // L3.1
  assert.equal(avcCodecString(720, 1280, 30, 5_000_000), "avc1.64001f");
  assert.equal(avcCodecString(1920, 1080, 30, 14_000_000), "avc1.640028"); // L4.0
  assert.equal(avcCodecString(1080, 1920, 30, 14_000_000), "avc1.640028");
  assert.equal(avcCodecString(1920, 1080, 30, 25_000_000), "avc1.640028"); // High allows 25 Mbps at L4.0
  assert.equal(avcCodecString(1920, 1080, 30, 30_000_000), "avc1.640029"); // L4.1
  assert.equal(avcCodecString(1920, 1080, 60, 12_000_000), "avc1.64002a"); // 489 600 MB/s needs L4.2
  assert.equal(avcCodecString(3840, 2160, 30, 40_000_000), "avc1.640033"); // L5.1
  assert.equal(avcCodecString(3840, 2160, 60, 60_000_000), "avc1.640034"); // L5.2
  assert.equal(avcCodecString(1280, 720, 30, 20_000_000), "avc1.640028"); // the bitrate alone can raise the level
});

t("avcCodecString: every preset gets a level that the macroblock rate fits", () => {
  const MAX_MBPS: Record<string, number> = { "1f": 108_000, "28": 245_760, "29": 245_760, "2a": 522_240, "32": 589_824, "33": 983_040, "34": 2_073_600 };
  for (const preset of Object.values(EXPORT_PRESETS)) {
    for (const ratio of RATIOS) {
      const { width, height } = exportSize(preset, ratio);
      const code = avcCodecString(width, height, preset.fps, preset.videoBitrate);
      assert.match(code, /^avc1\.6400[0-9a-f]{2}$/);
      assert.ok(Math.ceil(width / 16) * Math.ceil(height / 16) * preset.fps <= MAX_MBPS[code.slice(-2)], `${preset.id} ${ratio} ${code}`);
    }
  }
});

t("vp9CodecString: level 4.0 up to 1080p, 5.0 above", () => {
  assert.equal(vp9CodecString(1920, 1080), "vp09.00.40.08");
  assert.equal(vp9CodecString(1080, 1920), "vp09.00.40.08");
  assert.equal(vp9CodecString(1280, 720), "vp09.00.40.08");
  assert.equal(vp9CodecString(3840, 2160), "vp09.00.50.08");
});

// ---------- time ----------

t("clipTime loops the clip and starts at mediaOffset, like MediaStage", () => {
  assert.equal(clipTime(0, undefined, 4), 0);
  assert.equal(clipTime(1.5, undefined, 4), 1.5);
  assert.equal(clipTime(5, undefined, 4), 1); // scene longer than the clip: it loops
  assert.equal(clipTime(1, 2, 4), 3);
  assert.equal(clipTime(3, 2, 4), 1); // offset + local wraps
  assert.equal(clipTime(0, 4, 4), 0);
  assert.equal(clipTime(0, 9, 4), 1);
});

t("clipTime agrees with the formula of MediaStage.enter over a grid", () => {
  const stage = (local: number, offset: number | undefined, d: number) => (Number.isFinite(d) && d > 0 ? (local + (offset ?? 0)) % d : 0);
  for (const d of [0.5, 3.3, 4, 5.04, 10]) {
    for (const offset of [undefined, 0, 0.7, 2, 12.5]) {
      for (let i = 0; i < 400; i++) assert.equal(clipTime(i / 30, offset, d), stage(i / 30, offset, d), `d=${d} offset=${offset} i=${i}`);
    }
  }
});

t("backdropSampleTime: the middle of the frame, plus the margin that picks the newer clip frame on an exact boundary", () => {
  assert.ok(Math.abs(backdropSampleTime(0, 4, 30) - (0.5 / 30 + 0.001)) < 1e-12);
  assert.ok(Math.abs(backdropSampleTime(1.5, 4, 30) - (1.5 + 0.5 / 30 + 0.001)) < 1e-12);
  // 24 fps clip in a 30 fps video: output frame 5 starts at 5/30 s, exactly on the start of clip frame 4 (4/24 s).
  const clipFrame = (local: number) => Math.floor(clipTime(backdropSampleTime(local, 10, 30), undefined, 10) * 24);
  for (let i = 0; i < 300; i++) assert.equal(clipFrame(i / 30), Math.floor(((i + 0.5) / 30 + 0.001) * 24), `output frame ${i}`);
  assert.equal(clipFrame(5 / 30), 4);
});

t("backdropSampleTime: the frozen previous scene stays on its last picture, even when the clip is exactly as long as the scene", () => {
  const lastFrame = (clipDuration: number) => Math.floor(clipDuration * 30) - 1;
  const frame = (sceneDuration: number, offset: number | undefined, clipDuration: number) =>
    Math.floor(clipTime(backdropSampleTime(sceneDuration, sceneDuration, 30), offset, clipDuration) * 30);
  for (const duration of [1, 2, 3, 4, 10]) {
    assert.equal(frame(duration, undefined, duration), lastFrame(duration), `scene ${duration} s on a ${duration} s clip`); // not 0: the clip has not wrapped
    assert.equal(frame(2 * duration, undefined, duration), lastFrame(duration), `scene ${2 * duration} s on a ${duration} s clip`);
    assert.equal(frame(duration, duration / 2, duration / 2), lastFrame(duration / 2), `offset: scene ${duration} s on a ${duration / 2} s clip`);
  }
  assert.equal(frame(2, 2, 4), lastFrame(4), "offset + duration reaches the end of the clip");
  assert.equal(frame(3, undefined, 4), 89, "a shorter scene keeps its last picture");
});

t("backdropSampleTime: the frozen time is within one frame of the last picture the scene really drew", () => {
  for (let i = 3; i < 400; i++) {
    const duration = i * 0.0137;
    const lastDrawn = (Math.ceil(duration * 30 - 1e-9) - 1) / 30; // start of the last output frame that begins inside the scene
    const gap = Math.abs(backdropSampleTime(lastDrawn, duration, 30) - backdropSampleTime(duration, duration, 30));
    assert.ok(gap <= 1 / 30 + 1e-9, `duration ${duration}: gap ${gap}`);
  }
  assert.ok(backdropSampleTime(0.01, 0.01, 30) > 0, "a scene shorter than one frame does not go negative");
});

t("clipTime: a clip with no usable duration, or broken numbers, stays on its first frame", () => {
  for (const d of [0, -1, NaN, Infinity]) assert.equal(clipTime(2, 1, d), 0);
  assert.equal(clipTime(2, NaN, 4), 0);
  assert.equal(clipTime(-1, 0, 4), 0);
});

t("frameCount covers the duration, without an extra frame for floating-point noise", () => {
  assert.equal(frameCount(4, 30), 120);
  assert.equal(frameCount(1.5 + 2.1 + 0.4, 30), 120); // 4.000000000000001 s
  assert.equal(frameCount(0.1 + 0.2, 30), 9); // 0.30000000000000004 s
  assert.equal(frameCount(3.47, 30), 105); // the last frame ends past the end, never before it
  assert.equal(frameCount(1 / 30, 30), 1);
  assert.equal(frameCount(0.001, 30), 1);
  assert.equal(frameCount(60, 60), 3600);
  for (const bad of [0, -3, NaN]) assert.equal(frameCount(bad, 30), 0);
});

t("frameCount: the last frame starts inside the video and the frames reach its end", () => {
  for (let i = 1; i <= 2000; i++) {
    const seconds = i / 7;
    const frames = frameCount(seconds, 30);
    assert.ok((frames - 1) / 30 < seconds, `last frame starts before the end of ${seconds}`);
    assert.ok(frames / 30 >= seconds - 1e-6, `${frames} frames reach the end of ${seconds}`);
  }
});

t("frame timestamps are integer microseconds computed from the index", () => {
  assert.deepEqual([0, 1, 2, 3, 30].map((i) => frameTimestampUs(i, 30)), [0, 33_333, 66_667, 100_000, 1_000_000]);
  assert.equal(frameTimestampUs(1_080_000, 30), 36_000_000_000); // one hour: no accumulated drift
  for (let i = 0; i < 5000; i++) assert.ok(Number.isInteger(frameTimestampUs(i, 30)));
});

t("frame durations tile the timeline exactly", () => {
  for (const fps of [24, 30, 60]) {
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const d = frameDurationUs(i, fps);
      assert.ok(d > 0 && Number.isInteger(d));
      assert.equal(frameTimestampUs(i, fps) + d, frameTimestampUs(i + 1, fps));
      sum += d;
    }
    assert.equal(sum, frameTimestampUs(1000, fps));
  }
});

t("audioFrameCount: samples of the mix, never shorter than the picture", () => {
  assert.equal(audioFrameCount(4), 192_000);
  assert.equal(audioFrameCount(0.5), 24_000);
  assert.equal(audioFrameCount(1.5 + 2.1 + 0.4), 192_000);
  assert.equal(audioFrameCount(3.47), Math.ceil(3.47 * 48_000));
  assert.equal(audioFrameCount(0), 1);
  assert.equal(audioFrameCount(1.00001), 48_001); // 48 000.48 samples: rounded up, never cut short
  assert.equal(audioFrameCount(0.1234567), 5_926);
});

// ---------- size guard ----------

t("estimateBytes: bitrates x duration, with margin", () => {
  const expected = (preset: ExportPreset, s: number) => Math.ceil(((preset.videoBitrate + AUDIO_BITRATE.aac) * s * 1.05) / 8);
  assert.equal(estimateBytes(EXPORT_PRESETS["720p"], 30), expected(EXPORT_PRESETS["720p"], 30));
  assert.equal(estimateBytes(EXPORT_PRESETS["1080p"], 60), expected(EXPORT_PRESETS["1080p"], 60));
  assert.ok(estimateBytes(EXPORT_PRESETS["1080p"], 60) > (14_000_000 * 60) / 8, "never below the video bitrate alone");
  assert.equal(estimateBytes(EXPORT_PRESETS["720p"], 0), 0);
  assert.equal(estimateBytes(EXPORT_PRESETS["720p"], NaN), 0);
});

t("the guard accepts the longest video the app generates (120 s at 1080p) and refuses ten minutes", () => {
  assert.ok(estimateBytes(EXPORT_PRESETS["1080p"], 120) <= MAX_FILE_BYTES);
  assert.ok(estimateBytes(EXPORT_PRESETS["1080p"], 600) > MAX_FILE_BYTES);
});

// ---------- file names ----------

t("containerFormat: extension and mime per container", () => {
  assert.deepEqual(containerFormat("mp4-h264-aac"), { extension: "mp4", mime: "video/mp4" });
  assert.deepEqual(containerFormat("webm-vp9-opus"), { extension: "webm", mime: "video/webm" });
  assert.deepEqual(containerFormat("realtime"), { extension: "webm", mime: "video/webm" });
});

t("exportFilename: ascii slug, quality and extension", () => {
  assert.equal(exportFilename("Étincelle – Intro !", "mp4-h264-aac", "720p"), "etincelle-intro-720p.mp4");
  assert.equal(exportFilename("Ça va être génial", "webm-vp9-opus", "1080p"), "ca-va-etre-genial-1080p.webm");
  assert.equal(exportFilename("", "mp4-h264-aac", "1080p"), "neuro-studio-1080p.mp4");
  assert.equal(exportFilename("***", "realtime", "720p"), "neuro-studio-720p.webm");
  const long = exportFilename("a".repeat(30) + " " + "b".repeat(100), "mp4-h264-aac", "720p");
  assert.ok(long.length <= 60 + "-720p.mp4".length && !long.includes("--"));
  assert.ok(!exportFilename("x".repeat(59) + " yyyy", "mp4-h264-aac", "720p").includes("-720p-"), "no dangling dash before the quality");
});

// ---------- container decision ----------

const caps = (over: Partial<ContainerCapabilities> = {}): ContainerCapabilities => ({ hasVideoEncoder: true, hasH264: true, hasAac: true, hasVp9: true, hasOpus: true, ...over });

t("chooseContainer: MP4 whenever H.264 and AAC are available", () => {
  assert.equal(chooseContainer(caps()).container, "mp4-h264-aac");
  assert.equal(chooseContainer(caps({ hasVp9: false, hasOpus: false })).container, "mp4-h264-aac");
});

t("chooseContainer: no AAC (desktop Linux, Firefox) falls back to WebM VP9 + Opus", () => {
  assert.equal(chooseContainer(caps({ hasAac: false })).container, "webm-vp9-opus");
});

t("chooseContainer: no H.264 (open-source Chromium) falls back to WebM VP9 + Opus", () => {
  assert.equal(chooseContainer(caps({ hasH264: false, hasAac: false })).container, "webm-vp9-opus");
});

t("chooseContainer: real time when WebCodecs is missing, even if every flag claims support", () => {
  assert.equal(chooseContainer(caps({ hasVideoEncoder: false })).container, "realtime");
  assert.equal(chooseContainer(caps({ hasVideoEncoder: false, hasH264: false, hasAac: false, hasVp9: false, hasOpus: false })).container, "realtime");
});

t("chooseContainer: real time when neither pair of codecs is complete", () => {
  assert.equal(chooseContainer(caps({ hasAac: false, hasVp9: false })).container, "realtime");
  assert.equal(chooseContainer(caps({ hasAac: false, hasOpus: false })).container, "realtime");
  assert.equal(chooseContainer(caps({ hasH264: false, hasVp9: false })).container, "realtime");
});

t("chooseContainer: a video without any audio does not need an audio encoder", () => {
  assert.equal(chooseContainer(caps({ hasAudio: false, hasAac: false, hasOpus: false })).container, "mp4-h264-aac");
  assert.equal(chooseContainer(caps({ hasAudio: false, hasH264: false, hasAac: false, hasOpus: false })).container, "webm-vp9-opus");
  assert.equal(chooseContainer(caps({ hasAudio: false, hasH264: false, hasVp9: false })).container, "realtime");
  assert.ok(!chooseContainer(caps({ hasAudio: false })).reason.includes("AAC"), "the reason does not talk about a track that is not there");
});

t("chooseContainer agrees with an independent reading of the ladder on all 64 combinations", () => {
  for (let bits = 0; bits < 64; bits++) {
    const c = caps({ hasVideoEncoder: !!(bits & 1), hasH264: !!(bits & 2), hasAac: !!(bits & 4), hasVp9: !!(bits & 8), hasOpus: !!(bits & 16), hasAudio: !!(bits & 32) });
    const audio = c.hasAudio!;
    const expected = !c.hasVideoEncoder ? "realtime" : c.hasH264 && (c.hasAac || !audio) ? "mp4-h264-aac" : c.hasVp9 && (c.hasOpus || !audio) ? "webm-vp9-opus" : "realtime";
    assert.equal(chooseContainer(c).container, expected, JSON.stringify(c));
  }
});

t("chooseContainer: a file too big for memory goes to real time", () => {
  assert.equal(chooseContainer(caps({ estimatedBytes: MAX_FILE_BYTES })).container, "mp4-h264-aac");
  const big = chooseContainer(caps({ estimatedBytes: MAX_FILE_BYTES + 1 }));
  assert.equal(big.container, "realtime");
  assert.match(big.reason, /256 Mo/);
});

t("chooseContainer: every decision comes with a French reason", () => {
  const reasons = new Set<string>();
  for (let bits = 0; bits < 64; bits++) {
    const { reason } = chooseContainer(caps({ hasVideoEncoder: !!(bits & 1), hasH264: !!(bits & 2), hasAac: !!(bits & 4), hasVp9: !!(bits & 8), hasOpus: !!(bits & 16), hasAudio: !!(bits & 32) }));
    assert.ok(reason.length > 20 && /[ée]/.test(reason) && reason.endsWith(".") && !reason.includes("undefined"), reason);
    reasons.add(reason);
  }
  assert.ok(reasons.size >= 6, `distinct reasons: ${reasons.size}`);
  assert.match(chooseContainer(caps({ hasH264: false, hasAac: false })).reason, /H\.264/);
  assert.match(chooseContainer(caps({ hasAac: false })).reason, /AAC/);
  assert.match(chooseContainer(caps({ hasAac: false })).reason, /n'encode pas l'AAC/);
  assert.match(chooseContainer(caps({ hasH264: false })).reason, /n'encode pas le H\.264/);
});

// ---------- backdrops: the mirror of renderFrame's branching ----------

const media = (id: string, start = 0, end: number | null = null): Layer => ({ id, type: "media", start, end, x: 960, y: 540, rotation: 0, scale: 1, opacity: 1, w: 1920, h: 1080, anchor: "center" });
const scene = (i: number, duration: number, transition: TransitionType, layers: Layer[]): MotionScene => ({
  uid: `scene-${i}-abcdef`,
  id: i + 1,
  voiceOver: "",
  visualPrompt: "",
  duration,
  background: { type: "solid", color: "#102030" },
  transition: { type: transition, duration: 0.5 },
  layers,
});
const project = (scenes: MotionScene[], ratio: AspectRatio = "16:9"): MotionProject => ({ title: "T", category: "C", ratio, palette: [], scenes, music: null });

/** A canvas context that accepts every call; enough to run renderFrame and see which scenes ask for a picture. */
function fakeContext(width: number): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas: { width, height: 0 } };
  return new Proxy(state, {
    get: (target, key: string) => (key in target ? target[key] : () => ({ width: 10, addColorStop: () => {} })),
    set: (target, key: string, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D;
}

function requestedByRenderer(p: MotionProject, time: number): number[] {
  const asked = new Set<number>();
  const picture = { width: 10, height: 10 } as unknown as CanvasImageSource;
  renderFrame(fakeContext(1280), p, time, (s) => (asked.add(p.scenes.indexOf(s)), picture), SYSTEM_FONTS);
  return [...asked].sort();
}

t("backdropsAt lists exactly the scenes renderFrame asks a picture for, on every frame of every transition", () => {
  const types: TransitionType[] = ["none", "fade", "slide", "zoom", "wipe"];
  for (const type of types) {
    // Scene 0 and 2 have a backdrop, scene 1 has none: its transition must not request scene 0's picture twice or scene 1's at all.
    const p = project([scene(0, 2, "none", [media("m0")]), scene(1, 1.5, type, []), scene(2, 2, type, [media("m2")]), scene(3, 1, type, [media("m3")])]);
    const total = projectDuration(p);
    for (let i = 0; i < Math.floor(total * 30); i++) {
      const time = i / 30;
      const planned = [...new Set(backdropsAt(p, time).map((need) => need.sceneIndex))].sort();
      assert.deepEqual(planned, requestedByRenderer(p, time), `${type} at ${time}`);
    }
  }
});

t("backdropsAt: scene time, previous scene frozen at its end while the next one enters", () => {
  const p = project([scene(0, 2, "none", [media("m0")]), scene(1, 3, "fade", [media("m1")])]);
  assert.deepEqual(backdropsAt(p, 0), [{ sceneIndex: 0, local: 0 }]);
  assert.deepEqual(backdropsAt(p, 1), [{ sceneIndex: 0, local: 1 }]);
  assert.deepEqual(backdropsAt(p, 2.25), [{ sceneIndex: 0, local: 2 }, { sceneIndex: 1, local: 0.25 }]);
  assert.deepEqual(backdropsAt(p, 2.5), [{ sceneIndex: 1, local: 0.5 }]); // transition over: only the new scene
  assert.deepEqual(backdropsAt(p, 4), [{ sceneIndex: 1, local: 2 }]);
});

t("backdropsAt: a scene without a media layer needs nothing, an empty project too", () => {
  const p = project([scene(0, 2, "none", []), scene(1, 2, "slide", [])]);
  for (let i = 0; i < 120; i++) assert.deepEqual(backdropsAt(p, i / 30), []);
  assert.deepEqual(backdropsAt(project([]), 0), []);
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
