"use client";

import { useState } from "react";
import { Monitor, Play, Smartphone, Wand2 } from "lucide-react";
import clsx from "clsx";
import type { GenerateInput } from "@/app/actions";
import { STYLES, type StyleId } from "@/lib/motion/prompt";
import type { AspectRatio } from "@/lib/motion/types";

interface Props {
  motionReady: boolean;
  onGenerate: (input: GenerateInput) => void;
  onDemo: (ratio: AspectRatio) => void;
}

const DURATIONS = [15, 30, 45, 60];

const chip = (active: boolean) =>
  clsx(
    "rounded-lg border px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-all",
    active ? "border-indigo-500 bg-indigo-600 text-white" : "border-[#222] bg-[#0a0a0a] text-zinc-500 hover:border-[#444] hover:text-zinc-300",
  );

export default function BriefForm({ motionReady, onGenerate, onDemo }: Props) {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<StyleId>("kinetic");
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const [useMedia, setUseMedia] = useState(true);

  const canSubmit = motionReady && topic.trim().length >= 3;
  const submit = () => canSubmit && onGenerate({ topic: topic.trim(), style, targetSeconds, ratio, useMedia });

  return (
    <div className="space-y-12">
      <div className="max-w-3xl space-y-6">
        <h1 className="text-5xl font-bold leading-tight tracking-tighter md:text-7xl">
          Du motion design, <br />
          <span className="text-zinc-500">dirigé par Claude.</span>
        </h1>
        <p className="text-xl leading-relaxed text-zinc-400">
          Décrivez votre vidéo. Claude Opus anime les titres, les formes et les transitions ; des voix IA la racontent ; des modèles vidéo IA
          génèrent les plans de fond.
        </p>
      </div>

      <div className="max-w-3xl space-y-6 rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a] p-5 shadow-2xl">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit()}
          placeholder="Ex. : une pub de 30 s pour une appli de méditation, ton apaisant, couleurs chaudes…"
          className="min-h-[110px] w-full resize-none bg-transparent px-2 py-2 text-lg outline-none placeholder:text-zinc-700"
        />

        <div className="space-y-4 border-t border-[#1a1a1a] pt-5">
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <button key={s.id} onClick={() => setStyle(s.id)} className={chip(style === s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {DURATIONS.map((d) => (
              <button key={d} onClick={() => setTargetSeconds(d)} className={chip(targetSeconds === d)}>
                ~{d} s
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-[#222]" />
            <button onClick={() => setRatio("16:9")} className={clsx(chip(ratio === "16:9"), "flex items-center gap-2")}>
              <Monitor className="h-3 w-3" /> 16:9
            </button>
            <button onClick={() => setRatio("9:16")} className={clsx(chip(ratio === "9:16"), "flex items-center gap-2")}>
              <Smartphone className="h-3 w-3" /> 9:16
            </button>
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-400">
            <input type="checkbox" checked={useMedia} onChange={(e) => setUseMedia(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
            Prévoir des fonds IA (image ou plan vidéo générés scène par scène)
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-xl bg-white px-8 py-4 font-bold text-black transition-all hover:bg-indigo-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Wand2 className="h-5 w-5" /> Créer l&apos;animation
          </button>
          <button
            onClick={() => onDemo(ratio)}
            className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] px-6 py-4 text-sm font-bold text-zinc-300 transition-all hover:border-indigo-500 hover:text-white"
          >
            <Play className="h-4 w-4" /> Voir une démo
          </button>
        </div>

        {!motionReady && (
          <p className="text-sm text-amber-400/90">
            ANTHROPIC_API_KEY n&apos;est pas configurée : la génération par Claude est désactivée. La démo fonctionne sans clé.
          </p>
        )}
      </div>
    </div>
  );
}
