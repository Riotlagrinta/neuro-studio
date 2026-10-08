// Turns untrusted JSON (model output, or a project stored in the DB — including
// legacy "biopic" plans that have no layers) into a well-formed MotionProject.
// The renderer relies on these guarantees: finite numbers, bounded ranges,
// sorted keyframes, whitelisted enums, safe colors and URLs.

import {
  EASES,
  FRAMES,
  TRANSITIONS,
  type Anchor,
  type AspectRatio,
  type Background,
  type Ease,
  type FontFamily,
  type Keyframe,
  type Layer,
  type MotionProject,
  type MotionScene,
  type Reveal,
  type Track,
  type Transition,
} from "./types";

const MAX_SCENES = 20;
const MAX_LAYERS = 40;
const MAX_KEYS = 16;
const MAX_TIME = 120;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/a-z-]{1,60}\)|[a-z]{3,24})$/i;
function color(v: unknown, fallback: string): string {
  return typeof v === "string" && COLOR_RE.test(v.trim()) ? v.trim() : fallback;
}

function url(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 2048) return undefined;
  try {
    return new URL(v).protocol === "https:" ? v : undefined;
  } catch {
    return undefined;
  }
}

function track(v: unknown, fallback: number, min: number, max: number): Track {
  if (typeof v === "number" || typeof v === "string") return num(v, min, max, fallback);
  if (!Array.isArray(v)) return fallback;
  const keys: Keyframe[] = [];
  for (const raw of v.slice(0, MAX_KEYS)) {
    if (!isObj(raw)) continue;
    const t = num(raw.t, 0, MAX_TIME, NaN);
    const value = num(raw.v, min, max, NaN);
    if (Number.isNaN(t) || Number.isNaN(value)) continue;
    const key: Keyframe = { t, v: value };
    if (typeof raw.ease === "string" && (EASES as readonly string[]).includes(raw.ease)) key.ease = raw.ease as Ease;
    keys.push(key);
  }
  if (keys.length === 0) return fallback;
  keys.sort((a, b) => a.t - b.t);
  return keys;
}

function background(v: unknown): Background {
  const fallback: Background = { type: "solid", color: "#0a0a0f" };
  if (!isObj(v)) return fallback;
  const type = oneOf(v.type, ["solid", "linear", "radial"] as const, "solid");
  if (type === "solid") return { type, color: color(v.color, "#0a0a0f") };
  const from = color(v.from, "#0a0a0f");
  const to = color(v.to, "#1e1b4b");
  if (type === "radial") return { type, from, to };
  return { type, from, to, angle: num(v.angle, -360, 360, 135) };
}

function transition(v: unknown, sceneDuration: number): Transition {
  if (!isObj(v)) return { type: "fade", duration: 0.5 };
  const type = oneOf(v.type, TRANSITIONS, "fade");
  return { type, duration: num(v.duration, 0.2, Math.min(1.5, sceneDuration / 2), 0.5) };
}

function layer(raw: unknown, index: number, ratio: AspectRatio, sceneDuration: number): Layer | null {
  if (!isObj(raw)) return null;
  const { width: W, height: H } = FRAMES[ratio];
  const type = raw.type;
  if (type !== "rect" && type !== "ellipse" && type !== "text" && type !== "media") return null;

  const start = num(raw.start, 0, sceneDuration, 0);
  const endRaw = raw.end === undefined || raw.end === null ? null : num(raw.end, 0, MAX_TIME, NaN);
  const base = {
    id: `l${index}`,
    start,
    end: endRaw !== null && !Number.isNaN(endRaw) && endRaw > start ? endRaw : null,
    x: track(raw.x, W / 2, -3 * W, 4 * W),
    y: track(raw.y, H / 2, -3 * H, 4 * H),
    rotation: track(raw.rotation, 0, -3600, 3600),
    scale: track(raw.scale, 1, 0, 30),
    opacity: track(raw.opacity, 1, 0, 1),
  };
  const anchor: Anchor = oneOf(raw.anchor, ["center", "left", "right", "top", "bottom"] as const, "center");

  switch (type) {
    case "rect":
      return {
        ...base,
        type,
        w: track(raw.w, 400, 0, 6000),
        h: track(raw.h, 200, 0, 6000),
        radius: num(raw.radius, 0, 1000, 0),
        fill: color(raw.fill, "#ffffff"),
        stroke: raw.stroke ? color(raw.stroke, "#ffffff") : null,
        strokeWidth: num(raw.strokeWidth, 0, 200, 0),
        anchor,
      };
    case "ellipse":
      return {
        ...base,
        type,
        w: track(raw.w, 400, 0, 6000),
        h: track(raw.h, 400, 0, 6000),
        fill: color(raw.fill, "#ffffff"),
        stroke: raw.stroke ? color(raw.stroke, "#ffffff") : null,
        strokeWidth: num(raw.strokeWidth, 0, 200, 0),
        anchor,
      };
    case "text": {
      const text = str(raw.text, 400);
      if (!text.trim()) return null;
      return {
        ...base,
        type,
        text,
        size: num(raw.size, 8, 600, 64),
        weight: num(raw.weight, 100, 900, 700),
        color: color(raw.color, "#ffffff"),
        font: oneOf<FontFamily>(raw.font, ["sans", "serif", "mono", "display"], "sans"),
        align: oneOf(raw.align, ["left", "center", "right"] as const, "center"),
        maxWidth: num(raw.maxWidth, 50, 2 * W, W * 0.8),
        lineHeight: num(raw.lineHeight, 0.8, 2.5, 1.15),
        letterSpacing: num(raw.letterSpacing, -20, 80, 0),
        reveal: oneOf<Reveal>(raw.reveal, ["none", "fade", "words", "chars", "typewriter"], "none"),
        revealDuration: num(raw.revealDuration, 0.1, 6, 0.8),
      };
    }
    case "media":
      return { ...base, type, w: track(raw.w, W, 0, 6000), h: track(raw.h, H, 0, 6000), anchor };
  }
}

