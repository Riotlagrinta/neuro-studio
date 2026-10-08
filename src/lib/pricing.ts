// ESTIMATED costs in USD. They drive the per-user daily cost cap and the prices shown in the UI.
// They are not invoices: check vendor price pages before relying on them.
// This module is shared by server and client: keep it free of secrets and server-only imports.

import { VIDEO_QUALITIES, type VideoQuality } from "./video-models";

/** USD per million tokens (Anthropic public prices). Also the list of models we accept in MOTION_MODEL / REFINE_MODEL. */
export const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** USD per 1,000 characters of narration. ElevenLabs Multilingual v2; OpenAI bills audio tokens (~0.015 $/min, rounded up). */
export const VOICE_RATES = { elevenlabs: 0.08, openai: 0.02 } as const;

// Measured on a real spec: ~180 output tokens per second of video, doubled for reasoning, plus a 1.5x margin.
const OUTPUT_TOKENS_PER_VIDEO_SECOND = 360 * 1.5;
const MOTION_INPUT_TOKENS = 2000; // system prompt + brief
const REFINE_OUTPUT_TOKENS = 2400; // one scene spec + reasoning, with margin
const REFINE_INPUT_TOKENS = 2500; // system prompt + the scene being revised

const priceOf = (model: string) => CLAUDE_PRICES[model] ?? CLAUDE_PRICES["claude-opus-5-5"];

export function motionCost(seconds: number, model: string): number {
  const p = priceOf(model);
  return round((seconds * OUTPUT_TOKENS_PER_VIDEO_SECOND * p.output + MOTION_INPUT_TOKENS * p.input) / 1e6);
}

export function refineCost(model: string): number {
  const p = priceOf(model);
  return round((REFINE_OUTPUT_TOKENS * p.output + REFINE_INPUT_TOKENS * p.input) / 1e6);
}

export const voiceCost = (chars: number, perThousandChars: number) => round((chars / 1000) * perThousandChars);

/** "0,09 $" — what the interface shows. */
export function formatUsd(n: number): string {
  if (n <= 0) return "gratuit";
  if (n < 0.01) return "< 0,01 $";
  return `${n.toFixed(2).replace(".", ",")} $`;
}

/** Longest video a user may ask for. Raise it once the long-form pipeline exists. */
export function maxVideoSeconds(): number {
  const v = Number(process.env.MAX_VIDEO_SECONDS);
  return Number.isFinite(v) && v >= 10 ? Math.min(v, 120) : 60;
}

/** Quality pre-selected for AI video (VIDEO_DEFAULT_QUALITY=eco|standard|premium). Cheapest unless told otherwise. */
export function defaultVideoQuality(): VideoQuality {
  const v = process.env.VIDEO_DEFAULT_QUALITY?.trim();
  return (VIDEO_QUALITIES as readonly string[]).includes(v ?? "") ? (v as VideoQuality) : "eco";
}

/** Spend allowed per user over a rolling 24 hours. */
export function dailyCostCapUsd(): number {
  const v = Number(process.env.DAILY_COST_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}
