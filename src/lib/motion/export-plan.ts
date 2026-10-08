// Decisions behind the offline MP4/WebM export: sizes, bitrates, codec strings, frame timestamps and which
// container the browser can write. Pure functions with no DOM and no mediabunny, so Node tests cover them;
// export-mp4.ts does the encoding and the probing.

import type { ExportQuality } from "./export";
import { FRAMES, locate, type AspectRatio, type MotionProject, type MotionScene } from "./types";

export const EXPORT_FPS = 30;

export interface ExportPreset {
  id: ExportQuality;
  /** Length of the short side of the picture; the long side follows the aspect ratio (same rule as the real-time export). */
  shortSide: number;
  fps: number;
  /** Bits per second. Flat colours and sharp text need far more than Mediabunny's default quality curve gives. */
  videoBitrate: number;
}

export const EXPORT_PRESETS: Record<ExportQuality, ExportPreset> = {
  "720p": { id: "720p", shortSide: 720, fps: EXPORT_FPS, videoBitrate: 5_000_000 },
  "1080p": { id: "1080p", shortSide: 1080, fps: EXPORT_FPS, videoBitrate: 14_000_000 },
};

export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
export type AudioCodecId = "aac" | "opus";
export const AUDIO_BITRATE: Record<AudioCodecId, number> = { aac: 192_000, opus: 128_000 };

/** H.264 needs an even width and height (chroma is subsampled by 2). */
export function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function exportSize(preset: ExportPreset, ratio: AspectRatio): { width: number; height: number } {
  const frame = FRAMES[ratio];
  const width = ratio === "16:9" ? Math.round((preset.shortSide * 16) / 9) : preset.shortSide;
  return { width: even(width), height: even((width * frame.height) / frame.width) };
}

// [level_idc, MaxFS (macroblocks per frame), MaxMBPS (macroblocks per second), MaxBR (kbit/s, Baseline/Main)]
// for levels 3.1, 4.0, 4.1, 4.2, 5.0, 5.1 and 5.2 (H.264 Table A-1).
const AVC_LEVELS: readonly (readonly [number, number, number, number])[] = [
  [0x1f, 3600, 108_000, 14_000],
  [0x28, 8192, 245_760, 20_000],
  [0x29, 8192, 245_760, 50_000],
  [0x2a, 8704, 522_240, 50_000],
  [0x32, 22_080, 589_824, 135_000],
  [0x33, 36_864, 983_040, 240_000],
  [0x34, 36_864, 2_073_600, 240_000],
];

/**
 * avc1.PPCCLL for High profile: the level is enforced by the encoder, so it must fit the real size, frame rate and
 * bitrate (Mediabunny's own choice ignores the frame rate). High profile allows 1.25x the Main bitrate of a level.
 */
export function avcCodecString(width: number, height: number, fps: number, bitrate: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = AVC_LEVELS.find(([, maxFs, maxMbps, maxBr]) => macroblocks <= maxFs && macroblocks * fps <= maxMbps && bitrate / 1.25 <= maxBr * 1000) ?? AVC_LEVELS[AVC_LEVELS.length - 1];
  return `avc1.6400${level[0].toString(16).padStart(2, "0")}`;
}

/** VP9 profile 0, 8 bit; level 4.0 covers up to 2 228 224 luma pixels (1080p), 5.0 above. */
export function vp9CodecString(width: number, height: number): string {
  return width * height <= 2_228_224 ? "vp09.00.40.08" : "vp09.00.50.08";
}

/** Where the backdrop clip is when a scene is `local` seconds in: the clip loops and the scene may start part-way in (mediaOffset), like MediaStage. */
export function clipTime(local: number, mediaOffset: number | undefined, clipDuration: number): number {
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return 0;
  const t = (local + (mediaOffset ?? 0)) % clipDuration;
  return t > 0 ? t : 0;
}

/**
 * Added to every clip time. A time that lands exactly on the start of a clip frame (24 fps clip in a 30 fps video: one
 * output frame in five) must pick that frame, not the one before it: containers like WebM keep timestamps in whole
 * milliseconds, and sums of floats are never exact.
 */
const CLIP_TIME_MARGIN = 0.001;

/**
 * Scene time at which a backdrop clip is sampled for the output frame drawn `local` seconds into the scene: the middle
 * of the frame's interval, so a 30 fps clip in a 30 fps video is never near a frame boundary. The previous scene under
 * a transition is asked for at its duration (see backdropsAt): one step past the last picture it showed, where a clip
 * as long as the scene has wrapped to its first frame. It stays on that last picture instead, like the live player,
 * which pauses the clip where it stopped.
 */
export function backdropSampleTime(local: number, sceneDuration: number, fps: number): number {
  const shown = local >= sceneDuration ? Math.max(0, sceneDuration - 1 / fps) : local;
  return shown + 0.5 / fps + CLIP_TIME_MARGIN;
}

/** Floating-point sums (1.5 + 2.1 + 0.4) must not cost a whole extra frame. */
const FRAME_EPSILON = 1e-6;

/** Frames needed to cover `seconds`: the last one may end up to one frame past the end, never short of it. */
export function frameCount(seconds: number, fps: number): number {
  if (!(seconds > 0) || !(fps > 0)) return 0;
  return Math.max(1, Math.ceil(seconds * fps - FRAME_EPSILON));
}

/** Integer microseconds from the frame index: never accumulated, so a long video does not drift. */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * 1e6) / fps);
}

