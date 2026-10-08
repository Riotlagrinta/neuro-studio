import { normalizeProject } from "./sanitize";
import { FRAMES, type AspectRatio, type MotionProject } from "./types";

// A hand-written project in the same format Claude produces. It lets people explore the
// studio without any API key, and doubles as a reference for the spec.

const INK = "#0b0b14";
const INDIGO = "#6366f1";
const PINK = "#f472b6";
const AMBER = "#fbbf24";
const CREAM = "#f5f3ff";
const MUTED = "#a1a1aa";

const rise = (to: number, start: number, from = 220, dur = 0.7) => [
  { t: start, v: to + from },
  { t: start + dur, v: to, ease: "backOut" },
];
const fadeIn = (start: number, dur = 0.4) => [
  { t: start, v: 0 },
  { t: start + dur, v: 1, ease: "easeOut" },
];

export function buildSampleProject(ratio: AspectRatio): MotionProject {
  const { width: W, height: H } = FRAMES[ratio];
  const P = ratio === "9:16";
  const cx = W / 2;
  const cy = H / 2;

  // Scene 1 — hook
  const barW = P ? 420 : 560;
  const scene1 = {
    voiceOver: "Le mouvement donne vie aux idées.",
    visualPrompt: "abstract flowing light trails on a dark background, cinematic, no text",
    duration: 4.5,
    background: { type: "linear", from: INK, to: "#1e1b4b", angle: 160 },
    transition: { type: "fade", duration: 0.6 },
    layers: [
      { type: "ellipse", fill: INDIGO, opacity: 0.18, w: [{ t: 0, v: 0 }, { t: 2.8, v: P ? 1100 : 1300, ease: "expoOut" }], h: [{ t: 0, v: 0 }, { t: 2.8, v: P ? 1100 : 1300, ease: "expoOut" }] },
      { type: "ellipse", fill: "transparent", stroke: INDIGO, strokeWidth: 6, w: [{ t: 0.2, v: 0 }, { t: 2.2, v: P ? 900 : 1000, ease: "expoOut" }], h: [{ t: 0.2, v: 0 }, { t: 2.2, v: P ? 900 : 1000, ease: "expoOut" }], opacity: [{ t: 0.2, v: 0.8 }, { t: 2.2, v: 0, ease: "easeOut" }] },
      { type: "text", text: "LE MOUVEMENT", font: "display", size: P ? 190 : 230, color: CREAM, y: cy - (P ? 150 : 50), start: 0.3, reveal: "chars", revealDuration: 1, maxWidth: W * 0.9, letterSpacing: 2 },
      { type: "rect", fill: PINK, h: 10, radius: 5, anchor: "left", x: cx - barW / 2, y: cy + (P ? 130 : 90), start: 1.1, w: [{ t: 1.1, v: 0 }, { t: 1.8, v: barW, ease: "expoOut" }] },
      { type: "text", text: "donne vie aux idées", font: "sans", weight: 500, size: P ? 60 : 56, color: "#c4b5fd", y: cy + (P ? 230 : 160), start: 1.3, reveal: "words", revealDuration: 0.9 },
    ],
  };

  // Scene 2 — three cards sliding in with overshoot
  const cards = [
    { label: "Script", sub: "Claude Opus", color: INDIGO },
    { label: "Voix", sub: "ElevenLabs · OpenAI", color: PINK },
    { label: "Vidéo", sub: "Seedance · Wan", color: AMBER },
  ];
  const cardW = P ? 840 : 500;
  const cardH = P ? 300 : 420;
  const cardLayers = cards.flatMap((c, i) => {
    const s = 0.7 + i * 0.2;
    const x = P ? cx : cx + (i - 1) * (cardW + 60);
    const y = P ? H * 0.37 + i * (cardH + 50) : cy + 90;
    const opacity = fadeIn(s);
    return [
      { type: "rect", w: cardW, h: cardH, radius: 36, fill: "#15152a", stroke: c.color, strokeWidth: 3, x, y: rise(y, s), opacity },
      { type: "ellipse", w: 70, h: 70, fill: c.color, x: P ? x - cardW / 2 + 90 : x, y: rise(P ? y : y - 110, s + 0.05), opacity },
      { type: "text", text: c.label, font: "display", size: P ? 120 : 110, color: CREAM, align: P ? "left" : "center", x: P ? x - cardW / 2 + 170 : x, y: rise(P ? y - 20 : y + 10, s + 0.1), opacity },
      { type: "text", text: c.sub, font: "sans", weight: 500, size: 32, color: MUTED, align: P ? "left" : "center", x: P ? x - cardW / 2 + 170 : x, y: rise(P ? y + 70 : y + 110, s + 0.15), opacity },
    ];
  });
  const scene2 = {
    voiceOver: "Un seul studio, trois superpouvoirs : le script, la voix et la vidéo.",
    visualPrompt: "minimal dark studio with soft violet light, cinematic, no text",
    duration: 4.5,
    background: { type: "solid", color: INK },
    transition: { type: "slide", duration: 0.7 },
    layers: [
      { type: "text", text: "Un studio.\nTrois superpouvoirs.", font: "serif", weight: 700, size: P ? 88 : 82, color: CREAM, y: P ? H * 0.14 : H * 0.2, start: 0.1, reveal: "words", revealDuration: 1 },
      ...cardLayers,
    ],
  };

  // Scene 3 — big number with elastic pop
  const scene3 = {
    voiceOver: "Dix fois plus vite, de l'idée jusqu'à l'écran.",
    visualPrompt: "glowing geometric shapes rotating in deep space, cinematic, no text",
    duration: 4,
    background: { type: "radial", from: "#1e1b4b", to: INK },
    transition: { type: "zoom", duration: 0.7 },
    layers: [
      { type: "rect", w: 560, h: 560, radius: 120, fill: "transparent", stroke: INDIGO, strokeWidth: 8, y: cy - (P ? 60 : 20), opacity: 0.7, rotation: [{ t: 0, v: 0 }, { t: 4, v: 180, ease: "linear" }] },
      { type: "rect", w: 560, h: 560, radius: 120, fill: "transparent", stroke: PINK, strokeWidth: 6, y: cy - (P ? 60 : 20), scale: 0.8, opacity: 0.6, rotation: [{ t: 0, v: 0 }, { t: 4, v: -120, ease: "linear" }] },
      { type: "text", text: "×10", font: "display", size: P ? 420 : 380, color: CREAM, y: cy - (P ? 60 : 20), scale: [{ t: 0.2, v: 0.2 }, { t: 1.1, v: 1, ease: "elasticOut" }], opacity: fadeIn(0.2, 0.3) },
      { type: "text", text: "plus vite de l'idée à l'écran", font: "sans", weight: 600, size: P ? 62 : 56, color: "#c4b5fd", y: cy + (P ? 330 : 300), start: 1, reveal: "words", revealDuration: 1.2, maxWidth: W * 0.8 },
    ],
  };

  // Scene 4 — end card
  const lineW = P ? 500 : 700;
  const scene4 = {
    voiceOver: "NeuroStudio. Le motion design propulsé par l'IA.",
    visualPrompt: "soft violet gradient light, abstract, cinematic, no text",
    duration: 4,
    background: { type: "linear", from: INDIGO, to: "#4c1d95", angle: 135 },
    transition: { type: "wipe", duration: 0.7 },
    layers: [
      { type: "ellipse", fill: "#ffffff", opacity: 0.08, x: cx - (P ? 250 : 450), y: cy - 250, w: 900, h: 900, scale: [{ t: 0, v: 1 }, { t: 4, v: 1.25, ease: "linear" }] },
      { type: "ellipse", fill: "#ffffff", opacity: 0.06, x: cx + (P ? 250 : 500), y: cy + 300, w: 700, h: 700, scale: [{ t: 0, v: 1.2 }, { t: 4, v: 1, ease: "linear" }] },
      { type: "text", text: "NeuroStudio", font: "display", size: P ? 210 : 250, color: "#ffffff", y: cy - 30, start: 0.3, reveal: "typewriter", revealDuration: 1.2, maxWidth: W * 0.9 },
      { type: "rect", fill: "#ffffff", h: 8, radius: 4, anchor: "left", x: cx - lineW / 2, y: cy + (P ? 110 : 130), w: [{ t: 1.3, v: 0 }, { t: 2, v: lineW, ease: "expoOut" }] },
      { type: "text", text: "Motion design propulsé par l'IA", font: "sans", weight: 500, size: P ? 54 : 52, color: "#e0e7ff", y: cy + (P ? 210 : 220), start: 1.6, reveal: "fade", revealDuration: 0.8 },
    ],
  };

  const project = normalizeProject(
    { title: "NeuroStudio — démo motion", category: "Démo", ratio, palette: [INK, INDIGO, PINK, AMBER, CREAM], scenes: [scene1, scene2, scene3, scene4] },
    ratio,
    false,
  );
  if (!project) throw new Error("Sample project failed validation");
  return project;
}