/** Backdrop + dim overlay, so text stays legible over AI media. */
function mediaLayers(ratio: AspectRatio, duration: number): Layer[] {
  const { width: W, height: H } = FRAMES[ratio];
  const common = { start: 0, end: null, x: W / 2, y: H / 2, rotation: 0, scale: 1 as Track, opacity: 1 as Track };
  return [
    {
      ...common,
      id: "media",
      type: "media",
      w: W,
      h: H,
      anchor: "center",
      scale: [
        { t: 0, v: 1 },
        { t: duration, v: 1.12, ease: "linear" },
      ],
    },
    { ...common, id: "dim", type: "rect", w: W, h: H, radius: 0, fill: "#000000", stroke: null, strokeWidth: 0, anchor: "center", opacity: 0.45 },
  ];
}

/** Used for legacy plans and scenes where the model produced no usable layer. */
function fallbackLayers(scene: { voiceOver: string; duration: number }, ratio: AspectRatio): Layer[] {
  const { width: W, height: H } = FRAMES[ratio];
  const caption = scene.voiceOver.trim();
  const layers = mediaLayers(ratio, scene.duration);
  if (caption) {
    layers.push({
      id: "caption",
      type: "text",
      start: 0.2,
      end: null,
      x: W / 2,
      y: ratio === "16:9" ? H * 0.8 : H * 0.72,
      rotation: 0,
      scale: 1,
      opacity: 1,
      text: caption.slice(0, 220),
      size: ratio === "16:9" ? 54 : 56,
      weight: 700,
      color: "#ffffff",
      font: "sans",
      align: "center",
      maxWidth: W * 0.8,
      lineHeight: 1.2,
      letterSpacing: 0,
      reveal: "words",
      revealDuration: Math.min(2.5, scene.duration * 0.6),
    });
  }
  return layers;
}

export function hasMediaLayer(scene: MotionScene): boolean {
  return scene.layers.some((l) => l.type === "media");
}

/** Adds the backdrop layers when a scene gets generated media but has no media layer yet. */
export function ensureMediaLayer(scene: MotionScene, ratio: AspectRatio): MotionScene {
  if (hasMediaLayer(scene)) return scene;
  return { ...scene, layers: [...mediaLayers(ratio, scene.duration), ...scene.layers] };
}

export function normalizeScene(raw: unknown, index: number, ratio: AspectRatio, keepAssets: boolean): MotionScene {
  const r = isObj(raw) ? raw : {};
  const duration = num(r.duration, 1.5, 40, 5);
  const voiceOver = str(r.voiceOver, 1200);

  const rawLayers = Array.isArray(r.layers) ? r.layers.slice(0, MAX_LAYERS) : [];
  let layers = rawLayers.map((l, i) => layer(l, i, ratio, duration)).filter((l): l is Layer => l !== null);
  if (layers.length === 0) layers = fallbackLayers({ voiceOver, duration }, ratio);

  const scene: MotionScene = {
    id: index + 1,
    voiceOver,
    visualPrompt: str(r.visualPrompt, 500),
    duration,
    background: background(r.background),
    transition: transition(r.transition, duration),
    layers,
  };
  if (keepAssets) {
    scene.imageUrl = url(r.imageUrl);
    scene.videoUrl = url(r.videoUrl);
    scene.audioUrl = url(r.audioUrl);
  }
  return scene;
}

/**
 * @param keepAssets true for projects we stored ourselves; false for model output
 *                   (a model must not be able to point the player at arbitrary URLs).
 */
export function normalizeProject(raw: unknown, fallbackRatio: AspectRatio, keepAssets: boolean): MotionProject | null {
  if (!isObj(raw)) return null;
  const ratio = oneOf(raw.ratio, ["16:9", "9:16"] as const, fallbackRatio);
  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes.slice(0, MAX_SCENES) : [];
  if (rawScenes.length === 0) return null;
  const palette = Array.isArray(raw.palette)
    ? raw.palette.slice(0, 8).map((c) => color(c, "")).filter(Boolean)
    : [];
  return {
    title: str(raw.title, 120, "Sans titre"),
    category: str(raw.category, 40, "Motion design"),
    ratio,
    palette,
    scenes: rawScenes.map((s, i) => normalizeScene(s, i, ratio, keepAssets)),
  };
}

/** Pulls the JSON object out of a model reply (tolerates code fences / stray prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Pas de JSON dans la réponse");
  return JSON.parse(text.slice(start, end + 1));
}
