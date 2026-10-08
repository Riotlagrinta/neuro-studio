// Planning logic for the soundtrack: when the narration speaks, how loud the music must be at every
// instant, and when each audio file starts. Pure data in, pure data out: the live preview feeds
// gainAt() into HTMLAudioElement.volume on every frame and the export feeds the very same curve to
// WebAudio through scheduleGain(), so what you hear while editing is what ends up in the file.
// Nothing here touches the DOM or an AudioContext, and nothing mutates the project.

import type { Music, MotionProject, MotionScene } from "./types";

/** One point of a gain automation curve. Project seconds, linear gain 0-1; the gain between two points is LINEAR. */
export interface GainPoint {
  t: number;
  gain: number;
}

/** A stretch of the video during which somebody is talking. `sceneIndex` is the first scene of the stretch. */
export interface NarrationInterval {
  start: number;
  end: number;
  sceneIndex: number;
}

/** One narration file to play: where it starts in the project and which part of the file is heard. */
export interface SceneAudioClip {
  sceneIndex: number;
  uid: string;
  url: string;
  /** Project time (seconds) at which the clip starts. */
  startAt: number;
  /** Seconds into the audio file at which playback begins. */
  offset: number;
  /** Seconds of the file that play. */
  length: number;
}

/** One pass of the music file, to schedule at project time `at`. */
export interface LoopSegment {
  at: number;
  /** Always 0: every pass starts from the top of the file. */
  offset: number;
  length: number;
}

/** The part of an AudioParam we drive. A real AudioParam satisfies it; so does a recording fake in tests. */
export interface GainParam {
  cancelScheduledValues(time: number): void;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
}

/** Narrated scenes closer than this are one spoken passage: the music stays down instead of pumping up and down. */
const MERGE_GAP = 0.4;
/** Sums such as (2 + 0.4) - 2 come out as 0.3999999999999999: a gap of "exactly 0.4 s" must stay a gap. */
const GAP_EPS = 1e-9;
const DEFAULT_DUCK_GAIN = 0.3;
const DEFAULT_RAMP = 0.25;
/**
 * Shortest duck ramp. A gain that jumps in no time cannot be written as points with strictly increasing t
 * (and it clicks anyway), so ramp = 0 means "as fast as is still clean".
 */
const MIN_RAMP = 0.005;
/**
 * The curve is linear between points, but fade x duck is a product of two linear pieces wherever a fade
 * ramp and a duck ramp overlap, i.e. a parabola. Such stretches are cut into enough pieces to stay within
 * this distance of the true product (1e-4 = -80 dB of full scale: inaudible).
 */
const CURVE_TOLERANCE = 1e-4;
/**
 * Longest fade taken at face value. Anything this long is "longer than the video" anyway; capping it keeps
 * fadeIn + fadeOut finite, so the proportional shrink in fadeEnvelope() is defined even for Infinity.
 */
const MAX_FADE = Number.MAX_SAFE_INTEGER;
/** A music file needing more passes than this is a click, not music: plan nothing rather than allocate millions of segments. */
const MAX_LOOPS = 10_000;
/** A last pass shorter than this (a microsecond) is rounding noise, not audio. */
const LOOP_EPS = 1e-6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** NaN means "no usable value": silence / no fade, the safe reading of a broken number. */
const orZero = (v: number) => (Number.isNaN(v) ? 0 : v);
/** A duration or offset: finite and positive, otherwise nothing (a NaN or infinite scene must not poison every time after it). */
const seconds = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > 0 ? v : 0);

interface Span {
  index: number;
  scene: MotionScene;
  start: number;
  length: number;
}

/** Where each scene starts. Same summation order as sceneStart(), so the times agree to the last bit. */
function timeline(project: MotionProject): { spans: Span[]; total: number } {
  const spans: Span[] = [];
  let total = 0;
  project.scenes.forEach((scene, index) => {
    const length = seconds(scene.duration);
    spans.push({ index, scene, start: total, length });
    total += length;
  });
  return { spans, total };
}

function narration(spans: readonly Span[]): NarrationInterval[] {
  const out: NarrationInterval[] = [];
  for (const { scene, index, start, length } of spans) {
    if (!scene.audioUrl || length <= 0) continue;
    const prev = out[out.length - 1];
    if (prev && start - prev.end < MERGE_GAP - GAP_EPS) prev.end = start + length;
    else out.push({ start, end: start + length, sceneIndex: index });
  }
  return out;
}

