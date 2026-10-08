// Canvas renderer: a pure function of (project, time) → pixels.
// Preview, scrubbing and video export all call renderFrame, so what you see is what you export.

import { activeWordIndex, captionTimings, drawCaptions, layoutCaptions, paginate } from "./captions";
import { ease, sample } from "./easing";
import { FRAMES, locate, type Anchor, type CaptionsLayer, type Layer, type MotionProject, type MotionScene, type TextLayer } from "./types";

export interface FontStacks {
  sans: string;
  serif: string;
  mono: string;
  display: string;
}

export const SYSTEM_FONTS: FontStacks = {
  sans: 'system-ui, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  display: 'Impact, "Arial Narrow Bold", "Arial Black", sans-serif',
};

export type MediaResolver = (scene: MotionScene) => CanvasImageSource | null;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: MotionProject,
  t: number,
  media: MediaResolver,
  fonts: FontStacks,
): void {
  const frame = FRAMES[project.ratio];
  const k = ctx.canvas.width / frame.width;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, frame.width, frame.height);

  const { index, local } = locate(project, t);
  const scene = project.scenes[index];
  if (!scene) return;

  // A transition is how a scene enters over the previous one, so the first scene just starts.
  const prev = index > 0 ? project.scenes[index - 1] : null;
  const tr = scene.transition;
  if (!prev || tr.type === "none" || local >= tr.duration) {
    drawScene(ctx, scene, local, media, fonts, frame);
    return;
  }

  const p = ease("easeInOut", local / tr.duration);
  drawScene(ctx, prev, prev.duration, media, fonts, frame);
  ctx.save();
  switch (tr.type) {
    case "slide":
      ctx.translate((1 - p) * frame.width, 0);
      break;
    case "zoom": {
      const s = 1.25 - 0.25 * p;
      ctx.globalAlpha = p;
      ctx.translate(frame.width / 2, frame.height / 2);
      ctx.scale(s, s);
      ctx.translate(-frame.width / 2, -frame.height / 2);
      break;
    }
    case "wipe":
      ctx.beginPath();
      ctx.rect(0, 0, frame.width * p, frame.height);
      ctx.clip();
      break;
    default:
      ctx.globalAlpha = p;
  }
  drawScene(ctx, scene, local, media, fonts, frame);
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: MotionScene,
  t: number,
  media: MediaResolver,
  fonts: FontStacks,
  frame: { width: number; height: number },
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, frame.width, frame.height);
  ctx.clip();
  drawBackground(ctx, scene, frame);
  for (const layer of scene.layers) {
    if (t < layer.start || (layer.end !== null && t > layer.end)) continue;
    drawLayer(ctx, scene, layer, t, media, fonts);
  }
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, scene: MotionScene, frame: { width: number; height: number }) {
  const { width: W, height: H } = frame;
  const bg = scene.background;
  if (bg.type === "solid") {
    ctx.fillStyle = bg.color;
  } else if (bg.type === "radial") {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  } else {
    // CSS-style angle: 0° points up, 90° points right.
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const len = Math.abs(W * dx) + Math.abs(H * dy);
    const g = ctx.createLinearGradient(W / 2 - (dx * len) / 2, H / 2 - (dy * len) / 2, W / 2 + (dx * len) / 2, H / 2 + (dy * len) / 2);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);
}

/** Offset from the anchor point (x,y) to the shape's center. */
function anchorOffset(anchor: Anchor, w: number, h: number): [number, number] {
  switch (anchor) {
    case "left":
      return [w / 2, 0];
    case "right":
      return [-w / 2, 0];
    case "top":
      return [0, h / 2];
    case "bottom":
      return [0, -h / 2];
    default:
      return [0, 0];
  }
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  scene: MotionScene,
  layer: Layer,
  t: number,
  media: MediaResolver,
  fonts: FontStacks,
) {
  const opacity = clamp01(sample(layer.opacity, t));
  const scale = sample(layer.scale, t);
  if (opacity <= 0.001 || scale <= 0.001) return;

  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(sample(layer.x, t), sample(layer.y, t));
  ctx.rotate((sample(layer.rotation, t) * Math.PI) / 180);
  ctx.scale(scale, scale);

  switch (layer.type) {
    case "rect": {
      const w = Math.max(0, sample(layer.w, t));
      const h = Math.max(0, sample(layer.h, t));
      const [ox, oy] = anchorOffset(layer.anchor, w, h);
      ctx.beginPath();
      roundedRect(ctx, ox - w / 2, oy - h / 2, w, h, layer.radius);
      paint(ctx, layer.fill, layer.stroke, layer.strokeWidth);
      break;
    }
    case "ellipse": {
      const w = Math.max(0, sample(layer.w, t));
      const h = Math.max(0, sample(layer.h, t));
      const [ox, oy] = anchorOffset(layer.anchor, w, h);
      ctx.beginPath();
      ctx.ellipse(ox, oy, w / 2, h / 2, 0, 0, Math.PI * 2);
      paint(ctx, layer.fill, layer.stroke, layer.strokeWidth);
      break;
    }
    case "media": {
      const src = media(scene);
      if (src) drawCover(ctx, src, layer, t);
      break;
    }
    case "text":
      drawText(ctx, layer, t, fonts);
      break;
    case "captions":
      drawCaptions(ctx, layer, t, fonts, scene.duration);
      break;
  }
  ctx.restore();
}

