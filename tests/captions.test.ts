import assert from "node:assert/strict";
import { activeWordIndex, captionTimings, drawCaptions, generateCaptionLayer, layoutCaptions, paginate, type CaptionWord } from "../src/lib/motion/captions";
import { ease } from "../src/lib/motion/easing";
import type { FontStacks } from "../src/lib/motion/render";
import { normalizeScene } from "../src/lib/motion/sanitize";
import { CAPTION_STYLES, FRAMES, type AspectRatio, type CaptionsLayer, type MotionScene } from "../src/lib/motion/types";

let n = 0, failed = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; console.log("  ok -", name); } catch (e) { failed++; console.log("  FAIL -", name, "\n       ", (e as Error).message.replace(/\s+/g, " ").slice(0, 300)); } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const close = (a: number, b: number, msg?: string, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? "close"}: ${a} vs ${b}`);

// ---------- a recording stand-in for CanvasRenderingContext2D ----------

interface State {
  font: string; fillStyle: string; strokeStyle: string; globalAlpha: number; lineWidth: number; lineJoin: string; textAlign: string; textBaseline: string;
  /** Accumulated translate/scale (the drawing code only uses those two). */
  sx: number; sy: number; tx: number; ty: number;
}
interface Call {
  op: "fillText" | "strokeText" | "roundRect";
  text: string;
  /** Position in layer space, i.e. with the translations applied. */
  x: number; y: number; w: number; h: number; r: number;
  /** Accumulated scale when the call happened. */
  scale: number;
  fillStyle: string; strokeStyle: string; alpha: number; font: string; lineWidth: number; lineJoin: string; textAlign: string; textBaseline: string;
}

class FakeCtx {
  s: State = { font: "10px initial", fillStyle: "#010203", strokeStyle: "#040506", globalAlpha: 1, lineWidth: 1, lineJoin: "miter", textAlign: "start", textBaseline: "alphabetic", sx: 1, sy: 1, tx: 0, ty: 0 };
  stack: State[] = [];
  calls: Call[] = [];
  measures = 0;
  private path: { x: number; y: number; w: number; h: number; r: number } | null = null;

  get font() { return this.s.font; } set font(v: string) { this.s.font = v; }
  get fillStyle() { return this.s.fillStyle; } set fillStyle(v: string) { this.s.fillStyle = v; }
  get strokeStyle() { return this.s.strokeStyle; } set strokeStyle(v: string) { this.s.strokeStyle = v; }
  get globalAlpha() { return this.s.globalAlpha; } set globalAlpha(v: number) { this.s.globalAlpha = v; }
  get lineWidth() { return this.s.lineWidth; } set lineWidth(v: number) { this.s.lineWidth = v; }
  get lineJoin() { return this.s.lineJoin; } set lineJoin(v: string) { this.s.lineJoin = v; }
  get textAlign() { return this.s.textAlign; } set textAlign(v: string) { this.s.textAlign = v; }
  get textBaseline() { return this.s.textBaseline; } set textBaseline(v: string) { this.s.textBaseline = v; }

  save() { this.stack.push({ ...this.s }); }
  restore() { const p = this.stack.pop(); if (!p) throw new Error("restore() without save()"); this.s = p; }
  translate(x: number, y: number) { this.s.tx += this.s.sx * x; this.s.ty += this.s.sy * y; }
  scale(x: number, y: number) { assert.equal(x, y, "uniform scale only"); this.s.sx *= x; this.s.sy *= y; }
  measureText(text: string) {
    this.measures++;
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.s.font)?.[1]);
    assert.ok(Number.isFinite(size), `measuring without a usable font: ${this.s.font}`);
    return { width: text.length * size * 0.5 };
  }
  beginPath() { this.path = null; }
  roundRect(x: number, y: number, w: number, h: number, r: number) { this.path = { x: this.s.tx + this.s.sx * x, y: this.s.ty + this.s.sy * y, w: w * this.s.sx, h: h * this.s.sy, r: r * this.s.sx }; }
  fill() { if (this.path) this.record("roundRect", "", this.path.x, this.path.y, this.path.w, this.path.h, this.path.r); }
  fillText(text: string, x: number, y: number) { this.record("fillText", text, this.s.tx + this.s.sx * x, this.s.ty + this.s.sy * y); }
  strokeText(text: string, x: number, y: number) { this.record("strokeText", text, this.s.tx + this.s.sx * x, this.s.ty + this.s.sy * y); }
  private record(op: Call["op"], text: string, x: number, y: number, w = 0, h = 0, r = 0) {
    const s = this.s;
    this.calls.push({ op, text, x, y, w, h, r, scale: s.sx, fillStyle: s.fillStyle, strokeStyle: s.strokeStyle, alpha: s.globalAlpha, font: s.font, lineWidth: s.lineWidth, lineJoin: s.lineJoin, textAlign: s.textAlign, textBaseline: s.textBaseline });
  }
}

const fonts: FontStacks = { sans: "SANS", serif: "SERIF", mono: "MONO", display: "DISP" };

/** Eight 4-letter words = equal weights: with a 8 s scene, word i is said during [i, i+1) and pages are [a-d] [e-h]. */
const layer = (over: Partial<CaptionsLayer> = {}): CaptionsLayer => ({
  id: "captions", type: "captions", start: 0, end: null, x: 960, y: 864, rotation: 0, scale: 1, opacity: 1,
  text: "aaaa bbbb cccc dddd eeee ffff gggg hhhh", style: "karaoke", size: 60, weight: 800, font: "sans",
  color: "#ffffff", highlight: "#fbbf24", uppercase: false, maxWidth: 1536, lineHeight: 1.25, ...over,
});
const DUR = 8;
const WHITE = "#ffffff", AMBER = "#fbbf24";

function draw(l: CaptionsLayer, time: number, duration = DUR, baseAlpha = 1): FakeCtx {
  const c = new FakeCtx();
  c.globalAlpha = baseAlpha;
  drawCaptions(c as unknown as CanvasRenderingContext2D, l, time, fonts, duration);
  assert.equal(c.stack.length, 0, "every save() has its restore()");
  return c;
}
const fills = (c: FakeCtx) => c.calls.filter((k) => k.op === "fillText");
const strokes = (c: FakeCtx) => c.calls.filter((k) => k.op === "strokeText");
const boxes = (c: FakeCtx) => c.calls.filter((k) => k.op === "roundRect");
const shown = (c: FakeCtx) => fills(c).map((k) => `${k.text}:${k.fillStyle}`);

// A deterministic generator, so a failing random case can be replayed.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const VOCAB = ["a", "je", "oui", "bonjour", "éléphant", "l'été", "🔥", "3,5", "!", "?", "«", "»", "...", "—", "Hello,", "fin.", "(ok)", "x;", "y:", "ÇA", "naïve…", "été"];
const SEPARATORS = [" ", "\n", " ", "\t  ", " ", "  "];
function randomText(r: () => number, maxTokens = 60) {
  let out = "";
  for (let i = Math.floor(r() * maxTokens) + 1; i > 0; i--) out += VOCAB[Math.floor(r() * VOCAB.length)] + SEPARATORS[Math.floor(r() * SEPARATORS.length)];
  return out;
}

const timed = (text: string, from = 0, to = 10) => captionTimings(text, from, to);
const texts = (words: CaptionWord[]) => words.map((w) => w.text);

console.log("captionTimings");
t("words are spread in proportion to their length", () => {
  const w = timed("a bbbb", 0, 5);
  assert.deepEqual(w, [{ text: "a", start: 0, end: 1 }, { text: "bbbb", start: 1, end: 5 }]);
});
t("a sentence end adds a pause worth 4 letters, a comma or ; : worth 2", () => {
  assert.deepEqual(timed("Un. Deux", 0, 10), [{ text: "Un.", start: 0, end: 6 }, { text: "Deux", start: 6, end: 10 }]);
  assert.deepEqual(timed("Oui, non", 0, 8), [{ text: "Oui,", start: 0, end: 5 }, { text: "non", start: 5, end: 8 }]);
  // "ab?" weighs 2 + 4 = 6 and "cd" 2: a window of 8 s makes a weight unit one second.
  for (const mark of ["?", "!", "…", "."]) assert.equal(timed(`ab${mark} cd`, 0, 8)[0].end, 6, `ab${mark}`);
  for (const mark of [";", ":"]) assert.equal(timed(`ab${mark} cd`, 0, 6)[0].end, 4, `ab${mark}`);
});
t("a closing quote or bracket after the stop doesn't hide the pause", () => {
  assert.equal(timed("ab.) cd", 0, 8)[0].end, 6);
  assert.equal(timed('ab." cd', 0, 8)[0].end, 6);
  assert.equal(timed("ab.» cd", 0, 8)[0].end, 6);
  assert.equal(timed("ab,) cd", 0, 6)[0].end, 4);
  assert.equal(timed("ab) cd", 0, 4)[0].end, 2, "no stop, no pause");
});
t("punctuation inside a word is not a pause (3.5, l'été, peut-être)", () => {
  assert.equal(timed("3.5 aa", 0, 4)[0].end, 2, "3.5 = 2 digits, no pause");
  assert.equal(timed("l'été aaaa", 0, 8)[0].end, 4, "l'été = 4 letters");
  assert.equal(timed("peut-être aaaa", 0, 12)[0].end, 8, "peut-être = 8 letters");
});
t("French typography: a lone ? ! : or guillemet sticks to its neighbour instead of being a word", () => {
  assert.deepEqual(texts(timed("Vraiment ? Oui !")), ["Vraiment?", "Oui!"]);
  assert.deepEqual(texts(timed("Vraiment ? Oui !")), ["Vraiment?", "Oui!"]);
  assert.deepEqual(texts(timed("Il dit « Stop. » puis part")), ["Il", "dit", "«Stop.»", "puis", "part"]);
  assert.deepEqual(texts(timed("( ok )")), ["(ok)"]);
  assert.deepEqual(texts(timed('" Bonjour "')), ['"Bonjour"']);
  assert.deepEqual(texts(timed("— Bonjour")), ["—Bonjour"]);
  assert.deepEqual(texts(timed("Voilà ...")), ["Voilà..."]);
  assert.deepEqual(texts(timed("50 % de remise")), ["50%", "de", "remise"]);
  assert.deepEqual(texts(timed("Il est là — enfin")), ["Il", "est", "là—", "enfin"]);
  assert.equal(timed("Oui ! Non", 0, 100)[0].end - 0, 100 * 7 / 10, "the stuck mark keeps the sentence pause: Oui! = 3 + 4 of 10");
});
t("punctuation-only text is one word, never nothing", () => {
  assert.deepEqual(texts(timed("...")), ["..."]);
  assert.deepEqual(texts(timed("« »")), ["«»"]);
  assert.deepEqual(texts(timed("- - -")), ["---"]);
});
t("empty, whitespace-only text or an empty/invalid window gives no words", () => {
  assert.deepEqual(timed("", 0, 5), []);
  assert.deepEqual(timed("  \n\t  ", 0, 5), []);
  assert.deepEqual(timed("a", 5, 5), []);
  assert.deepEqual(timed("a", 5, 4), []);
  for (const [from, to] of [[NaN, 1], [0, NaN], [0, Infinity], [-Infinity, 0], [-1e308, 1e308]]) assert.deepEqual(timed("a b", from, to), [], `${from}..${to}`);
});
t("one word gets the whole window", () => {
  assert.deepEqual(timed("seul", 2, 3.5), [{ text: "seul", start: 2, end: 3.5 }]);
});
t("emoji and symbols weigh like a letter and are never skipped", () => {
  const w = timed("🔥 Super 👍", 0, 7);
  assert.deepEqual(texts(w), ["🔥", "Super", "👍"]);
  assert.deepEqual(w.map((x) => x.end - x.start), [1, 5, 1]);
  assert.deepEqual(texts(timed("Tom & Jerry")), ["Tom", "&", "Jerry"], "a symbol between words is a word");
  assert.deepEqual(texts(timed("a + b / c")), ["a", "+", "b", "/", "c"]);
  assert.deepEqual(timed("a + b", 0, 3).map((x) => x.end - x.start), [1, 1, 1], "and weighs at least one letter");
});
t("accented French: letters count once, composed or decomposed", () => {
  const w = timed("Éléphant énorme à Paris, c'est l'été.", 0, 100);
  assert.equal(w.length, 6);
  w.forEach((x) => assert.ok(x.end > x.start && Number.isFinite(x.end)));
  assert.deepEqual(timed("été", 0, 3), timed("été", 0, 3).map((x) => ({ ...x, text: "été" })), "e + combining accent weighs the same as é");
});
t("newlines and runs of any whitespace separate words", () => {
  assert.deepEqual(texts(timed("a\nb\r\n\tc   d e")), ["a", "b", "c", "d", "e"]);
});
t("a word never contains whitespace", () => {
  const r = rng(7);
  for (let i = 0; i < 100; i++) for (const w of timed(randomText(r))) assert.ok(!/\s/.test(w.text), JSON.stringify(w.text));
});
t("ordinary text survives: the words rejoined are the text", () => {
  assert.equal(texts(timed("  Bonjour   tout\nle monde.  ")).join(" "), "Bonjour tout le monde.");
});
t("random texts and windows: contiguous, monotonic, exactly covering [from, to], never NaN or negative", () => {
  const r = rng(42);
  for (let i = 0; i < 400; i++) {
    const from = r() < 0.3 ? 0 : r() * 50;
    const to = from + (r() < 0.2 ? 1e-7 : 0.001 + r() * 40);
    const w = timed(randomText(r, 200), from, to);
    assert.ok(w.length > 0);
    assert.equal(w[0].start, from);
    assert.equal(w[w.length - 1].end, to);
    for (let k = 0; k < w.length; k++) {
      assert.ok(Number.isFinite(w[k].start) && Number.isFinite(w[k].end), "finite");
      assert.ok(w[k].end >= w[k].start, `no negative duration at ${k}`);
      if (k > 0) assert.equal(w[k].start, w[k - 1].end, `contiguous at ${k}`);
      assert.ok(w[k].end <= to && w[k].start >= from);
    }
  }
});
t("a vanishing window with many words still gives non-negative durations", () => {
  const w = timed("mot ".repeat(1000), 1, 1 + 1e-12);
  assert.equal(w.length, 1000);
  for (let k = 0; k < w.length; k++) assert.ok(w[k].end >= w[k].start && !Number.isNaN(w[k].end));
  assert.equal(w[999].end, 1 + 1e-12);
});
t("frame-grid windows (0.1 to 5.3, 1/30 steps) cover exactly, with no float residue at the ends", () => {
  for (const [from, to] of [[0.1, 5.3], [0.1, 0.3], [1 / 30, 7 / 30], [0.1, 40], [2.7, 2.7 + 1e-15]]) {
    const w = timed("Salut tout le monde, voici une phrase un peu plus longue. Et une autre ?", from, to);
    assert.equal(w[0].start, from);
    assert.equal(w[w.length - 1].end, to);
    w.forEach((x) => assert.ok(x.end >= x.start));
  }
});
t("a huge text (50 000 words) is timed in one pass", () => {
  const w = timed("mot, autre. ".repeat(25000), 0.1, 3600);
  assert.equal(w.length, 50000);
  assert.equal(w[49999].end, 3600);
  assert.equal(activeWordIndex(w, 1800) >= 0, true);
});

console.log("activeWordIndex");
t("-1 before the first word, then the word being said, the last once they are all said", () => {
  const w = timed("aaaa bbbb cccc dddd", 1, 5); // one second each
  assert.equal(activeWordIndex(w, 0), -1);
  assert.equal(activeWordIndex(w, 0.999), -1);
  assert.equal(activeWordIndex(w, 1), 0, "a word starts exactly at its start");
  assert.equal(activeWordIndex(w, 1.999), 0);
  assert.equal(activeWordIndex(w, 2), 1, "and the previous one ends where it starts");
  assert.equal(activeWordIndex(w, 4.5), 3);
  assert.equal(activeWordIndex(w, 5), 3);
  assert.equal(activeWordIndex(w, 1e9), 3);
});
t("edge cases: no words, one word, NaN", () => {
  assert.equal(activeWordIndex([], 3), -1);
  const one = timed("seul", 0, 1);
  assert.deepEqual([-0.5, 0, 9].map((time) => activeWordIndex(one, time)), [-1, 0, 0]);
  assert.equal(activeWordIndex(one, NaN), -1);
});
t("agrees with a linear scan on random timings", () => {
  const r = rng(5);
  for (let i = 0; i < 200; i++) {
    const w = timed(randomText(r, 80), 0.1, 0.1 + 0.5 + r() * 20);
    for (let k = 0; k < 20; k++) {
      const time = -1 + r() * 25;
      let expected = -1;
      w.forEach((x, idx) => { if (x.start <= time) expected = idx; });
      assert.equal(activeWordIndex(w, time), expected);
    }
  }
});

console.log("paginate");
const words = (text: string) => timed(text, 0, 100);
t("pages hold at most 4 words by default, at most N when asked", () => {
  const w = words("a b c d e f g h i j");
  assert.deepEqual(paginate(w).map((p) => p.length), [4, 4, 2]);
  assert.deepEqual(paginate(w, 3).map((p) => p.length), [3, 3, 3, 1]);
  assert.deepEqual(paginate(w, 1).map((p) => p.length), Array(10).fill(1));
  assert.deepEqual(paginate(w, 99).map((p) => p.length), [10]);
});
t("a page ends early at a sentence end once it has 2 words", () => {
  assert.deepEqual(paginate(words("Un deux. Trois quatre cinq six sept")).map(texts), [["Un", "deux."], ["Trois", "quatre", "cinq", "six"], ["sept"]]);
  assert.deepEqual(paginate(words("a b c? d e f")).map(texts), [["a", "b", "c?"], ["d", "e", "f"]]);
  assert.deepEqual(paginate(words("Quoi ! Oui !? Non")).map(texts), [["Quoi!", "Oui!?"], ["Non"]], "! and ?! end sentences too");
});
t("a page with a single word doesn't end at a sentence end (no one-word flashes)", () => {
  assert.deepEqual(paginate(words("Oui. Non. Peut-être. Bon")).map(texts), [["Oui.", "Non."], ["Peut-être.", "Bon"]]);
});
t("commas, colons and abbreviations-with-no-stop don't end a page", () => {
  assert.deepEqual(paginate(words("a, b, c; d: e")).map((p) => p.length), [4, 1]);
});
t("every word lands on exactly one page, in order, by reference; pages are never empty", () => {
  const r = rng(11);
  for (let i = 0; i < 200; i++) {
    const w = timed(randomText(r, 100), 0, 60);
    const max = 1 + Math.floor(r() * 6);
    const pages = paginate(w, max);
    assert.ok(pages.every((p) => p.length >= 1 && p.length <= max));
    const flat = pages.flat();
    assert.equal(flat.length, w.length);
    flat.forEach((x, k) => assert.equal(x, w[k]));
    pages.slice(0, -1).forEach((p) => assert.ok(p.length === max || p.length >= 2, "a short page is a sentence page"));
  }
});
t("bad page sizes fall back sensibly", () => {
  const w = words("a b c d e f g h");
  assert.deepEqual(paginate(w, 0).map((p) => p.length), Array(8).fill(1), "0 -> 1");
  assert.deepEqual(paginate(w, -5).map((p) => p.length), Array(8).fill(1), "negative -> 1");
  assert.deepEqual(paginate(w, 2.9).map((p) => p.length), [2, 2, 2, 2], "fraction -> floor");
  assert.deepEqual(paginate(w, NaN).map((p) => p.length), [4, 4], "NaN -> default");
  assert.deepEqual(paginate(w, Infinity).map((p) => p.length), [8], "Infinity -> no limit");
});
t("no words, no pages; the input is not mutated", () => {
  assert.deepEqual(paginate([]), []);
  const w = Object.freeze(words("a b c d e").map((x) => Object.freeze(x)));
  assert.equal(paginate(w).length, 2);
});

console.log("layoutCaptions");
const ten = (s: string) => s.length * 10;
const L = (over: Partial<CaptionsLayer> = {}) => ({ maxWidth: 100, size: 20, lineHeight: 1.5, uppercase: false, ...over });
t("wraps greedily, centres each line, centres the block", () => {
  const lay = layoutCaptions(ten, L(), "FONT", ["aaaa", "bbbb", "cccc"]);
  assert.equal(lay.font, "FONT");
  assert.deepEqual(lay.words, [
    { text: "aaaa", x: -25, y: -15, w: 40 },
    { text: "bbbb", x: 25, y: -15, w: 40 },
    { text: "cccc", x: 0, y: 15, w: 40 },
  ]);
  assert.equal(lay.width, 90);
  assert.equal(lay.height, 60, "2 lines of size * lineHeight");
});
t("a line may be exactly maxWidth wide, not wider", () => {
  assert.equal(new Set(layoutCaptions(ten, L({ maxWidth: 90 }), "F", ["aaaa", "bbbb"]).words.map((w) => w.y)).size, 1);
  assert.equal(new Set(layoutCaptions(ten, L({ maxWidth: 89 }), "F", ["aaaa", "bbbb"]).words.map((w) => w.y)).size, 2);
});
t("a word wider than maxWidth keeps a line of its own (not cut) and the block grows to it", () => {
  const lay = layoutCaptions(ten, L({ maxWidth: 50 }), "F", ["abcdefghijkl", "ab", "cd"]);
  // "ab cd" is exactly 50 wide and fits on the second line.
  assert.deepEqual(lay.words.map((w) => [w.text, w.y]), [["abcdefghijkl", -15], ["ab", 15], ["cd", 15]]);
  assert.equal(lay.width, 120);
  assert.equal(lay.words[0].x, 0);
});
t("uppercase is applied before measuring, and the placed text is what to draw", () => {
  const wide = (s: string) => [...s].reduce((w, ch) => w + (ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 15 : 10), 0);
  const lower = layoutCaptions(wide, L({ maxWidth: 1000 }), "F", ["aaaa", "ça"]);
  const upper = layoutCaptions(wide, L({ maxWidth: 1000, uppercase: true }), "F", ["aaaa", "ça"]);
  assert.deepEqual(upper.words.map((w) => w.text), ["AAAA", "ÇA"]);
  assert.deepEqual(upper.words.map((w) => w.w), [60, 30]);
  assert.deepEqual(lower.words.map((w) => w.w), [40, 20]);
  assert.equal(layoutCaptions(ten, L({ uppercase: true }), "F", ["straße"]).words[0].text, "STRASSE");
});
t("no words: an empty block", () => {
  assert.deepEqual(layoutCaptions(ten, L(), "F", []), { font: "F", words: [], width: 0, height: 0 });
});
t("a single word is centred on the origin", () => {
  const lay = layoutCaptions(ten, L(), "F", ["seul"]);
  assert.deepEqual(lay.words, [{ text: "seul", x: 0, y: 0, w: 40 }]);
});
t("random pages: lines never exceed maxWidth (but for a lone long word), each line and the block are centred, order is kept", () => {
  const r = rng(3);
  for (let i = 0; i < 300; i++) {
    const count = 1 + Math.floor(r() * 9);
    const ws = Array.from({ length: count }, () => "x".repeat(1 + Math.floor(r() * 12)));
    const layer = L({ maxWidth: 30 + r() * 250, size: 10 + r() * 80, lineHeight: 0.9 + r() * 1.1 });
    const lay = layoutCaptions(ten, layer, "F", ws);
    assert.deepEqual(lay.words.map((w) => w.text), ws);
    const rows = new Map<number, typeof lay.words>();
    for (const w of lay.words) rows.set(w.y, [...(rows.get(w.y) ?? []), w]);
    let widest = 0;
    for (const row of rows.values()) {
      const left = Math.min(...row.map((w) => w.x - w.w / 2));
      const right = Math.max(...row.map((w) => w.x + w.w / 2));
      close(left, -right, "line is centred", 1e-9);
      if (row.length > 1) assert.ok(right - left <= layer.maxWidth + 1e-9, "wrapped line fits");
      for (let k = 1; k < row.length; k++) assert.ok(row[k].x - row[k].w / 2 >= row[k - 1].x + row[k - 1].w / 2, "words don't overlap");
      widest = Math.max(widest, right - left);
    }
    close(lay.width, widest, "block width = widest line");
    close(lay.height, rows.size * layer.size * layer.lineHeight, "block height");
    const ys = [...rows.keys()];
    close(ys[0], -ys[ys.length - 1], "block is vertically centred");
  }
});
t("inputs are not mutated", () => {
  const layer = Object.freeze(L());
  const ws = Object.freeze(["aaaa", "bbbb", "cccc"]);
  layoutCaptions(ten, layer, "F", ws);
});

console.log("generateCaptionLayer");
const sceneWith = (voiceOver: string, over: Partial<MotionScene> = {}): MotionScene =>
  ({ ...normalizeScene({ duration: 6, voiceOver, layers: [{ type: "rect" }, { type: "text", text: "Titre" }] }, 0, "16:9", false), ...over });
t("null when the scene has no narration", () => {
  assert.equal(generateCaptionLayer(sceneWith(""), "16:9"), null);
  assert.equal(generateCaptionLayer(sceneWith("  \n\t "), "16:9"), null);
});
t("builds a full-length karaoke layer from the narration with the documented defaults (16:9)", () => {
  const { width: W, height: H } = FRAMES["16:9"];
  const l = generateCaptionLayer(sceneWith("Bonjour tout le monde."), "16:9");
  assert.ok(l);
  assert.deepEqual(clone(l), {
    id: "captions", type: "captions", start: 0.1, end: null, x: W / 2, y: H * 0.8, rotation: 0, scale: 1, opacity: 1,
    text: "Bonjour tout le monde.", style: "karaoke", size: 60, weight: 800, font: "sans", color: "#ffffff", highlight: "#fbbf24",
    uppercase: false, maxWidth: W * 0.8, lineHeight: 1.25,
  });
});
t("9:16 gets the portrait defaults", () => {
  const { width: W, height: H } = FRAMES["9:16"];
  const l = generateCaptionLayer(sceneWith("Salut"), "9:16");
  assert.ok(l);
  assert.deepEqual([l.x, l.y, l.size, l.maxWidth], [W / 2, H * 0.72, 64, W * 0.8]);
});
t("the defaults are the sanitizer's own (nothing added, nothing forgotten)", () => {
  for (const ratio of ["16:9", "9:16"] as AspectRatio[]) {
    const bare = normalizeScene({ duration: 6, layers: [{ type: "captions", text: "x" }] }, 0, ratio, false).layers[0];
    const l = generateCaptionLayer(sceneWith("x"), ratio);
    assert.deepEqual({ ...l, id: "", start: 0 }, { ...bare, id: "", start: 0 }, ratio);
  }
});
t("the narration is trimmed; the layer survives a reload through the sanitizer unchanged", () => {
  for (const ratio of ["16:9", "9:16"] as AspectRatio[]) {
    const s = sceneWith("  Bonjour à tous, voici « le test » !\n", {});
    const l = generateCaptionLayer(s, ratio);
    assert.ok(l);
    assert.equal(l.text, "Bonjour à tous, voici « le test » !");
    const back = normalizeScene({ ...s, layers: [l] }, 0, ratio, true).layers[0];
    assert.deepEqual({ ...back, id: l.id }, l, ratio);
  }
});
t("opts.style picks the style; every style is accepted; an unknown one falls back to karaoke", () => {
  for (const style of CAPTION_STYLES) assert.equal(generateCaptionLayer(sceneWith("x"), "16:9", { style })?.style, style);
  assert.equal(generateCaptionLayer(sceneWith("x"), "16:9", {})?.style, "karaoke");
  assert.equal(generateCaptionLayer(sceneWith("x"), "16:9", { style: "nope" as never })?.style, "karaoke");
});
t("the id is unique in the scene: captions, captions2, captions3…", () => {
  const base = sceneWith("Salut");
  const withIds = (...ids: string[]) => ({ ...base, layers: ids.map((id) => ({ ...base.layers[0], id })) });
  assert.equal(generateCaptionLayer(base, "16:9")?.id, "captions");
  assert.equal(generateCaptionLayer(withIds("captions"), "16:9")?.id, "captions2");
  assert.equal(generateCaptionLayer(withIds("captions", "captions2"), "16:9")?.id, "captions3");
  assert.equal(generateCaptionLayer(withIds("captions", "captions3"), "16:9")?.id, "captions2", "takes the first free one");
  assert.equal(generateCaptionLayer(withIds("captions2"), "16:9")?.id, "captions", "captions2 alone doesn't block captions");
});
t("the scene is not mutated", () => {
  const s = sceneWith("Bonjour tout le monde.");
  const before = clone(s);
  const layersBefore = s.layers;
  const l = generateCaptionLayer(s, "9:16", { style: "box" });
  assert.deepEqual(clone(s), before);
  assert.equal(s.layers, layersBefore);
  assert.ok(l && !s.layers.includes(l));
});
t("two calls give two independent layers", () => {
  const s = sceneWith("Salut");
  const a = generateCaptionLayer(s, "16:9");
  const b = generateCaptionLayer(s, "16:9");
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
});
t("the generated layer plays: its words show up in the scene", () => {
  const l = generateCaptionLayer(sceneWith("Bonjour tout le monde."), "16:9");
  assert.ok(l);
  assert.ok(shown(draw(l, 3, 6)).length > 0);
  assert.equal(draw(l, 0.05, 6).calls.length, 0, "starts at 0.1");
});

console.log("drawCaptions: karaoke");
t("every word of the page is visible, the active one in the highlight colour", () => {
  assert.deepEqual(shown(draw(layer(), 0.5)), [`aaaa:${AMBER}`, `bbbb:${WHITE}`, `cccc:${WHITE}`, `dddd:${WHITE}`]);
  assert.deepEqual(shown(draw(layer(), 2.5)), [`aaaa:${WHITE}`, `bbbb:${WHITE}`, `cccc:${AMBER}`, `dddd:${WHITE}`]);
  assert.deepEqual(shown(draw(layer(), 3.999)), [`aaaa:${WHITE}`, `bbbb:${WHITE}`, `cccc:${WHITE}`, `dddd:${AMBER}`]);
});
t("only the page with the current word is shown: it turns when its first word is said", () => {
  assert.deepEqual(shown(draw(layer(), 4)), [`eeee:${AMBER}`, `ffff:${WHITE}`, `gggg:${WHITE}`, `hhhh:${WHITE}`]);
  assert.deepEqual(shown(draw(layer(), 6.2)), [`eeee:${WHITE}`, `ffff:${WHITE}`, `gggg:${AMBER}`, `hhhh:${WHITE}`]);
});
t("words sit on one line, side by side, centred on the origin, in the right font", () => {
  const c = draw(layer(), 0.5);
  // 4 letters at 60 px = 120 wide, a space = 30 wide.
  assert.deepEqual(fills(c).map((k) => [k.x, k.y]), [[-225, 0], [-75, 0], [75, 0], [225, 0]]);
  for (const k of c.calls) {
    assert.equal(k.font, "800 60px SANS");
    assert.equal(k.textAlign, "center");
    assert.equal(k.textBaseline, "middle");
    assert.equal(k.alpha, 1);
  }
  assert.equal(boxes(c).length + strokes(c).length, 0, "karaoke draws no box and no outline");
});
t("nothing before the layer starts or before the first word", () => {
  assert.equal(draw(layer(), -1).calls.length, 0);
  assert.equal(draw(layer({ start: 1 }), 0.999).calls.length, 0);
  assert.ok(draw(layer({ start: 1 }), 1).calls.length > 0);
});
t("layer.uppercase upper-cases what is drawn (accents included)", () => {
  const c = draw(layer({ text: "élève à l'école ça va", uppercase: true }), 0.1);
  assert.deepEqual(fills(c).map((k) => k.text), ["ÉLÈVE", "À", "L'ÉCOLE", "ÇA"]);
});
t("display font ignores the weight; others round it to the nearest hundred", () => {
  assert.equal(fills(draw(layer({ font: "display", weight: 800 }), 0.5))[0].font, "400 60px DISP");
  assert.equal(fills(draw(layer({ font: "serif", weight: 640 }), 0.5))[0].font, "600 60px SERIF");
  assert.equal(fills(draw(layer({ font: "mono", weight: 750, size: 33 }), 0.5))[0].font, "800 33px MONO");
});
t("wraps a long page to maxWidth: 2 lines of 2 words, block centred on the origin", () => {
  const c = draw(layer({ maxWidth: 300 }), 0.5);
  // 120 + 30 + 120 = 270 fits in 300, a third word doesn't. Line pitch = 60 * 1.25 = 75.
  assert.deepEqual(fills(c).map((k) => [k.x, k.y]), [[-75, -37.5], [75, -37.5], [-75, 37.5], [75, 37.5]]);
});
t("colours come from the layer", () => {
  assert.deepEqual(shown(draw(layer({ color: "#ff0000", highlight: "#00ff00" }), 1.5)), ["aaaa:#ff0000", "bbbb:#00ff00", "cccc:#ff0000", "dddd:#ff0000"]);
});

console.log("drawCaptions: pop");
const pop = (over: Partial<CaptionsLayer> = {}) => layer({ style: "pop", ...over });
t("a word only appears once it is said; earlier words stay, the active one is highlighted", () => {
  assert.deepEqual(shown(draw(pop(), 0.5)), [`aaaa:${AMBER}`]);
  assert.deepEqual(shown(draw(pop(), 1.5)), [`aaaa:${WHITE}`, `bbbb:${AMBER}`]);
  assert.deepEqual(shown(draw(pop(), 3.5)), [`aaaa:${WHITE}`, `bbbb:${WHITE}`, `cccc:${WHITE}`, `dddd:${AMBER}`]);
  assert.deepEqual(shown(draw(pop(), 4.5)), [`eeee:${AMBER}`], "a new page starts empty again");
});
t("words stay where the full page puts them (nothing jumps as words arrive)", () => {
  const full = fills(draw(layer(), 3.5)).map((k) => k.x);
  assert.deepEqual(fills(draw(pop(), 1.5)).map((k) => k.x), full.slice(0, 2));
  assert.deepEqual(fills(draw(pop(), 3.5)).map((k) => k.x), full);
});
t("scale-in over 0.18 s with an overshoot, fading in; settled words are at scale 1", () => {
  const start = 1; // word "bbbb"
  const at = (dt: number) => fills(draw(pop(), start + dt)).find((k) => k.text === "bbbb")!;
  close(at(0.09).scale, ease("backOut", 0.5), "halfway scale", 1e-9);
  close(at(0.09).alpha, ease("easeOut", 0.5), "halfway alpha", 1e-9);
  assert.ok(at(0.18 * 0.7).scale > 1.05, "overshoots");
  close(at(0.18).scale, 1, "settled", 1e-9);
  close(at(0.18).alpha, 1, "opaque", 1e-9);
  assert.equal(at(0.5).scale, 1);
  assert.equal(at(0.5).alpha, 1);
  close(at(0).scale, 0, "starts from nothing");
  assert.equal(at(0).alpha, 0);
  const a = fills(draw(pop(), start + 0.09)).find((k) => k.text === "aaaa")!;
  assert.deepEqual([a.scale, a.alpha], [1, 1], "the previous word is settled");
});
t("the pop scales around the word's own centre", () => {
  const c = draw(pop(), 1.05);
  const [a, b] = fills(c);
  const fullB = fills(draw(layer(), 1.05))[1];
  assert.equal(a.x, fills(draw(layer(), 1.05))[0].x);
  assert.equal(b.x, fullB.x);
  assert.equal(b.y, fullB.y);
});
t("pop's alpha multiplies the incoming alpha", () => {
  const b = fills(draw(pop(), 1.09, DUR, 0.5)).find((k) => k.text === "bbbb")!;
  close(b.alpha, 0.5 * ease("easeOut", 0.5), "multiplied");
});

console.log("drawCaptions: box");
const box = (over: Partial<CaptionsLayer> = {}) => layer({ style: "box", ...over });
t("all words are visible; a rounded rectangle in the highlight colour sits behind the active word, which turns black on amber", () => {
  const c = draw(box(), 1.5);
  assert.deepEqual(shown(c), [`aaaa:${WHITE}`, `bbbb:#000000`, `cccc:${WHITE}`, `dddd:${WHITE}`]);
  const [rect] = boxes(c);
  assert.equal(boxes(c).length, 1);
  assert.equal(rect.fillStyle, AMBER);
  const b = fills(c)[1];
  // padding 0.18 * 60 = 10.8 around a 120 x 60 word; radius 0.25 * 60 = 15.
  close(rect.w, 120 + 2 * 10.8, "width");
  close(rect.h, 60 + 2 * 10.8, "height");
  close(rect.x, b.x - 60 - 10.8, "left");
  close(rect.y, b.y - 30 - 10.8, "top");
  close(rect.r, 15, "radius");
  const order = c.calls.map((k) => `${k.op}:${k.text}`);
  assert.ok(order.indexOf("roundRect:") < order.indexOf("fillText:bbbb"), "the box is under the word");
});
t("the box follows the active word, page after page", () => {
  const x = (time: number) => { const c = draw(box(), time); return [boxes(c)[0].x + boxes(c)[0].w / 2, fills(c).find((k) => k.fillStyle !== WHITE)!.x]; };
  for (const time of [0.5, 1.5, 2.5, 3.5, 4.5, 7.5]) { const [centre, word] = x(time); close(centre, word, `t=${time}`); }
});
t("text colour on the box: black on light highlights, white on dark ones, black when it can't tell", () => {
  const on = (highlight: string) => fills(draw(box({ highlight }), 0.5))[0].fillStyle;
  assert.equal(on("#fbbf24"), "#000000");
  assert.equal(on("#ffffff"), "#000000");
  assert.equal(on("#fff"), "#000000");
  assert.equal(on("#FFFF00"), "#000000");
  assert.equal(on("#00ff00"), "#000000", "bright green");
  assert.equal(on("#000000"), "#ffffff");
  assert.equal(on("#000"), "#ffffff");
  assert.equal(on("#1e1b4b"), "#ffffff", "dark indigo");
  assert.equal(on("#0000ff"), "#ffffff", "pure blue is dark");
  assert.equal(on("#7f1d1d"), "#ffffff", "dark red");
  assert.equal(on("#ff0000"), "#000000", "pure red: black has the better contrast");
  assert.equal(on("#000f"), "#ffffff", "#rgba");
  assert.equal(on("#ffffff80"), "#000000", "#rrggbbaa");
  assert.equal(on("  #000  "), "#ffffff", "surrounding space");
  for (const odd of ["red", "navy", "rgb(0,0,0)", "hsl(0 0% 0%)", "#12", "#12345", "#1234567", "", "nonsense"]) assert.equal(on(odd), "#000000", odd);
});
t("an unparseable highlight still colours the box, as given", () => {
  assert.equal(boxes(draw(box({ highlight: "navy" }), 0.5))[0].fillStyle, "navy");
});
t("on a box the other words keep layer.color", () => {
  assert.deepEqual(shown(draw(box({ color: "#abcdef" }), 2.5)), ["aaaa:#abcdef", "bbbb:#abcdef", "cccc:#000000", "dddd:#abcdef"]);
});

