// Motion spec: the declarative format Claude writes and the canvas renderer plays.
// Everything here is the *normalized* shape (see sanitize.ts) — the renderer never
// sees raw model output.

export type AspectRatio = "16:9" | "9:16";

export const FRAMES: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

export const EASES = ["linear", "easeIn", "easeOut", "easeInOut", "backOut", "elasticOut", "expoOut", "bounceOut"] as const;
export type Ease = (typeof EASES)[number];

export interface Keyframe {
  t: number;
  v: number;
  /** How the value arrives at this keyframe. */
  ease?: Ease;
}

/** A constant, or keyframes sorted by time. */
export type Track = number | Keyframe[];

export type FontFamily = "sans" | "serif" | "mono" | "display";
export type Reveal = "none" | "fade" | "words" | "chars" | "typewriter";
export type Anchor = "center" | "left" | "right" | "top" | "bottom";

interface LayerBase {
  id: string;
  /** Seconds from scene start. */
  start: number;
  /** Seconds from scene start; null = until the scene ends. */
  end: number | null;
  x: Track;
  y: Track;
  rotation: Track;
  scale: Track;
  opacity: Track;
}

export interface RectLayer extends LayerBase {
  type: "rect";
  w: Track;
  h: Track;
  radius: number;
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  anchor: Anchor;
}

export interface EllipseLayer extends LayerBase {
  type: "ellipse";
  w: Track;
  h: Track;
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  anchor: Anchor;
}

export interface TextLayer extends LayerBase {
  type: "text";
  text: string;
  size: number;
  weight: number;
  color: string;
  font: FontFamily;
  align: "left" | "center" | "right";
  maxWidth: number;
  lineHeight: number;
  letterSpacing: number;
  reveal: Reveal;
  revealDuration: number;
}

/** The scene's AI backdrop (video if generated, otherwise image). */
export interface MediaLayer extends LayerBase {
  type: "media";
  w: Track;
  h: Track;
  anchor: Anchor;
}

export const CAPTION_STYLES = ["karaoke", "pop", "box", "outline"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

/**
 * Animated subtitles: the words of `text` appear one after another across the layer's visible window
 * (spread in proportion to word length), the current word being highlighted.
 */
export interface CaptionsLayer extends LayerBase {
  type: "captions";
  text: string;
  style: CaptionStyle;
  size: number;
  weight: number;
  font: FontFamily;
  /** Colour of the words. */
  color: string;
  /** Colour of the word being said (karaoke / pop) or of the box (box). */
  highlight: string;
  uppercase: boolean;
  maxWidth: number;
  lineHeight: number;
}

export type Layer = RectLayer | EllipseLayer | TextLayer | MediaLayer | CaptionsLayer;

export type Background =
  | { type: "solid"; color: string }
  | { type: "linear"; from: string; to: string; angle: number }
  | { type: "radial"; from: string; to: string };

export const TRANSITIONS = ["none", "fade", "slide", "zoom", "wipe"] as const;
export type TransitionType = (typeof TRANSITIONS)[number];

export interface Transition {
  type: TransitionType;
  duration: number;
}

export interface MotionScene {
  /** Stable identity: survives reordering, duplication keeps the original's and gives the copy a new one. */
  uid: string;
  /** Display number (position + 1). Don't use it to identify a scene. */
  id: number;
  voiceOver: string;
  /** English prompt for the AI backdrop (image / video). */
  visualPrompt: string;
  duration: number;
  background: Background;
  transition: Transition;
  layers: Layer[];
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  /** Seconds into the narration audio at which this scene starts (> 0 after a scene has been split). */
  audioOffset?: number;
  /** Seconds into the video clip at which this scene starts (> 0 after a scene has been split). */
  mediaOffset?: number;
}

/** Background music for the whole video: loops until the end, fades, optionally ducks under the narration. */
export interface Music {
  url: string;
  name: string;
  /** 0–1 */
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** Lower the music while a scene's narration is playing. */
  duck: boolean;
}

export interface MotionProject {
  title: string;
  category: string;
  ratio: AspectRatio;
  palette: string[];
  scenes: MotionScene[];
  music?: Music | null;
}

export function projectDuration(project: MotionProject): number {
  return project.scenes.reduce((sum, s) => sum + s.duration, 0);
}

/** Scene index + local time for a global time. Clamps to the end of the last scene. */
export function locate(project: MotionProject, t: number): { index: number; local: number } {
  let acc = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const d = project.scenes[i].duration;
    if (t < acc + d) return { index: i, local: Math.max(0, t - acc) };
    acc += d;
  }
  const last = project.scenes.length - 1;
  return { index: last, local: project.scenes[last]?.duration ?? 0 };
}

export function sceneStart(project: MotionProject, index: number): number {
  let acc = 0;
  for (let i = 0; i < index; i++) acc += project.scenes[i].duration;
  return acc;
}
