// Project-level scene operations: reorder, duplicate, delete, add and split (the CapCut "cut here" button).
// Like edit.ts every function is pure: it returns a new project, never mutates its input, and returns the very
// same project when the request changes nothing (so a refused drag or a click on a dead button leaves no undo step).
//
// A scene is identified by its `uid`. `id` is only the display number (position + 1): it is renumbered after every
// structural change, while uids are never touched except to mint a new one for a new scene.

import { captionTimings } from "./captions";
import { sample } from "./easing";
import { snapToFrame } from "./edit";
import { newUid } from "./ids";
import { FRAMES, type AspectRatio, type CaptionsLayer, type Keyframe, type Layer, type MotionProject, type MotionScene, type Track } from "./types";

/** Times closer than this are the same instant (a cut on a frame, k/30, must meet a key typed as 0.3333). */
const EPS = 1e-6;
/** Neither half of a split may be shorter than this. */
const MIN_SPLIT = 0.3;

const isIndex = (project: MotionProject, i: number) => Number.isInteger(i) && i >= 0 && i < project.scenes.length;

/** Scenes that already have the right number keep their identity. */
const renumber = (scenes: MotionScene[]): MotionScene[] => scenes.map((s, i) => (s.id === i + 1 ? s : { ...s, id: i + 1 }));

const withScenes = (project: MotionProject, scenes: MotionScene[]): MotionProject => ({ ...project, scenes: renumber(scenes) });

export const sceneIndexByUid = (project: MotionProject, uid: string): number => project.scenes.findIndex((s) => s.uid === uid);

/** Moves the scene at `from` so that it ends up at index `to`. */
export function moveScene(project: MotionProject, from: number, to: number): MotionProject {
  if (!isIndex(project, from) || !isIndex(project, to) || from === to) return project;
  const scenes = [...project.scenes];
  const [moved] = scenes.splice(from, 1);
  scenes.splice(to, 0, moved);
  return withScenes(project, scenes);
}

/**
 * Inserts a copy right after the original. The copy is a new scene (new uid) but points at the very same
 * files (image, video, narration): they are immutable, so sharing them costs nothing.
 */
export function duplicateScene(project: MotionProject, index: number): MotionProject {
  if (!isIndex(project, index)) return project;
  const copy: MotionScene = { ...project.scenes[index], uid: newUid() };
  return withScenes(project, [...project.scenes.slice(0, index + 1), copy, ...project.scenes.slice(index + 1)]);
}

/** A project always has a scene: the last one can't be deleted. */
export function deleteScene(project: MotionProject, index: number): MotionProject {
  if (!isIndex(project, index) || project.scenes.length <= 1) return project;
  return withScenes(project, project.scenes.filter((_, i) => i !== index));
}

/** Same defaults as sanitize.ts, so a blank scene survives a save/reload unchanged. */
function blankScene(ratio: AspectRatio): MotionScene {
  const { width, height } = FRAMES[ratio];
  return {
    uid: newUid(),
    id: 0, // renumbered by the caller
    voiceOver: "",
    visualPrompt: "",
    duration: 3,
    background: { type: "linear", from: "#0a0a0f", to: "#1e1b4b", angle: 135 },
    transition: { type: "fade", duration: 0.5 },
    layers: [
      {
        id: "l0",
        type: "text",
        start: 0,
        end: null,
        x: width / 2,
        y: height / 2,
        rotation: 0,
        scale: 1,
        opacity: 1,
        text: "Nouvelle scène",
        size: 96,
        weight: 700,
        color: "#ffffff",
        font: "display",
        align: "center",
        maxWidth: width * 0.8,
        lineHeight: 1.15,
        letterSpacing: 0,
        reveal: "words",
        revealDuration: 0.8,
      },
    ],
  };
}

/** Inserts a blank scene after `afterIndex` (-1 = at the very start). */
export function addScene(project: MotionProject, afterIndex: number): MotionProject {
  if (!Number.isInteger(afterIndex) || afterIndex < -1 || afterIndex >= project.scenes.length) return project;
  return withScenes(project, [...project.scenes.slice(0, afterIndex + 1), blankScene(project.ratio), ...project.scenes.slice(afterIndex + 1)]);
}