console.log("drawCaptions: outline");
const outline = (over: Partial<CaptionsLayer> = {}) => layer({ style: "outline", ...over });
t("every word gets a thick dark round-joined stroke under its fill; the active word is highlighted", () => {
  const c = draw(outline(), 1.5);
  assert.deepEqual(shown(c), [`aaaa:${WHITE}`, `bbbb:${AMBER}`, `cccc:${WHITE}`, `dddd:${WHITE}`]);
  assert.deepEqual(strokes(c).map((k) => k.text), ["aaaa", "bbbb", "cccc", "dddd"]);
  for (const k of strokes(c)) {
    close(k.lineWidth, 0.14 * 60, "line width");
    assert.equal(k.lineJoin, "round");
    assert.equal(k.strokeStyle, "#000000");
  }
  assert.equal(boxes(c).length, 0);
  const order = c.calls.map((k) => `${k.op}:${k.text}`);
  for (const w of ["aaaa", "bbbb", "cccc", "dddd"]) assert.ok(order.indexOf(`strokeText:${w}`) < order.indexOf(`fillText:${w}`), `${w}: stroke under fill`);
});
t("karaoke and pop never stroke", () => {
  assert.equal(strokes(draw(layer(), 1.5)).length, 0);
  assert.equal(strokes(draw(pop(), 1.5)).length, 0);
});
t("the stroke scales with the text size", () => {
  close(strokes(draw(outline({ size: 100 }), 0.5))[0].lineWidth, 14, "100 px");
});

