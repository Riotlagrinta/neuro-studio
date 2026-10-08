import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_PRICES } from "./pricing";

export type ClaudeTask = "generate" | "refine";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

// Writing a whole video is the hard, spatial/creative part: Opus, at high effort.
// Revising one scene is smaller and the user can simply retry: Sonnet at half the price.
const DEFAULTS: Record<ClaudeTask, { model: string; effort: Effort }> = {
  generate: { model: "claude-opus-5-5", effort: "high" },
  refine: { model: "claude-sonnet-5-5", effort: "medium" },
};

const warned = new Set<string>();
function invalid(name: string, value: string) {
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`${name}="${value}" is not supported: using the default instead.`);
  }
}

/**
 * Which model and effort to use for a task. Override with MOTION_MODEL / MOTION_EFFORT (full video) and
 * REFINE_MODEL / REFINE_EFFORT (scene retouch). Only models listed in CLAUDE_PRICES are accepted: they are
 * the ones whose request shape (adaptive thinking, effort, server-side fallback) this code is written for.
 */
export function claudeConfig(task: ClaudeTask): { model: string; effort: Effort } {
  const prefix = task === "generate" ? "MOTION" : "REFINE";
  const model = process.env[`${prefix}_MODEL`]?.trim();
  const effort = process.env[`${prefix}_EFFORT`]?.trim();
  if (model && !(model in CLAUDE_PRICES)) invalid(`${prefix}_MODEL`, model);
  if (effort && !(EFFORTS as readonly string[]).includes(effort)) invalid(`${prefix}_EFFORT`, effort);
  return {
    model: model && model in CLAUDE_PRICES ? model : DEFAULTS[task].model,
    effort: effort && (EFFORTS as readonly string[]).includes(effort) ? (effort as Effort) : DEFAULTS[task].effort,
  };
}

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  return apiKey ? new Anthropic({ apiKey }) : null;
}