// ---------- split ----------

/** Where each whitespace-separated word of a text ends. */
const wordEnds = (text: string): number[] => [...text.matchAll(/\S+/g)].map((m) => m.index + m[0].length);

/** Cuts a text at `index`. Both parts are slices of the original, so the spacing inside each is untouched. */
const cutAt = (text: string, index: number): [string, string] => [text.slice(0, index).trim(), text.slice(index).trim()];

/** The narration is shared out in proportion to the time each half gets; the first half keeps at least a word. */
function splitNarration(text: string, ratio: number): [string, string] {
  const ends = wordEnds(text);
  if (ends.length === 0) return ["", ""];
  const k = Math.min(ends.length, Math.max(1, Math.round(ends.length * ratio)));
  return cutAt(text, ends[k - 1]);
}

/**
 * Splits the text of a captions layer so that neither half replays what the other one already showed. The cut
 * goes after the word whose end (as captions.ts times it) is nearest to the cut. captions.ts decides what a word
 * is (a lone "?" belongs to the word before it) and how long it lasts, so a cut never lands inside one.
 */
function splitCaptions(layer: CaptionsLayer, sceneDuration: number, cut: number): [string, string] {
  const words = captionTimings(layer.text, layer.start, layer.end ?? sceneDuration);
  if (words.length === 0) return [layer.text.trim(), ""];
  let best = 0;
  words.forEach((w, i) => {
    if (Math.abs(w.end - cut) < Math.abs(words[best].end - cut)) best = i;
  });
  // The words are the non-blank characters of the text, in order: walk to the last one of the word we cut after.
  let remaining = words.slice(0, best + 1).reduce((sum, w) => sum + w.text.length, 0);
  let index = 0;
  while (remaining > 0) if (!/\s/.test(layer.text[index++])) remaining--;
  return cutAt(layer.text, index);
}

/** A track with a single key is a constant. */
const compact = (keys: Keyframe[]): Track => (keys.length === 1 ? keys[0].v : keys);

/**
 * The track as the first half sees it: everything after the cut is dropped. If the cut falls inside a segment the
 * pose reached at the cut is pinned there (same ease as the key it was heading to), so the half ends where the
 * original stood, not where it started. The curve of that last segment is the original's squeezed into the
 * shorter time: identical for linear and cubic easeIn, a re-timed ease for the others (it still ends on the same pose).
 */
function headTrack(track: Track, cut: number): Track {
  if (typeof track === "number" || track[track.length - 1].t <= cut + EPS) return track;
  const kept = track.filter((k) => k.t <= cut + EPS);
  if (kept.length === 0) return track[0].v; // the motion hasn't begun yet: only its first pose is ever seen
  if (Math.abs(kept[kept.length - 1].t - cut) <= EPS) return compact(kept);
  const ease = track[kept.length].ease;
  return [...kept, { t: cut, v: sample(track, cut), ...(ease ? { ease } : {}) }];
}

/**
 * The track as the second half sees it, with the time axis shifted by -cut. Keys at or before the cut collapse
 * into ONE key at 0 holding the value the original had at the cut, so the motion carries on from where it was.
 * Like the first half, a segment cut in two is re-timed (identical for linear and cubic easeOut).
 */
function tailTrack(track: Track, cut: number): Track {
  if (typeof track === "number") return track;
  const after = track.filter((k) => k.t > cut + EPS).map((k) => ({ ...k, t: k.t - cut }));
  if (after.length === track.length) return after; // nothing has happened yet: a plain shift
  return compact([{ t: 0, v: sample(track, cut) }, ...after]);
}

/** Applies `fn` to every animatable track. Returns the same layer when no track changed. */
function mapTracks<L extends Layer>(layer: L, fn: (track: Track) => Track): L {
  let changed = false;
  const apply = (track: Track): Track => {
    const next = fn(track);
    if (next !== track) changed = true;
    return next;
  };
  const sizes = "w" in layer ? { w: apply(layer.w), h: apply(layer.h) } : {};
  const next = { ...layer, x: apply(layer.x), y: apply(layer.y), rotation: apply(layer.rotation), scale: apply(layer.scale), opacity: apply(layer.opacity), ...sizes };
  return changed ? next : layer;
}

