import type { Ease, Track } from "./types";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function ease(name: Ease, input: number): number {
  const x = clamp01(input);
  switch (name) {
    case "linear":
      return x;
    case "easeIn":
      return x * x * x;
    case "easeOut":
      return 1 - Math.pow(1 - x, 3);
    case "easeInOut":
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "backOut": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case "elasticOut": {
      if (x === 0 || x === 1) return x;
      return Math.pow(2, -10 * x) * Math.sin(((x * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
    }
    case "expoOut":
      return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
    case "bounceOut": {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x - 1.5 / d1) * (x - 1.5 / d1) + 0.75;
      if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) * (x - 2.25 / d1) + 0.9375;
      return n1 * (x - 2.625 / d1) * (x - 2.625 / d1) + 0.984375;
    }
  }
}

/** Value of a track at time t. Keyframes must be sorted by time (sanitize.ts guarantees it). */
export function sample(track: Track, t: number): number {
  if (typeof track === "number") return track;
  const first = track[0];
  const last = track[track.length - 1];
  if (t <= first.t) return first.v;
  if (t >= last.t) return last.v;
  for (let i = 1; i < track.length; i++) {
    const b = track[i];
    if (t <= b.t) {
      const a = track[i - 1];
      const span = b.t - a.t;
      const p = span > 0 ? (t - a.t) / span : 1;
      return a.v + (b.v - a.v) * ease(b.ease ?? "easeInOut", p);
    }
  }
  return last.v;
}
