// ESTIMATED costs in USD, used only for the per-user daily cost cap. They are not invoices:
// check vendor price pages before relying on them (Anthropic 4$/20$ per MTok for Opus 5.5,
// ElevenLabs 0.08$/1k chars, Replicate per-second / per-clip prices).

/** Opus spec + reasoning: measured ~180 output tokens per video second, doubled for reasoning. */
const MOTION_COST_PER_SECOND = 0.012;
export const REFINE_COST = 0.1;

export const motionCost = (seconds: number) => round(seconds * MOTION_COST_PER_SECOND);
export const voiceCost = (chars: number, perThousandChars: number) => round((chars / 1000) * perThousandChars);

/** Longest video a user may ask for. Raise it once the long-form pipeline exists. */
export function maxVideoSeconds(): number {
  const v = Number(process.env.MAX_VIDEO_SECONDS);
  return Number.isFinite(v) && v >= 10 ? Math.min(v, 120) : 60;
}

/** Spend allowed per user over a rolling 24 hours. */
export function dailyCostCapUsd(): number {
  const v = Number(process.env.DAILY_COST_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}