/** Makes a layer run to the end of its scene. */
const toSceneEnd = <L extends Layer>(layer: L): L => (layer.end === null ? layer : { ...layer, end: null });

/** The layer as the first half sees it (null = not there). */
function headLayer(layer: Layer, scene: MotionScene, cut: number): Layer | null {
  if (layer.start >= cut - EPS) return null; // it only appears after the cut
  if (layer.end !== null && layer.end < cut - EPS) return layer; // it is over before the cut: nothing to change
  const clip = (track: Track) => headTrack(track, cut);
  // Still on screen at the cut, so it now simply runs to the end of the (shorter) scene.
  if (layer.type !== "captions") return toSceneEnd(mapTracks(layer, clip));
  const [text] = splitCaptions(layer, scene.duration, cut);
  return text ? { ...toSceneEnd(mapTracks(layer, clip)), text } : null;
}

/** The layer as the second half sees it (null = not there). */
function tailLayer(layer: Layer, scene: MotionScene, cut: number): Layer | null {
  if (layer.end !== null && layer.end <= cut + EPS) return null; // it is over
  const rest = scene.duration - cut;
  const start = Math.max(0, layer.start - cut);
  const end = layer.end === null || layer.end - cut >= rest - EPS ? null : layer.end - cut;
  const shift = (track: Track) => tailTrack(track, cut);
  // Its text/captions began before the cut: what has been shown must not be shown again.
  const running = layer.start < cut - EPS;
  if (layer.type === "captions") {
    const text = running ? splitCaptions(layer, scene.duration, cut)[1] : layer.text;
    return text ? { ...mapTracks(layer, shift), start, end, text } : null;
  }
  const tracked = mapTracks(layer, shift);
  const moved = tracked.start === start && tracked.end === end ? tracked : { ...tracked, start, end };
  return running && moved.type === "text" && moved.reveal !== "none" ? { ...moved, reveal: "none" } : moved;
}

/**
 * Cuts ONE scene in two at `localTime` (seconds inside that scene, snapped to a frame). The project lasts exactly
 * as long as before, every animated value is the same on both sides of the cut, and the narration/video carry on
 * from where the first half stops.
 *
 * - First half: keeps the scene's uid and transition. Second half: a new uid and a hard cut (`none`), since the cut
 *   happens inside one scene and must be seamless.
 * - Refused (same project back) when either half would be shorter than 0.3 s or the index/time is invalid.
 */
export function splitScene(project: MotionProject, index: number, localTime: number): MotionProject {
  if (!isIndex(project, index) || !Number.isFinite(localTime)) return project;
  const scene = project.scenes[index];
  const cut = snapToFrame(localTime);
  const rest = scene.duration - cut;
  if (cut < MIN_SPLIT - EPS || rest < MIN_SPLIT - EPS) return project;

  const [firstText, secondText] = splitNarration(scene.voiceOver, cut / scene.duration);
  const tr = scene.transition;
  const first: MotionScene = {
    ...scene,
    duration: cut,
    voiceOver: firstText,
    // A transition may not swallow its scene (sanitize.ts enforces half the duration on reload).
    transition: tr.type !== "none" && tr.duration > cut / 2 ? { ...tr, duration: cut / 2 } : tr,
    layers: scene.layers.flatMap((l) => headLayer(l, scene, cut) ?? []),
  };
  const second: MotionScene = {
    ...scene,
    uid: newUid(),
    duration: rest,
    voiceOver: secondText,
    transition: { type: "none", duration: 0.5 },
    layers: scene.layers.flatMap((l) => tailLayer(l, scene, cut) ?? []),
  };
  // The files are shared; each half plays its own stretch of them.
  if (scene.audioUrl) {
    const base = scene.audioOffset ?? 0;
    first.audioOffset = base;
    second.audioOffset = base + cut;
  }
  if (scene.videoUrl) second.mediaOffset = (scene.mediaOffset ?? 0) + cut;

  return withScenes(project, [...project.scenes.slice(0, index), first, second, ...project.scenes.slice(index + 1)]);
}
