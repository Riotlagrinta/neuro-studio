"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { Loader2, Music2, Trash2, Upload, X } from "lucide-react";
import clsx from "clsx";
import {
  MAX_FADE,
  acceptFor,
  checkPickedFile,
  fadeMax,
  fadeValue,
  fileSummary,
  formatSeconds,
  formatsLabel,
  limitLabel,
  loopsToEnd,
  newMusic,
  setFade,
  volumeFromPercent,
  volumePercent,
  type FadeKey,
} from "@/lib/motion/music-utils";
import type { Music } from "@/lib/motion/types";
import { uploadFile, UploadError, type UploadProgress } from "@/lib/upload-client";

interface Props {
  music: Music | null;
  /** Length of the whole video, in seconds: the fades have to fit in it. */
  totalSeconds: number;
  /** Signed in and invited. Without it the dropzone is disabled ("Connexion requise"). */
  canUpload: boolean;
  /** `key` lets the moves of one slider merge into a single undo step; without it the change is a step of its own. */
  onSet: (music: Music | null, key?: string) => void;
  /** The music row of the timeline is the current selection. */
  selected?: boolean;
}

/** The upload under way. */
interface Sending {
  name: string;
  phase: UploadProgress["phase"];
  ratio: number;
}

/** What the browser reported about the file just uploaded; the project does not keep it, so it is only known until the panel is closed. */
interface Known {
  url: string;
  bytes: number;
  duration?: number;
}

const FADES: { key: FadeKey; label: string }[] = [
  { key: "fadeIn", label: "Fondu d'entrée" },
  { key: "fadeOut", label: "Fondu de sortie" },
];

const FAILED = "L'envoi a échoué : réessayez dans un instant.";

const smallButton =
  "flex shrink-0 items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40";