/** Up to the next frame's timestamp, so consecutive frames neither overlap nor leave a gap. */
export function frameDurationUs(index: number, fps: number): number {
  return frameTimestampUs(index + 1, fps) - frameTimestampUs(index, fps);
}

/** Length of the audio mix in samples: never shorter than the picture. */
export function audioFrameCount(seconds: number): number {
  return Math.max(1, Math.ceil(seconds * AUDIO_SAMPLE_RATE - FRAME_EPSILON));
}

function hasMediaLayer(scene: MotionScene): boolean {
  return scene.layers.some((layer) => layer.type === "media");
}

export interface BackdropNeed {
  sceneIndex: number;
  /** Seconds into the scene at which renderFrame draws it. */
  local: number;
}

/**
 * Which scenes' backdrops renderFrame will ask for at global time t, and at what scene time. A scene entering
 * over another draws both (the previous one frozen at its last instant). This mirrors the branching of
 * renderFrame in render.ts: the exporter has to decode those pictures before drawing, because the media
 * resolver is synchronous.
 */
export function backdropsAt(project: MotionProject, t: number): BackdropNeed[] {
  const { index, local } = locate(project, t);
  const scene = project.scenes[index];
  if (!scene) return [];
  const needs: BackdropNeed[] = [];
  const prev = index > 0 ? project.scenes[index - 1] : null;
  if (prev && scene.transition.type !== "none" && local < scene.transition.duration && hasMediaLayer(prev)) needs.push({ sceneIndex: index - 1, local: prev.duration });
  if (hasMediaLayer(scene)) needs.push({ sceneIndex: index, local });
  return needs;
}

/** Container overhead and VBR overshoot on top of the raw bitrates. */
const SIZE_MARGIN = 1.05;

/** Upper estimate of the file size: video at its target bitrate plus the larger audio bitrate. */
export function estimateBytes(preset: ExportPreset, seconds: number): number {
  if (!(seconds > 0)) return 0;
  return Math.ceil(((preset.videoBitrate + AUDIO_BITRATE.aac) * seconds * SIZE_MARGIN) / 8);
}

/** The offline export builds the whole file in memory (BufferTarget, then a Blob copy): beyond this we use the real-time export. */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;

export type ExportContainer = "mp4-h264-aac" | "webm-vp9-opus" | "realtime";

const FORMATS = {
  "mp4-h264-aac": { extension: "mp4", mime: "video/mp4" },
  "webm-vp9-opus": { extension: "webm", mime: "video/webm" },
  realtime: { extension: "webm", mime: "video/webm" },
} as const;

export function containerFormat(container: ExportContainer): { extension: "mp4" | "webm"; mime: string } {
  return FORMATS[container];
}

/** "Étincelle – Intro !" -> "etincelle-intro-720p.mp4" */
export function exportFilename(title: string, container: ExportContainer, quality: ExportQuality): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `${slug || "neuro-studio"}-${quality}.${containerFormat(container).extension}`;
}

export interface ContainerCapabilities {
  /** VideoEncoder exists (WebCodecs, secure context). */
  hasVideoEncoder: boolean;
  hasH264: boolean;
  hasAac: boolean;
  hasVp9: boolean;
  hasOpus: boolean;
  /** False when the video has no voice and no music: no audio encoder is needed. Defaults to true. */
  hasAudio?: boolean;
  /** Estimated size of the file; over MAX_FILE_BYTES it cannot be built in memory. */
  estimatedBytes?: number;
}

export interface ContainerChoice {
  container: ExportContainer;
  /** Human-readable (French): why this container, shown next to the export options. */
  reason: string;
}

/**
 * The best container this browser can write, from what its encoders support: MP4 (H.264 + AAC) plays everywhere,
 * WebM (VP9 + Opus) plays on the web, and 'realtime' means the offline path is not possible at all and the
 * MediaRecorder export must be used.
 */
export function chooseContainer(caps: ContainerCapabilities): ContainerChoice {
  const audio = caps.hasAudio ?? true;
  if (!caps.hasVideoEncoder) {
    return { container: "realtime", reason: "Ce navigateur ne peut pas encoder la vidéo image par image (WebCodecs absent) : export en temps réel, onglet à garder visible jusqu'à la fin." };
  }
  if (caps.estimatedBytes !== undefined && caps.estimatedBytes > MAX_FILE_BYTES) {
    const mb = Math.round(caps.estimatedBytes / (1024 * 1024));
    const max = Math.round(MAX_FILE_BYTES / (1024 * 1024));
    return { container: "realtime", reason: `Vidéo trop longue pour l'export rapide (environ ${mb} Mo en mémoire, maximum ${max} Mo) : export en temps réel, onglet à garder visible jusqu'à la fin.` };
  }
  if (caps.hasH264 && (!audio || caps.hasAac)) {
    return { container: "mp4-h264-aac", reason: audio ? "MP4 (H.264 + AAC), plus rapide que la lecture : lisible partout." : "MP4 (H.264), plus rapide que la lecture : lisible partout." };
  }
  if (caps.hasVp9 && (!audio || caps.hasOpus)) {
    const missing = !caps.hasH264 ? "le H.264" : "l'AAC";
    return {
      container: "webm-vp9-opus",
      reason: `Ce navigateur n'encode pas ${missing} : export WebM (${audio ? "VP9 + Opus" : "VP9"}), plus rapide que la lecture, lisible dans Chrome, Firefox et Edge.`,
    };
  }
  return { container: "realtime", reason: "Aucun encodeur MP4 ou WebM disponible ici : export en temps réel, onglet à garder visible jusqu'à la fin." };
}
