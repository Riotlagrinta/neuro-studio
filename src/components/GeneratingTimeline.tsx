"use client";

import { motion, useReducedMotion } from "framer-motion";

// While Claude Opus composes, show the work: a timeline filling up with clips and keyframes.
// Purely decorative — the numbers below are fixed, not progress.

const ROWS: { label: string; color: string; bars: [number, number][]; keys: number[] }[] = [
  { label: "Scènes", color: "#6366f1", bars: [[0, 22], [23, 48], [49, 74], [75, 100]], keys: [] },
  { label: "Titres", color: "#f5f3ff", bars: [[4, 20], [27, 46], [53, 72], [79, 98]], keys: [6, 12, 17, 30, 36, 43, 56, 63, 69] },
  { label: "Formes", color: "#f472b6", bars: [[0, 18], [24, 40], [50, 70], [76, 100]], keys: [3, 9, 26, 33, 52, 60, 78, 90] },
  { label: "Fonds IA", color: "#38bdf8", bars: [[0, 46], [49, 100]], keys: [10, 55] },
  { label: "Voix", color: "#34d399", bars: [[2, 21], [25, 47], [51, 73], [77, 99]], keys: [] },
];

export default function GeneratingTimeline({ stage }: { stage: string }) {
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="label">Composition en cours</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink" />
            <span className="label text-pink">Claude Opus</span>
          </span>
        </div>

        <div className="relative px-4 py-3">
          {ROWS.map((row, r) => (
            <div key={row.label} className="flex h-9 items-center gap-3">
              <span className="label w-16 shrink-0">{row.label}</span>
              <div className="relative h-5 flex-1">
                {row.bars.map(([from, to], i) => (
                  <motion.div
                    key={i}
                    className="absolute bottom-0 top-0 origin-left rounded-sm"
                    style={{ left: `${from}%`, width: `${to - from}%`, background: `${row.color}30`, border: `1px solid ${row.color}77` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 0.15 * r + 0.25 * i, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                ))}
                {row.keys.map((k, i) => (
                  <motion.span
                    key={k}
                    className="keyframe"
                    style={{ left: `${k}%` }}
                    initial={reduce ? false : { opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1 + 0.12 * i + 0.1 * r, type: "spring", stiffness: 500, damping: 18 }}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="pointer-events-none absolute inset-y-3 left-[calc(1rem+4rem+0.75rem)] right-4">
            <motion.div
              className="absolute bottom-0 top-0 w-px bg-pink shadow-[0_0_10px_1px_rgba(244,114,182,0.7)]"
              initial={{ left: "0%" }}
              animate={reduce ? undefined : { left: ["0%", "100%"] }}
              transition={{ duration: 3.2, ease: "linear", repeat: Infinity }}
            >
              <span className="absolute -left-[5px] -top-1 h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-pink" />
            </motion.div>
          </div>
        </div>
      </div>

      <div className="space-y-1 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-cream" role="status" aria-live="polite">
          {stage}
          <motion.span animate={reduce ? undefined : { opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }}>
            ▍
          </motion.span>
        </p>
        <p className="text-sm text-zinc-600">Opus compose toute l&apos;animation : comptez entre 30 secondes et 2 minutes.</p>
      </div>
    </div>
  );
}