function paint(ctx: CanvasRenderingContext2D, fill: string, stroke: string | null, strokeWidth: number) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke && strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sourceSize(src: CanvasImageSource): [number, number] {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  const s = src as { width: number; height: number };
  return [s.width, s.height];
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, layer: Extract<Layer, { type: "media" }>, t: number) {
  const w = Math.max(0, sample(layer.w, t));
  const h = Math.max(0, sample(layer.h, t));
  const [sw, sh] = sourceSize(src);
  if (!sw || !sh || !w || !h) return;
  const [ox, oy] = anchorOffset(layer.anchor, w, h);
  const bx = ox - w / 2;
  const by = oy - h / 2;
  const fit = Math.max(w / sw, h / sh);
  const dw = sw * fit;
  const dh = sh * fit;
  ctx.beginPath();
  ctx.rect(bx, by, w, h);
  ctx.clip();
  ctx.drawImage(src, bx + (w - dw) / 2, by + (h - dh) / 2, dw, dh);
}

// ---------- text ----------

interface Unit {
  text: string;
  x: number;
  y: number;
}

interface TextLayout {
  key: string;
  units: Unit[];
  mode: "line" | "word" | "char";
  /** Size of the block, before the layer's scale (the box a selection frame has to hug). */
  width: number;
  height: number;
}

const layoutCache = new WeakMap<TextLayer, TextLayout>();

function fontString(layer: Pick<TextLayer, "font" | "weight" | "size">, fonts: FontStacks): string {
  // The display face only ships a regular weight; asking for bold would be synthesized and smudge it.
  const weight = layer.font === "display" ? 400 : Math.round(layer.weight / 100) * 100;
  return `${weight} ${layer.size}px ${fonts[layer.font]}`;
}

function layoutText(ctx: CanvasRenderingContext2D, layer: TextLayer, font: string): TextLayout {
  const mode = layer.letterSpacing !== 0 || layer.reveal === "chars" || layer.reveal === "typewriter" ? "char" : layer.reveal === "words" ? "word" : "line";
  const key = `${font}|${mode}|${layer.text}|${layer.maxWidth}|${layer.letterSpacing}|${layer.lineHeight}|${layer.align}`;
  const cached = layoutCache.get(layer);
  if (cached && cached.key === key) return cached;

  ctx.font = font;
  const ls = layer.letterSpacing;
  const width = (s: string) => ctx.measureText(s).width + ls * s.length;
  const space = width(" ");

  // 1. Greedy word wrap.
  const lines: { words: { text: string; w: number }[]; w: number }[] = [];
  for (const para of layer.text.split("\n")) {
    let line = { words: [] as { text: string; w: number }[], w: 0 };
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = width(word);
      const next = line.words.length ? line.w + space + w : w;
      if (line.words.length && next > layer.maxWidth) {
        lines.push(line);
        line = { words: [], w: 0 };
        line.words.push({ text: word, w });
        line.w = w;
      } else {
        line.words.push({ text: word, w });
        line.w = next;
      }
    }
    lines.push(line);
  }

  // 2. Position. The block is anchored at the origin according to `align`.
  const blockW = Math.max(...lines.map((l) => l.w), 0);
  const left = layer.align === "left" ? 0 : layer.align === "right" ? -blockW : -blockW / 2;
  const lh = layer.size * layer.lineHeight;
  const top = -(lines.length * lh) / 2;
  const units: Unit[] = [];

  lines.forEach((line, li) => {
    const y = top + (li + 0.5) * lh;
    let x = left + (layer.align === "left" ? 0 : layer.align === "right" ? blockW - line.w : (blockW - line.w) / 2);
    if (mode === "line") {
      units.push({ text: line.words.map((w) => w.text).join(" "), x, y });
      return;
    }
    line.words.forEach((word, wi) => {
      if (wi > 0) x += space;
      if (mode === "word") {
        units.push({ text: word.text, x, y });
      } else {
        let cx = x;
        for (const ch of word.text) {
          units.push({ text: ch, x: cx, y });
          cx += width(ch);
        }
      }
      x += word.w;
    });
  });

  const layout: TextLayout = { key, units, mode, width: blockW, height: lines.length * lh };
  layoutCache.set(layer, layout);
  return layout;
}

