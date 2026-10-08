"use client";

import { useMemo, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Play } from "lucide-react";
import MotionPlayer from "@/components/MotionPlayer";
import { buildSampleProject } from "@/lib/motion/sample";
import { timecode } from "@/lib/motion/timecode";

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** One line of display type whose words rise out of a mask, staggered. */
function Line({ words, delay, className }: { words: string[]; delay: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="-mt-[0.18em] block overflow-hidden pb-[0.08em] pt-[0.18em]">
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className={`mr-[0.22em] inline-block ${className ?? ""}`}
          initial={reduce ? false : { y: "112%", rotate: 3 }}
          animate={{ y: 0, rotate: 0 }}
          transition={{ delay: delay + i * 0.09, duration: 0.85, ease: EASE_OUT_EXPO }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

export function KineticTitle() {
  return (
    <h1 className="font-display text-[clamp(3.4rem,9vw,7.5rem)] uppercase leading-[0.92] tracking-tight text-cream">
      <Line words={["Donnez", "du"]} delay={0.1} />
      <Line
        words={["mouvement"]}
        delay={0.28}
        className="text-transparent [-webkit-text-stroke:2px_var(--color-pink)]"
      />
      <Line words={["à", "vos", "idées."]} delay={0.46} />
    </h1>
  );
}

/** A decorative timeline ruler with a playhead sweeping across it. */
export function SweepRuler() {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-7 overflow-hidden border-b border-line bg-panel/60" aria-hidden>
      <div className="ruler-ticks absolute inset-0 opacity-80" />
      <motion.div
        className="absolute bottom-0 top-0 w-px bg-pink shadow-[0_0_10px_1px_rgba(244,114,182,0.7)]"
        initial={{ left: "0%" }}
        animate={reduce ? undefined : { left: ["0%", "100%"] }}
        transition={{ duration: 10, ease: "linear", repeat: Infinity }}
      >
        <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-pink" />
      </motion.div>
    </div>
  );
}

/** The product's own output, looping: proof of the result before anyone types a word. */
export function HeroReel({ onOpen }: { onOpen: () => void }) {
  const project = useMemo(() => buildSampleProject("16:9"), []);
  const clockRef = useRef<HTMLSpanElement>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.9, ease: EASE_OUT_EXPO }}
      className="space-y-3"
    >
      <div className="relative rounded-xl border border-line bg-panel p-2 shadow-[0_0_120px_-30px_rgba(99,102,241,0.55)]">
        <MotionPlayer
          project={project}
          variant="reel"
          onFrame={(t) => {
            if (clockRef.current) clockRef.current.textContent = timecode(t);
          }}
        />
        <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 backdrop-blur">
          <span className="h-2 w-2 animate-pulse rounded-full bg-pink" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-cream">Boucle</span>
        </div>
        <div className="pointer-events-none absolute bottom-5 right-5 rounded-md bg-black/60 px-2.5 py-1 font-mono text-xs tabular-nums text-cream backdrop-blur">
          <span ref={clockRef}>{timecode(0)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="label normal-case tracking-normal">Cette animation a été écrite sous forme de spec, puis jouée en direct.</p>
        <button
          onClick={onOpen}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-line-2 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-zinc-300 transition-colors hover:border-pink hover:text-white"
        >
          <Play className="h-3 w-3 fill-current" /> Ouvrir dans le studio
        </button>
      </div>
    </motion.div>
  );
}