console.log("drawCaptions: timing window");
t("an explicit end bounds the window: words are spread over [start, end]", () => {
  const l = layer({ text: "aaaa bbbb cccc dddd", start: 1, end: 5 });
  assert.equal(draw(l, 0.9).calls.length, 0);
  assert.deepEqual(shown(draw(l, 1)), [`aaaa:${AMBER}`, `bbbb:${WHITE}`, `cccc:${WHITE}`, `dddd:${WHITE}`]);
  assert.deepEqual(shown(draw(l, 3.5)), [`aaaa:${WHITE}`, `bbbb:${WHITE}`, `cccc:${AMBER}`, `dddd:${WHITE}`]);
  assert.deepEqual(shown(draw(l, 4.99)), [`aaaa:${WHITE}`, `bbbb:${WHITE}`, `cccc:${WHITE}`, `dddd:${AMBER}`]);
});
t("without an end the words are spread to the scene end, and follow it when the scene is stretched", () => {
  const l = layer();
  assert.deepEqual(shown(draw(l, 4.5, 16)), [`aaaa:${WHITE}`, `bbbb:${WHITE}`, `cccc:${AMBER}`, `dddd:${WHITE}`], "16 s scene: 2 s a word");
  assert.deepEqual(shown(draw(l, 4.5, 8)), [`eeee:${AMBER}`, `ffff:${WHITE}`, `gggg:${WHITE}`, `hhhh:${WHITE}`]);
});
t("pauses are honoured: the word before a full stop is held longer", () => {
  const l = layer({ text: "Fin. Suite ici", end: 10 }); // Fin. = 7, Suite = 5, ici = 3 -> 15
  assert.deepEqual(shown(draw(l, 4.6)), [`Fin.:${AMBER}`, `Suite:${WHITE}`, `ici:${WHITE}`]);
  assert.deepEqual(shown(draw(l, 4.7)), [`Fin.:${WHITE}`, `Suite:${AMBER}`, `ici:${WHITE}`]);
});
t("after the last word the last page is held 0.3 s then fades out over 0.2 s", () => {
  for (const style of CAPTION_STYLES) {
    const l = layer({ style });
    const alphaAt = (time: number) => { const f = fills(draw(l, time)); return f.length ? Math.min(...f.map((k) => k.alpha)) : null; };
    const full = (time: number) => shown(draw(l, time)).map((s) => s.split(":")[0]);
    assert.deepEqual(full(8), ["eeee", "ffff", "gggg", "hhhh"], `${style}: last page at the end`);
    assert.deepEqual(full(8.25), ["eeee", "ffff", "gggg", "hhhh"], `${style}: held`);
    assert.equal(alphaAt(8), 1);
    close(alphaAt(8.3)!, 1, `${style}: still opaque after 0.3 s`);
    close(alphaAt(8.4)!, 0.5, `${style}: half way through the fade`, 1e-9);
    assert.ok(alphaAt(8.45)! < alphaAt(8.4)!);
    assert.equal(alphaAt(8.51), null, `${style}: gone`);
    assert.equal(alphaAt(60), null);
    assert.equal(alphaAt(Infinity), null);
  }
});
t("the last word is still the highlighted one while the page is held", () => {
  assert.deepEqual(shown(draw(layer(), 8.2)), [`eeee:${WHITE}`, `ffff:${WHITE}`, `gggg:${WHITE}`, `hhhh:${AMBER}`]);
});
t("the fade multiplies the incoming alpha", () => {
  close(fills(draw(layer(), 8.4, DUR, 0.5))[0].alpha, 0.25, "0.5 * 0.5", 1e-9);
  assert.equal(fills(draw(layer(), 1, DUR, 0.5))[0].alpha, 0.5);
});
t("an empty window draws nothing (end before start, scene shorter than the start)", () => {
  assert.equal(draw(layer({ start: 5, end: 3 }), 4).calls.length, 0);
  assert.equal(draw(layer({ start: 5, end: 5 }), 5).calls.length, 0);
  assert.equal(draw(layer({ start: 5 }), 6, 4).calls.length, 0);
  assert.equal(draw(layer(), 1, 0).calls.length, 0);
  assert.equal(draw(layer(), 1, NaN).calls.length, 0);
});
t("NaN time draws nothing", () => {
  assert.equal(draw(layer(), NaN).calls.length, 0);
});

