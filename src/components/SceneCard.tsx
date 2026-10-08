"use client";

import { useState } from "react";
import { Check, Clapperboard, Image as ImageIcon, Loader2, Mic2, Sparkles } from "lucide-react";
import clsx from "clsx";
import { TRANSITIONS, type MotionScene, type TransitionType } from "@/lib/motion/types";

export type BusyKind = "voice" | "image" | "video" | "refine";

const TRANSITION_LABELS: Record<TransitionType, string> = { none: "Coupe franche", fade: "Fondu", slide: "Glissement", zoom: "Zoom", wipe: "Balayage" };

// The inspector for the scene under the playhead (the timeline picks which one that is).
interface Props {
  scene: MotionScene;
  index: number;
  total: number;
  busy?: BusyKind;
  /** Progress or error text for this scene. */
  note?: { text: string; error: boolean };
  voiceReady: boolean;
  imageReady: boolean;
  videoReady: boolean;
  /** The selected video engine needs a scene image first (and there is none yet). */
  videoBlocked: boolean;
  motionReady: boolean;
  /** Estimated price of each action for this scene, already formatted ("0,09 $"). */
  estimates: { voice: string; image: string; video: string };
  onChange: (patch: Partial<MotionScene>) => void;
  onTransition: (patch: { type?: TransitionType; duration?: number }) => void;
  onVoice: () => void;
  onImage: () => void;
  onVideo: () => void;
  onRefine: (instruction: string) => void;
}

function Action({
  label,
  hint,
  done,
  loading,
  disabled,
  title,
  onClick,
  children,
}: {
  label: string;
  /** Estimated price shown under the label. */
  hint?: string;
  done?: boolean;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={title ?? label}
      className={clsx(
        "flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-35",
        done ? "border-mint/40 bg-mint/10 text-mint" : "border-line-2 bg-panel-2 text-zinc-400 hover:border-accent hover:text-white",
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : children}
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      {hint && <span className="font-mono text-[9px] normal-case tracking-normal opacity-70">{done ? "fait" : `≈ ${hint}`}</span>}
    </button>
  );
}

export default function SceneCard({
  scene,
  index,
  total,
  busy,
  note,
  voiceReady,
  imageReady,
  videoReady,
  videoBlocked,
  motionReady,
  estimates,
  onChange,
  onTransition,
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
    <section className="rounded-xl border border-line bg-panel" aria-label={`Inspecteur de la scène ${index + 1}`}>
      <div className="flex items-end justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="label">
            Scène {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
            {scene.layers.length} calques · transition {scene.transition.type}
          </p>
        </div>
        <label className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
          <input
            type="number"
            min={1.5}
            max={40}
            step={0.1}
            value={scene.duration}
            onChange={(e) => onChange({ duration: Math.min(40, Math.max(1.5, Number(e.target.value) || scene.duration)) })}
            aria-label="Durée de la scène en secondes"
            className="w-16 rounded-md border border-line-2 bg-ink px-2 py-1 text-right text-sm text-cream outline-none focus:border-accent"
          />
          s
        </label>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex gap-2">
          <Action label="Voix" hint={estimates.voice} done={!!scene.audioUrl} loading={busy === "voice"} disabled={!voiceReady || !scene.voiceOver.trim()} onClick={onVoice}>
            <Mic2 className="h-4 w-4" />
          </Action>
          <Action label="Image" hint={estimates.image} done={!!scene.imageUrl} loading={busy === "image"} disabled={!imageReady || !scene.visualPrompt.trim()} onClick={onImage}>
            <ImageIcon className="h-4 w-4" />
          </Action>
          <Action
            label="Vidéo IA"
            hint={estimates.video}
            done={!!scene.videoUrl}
            loading={busy === "video"}
            disabled={!videoReady || videoBlocked || !scene.visualPrompt.trim()}
            title={videoBlocked ? "Générez d'abord l'image (ce moteur part d'une image)" : "Générer un plan vidéo IA"}
            onClick={onVideo}
          >
            <Clapperboard className="h-4 w-4" />
          </Action>
        </div>

        <div className="space-y-1.5">
          <label className="label" htmlFor={`narration-${scene.id}`}>
            Narration
          </label>
          <textarea
            id={`narration-${scene.id}`}
            value={scene.voiceOver}
            onChange={(e) => onChange({ voiceOver: e.target.value })}
            className="min-h-[88px] w-full resize-none rounded-lg border border-line-2 bg-ink p-3 text-sm leading-relaxed text-cream outline-none transition-colors focus:border-accent"
          />
        </div>

        <div className="space-y-1.5">
          <label className="label" htmlFor={`prompt-${scene.id}`}>
            Fond IA — prompt (anglais)
          </label>
          <textarea
            id={`prompt-${scene.id}`}
            value={scene.visualPrompt}
            onChange={(e) => onChange({ visualPrompt: e.target.value })}
            className="min-h-[72px] w-full resize-none rounded-lg border border-line-2 bg-ink p-3 text-sm italic leading-relaxed text-zinc-400 outline-none transition-colors focus:border-accent"
          />
        </div>

        <div className="grid grid-cols-[1fr_88px] gap-3">
          <label className="space-y-1.5">
            <span className="label">{index === 0 ? "Transition (ignorée : 1re scène)" : "Transition d'entrée"}</span>
            <select
              aria-label="Transition d'entrée"
              value={scene.transition.type}
              disabled={index === 0}
              onChange={(e) => onTransition({ type: e.target.value as TransitionType })}
              className="w-full rounded-md border border-line-2 bg-ink px-2 py-1.5 text-sm text-cream outline-none focus:border-accent disabled:opacity-40"
            >
              {TRANSITIONS.map((tr) => (
                <option key={tr} value={tr}>
                  {TRANSITION_LABELS[tr]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label">Durée (s)</span>
            <input
              type="number"
              aria-label="Durée de la transition"
              min={0.2}
              max={1.5}
              step={0.1}
              value={scene.transition.duration}
              disabled={index === 0 || scene.transition.type === "none"}
              onChange={(e) => onTransition({ duration: Math.min(1.5, Math.max(0.2, Number(e.target.value) || scene.transition.duration)) })}
              className="w-full rounded-md border border-line-2 bg-ink px-2 py-1.5 text-sm text-cream outline-none focus:border-accent disabled:opacity-40"
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <label className="label flex items-center gap-1.5 text-pink/80" htmlFor={`refine-${scene.id}`}>
            <Sparkles className="h-3 w-3" /> Directeur IA
          </label>
          <div className="flex gap-2">
            <input
              id={`refine-${scene.id}`}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRefine()}
              placeholder="Plus dynamique, texte jaune, transition zoom…"
              disabled={!motionReady}
              className="min-w-0 flex-1 rounded-lg border border-line-2 bg-ink px-3 py-2 text-sm text-cream outline-none placeholder:text-zinc-700 focus:border-pink disabled:opacity-40"
            />
            <button
              onClick={submitRefine}
              disabled={!motionReady || refining || !instruction.trim()}
              aria-label="Retoucher l'animation avec Claude"
              className="flex items-center gap-2 rounded-lg bg-pink px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Go"}
            </button>
          </div>
        </div>

        {note && (
          <p className={clsx("text-xs leading-relaxed", note.error ? "text-red-400" : "text-zinc-500")} role={note.error ? "alert" : "status"}>
            {note.text}
          </p>
        )}
      </div>
    </section>
  );
}
