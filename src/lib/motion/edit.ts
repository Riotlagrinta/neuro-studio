// Pure editing operations on a scene. Everything the timeline lets you drag ends up here, so the
// rules (frame snapping, bounds, keyframes travelling with their layer) live in one tested place.
// Every function returns a new scene and never mutates its input.

import type { Keyframe, Layer, MotionScene, Track } from "./types";

export const FPS = 30;
const EPS = 1e-6;
/** Shortest a layer may be trimmed to. */
export const MIN_LAYER = 0.1;
export const MIN_SCENE = 0.3;
export const MAX_SCENE = 40;
/** Keyframes closer than this are the same pose. */
const SAME_KEY = 0.004;

const round = (t: number) => Math.round(t * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Snap a time to the nearest frame. */
export const snapToFrame = (t: number) => Math.round(t * FPS) / FPS;
/** Snap a scene length to a tidy tenth of a second. */
export const snapToTenth = (t: number) => Math.round(t * 10) / 10;

/** When the layer stops being visible (null = until the scene ends). */
export const layerEnd = (scene: MotionScene, layer: Layer) => layer.end ?? scene.duration;

const find = (scene: MotionScene, id: string) => scene.layers.find((l) => l.id === id);

/** Applies `fn` to one layer. If `fn` changes nothing it returns the same layer, and the same scene comes back. */
function mapLayer(scene: MotionScene, id: string, fn: (layer: Layer) => Layer): MotionScene {
  const layer = find(scene, id);
  if (!layer) return scene;
  const next = fn(layer);
  return next === layer ? scene : { ...scene, layers: scene.layers.map((l) => (l === layer ? next : l)) };
}

/** Applies `fn` to every animatable track. Returns the same layer when no track changed. */
function mapTracks<L extends Layer>(layer: L, fn: (track: Track) => Track): L {
  const next = { x: fn(layer.x), y: fn(layer.y), rotation: fn(layer.rotation), scale: fn(layer.scale), opacity: fn(layer.opacity) };
  const sized = "w" in layer ? { w: fn(layer.w), h: fn(layer.h) } : {};
  const changed =
    next.x !== layer.x || next.y !== layer.y || next.rotation !== layer.rotation || next.scale !== layer.scale || next.opacity !== layer.opacity ||
    ("w" in layer && (sized as { w: Track; h: Track }).w !== layer.w) || ("w" in layer && (sized as { w: Track; h: Track }).h !== layer.h);
  return changed ? ({ ...layer, ...next, ...sized } as L) : layer;
}

const shift = (track: Track, dt: number): Track => (typeof track === "number" ? track : track.map((k) => ({ ...k, t: round(k.t + dt) })));

/**
 * Moves a layer in time as one unit: its visibility window and all its keyframes shift together,
 * like moving a layer in After Effects. The layer stays inside the scene.
 */
export function moveLayer(scene: MotionScene, id: string, delta: number): MotionScene {
  return mapLayer(scene, id, (layer) => {
    const end = layerEnd(scene, layer);
    const d = clamp(delta, -layer.start, Math.max(0, scene.duration - end));
    if (Math.abs(d) < EPS) return layer;
    const newEnd = round(end + d);
    return {
      ...mapTracks(layer, (t) => shift(t, d)),
      start: round(layer.start + d),
      end: newEnd >= scene.duration - EPS ? null : newEnd,
    };
  });
}

/** Trims the start or the end of a layer (keyframes stay where they are). */
export function trimLayer(scene: MotionScene, id: string, edge: "start" | "end", t: number): MotionScene {
  return mapLayer(scene, id, (layer) => {
    if (edge === "start") {
      const start = round(clamp(t, 0, layerEnd(scene, layer) - MIN_LAYER));
      return start === layer.start ? layer : { ...layer, start };
    }
    const raw = round(clamp(t, layer.start + MIN_LAYER, scene.duration));
    const end = raw >= scene.duration - EPS ? null : raw;
    return end === layer.end ? layer : { ...layer, end };
  });
}

/**
 * Moves every keyframe a layer has at time `from` to time `to` (the "pose" at that moment).
 * Keyframes stay sorted; a moved key replaces one it lands on.
 */
export function moveKeyframes(scene: MotionScene, id: string, from: number, to: number): MotionScene {
  const target = round(clamp(to, 0, scene.duration));
  if (Math.abs(target - from) <= SAME_KEY) return scene;
  const moveTrack = (track: Track): Track => {
    if (typeof track === "number") return track;
    const entries = track.map((k) => ({ k, moved: Math.abs(k.t - from) <= SAME_KEY }));
    if (!entries.some((e) => e.moved)) return track;
    const placed = entries
      .map(({ k, moved }) => ({ k: moved ? { ...k, t: target } : k, moved }))
      .sort((a, b) => a.k.t - b.k.t);
    const out: { k: Keyframe; moved: boolean }[] = [];
    for (const entry of placed) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.k.t - entry.k.t) <= SAME_KEY) {
        if (entry.moved && !prev.moved) out[out.length - 1] = entry; // the moved pose wins
      } else out.push(entry);
    }
    return out.map((e) => e.k);
  };
  return mapLayer(scene, id, (layer) => mapTracks(layer, moveTrack));
}

/** Changes how long a scene lasts. Layers that ran to the end keep running to the new end. */
export function setSceneDuration(scene: MotionScene, duration: number): MotionScene {
  const d = round(clamp(duration, MIN_SCENE, MAX_SCENE));
  if (d === scene.duration) return scene;
  return {
    ...scene,
    duration: d,
    layers: scene.layers.map((l) => ({
      ...l,
      start: Math.min(l.start, round(d - MIN_LAYER)),
      end: l.end !== null && l.end < d - EPS ? l.end : null,
    })),
  };
}

/** Removes a layer. A scene may end up with none: it then shows its background only. */
export function deleteLayer(scene: MotionScene, id: string): MotionScene {
  if (!find(scene, id)) return scene;
  return { ...scene, layers: scene.layers.filter((l) => l.id !== id) };
}

const PROTECTED = new Set(["id", "type"]);

/** Sets static properties on a layer (text, colour, size…). Identity fields can't be changed. */
export function updateLayer(scene: MotionScene, id: string, patch: Record<string, unknown>): MotionScene {
  const safe = Object.fromEntries(Object.entries(patch).filter(([k]) => !PROTECTED.has(k)));
  return mapLayer(scene, id, (layer) => {
    const changed = Object.entries(safe).some(([k, v]) => (layer as unknown as Record<string, unknown>)[k] !== v);
    return changed ? ({ ...layer, ...safe } as Layer) : layer;
  });
}

/** Times (relative to the scene) at which a layer has at least one keyframe. */
export function keyTimes(layer: Layer): number[] {
  const tracks: Track[] = [layer.x, layer.y, layer.rotation, layer.scale, layer.opacity];
  if ("w" in layer) tracks.push(layer.w, layer.h);
  const times = new Set<number>();
  for (const track of tracks) if (Array.isArray(track)) for (const key of track) times.add(round(key.t));
  return [...times].sort((a, b) => a - b);
}
