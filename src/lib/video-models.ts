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
  /** Short hint shown under the model selector. */
  note: string;
  /** Replicate "owner/name" of an official model. */
  slug: `${string}/${string}`;
  /** Image-to-video only: a scene image must exist first. */
  needsImage: boolean;
  tiers: Record<VideoQuality, Tier>;
  /** Inputs common to every tier. A tier's params win over these. */
  baseInput(req: VideoRequest): Record<string, unknown>;
}

/** The length a model really renders, as whole seconds inside its limits. */
const clampSeconds = (duration: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(duration)));
// Rounded to 4 decimals like usage_events.cost_usd: 5 * 0.07 is 0.35000000000000003, which a 0.35 $ daily cap would refuse.
const perSecond = (rate: number, seconds: (duration: number) => number) => (duration: number) => Math.round(seconds(duration) * rate * 1e4) / 1e4;

const seedanceSeconds = (duration: number) => clampSeconds(duration, 2, 12);
const wanSeconds = (duration: number) => clampSeconds(duration, 2, 12);
// Up to 15 s accepted, capped at 12 s like the other engines: the app never asks for more, so the prices shown match the bill.
const grokSeconds = (duration: number) => clampSeconds(duration, 1, 12);
// Kling renders 5 or 10 s only: the nearer of the two.
const klingSeconds = (duration: number) => (Math.round(duration) <= 7 ? 5 : 10);
// Veo renders 4, 6 or 8 s: the nearest whole second, snapped up to one of them. 1080p is only allowed at 8 s.
const veoSeconds = (duration: number) => [4, 6, 8].find((s) => s >= Math.round(duration)) ?? 8;
const VEO_1080P_SECONDS = 8;

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "seedance",
    label: "Seedance 1.5 Pro",
    note: "Polyvalent · ≈ 1 min",
    slug: "bytedance/seedance-1.5-pro",
    needsImage: false,
    // 2–12 s clips. generate_audio defaults to true and doubles the price: always sent. aspect_ratio is ignored
    // by the model when an image is given. Prices below are per output second without audio.
    baseInput: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: seedanceSeconds(duration),
      generate_audio: false,
      ...(imageUrl ? { image: imageUrl } : { aspect_ratio: ratio }),
    }),
    tiers: {
      eco: { detail: "480p", params: { resolution: "480p" }, cost: perSecond(0.013, seedanceSeconds) },
      standard: { detail: "720p", params: { resolution: "720p" }, cost: perSecond(0.026, seedanceSeconds) },
      premium: { detail: "1080p", params: { resolution: "1080p" }, cost: perSecond(0.06, seedanceSeconds) },
    },
  },
  {
    id: "wan3",
    label: "Wan 3",
    note: "Qualité maximale · lent (≈ 5 min en 1080p)",
    slug: "alibaba/wan-3",
    needsImage: false,
    // 2–30 s accepted, capped at 12 s here. resolution defaults to 1080p, the most expensive: always sent.
    // Prices are the model README's, twice the live billing config (which looked like a promotion): worst case.
    baseInput: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: wanSeconds(duration),
      ...(imageUrl ? { image: imageUrl } : { aspect_ratio: ratio }),
    }),
    tiers: {
      eco: { detail: "480p", params: { resolution: "480p" }, cost: perSecond(0.05, wanSeconds) },
      standard: { detail: "720p", params: { resolution: "720p" }, cost: perSecond(0.1, wanSeconds) },
      premium: { detail: "1080p", params: { resolution: "1080p" }, cost: perSecond(0.2, wanSeconds) },
    },
  },
  {
    id: "kling",
    label: "Kling 2.5 Turbo Pro",
    note: "Mouvement fluide · clips de 5 ou 10 s",
    slug: "kwaivgi/kling-v2.5-turbo-pro",
    needsImage: false,
    // No resolution input and one flat price, so the three tiers are the same. start_image replaces aspect_ratio.
    baseInput: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: klingSeconds(duration),
      ...(imageUrl ? { start_image: imageUrl } : { aspect_ratio: ratio }),
    }),
    tiers: {
      eco: { detail: "HD", params: {}, cost: perSecond(0.07, klingSeconds) },
      standard: { detail: "HD", params: {}, cost: perSecond(0.07, klingSeconds) },
      premium: { detail: "HD", params: {}, cost: perSecond(0.07, klingSeconds) },
    },
  },
  {
    id: "veo",
    label: "Veo 3.1 Lite (Google)",
    note: "Réaliste · clips de 4, 6 ou 8 s (1080p : 8 s) · ≈ 40 s",
    slug: "google/veo-3.1-lite",
    needsImage: false,
    // The model always generates sound and has no switch: backdrops are muted by the app. aspect_ratio is always
    // sent (the schema does not say it is ignored with an image).
    baseInput: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: veoSeconds(duration),
      aspect_ratio: ratio,
      ...(imageUrl ? { image: imageUrl } : {}),
    }),
    tiers: {
      eco: { detail: "720p", params: { resolution: "720p" }, cost: perSecond(0.05, veoSeconds) },
      standard: { detail: "720p", params: { resolution: "720p" }, cost: perSecond(0.05, veoSeconds) },
      premium: {
        detail: `1080p · ${VEO_1080P_SECONDS} s`,
        params: { resolution: "1080p", duration: VEO_1080P_SECONDS },
        cost: perSecond(0.08, () => VEO_1080P_SECONDS),
      },
    },
  },
  {
    id: "grok",
    label: "Grok Imagine",
    note: "Rapide · ≈ 30 s · 720p maximum",
    slug: "xai/grok-imagine-video",
    needsImage: false,
    // One flat price for both resolutions. Sound is always generated (muted by the app). With an image the model
    // takes the image's own ratio ('auto').
    baseInput: ({ prompt, imageUrl, ratio, duration }) => ({
      prompt,
      duration: grokSeconds(duration),
      aspect_ratio: imageUrl ? "auto" : ratio,
      ...(imageUrl ? { image: imageUrl } : {}),
    }),
    tiers: {
      eco: { detail: "480p", params: { resolution: "480p" }, cost: perSecond(0.05, grokSeconds) },
      standard: { detail: "720p", params: { resolution: "720p" }, cost: perSecond(0.05, grokSeconds) },
      premium: { detail: "720p", params: { resolution: "720p" }, cost: perSecond(0.05, grokSeconds) },
    },
  },
  {
    id: "wan-fast",
    label: "Wan 2.2 Fast (image → vidéo)",
    note: "Économique · clip fixe ≈ 5 s · image requise",
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
