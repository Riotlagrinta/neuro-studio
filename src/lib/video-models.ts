// AI video engines, run through Replicate. Input shapes and prices were checked against each model's
// published schema and pricing page; adding an engine = add an entry here.
// Shared by server and client (the UI shows prices before anyone spends): no secrets in here.

import type { AspectRatio } from "./motion/types";

export const VIDEO_QUALITIES = ["eco", "standard", "premium"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

export const QUALITY_LABELS: Record<VideoQuality, string> = {
  eco: "Économique",
  standard: "Standard",
  premium: "Premium",
};

export interface VideoRequest {
  prompt: string;
  imageUrl?: string;
  ratio: AspectRatio;
  /** Scene length in seconds. */
  duration: number;
  quality: VideoQuality;
}

interface Tier {
  /** What the user gets, e.g. "720p". */
  detail: string;
  /** Model inputs this tier sets. */
  params: Record<string, unknown>;
  /** Estimated USD for a clip of this length. */
  cost(duration: number): number;
}

export interface VideoModel {
  id: string;
  label: string;
  /** Replicate "owner/name" of an official model. */
  slug: `${string}/${string}`;
  /** Image-to-video only: a scene image must exist first. */
  needsImage: boolean;
  tiers: Record<VideoQuality, Tier>;
  /** Inputs common to every tier. */
  baseInput(req: VideoRequest): Record<string, unknown>;
}

const seedanceSeconds = (duration: number) => Math.min(12, Math.max(4, Math.round(duration)));

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "seedance",
    label: "Seedance 1 Lite",
    slug: "bytedance/seedance-1-lite",
    needsImage: false,
    // 4–12 s clips. aspect_ratio is ignored by the model when an image is given. Billed per output second.
    baseInput: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: seedanceSeconds(duration),
      ...(imageUrl ? { image: imageUrl } : { aspect_ratio: ratio }),
    }),
    tiers: {
      eco: { detail: "480p", params: { resolution: "480p" }, cost: (d) => seedanceSeconds(d) * 0.018 },
      standard: { detail: "720p", params: { resolution: "720p" }, cost: (d) => seedanceSeconds(d) * 0.036 },
      premium: { detail: "1080p", params: { resolution: "1080p" }, cost: (d) => seedanceSeconds(d) * 0.072 },
    },
  },
  {
    id: "wan-fast",
    label: "Wan 2.2 Fast (image → vidéo)",
    slug: "wan-video/wan-2.2-i2v-fast",
    needsImage: true,
    // Fixed ~5 s clip, billed per video; the output keeps the input image's orientation.
    baseInput: ({ prompt, imageUrl }) => ({ prompt, image: imageUrl }),
    tiers: {
      eco: { detail: "480p", params: { resolution: "480p" }, cost: () => 0.05 },
      standard: { detail: "720p", params: { resolution: "720p" }, cost: () => 0.11 },
      premium: { detail: "720p · 30 images/s", params: { resolution: "720p", interpolate_output: true }, cost: () => 0.145 },
    },
  },
];

export function getVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}

export const videoInput = (model: VideoModel, req: VideoRequest) => ({ ...model.baseInput(req), ...model.tiers[req.quality].params });
export const videoCost = (model: VideoModel, req: VideoRequest) => model.tiers[req.quality].cost(req.duration);