function Slider({
  label,
  caption,
  value,
  max,
  step,
  readout,
  title,
  onChange,
}: {
  /** Accessible name. */
  label: string;
  caption: string;
  value: number;
  max: number;
  step: number;
  readout: string;
  title?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1" title={title}>
      <span className="label flex items-center justify-between">
        {caption}
        <span className="text-zinc-400" aria-hidden="true">
          {readout}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={readout}
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={max <= 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
    </label>
  );
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

export default function MusicPanel({ music, totalSeconds, canUpload, onSet, selected = false }: Props) {
  const [sending, setSending] = useState<Sending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Known | null>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  // An upload outlives many renders: when it ends it must call the current onSet and use the current length.
  const latest = useRef({ onSet, totalSeconds });
  useEffect(() => {
    latest.current = { onSet, totalSeconds };
  });
  // A panel that goes away must not drop a track into whatever project is open by the time the upload ends.
  useEffect(() => () => upload.current?.abort(), []);

  /** Frees the panel for the next file, unless a newer upload has taken the slot in the meantime. */
  const release = (controller: AbortController) => {
    if (upload.current !== controller) return;
    upload.current = null;
    setSending(null);
  };

  const send = async (file: File) => {
    if (upload.current || !canUpload) return;
    setError(null);
    const refusal = checkPickedFile(file, "audio");
    if (refusal) {
      setError(refusal);
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setSending({ name: file.name, phase: "preparing", ratio: 0 });
    try {
      const uploaded = await uploadFile(file, "audio", {
        signal: controller.signal,
        onProgress: ({ phase, ratio }) => {
          if (!controller.signal.aborted) setSending({ name: file.name, phase, ratio });
        },
      });
      if (controller.signal.aborted) return;
      setKnown({ url: uploaded.url, bytes: uploaded.bytes, duration: uploaded.duration });
      latest.current.onSet(newMusic(uploaded.url, file.name, latest.current.totalSeconds));
    } catch (e) {
      // A cancelled upload rejects with an AbortError: that is the user's choice, not a failure to report.
      if (!controller.signal.aborted) setError(e instanceof UploadError ? e.message : FAILED);
    } finally {
      release(controller);
    }
  };

  const cancel = () => {
    const controller = upload.current;
    if (!controller) return;
    controller.abort();
    release(controller); // at once: the signing request in flight cannot be interrupted and may take a while to notice
  };

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so that the same file can be picked again
    if (file) void send(file);
  };

  const remove = () => {
    setError(null);
    setKnown(null);
    onSet(null);
  };

  const summary = music && known?.url === music.url ? fileSummary(known.bytes, known.duration) : "";
  const loops = music && known?.url === music.url && loopsToEnd(known.duration, totalSeconds);
  const limited = music && FADES.some(({ key }) => fadeMax(music, key, totalSeconds) < MAX_FADE);

  const adjust = (key: FadeKey, value: number) => {
    if (!music) return;
    const next = setFade(music, key, value, totalSeconds);
    if (next.fadeIn !== music.fadeIn || next.fadeOut !== music.fadeOut) onSet(next, `music-${key}`);
  };

  let body: ReactNode;
  if (sending) {
    const sent = sending.phase === "uploading";
    const percent = Math.round(Math.min(1, Math.max(0, sending.ratio)) * 100);
    const status = sending.phase === "preparing" ? "Préparation du fichier…" : sent ? `Envoi en cours · ${percent} %` : "Vérification du fichier…";
    body = (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-cream" title={sending.name}>
            {sending.name}
          </p>
          <button type="button" onClick={cancel} aria-label="Annuler l'envoi" className={`${smallButton} hover:border-red-500/50 hover:text-red-400`}>
            <X className="h-3.5 w-3.5" /> Annuler
          </button>
        </div>
        <div
          role="progressbar"
          aria-label="Envoi de la musique"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sent ? percent : undefined}
          aria-valuetext={status}
          className="h-1.5 overflow-hidden rounded-full bg-line-2"
        >
          <div className={clsx("h-full rounded-full bg-accent transition-[width]", !sent && "animate-pulse")} style={{ width: `${sent ? percent : 100}%` }} />
        </div>
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" /> {status}
        </p>
      </div>
    );
  } else if (music) {
    body = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-cream" title={music.name}>
              {music.name}
            </p>
            {summary && <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{summary}</p>}
          </div>
          <button type="button" onClick={remove} aria-label="Retirer la musique" title="Retirer la musique du projet" className={`${smallButton} hover:border-red-500/50 hover:text-red-400`}>
            <Trash2 className="h-3.5 w-3.5" /> Retirer
          </button>
        </div>

        <Slider
          label="Volume de la musique"
          caption="Volume"
          value={volumePercent(music.volume)}
          max={100}
          step={1}
          readout={`${volumePercent(music.volume)} %`}
          onChange={(percent) => onSet({ ...music, volume: volumeFromPercent(percent) }, "music-volume")}
        />
        {FADES.map(({ key, label }) => {
          const value = fadeValue(music, key, totalSeconds);
          return (
            <Slider
              key={key}
              label={label}
              caption={label}
              value={value}
              max={fadeMax(music, key, totalSeconds)}
              step={0.1}
              readout={formatSeconds(value)}
              title="Les deux fondus tiennent dans la durée de la vidéo"
              onChange={(next) => adjust(key, next)}
            />
          );
        })}
        {limited && <p className="font-mono text-[9px] text-zinc-600">Les deux fondus tiennent dans la durée de la vidéo ({formatSeconds(totalSeconds)}).</p>}

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" checked={music.duck} onChange={(e) => onSet({ ...music, duck: e.target.checked })} className="h-4 w-4 accent-accent" />
          Baisser la musique pendant la voix
        </label>
        {loops && <p className="font-mono text-[10px] text-zinc-500">La musique boucle jusqu&apos;à la fin</p>}
      </div>
    );
  } else {
    const drop = canUpload && over;
    body = (
      <div
        onDragEnter={(e) => {
          if (hasFiles(e) && canUpload) setOver(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault(); // or the browser opens the file in place of the project
          e.dataTransfer.dropEffect = canUpload ? "copy" : "none";
        }}
        onDragLeave={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOver(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void send(file);
        }}
        className={clsx("rounded-lg border border-dashed transition-colors", drop ? "border-accent bg-accent/10" : "border-line-2 bg-ink")}
      >
        <button
          type="button"
          aria-label="Ajouter une musique"
          aria-describedby={hintId}
          disabled={!canUpload}
          title={canUpload ? "Choisir un fichier audio, ou le déposer ici" : "Connexion requise"}
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1.5 rounded-lg px-3 py-4 text-zinc-400 transition-colors enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload className="h-5 w-5" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{canUpload ? "Cliquez ou déposez un fichier audio" : "Connexion requise"}</span>
        </button>
        <input ref={input} type="file" accept={acceptFor("audio")} aria-label="Fichier de musique" disabled={!canUpload} onChange={pick} className="hidden" />
      </div>
    );
  }

  return (
    <section className={clsx("space-y-3 rounded-xl border bg-panel p-3", selected ? "border-accent/60" : "border-line")} aria-label="Musique de fond">
      <p className="label flex items-center gap-1.5">
        <Music2 className="h-3 w-3" /> Musique de fond
      </p>
      {body}
      {!music && !sending && (
        <p id={hintId} className="font-mono text-[10px] text-zinc-600">
          Formats : {formatsLabel("audio")} · {limitLabel("audio")} maximum
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-relaxed text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
