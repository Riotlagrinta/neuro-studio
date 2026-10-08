"use client";

import { useState } from "react";
import { Monitor, Smartphone, Wand2 } from "lucide-react";
import clsx from "clsx";
import { signInWithGoogle, type GenerateInput } from "@/app/actions";
import { STYLES, type StyleId } from "@/lib/motion/prompt";
import type { AspectRatio } from "@/lib/motion/types";

export interface Gate {
  canCreate: boolean;
  /** Why creating is unavailable (shown under the buttons). */
  message: string | null;
  /** Offer the sign-in button. */
  showSignIn: boolean;
}

interface Props {
  gate: Gate;
  maxSeconds: number;
  onGenerate: (input: GenerateInput) => void;
  onDemo: (ratio: AspectRatio) => void;
}

const DURATIONS = [15, 30, 45, 60];

const chip = (active: boolean) =>
  clsx(
    "rounded-md border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-all",
    active ? "border-accent bg-accent/20 text-cream" : "border-line-2 bg-panel-2 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200",
  );

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-2 sm:grid-cols-[88px_1fr]">
      <span className="label pt-2">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function BriefForm({ gate, maxSeconds, onGenerate, onDemo }: Props) {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<StyleId>("kinetic");
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const [useMedia, setUseMedia] = useState(true);

  const durations = DURATIONS.filter((d) => d <= maxSeconds);
  const canSubmit = gate.canCreate && topic.trim().length >= 3;
  const submit = () => canSubmit && onGenerate({ topic: topic.trim(), style, targetSeconds: Math.min(targetSeconds, maxSeconds), ratio, useMedia });

  return (
    <section className="rounded-xl border border-line bg-panel shadow-2xl" aria-label="Nouvelle composition">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="relative inline-block h-2 w-2 rotate-45 bg-amber" />
        <span className="label">Nouvelle composition</span>
      </div>

      <div className="space-y-5 p-4">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
          placeholder="Décrivez la vidéo : une pub de 30 s pour une appli de méditation, ton apaisant, couleurs chaudes…"
          aria-label="Brief de la vidéo"
          className="min-h-[104px] w-full resize-none rounded-lg border border-line-2 bg-ink px-4 py-3 text-base leading-relaxed outline-none transition-colors placeholder:text-zinc-700 focus:border-accent"
        />

        <div className="space-y-3">
          <Setting label="Style">
            {STYLES.map((s) => (
              <button key={s.id} onClick={() => setStyle(s.id)} aria-pressed={style === s.id} className={chip(style === s.id)}>
                {s.label}
              </button>
            ))}
          </Setting>
          <Setting label="Durée">
            {durations.map((d) => (
              <button key={d} onClick={() => setTargetSeconds(d)} aria-pressed={targetSeconds === d} className={chip(targetSeconds === d)}>
                ~{d} s
              </button>
            ))}
          </Setting>
          <Setting label="Format">
            <button onClick={() => setRatio("16:9")} aria-pressed={ratio === "16:9"} className={clsx(chip(ratio === "16:9"), "flex items-center gap-2")}>
              <Monitor className="h-3 w-3" /> 16:9
            </button>
            <button onClick={() => setRatio("9:16")} aria-pressed={ratio === "9:16"} className={clsx(chip(ratio === "9:16"), "flex items-center gap-2")}>
              <Smartphone className="h-3 w-3" /> 9:16
            </button>
          </Setting>
          <Setting label="Fonds IA">
            <label className="flex cursor-pointer items-center gap-3 pt-1.5 text-sm text-zinc-400">
              <input type="checkbox" checked={useMedia} onChange={(e) => setUseMedia(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
              Prévoir des images ou plans vidéo générés par scène
            </label>
          </Setting>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg bg-cream px-6 py-3 font-bold text-ink transition-all hover:bg-pink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cream"
          >
            <Wand2 className="h-4 w-4" /> Créer l&apos;animation
          </button>
          <button
            onClick={() => onDemo(ratio)}
            className="rounded-lg border border-line-2 px-5 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-pink hover:text-white"
          >
            Voir la démo
          </button>
          {gate.showSignIn && (
            <form action={signInWithGoogle} className="ml-auto">
              <button className="rounded-lg border border-accent/50 bg-accent/10 px-4 py-3 text-sm font-semibold text-indigo-300 transition-colors hover:bg-accent hover:text-white">
                Se connecter avec Google
              </button>
            </form>
          )}
        </div>

        {gate.message && <p className="text-sm text-amber/90">{gate.message}</p>}
      </div>
    </section>
  );
}