/**
 * When the narration is heard, as intervals of project time. Narrated scenes that follow each other, or
 * that are separated by less than 0.4 s, form ONE interval (its sceneIndex is the first scene of the run).
 * The whole scene counts, tail included: the scene is fitted to the narration plus a short tail on purpose.
 */
export function narrationIntervals(project: MotionProject): NarrationInterval[] {
  return narration(timeline(project).spans);
}

/** A gain envelope that is piecewise linear, with `knots` listing every time at which its slope may change. */
interface Envelope {
  at: (t: number) => number;
  knots: number[];
}

/** Fade in from 0 over `fadeIn`, fade out to 0 over the last `fadeOut`, at most `volume`. */
function fadeEnvelope(music: Music, total: number): Envelope {
  const volume = clamp(orZero(music.volume), 0, 1);
  const fadeIn = clamp(orZero(music.fadeIn), 0, MAX_FADE);
  const fadeOut = clamp(orZero(music.fadeOut), 0, MAX_FADE);
  let inEnd = fadeIn;
  let outStart = total - fadeOut;
  if (fadeIn + fadeOut > total) {
    // Both fades cannot fit: shrink them in proportion so they meet at the peak instead of overlapping.
    inEnd = (total * fadeIn) / (fadeIn + fadeOut);
    outStart = inEnd;
  }
  const outLength = total - outStart;
  return {
    at: (t) => volume * Math.min(inEnd > 0 ? clamp(t / inEnd, 0, 1) : 1, outLength > 0 ? clamp((total - t) / outLength, 0, 1) : 1),
    knots: [inEnd, outStart],
  };
}

const NO_DUCK: Envelope = { at: () => 1, knots: [] };

/**
 * `gain` inside the narration intervals and 1 outside, with linear ramps of `ramp` seconds just before an
 * interval starts (the music is already down when the voice comes in) and just after it ends.
 */
function duckEnvelope(intervals: readonly NarrationInterval[], total: number, gain: number, ramp: number): Envelope {
  const length = Math.max(ramp, MIN_RAMP);
  const zones = intervals.map((iv, k) => {
    const prev = intervals[k - 1];
    const next = intervals[k + 1];
    // Neighbours take at most half the gap each, so their ramps can meet but never cross, whatever `ramp` is.
    // The first/last interval may use all the room up to the start/end of the video (none if it touches it).
    const room = { before: prev ? (iv.start - prev.end) / 2 : iv.start, after: next ? (next.start - iv.end) / 2 : total - iv.end };
    return { start: iv.start, end: iv.end, pre: Math.min(length, room.before), post: Math.min(length, room.after) };
  });
  /** 0 = untouched music, 1 = fully ducked. */
  const depth = (z: (typeof zones)[number], t: number) => {
    if (t < z.start) return z.pre > 0 ? Math.max(0, 1 - (z.start - t) / z.pre) : 0;
    if (t <= z.end) return 1;
    return z.post > 0 ? Math.max(0, 1 - (t - z.end) / z.post) : 0;
  };
  return {
    at: (t) => 1 - (1 - gain) * zones.reduce((deepest, z) => Math.max(deepest, depth(z, t)), 0),
    knots: zones.flatMap((z) => [z.start - z.pre, z.start, z.end, z.end + z.post]),
  };
}

/**
 * The gain the music must have over the whole video [0, total], or null when the project has no music.
 *
 * The curve equals fade(t) x duck(t): `music.volume` shaped by the fade in / fade out (scaled down together
 * when they are longer than the video), times `duckGain` inside the narration intervals when `music.duck` is on.
 * It starts at t = 0, ends at t = total and has strictly increasing t. It is exact at every point and within
 * 1e-4 between them (see CURVE_TOLERANCE). Unusable numbers never throw: NaN volume or fades are 0, values are
 * clamped to their range, a video with no duration yields one silent point.
 */
