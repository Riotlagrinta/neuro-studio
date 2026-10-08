// AI video engines, run through Replicate. Input shapes were checked against each model's
// published schema; adding an engine = add an entry here.

import type { AspectRatio } from "./motion/types";

export interface VideoRequest {
  prompt: string;
  imageUrl?: string;
  ratio: AspectRatio;
  /** Scene length in seconds. */
  duration: number;
}

export interface VideoModel {
  id: string;
  label: string;
  /** Replicate "owner/name" of an official model. */
  slug: `${string}/${string}`;
  /** Image-to-video only: a scene image must exist first. */
  needsImage: boolean;
  input(req: VideoRequest): Record<string, unknown>;
}

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "seedance",
    label: "Seedance 1 Lite",
    slug: "bytedance/seedance-1-lite",
    needsImage: false,
    // 4–12 s, 720p. aspect_ratio is ignored by the model when an image is given.
    input: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: Math.min(12, Math.max(4, Math.round(duration))),
      resolution: "720p",
      ...(imageUrl ? { image: imageUrl } : { aspect_ratio: ratio }),
    }),
  },
  {
    id: "wan-fast",
    label: "Wan 2.2 Fast (image → vidéo)",
    slug: "wan-video/wan-2.2-i2v-fast",
    needsImage: true,
    // Fixed ~5 s clip; the output keeps the input image's orientation.
    input: ({ prompt, imageUrl }) => ({ prompt, image: imageUrl, resolution: "720p" }),
  },
];

export function getVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id);
}
