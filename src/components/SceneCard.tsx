"use client";

import { useState } from "react";
import { Check, Clapperboard, Eye, Image as ImageIcon, Loader2, Mic2, Sparkles } from "lucide-react";
import clsx from "clsx";
import type { MotionScene } from "@/lib/motion/types";

export type BusyKind = "voice" | "image" | "video" | "refine";

interface Props {
  scene: MotionScene;
  index: number;
  active: boolean;
  busy?: BusyKind;
  /** Progress or error text for this scene. */
  note?: { text: string; error: boolean };
  voiceReady: boolean;
  videoReady: boolean;
  /** The selected video engine needs a scene image first (and there is none yet). */
  videoBlocked: boolean;
  motionReady: boolean;
  onChange: (patch: Partial<MotionScene>) => void;
  onSeek: () => void;
  onVoice: () => void;
  onImage: () => void;
  onVideo: () => void;
  onRefine: (instruction: string) => void;
}

function ActionButton({
  label,
  done,
  loading,
  disabled,
  onClick,
  children,
}: {
  label: string;
  done?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      className={clsx(
        "relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all disabled:cursor-not-allowed disabled:opacity-40",
        done ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300" : "border-[#2a2a2a] bg-[#141414] text-zinc-400 hover:border-indigo-500 hover:text-white",
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
      {done && !loading && <Check className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-indigo-500 p-0.5 text-white" />}
    </button>
  );
}

export default function SceneCard({
  scene,
  index,
  active,
  busy,
  note,
  voiceReady,
  videoReady,
  videoBlocked,
  motionReady,
  onChange,
  onSeek,
  onVoice,
  onImage,
  onVideo,
  onRefine,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const refining = busy === "refine";

  const submitRefine = () => {
    if (!instruction.trim() || refining) return;
    onRefine(instruction.trim());
    setInstruction("");
  };

  return (
    <div className={clsx("space-y-4 rounded-2xl border bg-[#0a0a0a] p-5 transition-colors", active ? "border-indigo-500/60" : "border-[#1a1a1a]")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#333] bg-[#1a1a1a] text-xs font-bold">
            {String(index + 1).padStart(2, "0")}
          </span>
          <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            <input
              type="number"
              min={1.5}
              max={40}
              step={0.1}
              value={scene.duration}
              onChange={(e) => onChange({ duration: Math.min(40, Math.max(1.5, Number(e.target.value) || scene.duration)) })}
              className="w-16 rounded-md border border-[#222] bg-black px-2 py-1 text-right font-mono text-xs text-zinc-200 outline-none focus:border-indigo-500/50"
            />
            s
          </label>
          <span className="hidden text-[10px] font-bold uppercase tracking-widest text-zinc-600 sm:inline">
            {scene.layers.length} calques · {scene.transition.type}
          </span>
        </div>
        <div className="flex gap-2">
          <ActionButton label="Voir cette scène" onClick={onSeek}>
            <Eye className="h-4 w-4" />
          </ActionButton>
          <ActionButton label="Générer la voix" done={!!scene.audioUrl} loading={busy === "voice"} disabled={!voiceReady || !scene.voiceOver.trim()} onClick={onVoice}>
            <Mic2 className="h-4 w-4" />
          </ActionButton>
          <ActionButton label="Générer l'image de fond" done={!!scene.imageUrl} loading={busy === "image"} disabled={!scene.visualPrompt.trim()} onClick={onImage}>
            <ImageIcon className="h-4 w-4" />
          </ActionButton>
          <ActionButton
            label={videoBlocked ? "Générez d'abord l'image (ce moteur part d'une image)" : "Générer un plan vidéo IA"}
            done={!!scene.videoUrl}
            loading={busy === "video"}
            disabled={!videoReady || videoBlocked || !scene.visualPrompt.trim()}
            onClick={onVideo}
          >
            <Clapperboard className="h-4 w-4" />
          </ActionButton>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Narration</label>
          <textarea
            value={scene.voiceOver}
            onChange={(e) => onChange({ voiceOver: e.target.value })}
            className="min-h-[96px] w-full resize-none rounded-xl border border-[#1a1a1a] bg-black p-3 text-sm leading-relaxed text-zinc-100 outline-none transition-colors focus:border-indigo-500/50"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Fond IA — prompt (anglais)</label>
          <textarea
            value={scene.visualPrompt}
            onChange={(e) => onChange({ visualPrompt: e.target.value })}
            className="min-h-[96px] w-full resize-none rounded-xl border border-[#1a1a1a] bg-black p-3 text-sm italic leading-relaxed text-zinc-400 outline-none transition-colors focus:border-indigo-500/50"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitRefine()}
          placeholder="Retoucher l'animation : plus dynamique, texte jaune, transition zoom…"
          disabled={!motionReady}
          className="flex-1 rounded-xl border border-[#1a1a1a] bg-black px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-indigo-500/50 disabled:opacity-40"
        />
        <button
          onClick={submitRefine}
          disabled={!motionReady || refining || !instruction.trim()}
          className="flex items-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#141414] px-4 text-[10px] font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Claude
        </button>
      </div>

      {note && <p className={clsx("text-xs", note.error ? "text-red-400" : "text-zinc-500")}>{note.text}</p>}
    </div>
  );
}
