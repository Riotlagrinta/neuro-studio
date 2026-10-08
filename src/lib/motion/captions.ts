// Animated subtitles ("the CapCut effect"): the words of the narration appear and light up one after
// another across the layer's window. Timing, paging and layout are pure functions of their arguments
// (the layout takes an injected `measure`), so they are tested without a canvas; only drawCaptions
// touches a context.

import { ease } from "./easing";
import type { FontStacks } from "./render";
import { normalizeScene } from "./sanitize";
import type { AspectRatio, CaptionsLayer, CaptionStyle, MotionScene } from "./types";

export interface CaptionWord {
  text: string;
  /** Scene-local seconds. */
  start: number;
  end: number;
}

// ---------- timing ----------

/** Silence after a sentence end / a comma, expressed in letters so it scales with the speaking pace. */
const SENTENCE_PAUSE = 4;
const CLAUSE_PAUSE = 2;
const DEFAULT_PAGE_WORDS = 4;

const LETTER = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;
/** Marks that belong to the word before them, and marks that belong to the word after them. */
const TRAILING_MARKS = /^[\p{Pe}\p{Pf}\p{Pd}.,;:!?…%'"]+$/u;
const LEADING_MARKS = /^[\p{Ps}\p{Pi}]+$/u;
/** Quotes and brackets that may follow the full stop: «Bonjour.» still ends a sentence. */
const CLOSERS = ")]}\"'»”’";

/**
 * Whitespace-separated words, except that a token made only of such marks never stands alone: French
 * typography puts a space before "?", "!", ":", "%" and inside « guillemets », which would otherwise give
 * subtitles a word that is just "!". It sticks to the word it belongs to (opening marks to the next one,
 * and whatever follows an opening mark goes with it: « — Bonjour » keeps its dash after the guillemet).
 * Consequence: a word never contains whitespace, the characters keep their order ("Oui !" is shown as
 * "Oui!"), and scenes.ts can cut a text by counting non-blank characters. Other symbols ("&", "+", "/") are
 * words of their own.
 */
function splitWords(text: string): string[] {
  const words: string[] = [];
  let opening = "";
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const leading = LEADING_MARKS.test(token);
    if (!leading && !TRAILING_MARKS.test(token)) {
      words.push(opening + token);
      opening = "";
    } else if (leading || opening || words.length === 0) {
      opening += token;
    } else {
      words[words.length - 1] += token;
    }
  }
  if (opening) {
    if (words.length > 0) words[words.length - 1] += opening;
    else words.push(opening);
  }
  return words;
}

/** Looks through closing quotes and brackets (a plain scan: a regex for "closers at the end" backtracks quadratically). */
function trailingPause(word: string): number {
  let end = word.length;
  while (end > 0 && CLOSERS.includes(word[end - 1])) end--;
  if (end === 0) return 0;
  const last = word[end - 1];
  if (".?!…".includes(last)) return SENTENCE_PAUSE;
  if (",;:".includes(last)) return CLAUSE_PAUSE;
  return 0;
}

/** Relative time a word takes to say: its letters (an emoji counts as one) plus the pause its punctuation asks for. */
function weight(word: string): number {
  let letters = 0;
  for (const ch of word) if (LETTER.test(ch)) letters++;
  return Math.max(1, letters) + trailingPause(word);
}

/**
 * Spreads the words of `text` over [from, to] in proportion to their weight. The result is contiguous
 * (each word starts where the previous one ends), monotonic, and covers [from, to] exactly.
 * Empty text, or a window that is empty or not finite, gives [].
 */
