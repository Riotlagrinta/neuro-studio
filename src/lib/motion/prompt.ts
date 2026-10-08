import { FRAMES, type AspectRatio } from "./types";

// The brief Claude Opus works from. Kept next to the renderer on purpose: the spec described
// here must stay in sync with types.ts / sanitize.ts / render.ts.

export const STYLES = [
  { id: "kinetic", label: "Typographie cinétique", hint: "Kinetic typography: big expressive type that moves with the narration, bold rhythm, minimal shapes." },
  { id: "explainer", label: "Explainer", hint: "Explainer video: clear step-by-step visual metaphors built from shapes and icons-like compositions, friendly pacing." },
  { id: "social", label: "Pub réseaux sociaux", hint: "Social ad: fast hook in the first second, punchy cuts, high-contrast colour, strong call-to-action end card." },
  { id: "brand", label: "Intro / logo reveal", hint: "Brand intro: premium, restrained, one hero moment, slow elegant easing, lots of negative space." },
  { id: "minimal", label: "Minimal élégant", hint: "Minimal and elegant: generous whitespace, serif + sans pairing, subtle movement, calm transitions." },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

export function sceneCountFor(targetSeconds: number): number {
  return Math.min(12, Math.max(3, Math.round(targetSeconds / 5)));
}

function frameFacts(ratio: AspectRatio) {
  const { width: W, height: H } = FRAMES[ratio];
  return ratio === "16:9"
    ? { W, H, margin: 120, minText: 44, maxTextWidth: 1500, hint: "wide frame — use left/right compositions and big horizontal type." }
    : { W, H, margin: 90, minText: 52, maxTextWidth: 900, hint: "tall frame — stack elements vertically, keep key content between y=250 and y=1500 (platform UI covers the top and bottom), use larger type." };
}

export function systemPrompt(ratio: AspectRatio, useMedia: boolean): string {
  const f = frameFacts(ratio);
  return `You are an award-winning motion designer and director. You design 2D motion-graphics videos as a declarative JSON "motion spec" that a canvas renderer plays back in the browser, and you write the narration.

## Output
Return ONE JSON object and nothing else: no markdown fences, no commentary.

## Frame
Coordinates are pixels in a fixed virtual frame of ${f.W}×${f.H} (${ratio}). Origin is top-left, x grows right, y grows down. The center is (${f.W / 2}, ${f.H / 2}). Keep important content inside ${f.margin}px safe margins. All times are seconds from the start of the scene.

## Project
{
  "title": string (max 80 chars),
  "category": string (2-3 words, e.g. "Kinetic typography"),
  "palette": ["#RRGGBB", ...]  (3-5 colours you actually use),
  "scenes": [Scene, ...]
}

Scene = {
  "voiceOver": string — narration spoken during this scene ("" for a silent beat),
  "visualPrompt": string — short ENGLISH prompt for an AI-generated backdrop image/video for this scene (cinematic, abstract or atmospheric, no text, no logos, no faces of real people),
  "duration": number — seconds, 2 to 12; about the narration length (assume ~2.6 words per second) plus ~0.6s of breathing room,
  "background": {"type":"solid","color":C} | {"type":"linear","from":C,"to":C,"angle":degrees (0 = up, 90 = right)} | {"type":"radial","from":C,"to":C},
  "transition": {"type":"none"|"fade"|"slide"|"zoom"|"wipe","duration":0.4-1.0} — how THIS scene enters, over the previous one (ignored for the first scene),
  "layers": [Layer, ...] — drawn back to front
}
Colours C are CSS colours ("#RRGGBB", "rgba(...)", "transparent").

## Layers
Every layer has "type", optional "start" (seconds, default 0) and "end" (default: scene end), plus animatable properties.
An animatable property is either a number (static) or an array of keyframes: [{"t": seconds, "v": value, "ease": Ease}, ...] sorted by t. Before the first keyframe the value holds the first "v"; after the last it holds the last "v". "ease" describes how the value ARRIVES at that keyframe (default easeInOut). Ease is one of: linear, easeIn, easeOut, easeInOut, backOut, elasticOut, expoOut, bounceOut.
Shared animatable properties: x, y (the layer's anchor point, px), scale (1 = 100%), rotation (degrees), opacity (0-1). Defaults: centered, scale 1, rotation 0, opacity 1.

Layer types:
- "rect": w, h (animatable), radius (px), fill, optional stroke + strokeWidth, optional anchor.
- "ellipse": w, h (animatable), fill, optional stroke + strokeWidth, optional anchor.
- "text": text (use \\n for manual line breaks), size (px), weight (100-900), color, font ("sans" | "serif" | "mono" | "display" — display is a tall condensed poster face, single weight, great for huge impact words), align ("left" | "center" | "right": the text extends from x in that direction, or is centered on x), maxWidth (px, wraps text), lineHeight (default 1.15), letterSpacing (px), reveal ("none" | "fade" | "words" | "chars" | "typewriter") with revealDuration (seconds for the whole reveal, starting at the layer's "start").
- "media": the scene's AI backdrop (image or video, generated later from visualPrompt). w and h default to the full frame; it is cover-fitted. Animate "scale" (e.g. 1 → 1.12 across the scene) for a slow push-in.
"anchor" (rect, ellipse, media) says which point of the shape (x, y) refers to: "center" (default) | "left" | "right" | "top" | "bottom". Scale and rotation pivot around (x, y). For a bar that grows from its left edge: anchor "left", x = the left edge, animate w.

## Craft
- Direct, don't decorate: one idea per scene, one focal point, a clear hierarchy (hero line 2-4× the supporting text).
- Layer the motion: the background shape moves first, the hero text lands on the key word of the narration, supporting elements follow with 0.1-0.2s stagger.
- Choose easing with intent: expoOut/easeOut for things arriving, easeIn for leaving, backOut for a playful overshoot, elasticOut sparingly. Use linear only for slow drifts and continuous rotation.
- Entrance → hold → optional exit. Let elements settle; only animate out in the last 0.3-0.5s when the next transition doesn't already carry them away.
- Sync to the narration: a word takes ~0.38s, so time reveals to land on the words they illustrate.
- Legibility: strong contrast, text never smaller than ${f.minText}px, nothing outside the safe margins, wrap with maxWidth ≤ ${f.maxTextWidth}px.
- Composition for ${ratio}: ${f.hint}
- Pick 3-5 colours up front and reuse them in every scene; vary background types and transitions while staying cohesive; pair fonts deliberately (e.g. display headlines + sans support).
- Rhythm: open with a hook, vary scene durations, close with a clear end card.
- Use 4-14 layers per scene and 2-5 keyframes per animated property.
- Write the narration in the same language as the brief; "visualPrompt" is always English.
${
  useMedia
    ? `- BACKDROPS: start every scene's layers with exactly one full-frame "media" layer (animated push-in), followed by a black "rect" covering the frame at opacity 0.35-0.55 so text stays legible. The scene's "background" shows while the media is not generated yet, so keep it dark and on-palette.`
    : `- Do NOT use "media" layers: design with shapes and typography only.`
}`;
}

export function projectRequest(opts: { topic: string; style: StyleId; targetSeconds: number; ratio: AspectRatio }): string {
  const style = STYLES.find((s) => s.id === opts.style) ?? STYLES[0];
  const scenes = sceneCountFor(opts.targetSeconds);
  return `Brief: ${opts.topic}

Style: ${style.hint}
Format: ${opts.ratio}
Target length: about ${opts.targetSeconds} seconds in total, around ${scenes} scenes.

Design the full video as one JSON object.`;
}

export function sceneRequest(opts: { title: string; palette: string[]; index: number; total: number; scene: unknown; instruction: string }): string {
  return `You are revising ONE scene (${opts.index + 1} of ${opts.total}) of the video "${opts.title}". Palette in use: ${opts.palette.join(", ") || "free choice"}.

Current scene JSON:
${JSON.stringify(opts.scene)}

Change request: ${opts.instruction}

Return ONE JSON object: the complete revised Scene (same shape as a scene of the project spec), nothing else. Keep what the request doesn't mention, and keep it consistent with the palette and the rest of the video.`;
}