console.log("drawCaptions: robustness");
t("every frame of the window shows something, with finite numbers, for every style", () => {
  const r = rng(99);
  for (const style of CAPTION_STYLES) {
    for (const text of ["aaaa bbbb cccc dddd eeee ffff gggg hhhh", "Salut, tout le monde. Ça va ? Oui ! Très bien, merci beaucoup.", randomText(r, 40) + "fin"]) {
      const l = layer({ style, text, start: 0.1, end: 7.3 });
      for (let i = 0; i <= 270; i++) {
        const time = i / 30;
        const c = draw(l, time);
        for (const k of c.calls) for (const v of [k.x, k.y, k.scale, k.alpha, k.w, k.h, k.r, k.lineWidth]) assert.ok(Number.isFinite(v), `${style} t=${time}`);
        for (const k of c.calls) assert.ok(k.alpha >= 0 && k.alpha <= 1 && k.scale >= 0, `${style} t=${time} alpha/scale`);
        const inside = time >= 0.1 && time <= 7.3 + 0.3;
        if (inside) assert.ok(fills(c).length >= 1 && fills(c).length <= 4, `${style} t=${time}: a page of 1-4 words`);
        if (time < 0.1 || time > 7.3 + 0.5 + 1e-9) assert.equal(c.calls.length, 0, `${style} t=${time}: nothing outside`);
      }
    }
  }
});
t("empty and whitespace-only text draw nothing and don't throw", () => {
  for (const style of CAPTION_STYLES) for (const text of ["", "   ", "\n\t "]) assert.equal(draw(layer({ style, text }), 2).calls.length, 0);
});
t("emoji, accents and punctuation-only text are drawn", () => {
  assert.deepEqual(fills(draw(layer({ text: "🔥🔥 👍 ❤️" }), 0.1)).map((k) => k.text), ["🔥🔥", "👍", "❤️"]);
  assert.deepEqual(fills(draw(layer({ text: "Où ça ? Là-bas, très loin !" }), 0.1)).map((k) => k.text), ["Où", "ça?"], "the question ends the page");
  assert.deepEqual(fills(draw(layer({ text: "Où ça ? Là-bas, très loin !", end: 10 }), 9)).map((k) => k.text), ["Là-bas,", "très", "loin!"]);
  assert.deepEqual(fills(draw(layer({ text: "..." }), 0.1)).map((k) => k.text), ["..."]);
});
t("a huge text draws one small page per frame", () => {
  const l = layer({ text: "mot, autre. Encore ! ".repeat(20000), end: 600 });
  for (const time of [0, 0.5, 100, 300.25, 599.9, 600]) {
    const c = draw(l, time, 600);
    assert.ok(fills(c).length >= 1 && fills(c).length <= 4, `t=${time}`);
  }
});
t("a single very long word is drawn whole", () => {
  const l = layer({ text: "x".repeat(300), maxWidth: 200 });
  const c = draw(l, 1);
  assert.equal(fills(c)[0].text.length, 300);
  assert.equal(fills(c).length, 1);
});
t("draw state is left as it was found (font, colours, alpha, alignment) and the transform is balanced", () => {
  for (const style of CAPTION_STYLES) {
    const c = new FakeCtx();
    c.globalAlpha = 0.7;
    const before = { ...c.s };
    drawCaptions(c as unknown as CanvasRenderingContext2D, layer({ style }), 1.5, fonts, DUR);
    assert.deepEqual(c.s, before, style);
    assert.equal(c.stack.length, 0);
    assert.ok(c.calls.length > 0);
    for (const k of c.calls) assert.ok(k.alpha <= 0.7 + 1e-12, "never brighter than the incoming alpha");
  }
});
t("the layer is not mutated by drawing", () => {
  for (const style of CAPTION_STYLES) {
    const l = layer({ style });
    const before = clone(l);
    draw(l, 1.5);
    draw(l, 9);
    assert.deepEqual(clone(l), before);
  }
});

