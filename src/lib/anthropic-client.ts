import Anthropic from "@anthropic-ai/sdk";

// Motion design is the hard, spatial/creative part of the product, so it runs on Opus.
export const MOTION_MODEL = "claude-opus-5-5";

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  return apiKey ? new Anthropic({ apiKey }) : null;
}