export function musicGainCurve(project: MotionProject, duckGain: number = DEFAULT_DUCK_GAIN, ramp: number = DEFAULT_RAMP): GainPoint[] | null {
  const { music } = project;
  if (!music) return null;
  const { spans, total } = timeline(project);
  if (total <= 0) return [{ t: 0, gain: 0 }];

  const fade = fadeEnvelope(music, total);
  const lowered = Number.isNaN(duckGain) ? DEFAULT_DUCK_GAIN : clamp(duckGain, 0, 1);
  const duck = music.duck && lowered < 1 ? duckEnvelope(narration(spans), total, lowered, Number.isNaN(ramp) ? DEFAULT_RAMP : ramp) : NO_DUCK;

  const gain = (t: number) => fade.at(t) * duck.at(t);
  const knots = [...new Set([0, total, ...fade.knots, ...duck.knots].map((k) => clamp(k, 0, total)))].sort((a, b) => a - b);

  const points: GainPoint[] = [];
  const push = (t: number) => {
    // Strictly increasing t: a point that rounds onto its predecessor adds nothing.
    if (points.length === 0 || t > points[points.length - 1].t) points.push({ t, gain: gain(t) });
  };
  push(knots[0]);
  for (let i = 1; i < knots.length; i++) {
    const [p, q] = [knots[i - 1], knots[i]];
    // Between two knots both envelopes are straight lines, so the product is a parabola whose distance to the
    // chord is |dFade x dDuck| / 4; n equal pieces divide it by n^2.
    const bend = Math.abs((fade.at(q) - fade.at(p)) * (duck.at(q) - duck.at(p)));
    const pieces = Math.max(1, Math.ceil(Math.sqrt(bend / (4 * CURVE_TOLERANCE))));
    for (let j = 1; j < pieces; j++) push(p + ((q - p) * j) / pieces);
    push(q);
  }
  return points;
}

/**
 * Linear interpolation of a curve (sorted by t) at time t, clamped to its first and last points, 0 for an empty
 * curve. Two points sharing a t make a step. A NaN time reads as the start.
 */
export function gainAt(curve: readonly GainPoint[], t: number): number {
  const n = curve.length;
  if (n === 0) return 0;
  if (!(t > curve[0].t)) return curve[0].gain;
  if (t >= curve[n - 1].t) return curve[n - 1].gain;
  // Invariant: curve[lo].t <= t < curve[hi].t, so the span is never zero.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const [a, b] = [curve[lo], curve[hi]];
  return a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
}

/** Every narration file, with where it starts in the project and which slice of it plays. Zero-length scenes play nothing and are left out. */
export function sceneAudioSchedule(project: MotionProject): SceneAudioClip[] {
  const clips: SceneAudioClip[] = [];
  for (const { scene, index, start, length } of timeline(project).spans) {
    if (!scene.audioUrl || length <= 0) continue;
    clips.push({ sceneIndex: index, uid: scene.uid, url: scene.audioUrl, startAt: start, offset: seconds(scene.audioOffset), length });
  }
  return clips;
}

/**
 * The passes to schedule so a music file of `musicDuration` seconds loops until `total`: every pass plays the
 * whole file from its start except the last one, which is cut at `total`. A file longer than the video gives a
 * single pass of `total` seconds. Unusable input (non-positive, NaN, infinite) gives no pass.
 *
 * The loop point can click, since the end of a track rarely meets its start at zero amplitude. The export may
 * hide it with a tiny (about 20 ms) crossfade between passes; that is its job, not the plan's.
 */
export function musicLoopPlan(musicDuration: number, total: number): LoopSegment[] {
  if (!(musicDuration > 0) || !Number.isFinite(musicDuration) || !(total > 0) || !Number.isFinite(total)) return [];
  const passes = Math.ceil(total / musicDuration);
  if (passes > MAX_LOOPS) return [];
  const segments: LoopSegment[] = [];
  for (let i = 0; i < passes; i++) {
    // i * duration, not a running sum: no drift over thousands of passes.
    const at = i * musicDuration;
    const length = Math.min(musicDuration, total - at);
    // total / duration can round up to one pass too many (1.1 / 0.1): that pass would last 0 s.
    if (length > LOOP_EPS) segments.push({ at, offset: 0, length });
  }
  return segments;
}

/**
 * Writes a curve into an AudioParam, `startTime` being the AudioContext time at which project time 0 plays:
 * earlier automation from the first point on is cleared, the first point is set, every other point is a linear
 * ramp. An empty curve touches nothing. WebAudio throws on a non-finite or negative time or value, so points
 * that are not finite are skipped, times are floored at 0, and a non-finite `startTime` schedules nothing.
 */
export function scheduleGain(param: GainParam, curve: readonly GainPoint[], startTime: number): void {
  if (!Number.isFinite(startTime)) return;
  const points = curve.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.gain));
  if (points.length === 0) return;
  const when = (p: GainPoint) => Math.max(0, startTime + p.t);
  param.cancelScheduledValues(when(points[0]));
  param.setValueAtTime(points[0].gain, when(points[0]));
  for (let i = 1; i < points.length; i++) param.linearRampToValueAtTime(points[i].gain, when(points[i]));
}