const UNIT_DURATION = 0.4;

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, t: number, fonts: FontStacks) {
  const font = fontString(layer, fonts);
  const layout = layoutText(ctx, layer, font);
  ctx.font = font;
  ctx.fillStyle = layer.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const elapsed = t - layer.start;
  const n = layout.units.length;

  // Per-unit progress 0..1 for the chosen reveal.
  let progress: (i: number) => number;
  switch (layer.reveal) {
    case "none":
      progress = () => 1;
      break;
    case "fade": {
      const p = clamp01(elapsed / layer.revealDuration);
      progress = () => p;
      break;
    }
    case "typewriter": {
      const step = layer.revealDuration / Math.max(1, n);
      progress = (i) => (elapsed >= i * step ? 1 : 0);
      break;
    }
    default: {
      const stagger = n > 1 ? Math.max(0, layer.revealDuration - UNIT_DURATION) / (n - 1) : 0;
      progress = (i) => clamp01((elapsed - i * stagger) / UNIT_DURATION);
    }
  }

  const rise = layer.reveal === "words" ? layer.size * 0.4 : layer.reveal === "chars" ? layer.size * 0.3 : 0;
  const base = ctx.globalAlpha;
  layout.units.forEach((u, i) => {
    const p = progress(i);
    if (p <= 0) return;
    const e = layer.reveal === "typewriter" || layer.reveal === "none" ? 1 : ease("easeOut", p);
    ctx.globalAlpha = base * e;
    ctx.fillText(u.text, u.x, u.y + (1 - e) * rise);
  });
  ctx.globalAlpha = base;
}

// ---------- measuring ----------

/** When a block is measured: captions show one page at a time, so how big they are depends on the moment. */
export interface MeasureMoment {
  /** Scene-local seconds. */
  t: number;
  sceneDuration: number;
}

/**
 * The size of a text or captions block in layer units (before the layer's scale), from the very same wrapping and
 * line height as drawText / drawCaptions, so a selection frame hugs the drawn pixels. Text reuses the layout
 * renderFrame caches. Captions are measured on the page being shown at `moment`, or on their first page without one.
 */
export function measureLayer(ctx: CanvasRenderingContext2D, layer: TextLayer | CaptionsLayer, fonts: FontStacks, moment?: MeasureMoment): { w: number; h: number } {
  const font = fontString(layer, fonts);
  // measureText reads ctx.font, which the next draw sets again anyway: leave the context as it was found.
  ctx.save();
  let size: { width: number; height: number };
  if (layer.type === "text") {
    size = layoutText(ctx, layer, font);
  } else {
    ctx.font = font;
    size = layoutCaptions((s) => ctx.measureText(s).width, layer, font, captionsPage(layer, moment));
  }
  ctx.restore();
  return { w: size.width, h: size.height };
}

/** The words of the page drawCaptions shows at `moment` (the first page without one). */
function captionsPage(layer: CaptionsLayer, moment?: MeasureMoment): string[] {
  const to = moment ? Math.min(layer.end ?? moment.sceneDuration, moment.sceneDuration) : layer.start + 1;
  // A layer whose window is empty draws nothing, but it must still have a size to be grabbed by.
  let words = captionTimings(layer.text, layer.start, to);
  if (words.length === 0) words = captionTimings(layer.text, 0, 1);
  const pages = paginate(words);
  const current = moment ? Math.max(0, activeWordIndex(words, moment.t)) : 0;
  let first = 0;
  for (const page of pages) {
    if (current < first + page.length) return page.map((w) => w.text);
    first += page.length;
  }
  return [];
}
