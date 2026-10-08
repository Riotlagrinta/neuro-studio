"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileDown, History, Loader2, Save, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import {
  checkVideoJob,
  generateImage,
  generateMotionProject,
  getProject,
  getStudioCapabilities,
  refineMotionScene,
  saveProject,
  startVideoJob,
  synthesizeVoice,
  type GenerateInput,
  type StudioCapabilities,
} from "./actions";
import BriefForm from "@/components/BriefForm";
import MotionPlayer, { type MotionPlayerHandle } from "@/components/MotionPlayer";
import SceneCard, { type BusyKind } from "@/components/SceneCard";
import { explain } from "@/lib/errors";
import { exportProjectToWebm } from "@/lib/motion/export";
import { buildSampleProject } from "@/lib/motion/sample";
import { ensureMediaLayer } from "@/lib/motion/sanitize";
import { projectDuration, type AspectRatio, type MotionProject, type MotionScene } from "@/lib/motion/types";
import { exportScriptPdf } from "@/lib/script-pdf";
import type { VoiceProviderId } from "@/lib/voice-providers";

const STAGES = [
  "Claude Opus lit votre brief…",
  "Écriture de la narration…",
  "Mise en scène : calques et keyframes…",
  "Réglage des easings et des transitions…",
  "Dernières vérifications…",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Narration length + a short tail, so the picture doesn't cut the voice. */
const fitDuration = (audioSeconds: number) => Math.round((audioSeconds + 0.6) * 10) / 10;

function audioDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : undefined);
    audio.onerror = () => resolve(undefined);
    audio.src = url;
  });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type Note = { text: string; error: boolean };

const select =
  "w-full rounded-lg border border-[#222] bg-black px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500/50 disabled:opacity-40";