console.log("drawCaptions: layout cache");
t("the layout is measured once per layer, not once per frame", () => {
  const l = layer();
  const first = draw(l, 0.5);
  assert.ok(first.measures > 0);
  for (const time of [0.6, 1.5, 4.5, 7.9, 8.1]) assert.equal(draw(l, time).measures, 0, `t=${time}`);
});
t("the cache is dropped when anything the layout depends on changes", () => {
  const changes: [string, (l: CaptionsLayer) => void][] = [
    ["text", (l) => { l.text = "un deux trois quatre"; }],
    ["size", (l) => { l.size = 70; }],
    ["weight", (l) => { l.weight = 400; }],
    ["font", (l) => { l.font = "serif"; }],
    ["maxWidth", (l) => { l.maxWidth = 500; }],
    ["lineHeight", (l) => { l.lineHeight = 1.5; }],
    ["uppercase", (l) => { l.uppercase = true; }],
    ["style", (l) => { l.style = "box"; }],
    ["start", (l) => { l.start = 1; }],
    ["end", (l) => { l.end = 6; }],
  ];
  for (const [name, change] of changes) {
    const l = layer();
    draw(l, 1.5);
    change(l);
    assert.ok(draw(l, 1.5).measures > 0, `${name}: re-measured`);
    assert.equal(draw(l, 1.6).measures, 0, `${name}: then cached again`);
  }
});
t("the cache is dropped when the scene is stretched under an open-ended layer", () => {
  const l = layer();
  draw(l, 1, 8);
  assert.ok(draw(l, 1, 12).measures > 0);
  assert.equal(draw(l, 1, 12).measures, 0);
});
t("a changed layer is drawn with the new values, not stale ones", () => {
  const l = layer({ style: "box" });
  draw(l, 1.5);
  l.text = "un deux trois quatre cinq six sept huit"; l.uppercase = true; l.color = "#abcdef"; l.highlight = "#1e1b4b"; l.size = 40;
  const c = draw(l, 1.5); // weights 2 4 5 6 4 3 4 4 over 8 s: "trois" is said from 1.5 s
  assert.deepEqual(shown(c), ["UN:#abcdef", "DEUX:#abcdef", "TROIS:#ffffff", "QUATRE:#abcdef"]);
  assert.equal(boxes(c)[0].fillStyle, "#1e1b4b");
  close(boxes(c)[0].h, 40 + 2 * 0.18 * 40, "box follows the new size");
});
t("two layers don't share a cache", () => {
  const a = layer({ text: "un deux" }), b = layer({ text: "trois quatre" });
  assert.deepEqual(fills(draw(a, 0.1)).map((k) => k.text), ["un", "deux"]);
  assert.deepEqual(fills(draw(b, 0.1)).map((k) => k.text), ["trois", "quatre"]);
  assert.deepEqual(fills(draw(a, 0.1)).map((k) => k.text), ["un", "deux"]);
});

console.log(`\n${n} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