export function captionTimings(text: string, from: number, to: number): CaptionWord[] {
  const span = to - from;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const words = splitWords(text);
  if (words.length === 0) return [];

  const weights = words.map(weight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const last = words.length - 1;
  let start = from;
  let acc = 0;
  return words.map((word, i) => {
    acc += weights[i];
    // Boundaries come from the running total, not from summed durations, so rounding can't open a gap or
    // drift; the clamp keeps float error from pushing a boundary past `to`.
    const end = i === last ? to : Math.min(to, from + (span * acc) / total);
    const timed = { text: word, start, end };
    start = end;
    return timed;
  });
}

/** Index of the word being said at `t`: -1 before the first one, the last index once they are all said. */
export function activeWordIndex(words: readonly CaptionWord[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Splits the words into pages of at most `maxWordsPerPage`, ending a page early at a sentence end once it
 * holds at least two words (a lone "Oui." stays with the next sentence instead of flashing by itself).
 */
export function paginate(words: readonly CaptionWord[], maxWordsPerPage = DEFAULT_PAGE_WORDS): CaptionWord[][] {
  const max = Math.max(1, Math.floor(maxWordsPerPage)) || DEFAULT_PAGE_WORDS;
  const pages: CaptionWord[][] = [];
  let page: CaptionWord[] = [];
  for (const word of words) {
    page.push(word);
    if (page.length >= max || (page.length >= 2 && trailingPause(word.text) === SENTENCE_PAUSE)) {
      pages.push(page);
      page = [];
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

// ---------- layout ----------

export interface PlacedWord {
  /** What to draw: the word, upper-cased when the layer asks for it. */
  text: string;
  /** Centre of the word, relative to the centre of the block. */
  x: number;
  y: number;
  /** Measured width. */
  w: number;
}

export interface CaptionLayout {
  /** The font the words were measured with: draw with the same one. */
  font: string;
  words: PlacedWord[];
  /** Size of the block (its widest line, and all lines at the layer's line height). */
  width: number;
  height: number;
}

type LayoutSettings = Pick<CaptionsLayer, "maxWidth" | "size" | "lineHeight" | "uppercase">;

/**
 * Lays one page of words out in centred lines no wider than `layer.maxWidth` (a single word wider than
 * that still gets a line of its own rather than being cut). `measure` returns the width of a text in
 * `fontString`; it is injected so the layout can be tested without a canvas.
 */
export function layoutCaptions(
  measure: (text: string) => number,
  layer: LayoutSettings,
  fontString: string,
  words: readonly string[],
): CaptionLayout {
  const labels = words.map((w) => (layer.uppercase ? w.toUpperCase() : w));
  const widths = labels.map(measure);
  const space = measure(" ");

  const lines: { first: number; last: number; w: number }[] = [];
  let first = 0;
  let lineW = 0;
  widths.forEach((w, i) => {
    const next = i === first ? w : lineW + space + w;
    if (i > first && next > layer.maxWidth) {
      lines.push({ first, last: i - 1, w: lineW });
      first = i;
      lineW = w;
    } else lineW = next;
  });
  if (labels.length > 0) lines.push({ first, last: labels.length - 1, w: lineW });

  const pitch = layer.size * layer.lineHeight;
  const height = lines.length * pitch;
  const placed: PlacedWord[] = [];
  lines.forEach((line, li) => {
    const y = -height / 2 + (li + 0.5) * pitch;
    let left = -line.w / 2;
    for (let i = line.first; i <= line.last; i++) {
      placed.push({ text: labels[i], x: left + widths[i] / 2, y, w: widths[i] });
      left += widths[i] + space;
    }
  });
  return { font: fontString, words: placed, width: lines.reduce((m, l) => Math.max(m, l.w), 0), height };
}

// ---------- generating a layer ----------

/**
 * A captions layer for a scene's narration, or null when there is no narration. The defaults come from the
 * sanitizer itself (by normalizing a bare captions layer), so the layer is exactly what a reload would
 * give it and the two can't drift apart. The scene is not touched.
 */
export function generateCaptionLayer(scene: MotionScene, ratio: AspectRatio, opts: { style?: CaptionStyle } = {}): CaptionsLayer | null {
  const text = scene.voiceOver.trim();
  if (!text) return null;
  const raw = { duration: scene.duration, layers: [{ type: "captions", text, style: opts.style, start: 0.1 }] };
  const layer = normalizeScene(raw, 0, ratio, false).layers.find((l): l is CaptionsLayer => l.type === "captions");
  if (!layer) return null;

  // Layer ids are only unique within a scene: take the first free "captions", "captions2", "captions3"…
  const taken = new Set(scene.layers.map((l) => l.id));
  let id = "captions";
  for (let n = 2; taken.has(id); n++) id = `captions${n}`;
  return { ...layer, id };
}

// ---------- drawing ----------

/** After the last word the last page stays, then fades out. */
const HOLD = 0.3;
const FADE = 0.2;
/** A word pops in over this long. */
const POP_SECONDS = 0.18;
const BOX_PADDING = 0.18;
const BOX_RADIUS = 0.25;
const OUTLINE_WIDTH = 0.14;
const OUTLINE_COLOR = "#000000";

interface Page {
  /** Index of the page's first word among all the words. */
  first: number;
  words: CaptionWord[];
  layout: CaptionLayout;
}

interface Prepared {
  key: string;
  words: CaptionWord[];
  pages: Page[];
  /** Page number of every word. */
  pageOf: number[];
}

const cache = new WeakMap<CaptionsLayer, Prepared>();

function captionFont(layer: CaptionsLayer, fonts: FontStacks): string {
  // The display face only ships a regular weight; asking for bold would be synthesized and smudge it.
  const weight = layer.font === "display" ? 400 : Math.round(layer.weight / 100) * 100;
  return `${weight} ${layer.size}px ${fonts[layer.font]}`;
}

/** Times, pages and layouts of a layer; computed once and reused while nothing they depend on changes. */
function prepare(ctx: CanvasRenderingContext2D, layer: CaptionsLayer, font: string, from: number, to: number): Prepared {
  // `font` carries the family, weight and size.
  const key = JSON.stringify([font, layer.text, layer.maxWidth, layer.lineHeight, layer.uppercase, layer.style, from, to]);
  const cached = cache.get(layer);
  if (cached && cached.key === key) return cached;

  const words = captionTimings(layer.text, from, to);
  const pages: Page[] = [];
  const pageOf: number[] = [];
  ctx.save();
  ctx.font = font;
  const measure = (s: string) => ctx.measureText(s).width;
  let first = 0;
  for (const chunk of paginate(words)) {
    for (let i = 0; i < chunk.length; i++) pageOf.push(pages.length);
    pages.push({ first, words: chunk, layout: layoutCaptions(measure, layer, font, chunk.map((w) => w.text)) });
    first += chunk.length;
  }
  ctx.restore();

  const prepared = { key, words, pages, pageOf };
  cache.set(layer, prepared);
  return prepared;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** How a canvas reads a colour back: "#rrggbb", or "rgba(r, g, b, a)" when it is translucent. */
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*[,)]/i;

/** Black or white, whichever reads better on `background` (black when the colour can't be parsed). */
function contrastColor(background: string): string {
  const css = background.trim();
  const hex = HEX.exec(css);
  let channels: number[] | null = null;
  if (hex) {
    const digits = hex[1].length <= 4 ? hex[1].replace(/./g, "$&$&") : hex[1];
    channels = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
  } else {
    const rgb = RGB.exec(css);
    if (rgb) channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  if (!channels) return "#000000";
  const [r, g, b] = channels.map((v) => {
    const c = Math.min(255, v) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  // Past this luminance black text has the higher contrast ratio than white.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}

/**
 * The text colour for the active word on the box. The sanitizer lets names, rgb() and hsl() through as well as
 * hex, and only the canvas knows what they are: it reads any valid colour back as "#rrggbb" / "rgba(...)", and
 * ignores an invalid one, so what it reads back is exactly the colour the box is painted with.
 */
function boxTextColor(ctx: CanvasRenderingContext2D, highlight: string): string {
  ctx.save();
  ctx.fillStyle = highlight;
  const painted = ctx.fillStyle;
  ctx.restore();
  return contrastColor(typeof painted === "string" ? painted : "");
}

/**
 * Draws animated subtitles. `t` is the scene-local time; `sceneDuration` bounds layers that have no explicit
 * end. The origin is the layer's anchor and the block of text is centred on it. Only the page holding the
 * word being said is shown; once the last word is said it stays for HOLD seconds, then fades over FADE.
 */
export function drawCaptions(ctx: CanvasRenderingContext2D, layer: CaptionsLayer, t: number, fonts: FontStacks, sceneDuration: number): void {
  const from = layer.start;
  // The scene is the hard limit: a layer that claims to end after it (the sanitizer allows it) must not spread
  // its words over time that is never played.
  const to = Math.min(layer.end ?? sceneDuration, sceneDuration);
  if (!(to > from)) return;
  const over = t - to;
  const alpha = over <= HOLD ? 1 : 1 - (over - HOLD) / FADE;
  if (alpha <= 0) return;

  const prepared = prepare(ctx, layer, captionFont(layer, fonts), from, to);
  const current = activeWordIndex(prepared.words, t);
  if (current < 0) return;
  const page = prepared.pages[prepared.pageOf[current]];
  const active = current - page.first;
  const { size, style } = layer;
  // On a box the highlight colour is the box, so the word needs a colour of its own.
  const activeColor = style === "box" ? boxTextColor(ctx, layer.highlight) : layer.highlight;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = page.layout.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style === "outline") {
    ctx.lineJoin = "round";
    ctx.lineWidth = size * OUTLINE_WIDTH;
    ctx.strokeStyle = OUTLINE_COLOR;
  }

  for (let j = 0; j < page.layout.words.length; j++) {
    // Pop shows a word only from the moment it is said.
    if (style === "pop" && j > active) break;
    const word = page.layout.words[j];
    const isActive = j === active;

    ctx.save();
    ctx.translate(word.x, word.y);
    if (style === "pop") {
      const p = (t - page.words[j].start) / POP_SECONDS;
      const s = ease("backOut", p);
      ctx.scale(s, s);
      ctx.globalAlpha *= ease("easeOut", p);
    }
    if (style === "box" && isActive) {
      const pad = size * BOX_PADDING;
      ctx.fillStyle = layer.highlight;
      ctx.beginPath();
      ctx.roundRect(-word.w / 2 - pad, -size / 2 - pad, word.w + 2 * pad, size + 2 * pad, size * BOX_RADIUS);
      ctx.fill();
    }
    // The stroke goes under the fill: a stroke is centred on the glyph edge and would eat into the letters.
    if (style === "outline") ctx.strokeText(word.text, 0, 0);
    ctx.fillStyle = isActive ? activeColor : layer.color;
    ctx.fillText(word.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