export default function Home() {
  const [project, setProject] = useState<MotionProject | null>(null);
  const [topic, setTopic] = useState("");
  const [caps, setCaps] = useState<StudioCapabilities | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<number, BusyKind | undefined>>({});
  const [notes, setNotes] = useState<Record<number, Note | undefined>>({});
  const [bulk, setBulk] = useState<"voice" | "image" | null>(null);
  const [voice, setVoice] = useState<{ provider: VoiceProviderId; voiceId: string }>({ provider: "elevenlabs", voiceId: "" });
  const [videoModelId, setVideoModelId] = useState("seedance");
  const [activeScene, setActiveScene] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportPct, setExportPct] = useState<number | null>(null);

  const playerRef = useRef<MotionPlayerHandle>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    getStudioCapabilities().then((c) => {
      if (!alive.current) return;
      setCaps(c);
      const provider = c.voices.find((v) => v.available) ?? c.voices[0];
      if (provider) setVoice({ provider: provider.id, voiceId: provider.voices[0]?.id ?? "" });
      if (c.videoModels[0]) setVideoModelId(c.videoModels[0].id);
    });

    // Reopen a project from the archives: /?project=ID
    const id = Number(new URLSearchParams(window.location.search).get("project"));
    if (Number.isInteger(id) && id > 0) {
      getProject(id).then((r) => {
        if (!alive.current) return;
        if (r.success) {
          setProject(r.data);
          setTopic(r.topic);
        } else {
          setError(explain(r.error));
        }
      });
    }
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 12000);
    return () => clearInterval(timer);
  }, [generating]);

  const motionReady = !!caps?.motion;
  const providerInfo = caps?.voices.find((v) => v.id === voice.provider);
  const voiceReady = !!providerInfo?.available && !!voice.voiceId;
  const videoModel = caps?.videoModels.find((m) => m.id === videoModelId);

  // ---- project-level actions ----

  const generate = async (input: GenerateInput) => {
    setGenerating(true);
    setStage(0);
    setError("");
    try {
      const result = await generateMotionProject(input);
      if (result.success) {
        setProject(result.data);
        setTopic(input.topic);
        setActiveScene(0);
      } else {
        setError(explain(result.error));
      }
    } catch {
      setError("Connexion au serveur interrompue. Réessayez.");
    } finally {
      setGenerating(false);
    }
  };

  const openDemo = (ratio: AspectRatio) => {
    setError("");
    setTopic("Démo");
    setProject(buildSampleProject(ratio));
    setActiveScene(0);
  };

  const closeProject = () => {
    setProject(null);
    setBusy({});
    setNotes({});
    setSaved(false);
  };

  const patchScene = (index: number, update: (scene: MotionScene) => MotionScene) => {
    setSaved(false);
    setProject((p) => (p ? { ...p, scenes: p.scenes.map((s, i) => (i === index ? update(s) : s)) } : p));
  };

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const result = await saveProject(topic, project);
      if (result.success) {
        setSaved(true);
        setError("");
      } else {
        setError(explain(result.error));
      }
    } catch {
      setError("Connexion au serveur interrompue.");
    } finally {
      setSaving(false);
    }
  };

  const handleExportVideo = async () => {
    if (!project) return;
    setError("");
    setExportPct(0);
    try {
      const blob = await exportProjectToWebm(project, (fraction) => setExportPct(Math.round(fraction * 100)));
      const name = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "neuro-studio";
      download(blob, `${name}.webm`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'export vidéo.");
    } finally {
      setExportPct(null);
    }
  };

  const handleExportPdf = async () => {
    if (!project) return;
    setPdfBusy(true);
    try {
      await exportScriptPdf(project);
    } finally {
      setPdfBusy(false);
    }
  };

  // ---- per-scene generation ----

  const runScene = async (index: number, kind: BusyKind, job: () => Promise<{ error?: string }>) => {
    setBusy((b) => ({ ...b, [index]: kind }));
    setNotes((n) => ({ ...n, [index]: undefined }));
    try {
      const { error: code } = await job();
      if (alive.current) setNotes((n) => ({ ...n, [index]: code ? { text: explain(code), error: true } : undefined }));
    } catch {
      if (alive.current) setNotes((n) => ({ ...n, [index]: { text: "Connexion au serveur interrompue.", error: true } }));
    } finally {
      if (alive.current) setBusy((b) => ({ ...b, [index]: undefined }));
    }
  };

  const makeVoice = (index: number) => {
    if (!project) return Promise.resolve();
    const scene = project.scenes[index];
    return runScene(index, "voice", async () => {
      const result = await synthesizeVoice(scene.voiceOver, voice.provider, voice.voiceId);
      if (!result.success) return { error: result.error };
      const seconds = result.duration ?? (await audioDuration(result.url));
      // The narration drives the scene length.
      patchScene(index, (s) => ({ ...s, audioUrl: result.url, ...(seconds ? { duration: fitDuration(seconds) } : {}) }));
      return {};
    });
  };

  const makeImage = (index: number) => {
    if (!project) return Promise.resolve();
    const { ratio } = project;
    const scene = project.scenes[index];
    return runScene(index, "image", async () => {
      const result = await generateImage(scene.visualPrompt, ratio);
      if (!result.success) return { error: result.error };
      patchScene(index, (s) => ensureMediaLayer({ ...s, imageUrl: result.url }, ratio));
      return {};
    });
  };

  const makeVideo = (index: number) => {
    if (!project) return Promise.resolve();
    const { ratio } = project;
    const scene = project.scenes[index];
    return runScene(index, "video", async () => {
      const start = await startVideoJob({ modelId: videoModelId, prompt: scene.visualPrompt, imageUrl: scene.imageUrl, ratio, duration: scene.duration });
      if (!start.success) return { error: start.error };
      setNotes((n) => ({ ...n, [index]: { text: "Plan vidéo en cours de génération (1 à 3 minutes)…", error: false } }));
      for (let attempt = 0; attempt < 150 && alive.current; attempt++) {
        await sleep(4000);
        const status = await checkVideoJob(start.id);
        if (!status.success) return { error: status.error };
        if (status.status === "succeeded") {
          patchScene(index, (s) => ensureMediaLayer({ ...s, videoUrl: status.url }, ratio));
          return {};
        }
      }
      return { error: "VIDEO_TIMEOUT" };
    });
  };

  const refine = (index: number, instruction: string) => {
    if (!project) return Promise.resolve();
    const { title, palette, ratio, scenes } = project;
    return runScene(index, "refine", async () => {
      const result = await refineMotionScene({ title, palette, ratio, index, total: scenes.length, scene: scenes[index], instruction });
      if (!result.success) return { error: result.error };
      patchScene(index, () => result.data);
      return {};
    });
  };

  const generateAll = async (kind: "voice" | "image") => {
    if (!project) return;
    setBulk(kind);
    for (let i = 0; i < project.scenes.length && alive.current; i++) {
      const scene = project.scenes[i];
      if (kind === "voice" && !scene.audioUrl && scene.voiceOver.trim()) await makeVoice(i);
      if (kind === "image" && !scene.imageUrl && scene.visualPrompt.trim()) await makeImage(i);
    }
    if (alive.current) setBulk(null);
  };

  // ---- render ----

  return (
    <div className="min-h-screen bg-black text-white selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-[#1a1a1a] bg-black/80 px-6 backdrop-blur-md md:px-8">
        <button onClick={closeProject} className="flex items-center gap-3" aria-label="Retour à l'accueil">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600 shadow-[0_0_15px_-3px_rgba(79,70,229,0.5)]">
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          <span className="text-sm font-bold uppercase tracking-widest">NeuroStudio</span>
        </button>
        <div className="flex items-center gap-5">
          {project && (
            <span className="hidden rounded border border-[#222] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 sm:block">
              {project.ratio} · {projectDuration(project).toFixed(1)} s
            </span>
          )}
          <Link href="/archives" className="flex items-center gap-2 text-zinc-500 transition-colors hover:text-white">
            <History className="h-5 w-5" />
            <span className="hidden text-[10px] font-bold uppercase tracking-widest sm:inline">Archives</span>
          </Link>
          <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-400">
            Motion v6
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-14 md:py-20">
        {error && (
          <div role="alert" className="mb-8 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!project && !generating && <BriefForm motionReady={motionReady} onGenerate={generate} onDemo={openDemo} />}

        {generating && (
          <div className="flex h-[45vh] flex-col items-center justify-center gap-6 text-center">
            <div className="relative">
              <Loader2 className="h-14 w-14 animate-spin text-indigo-500" />
              <div className="absolute inset-0 animate-pulse bg-indigo-500/30 blur-xl" />
            </div>
            <p className="animate-pulse text-xs font-bold uppercase tracking-widest text-zinc-400">{STAGES[stage]}</p>
            <p className="max-w-sm text-sm text-zinc-600">Opus compose toute l&apos;animation : comptez entre 30 secondes et 2 minutes.</p>
          </div>
        )}

        {project && (
          <div className="space-y-10">
            <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a] p-6 shadow-2xl md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <span className="rounded bg-indigo-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-500">{project.category}</span>
                <input
                  value={project.title}
                  onChange={(e) => {
                    setSaved(false);
                    setProject({ ...project, title: e.target.value });
                  }}
                  aria-label="Titre du projet"
                  className="mt-2 block w-full border-b border-transparent bg-transparent text-3xl font-bold outline-none transition-all focus:border-indigo-500/30"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg border border-[#333] bg-[#1a1a1a] px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all hover:bg-[#2a2a2a]"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Save className="h-4 w-4" />}
                  {saved ? "Enregistré" : "Sauvegarder"}
                </button>
                <button
                  onClick={handleExportPdf}
                  disabled={pdfBusy}
                  className="flex items-center gap-2 rounded-lg border border-[#333] bg-[#1a1a1a] px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all hover:bg-[#2a2a2a]"
                >
                  {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  PDF
                </button>
                <button
                  onClick={handleExportVideo}
                  disabled={exportPct !== null}
                  className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-black transition-all hover:bg-indigo-500 hover:text-white disabled:opacity-70"
                >
                  {exportPct !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  {exportPct !== null ? `Export ${exportPct}%` : "Exporter la vidéo"}
                </button>
              </div>
            </div>
            {exportPct !== null && (
              <p className="-mt-6 text-xs text-zinc-500">
                L&apos;export enregistre la vidéo en temps réel : gardez cet onglet visible jusqu&apos;à la fin.
              </p>
            )}

            <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
              <div className="order-2 space-y-6 lg:order-1">
                <div className="grid gap-4 rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a] p-5 sm:grid-cols-3">
                  <label className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Fournisseur de voix</span>
                    <select
                      value={voice.provider}
                      onChange={(e) => {
                        const provider = caps?.voices.find((v) => v.id === e.target.value);
                        if (provider) setVoice({ provider: provider.id, voiceId: provider.voices[0]?.id ?? "" });
                      }}
                      className={select}
                    >
                      {caps?.voices.map((v) => (
                        <option key={v.id} value={v.id} disabled={!v.available}>
                          {v.label}
                          {v.available ? "" : " (sans clé)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Voix</span>
                    <select value={voice.voiceId} onChange={(e) => setVoice({ ...voice, voiceId: e.target.value })} disabled={!providerInfo?.available} className={select}>
                      {providerInfo?.voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Moteur vidéo IA</span>
                    <select value={videoModelId} onChange={(e) => setVideoModelId(e.target.value)} disabled={!caps?.videoAvailable} className={select}>
                      {caps?.videoModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
                  <button
                    onClick={() => generateAll("voice")}
                    disabled={!voiceReady || bulk !== null}
                    className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-zinc-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {bulk === "voice" && <Loader2 className="h-3 w-3 animate-spin" />} Toutes les voix
                  </button>
                  <button
                    onClick={() => generateAll("image")}
                    disabled={bulk !== null}
                    className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-zinc-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {bulk === "image" && <Loader2 className="h-3 w-3 animate-spin" />} Tous les fonds
                  </button>
                  {caps?.quota && providerInfo?.id === "elevenlabs" && (
                    <span className="text-zinc-600">{caps.quota.remaining.toLocaleString("fr-FR")} caractères ElevenLabs restants</span>
                  )}
                  {!caps?.videoAvailable && <span className="text-zinc-600">REPLICATE_API_TOKEN manquant : plans vidéo IA désactivés</span>}
                </div>

                {project.scenes.map((scene, i) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    index={i}
                    active={i === activeScene}
                    busy={busy[i]}
                    note={notes[i]}
                    voiceReady={voiceReady}
                    videoReady={!!caps?.videoAvailable}
                    videoBlocked={!!videoModel?.needsImage && !scene.imageUrl}
                    motionReady={motionReady}
                    onChange={(patch) => patchScene(i, (s) => ({ ...s, ...patch }))}
                    onSeek={() => playerRef.current?.seekToScene(i)}
                    onVoice={() => makeVoice(i)}
                    onImage={() => makeImage(i)}
                    onVideo={() => makeVideo(i)}
                    onRefine={(instruction) => refine(i, instruction)}
                  />
                ))}
              </div>

              <div className={clsx("order-1 lg:order-2 lg:sticky lg:top-24")}>
                <MotionPlayer ref={playerRef} project={project} onSceneChange={setActiveScene} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
