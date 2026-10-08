"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, FileDown, History, Loader2, Redo2, Save, Undo2, Video } from "lucide-react";
import Link from "next/link";
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
import AccountMenu from "@/components/AccountMenu";
import BriefForm, { type Gate } from "@/components/BriefForm";
import EditToolbar from "@/components/EditToolbar";
import LayerInspector, { type TransformProp } from "@/components/LayerInspector";
import GeneratingTimeline from "@/components/GeneratingTimeline";
import { HeroReel, KineticTitle, SweepRuler } from "@/components/Hero";
import MotionPlayer, { type MotionPlayerHandle } from "@/components/MotionPlayer";
import MusicPanel from "@/components/MusicPanel";
import SceneCard, { type BusyKind, type ImportKind } from "@/components/SceneCard";
import Timeline, { type TimelineHandle } from "@/components/Timeline";
import { explain } from "@/lib/errors";
import { EXPORT_QUALITIES, exportProjectToWebm, type ExportQuality } from "@/lib/motion/export";
import { ExportUnavailableError, exportProject } from "@/lib/motion/export-mp4";
import { EXPORT_PRESETS, exportFilename } from "@/lib/motion/export-plan";
import { buildSampleProject } from "@/lib/motion/sample";
import { generateCaptionLayer } from "@/lib/motion/captions";
import { deleteLayer, snapToFrame, trimLayer, updateLayer } from "@/lib/motion/edit";
import { addLayer, createLayer, duplicateLayer, MAX_LAYERS, reorderLayer, type LayerReorder, type NewLayerKind } from "@/lib/motion/layers";
import { setTrackAt } from "@/lib/motion/manipulate";
import { ensureMediaLayer, MAX_SCENES } from "@/lib/motion/sanitize";
import { addScene, deleteScene, duplicateScene, splitScene } from "@/lib/motion/scenes";
import type { Selection } from "@/lib/motion/selection";
import { locate, projectDuration, sceneStart, type AspectRatio, type Music, type MotionProject, type MotionScene } from "@/lib/motion/types";
import { formatUsd, VOICE_RATES, voiceCost } from "@/lib/pricing";
import { exportScriptPdf } from "@/lib/script-pdf";
import { uploadFile, UploadError } from "@/lib/upload-client";
import { useHistory } from "@/lib/useHistory";
import { getVideoModel, QUALITY_LABELS, videoCost, VIDEO_QUALITIES, type VideoQuality } from "@/lib/video-models";
import type { VoiceProviderId } from "@/lib/voice-providers";

const STAGES = [
  "Claude Opus lit votre brief",
  "Écriture de la narration",
  "Mise en scène : calques et keyframes",
  "Réglage des easings et des transitions",
  "Dernières vérifications",
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

const AUTH_ERRORS: Record<string, string> = {
  AccessDenied: "Ce compte Google n'est pas invité. Demandez un accès à l'administrateur.",
};

type Note = { text: string; error: boolean };

const select =
  "w-full min-w-0 rounded-md border border-line-2 bg-ink px-2 py-2 text-xs text-zinc-200 outline-none focus:border-accent disabled:opacity-40";
const toolButton =
  "flex items-center gap-2 rounded-md border border-line-2 bg-panel-2 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300 transition-colors hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-accent" />
      <path d="M11 8v16" stroke="#f472b6" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 8l-3-3h6z" fill="#f472b6" />
      <rect x="16" y="13" width="7" height="7" rx="1" transform="rotate(45 19.5 16.5)" fill="#fbbf24" />
    </svg>
  );
}

export default function Home() {
  // The project lives in an undo/redo history: every edit is a step, a drag is one step.
  const hist = useHistory<MotionProject | null>(null);
  const project = hist.present;
  const { reset: resetProject } = hist; // stable across renders, so effects that load a project run once
  const [selected, setSelected] = useState<Selection | null>(null);
  const [musicSelected, setMusicSelected] = useState(false);
  // Bumped whenever a different project replaces the current one: keeps per-project widget state (uploads…) from leaking across.
  const [epoch, setEpoch] = useState(0);
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState<Record<string, ImportKind | null | undefined>>({});
  const [topic, setTopic] = useState("");
  const [caps, setCaps] = useState<StudioCapabilities | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  // Per-scene state is keyed by the scene's uid, not its position: reordering mid-generation must not mix scenes up.
  const [busy, setBusy] = useState<Record<string, BusyKind | undefined>>({});
  const [notes, setNotes] = useState<Record<string, Note | undefined>>({});
  const [bulk, setBulk] = useState<"voice" | "image" | null>(null);
  const [voice, setVoice] = useState<{ provider: VoiceProviderId; voiceId: string }>({ provider: "elevenlabs", voiceId: "" });
  const [videoModelId, setVideoModelId] = useState("seedance");
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("eco");
  const [exportQuality, setExportQuality] = useState<ExportQuality>("720p");
  const [activeScene, setActiveScene] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedProject, setSavedProject] = useState<MotionProject | null>(null);
  // "Saved" means: what is on screen is exactly what was last saved (so undoing back to it counts too).
  const saved = !!project && project === savedProject;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportPct, setExportPct] = useState<number | null>(null);
  // "fast": frames encoded one by one, faster than playback (MP4 or WebM). "realtime": the tab is recorded while it plays.
  const [exportMode, setExportMode] = useState<"fast" | "realtime">("fast");
  const exportAbort = useRef<AbortController | null>(null);

  // The playhead is not React state (the player drives the timeline through refs). The inspector needs it as a value,
  // so it gets a throttled copy: at most ~8 renders a second while playing, one right after a seek.
  const [playhead, setPlayhead] = useState(0);

  const playerRef = useRef<MotionPlayerHandle>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const alive = useRef(true);
  const timeRef = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => {
    alive.current = true;
    getStudioCapabilities().then((c) => {
      if (!alive.current) return;
      setCaps(c);
      const provider = c.voices.find((v) => v.available) ?? c.voices[0];
      if (provider) setVoice({ provider: provider.id, voiceId: provider.voices[0]?.id ?? "" });
      if (c.videoModels[0]) setVideoModelId(c.videoModels[0].id);
      setVideoQuality(c.videoDefaultQuality);
    });

    const params = new URLSearchParams(window.location.search);

    // Auth.js sends failed sign-ins back here as /?error=…
    const authError = params.get("error");
    if (authError) {
      setError(AUTH_ERRORS[authError] ?? `La connexion a échoué (${authError}).`);
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Reopen a project from the archives: /?project=ID
    const id = Number(params.get("project"));
    if (Number.isInteger(id) && id > 0) {
      getProject(id).then((r) => {
        if (!alive.current) return;
        if (r.success) {
          resetProject(r.data);
          setEpoch((e) => e + 1);
          setTopic(r.topic);
        } else {
          setError(explain(r.error));
        }
      });
    }
    return () => {
      alive.current = false;
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, [resetProject]);

  // A scene added, duplicated or deleted by a button: once the new project has rendered (the player has taken it), move the playhead to it.
  useEffect(() => {
    if (pendingSeek.current === null) return;
    playerRef.current?.seekToScene(pendingSeek.current);
    pendingSeek.current = null;
  }, [project]);

  // Opening a project replaces the whole page: start at the top, not where the landing page was scrolled.
  const hasProject = !!project;
  useEffect(() => {
    if (hasProject) window.scrollTo(0, 0);
  }, [hasProject]);

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 12000);
    return () => clearInterval(timer);
  }, [generating]);

  // What this visitor may do. Paid features need a signed-in, invited account.
  const canUse = !!caps?.auth.allowed;
  const motionReady = canUse && !!caps?.motion;
  const providerInfo = caps?.voices.find((v) => v.id === voice.provider);
  const voiceReady = canUse && !!providerInfo?.available && !!voice.voiceId;
  const videoModel = getVideoModel(videoModelId);

  let gate: Gate;
  if (!caps) gate = { canCreate: false, message: null, showSignIn: false };
  else if (!caps.auth.configured)
    gate = { canCreate: false, message: "La connexion n'est pas configurée (AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET). La démo reste accessible.", showSignIn: false };
  else if (!caps.auth.user)
    gate = { canCreate: false, message: "Connectez-vous pour créer une animation. La démo reste accessible sans compte.", showSignIn: true };
  else if (!caps.auth.allowed) gate = { canCreate: false, message: "Votre compte n'a pas accès : l'accès est sur invitation.", showSignIn: false };
  else if (!caps.motion)
    gate = { canCreate: false, message: "ANTHROPIC_API_KEY n'est pas configurée : la génération par Claude est désactivée.", showSignIn: false };
  else gate = { canCreate: true, message: null, showSignIn: false };

  // ---- project-level actions ----

  const generate = async (input: GenerateInput) => {
    setGenerating(true);
    setStage(0);
    setError("");
    try {
      const result = await generateMotionProject(input);
      if (result.success) {
        hist.reset(result.data);
        setEpoch((e) => e + 1);
        setMusicSelected(false);
        setSavedProject(null);
        setSelected(null);
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
    hist.reset(buildSampleProject(ratio));
    setEpoch((e) => e + 1);
    setMusicSelected(false);
    setSavedProject(null);
    setSelected(null);
    setActiveScene(0);
  };

  const closeProject = () => {
    hist.reset(null);
    setEpoch((e) => e + 1);
    setMusicSelected(false);
    setSelected(null);
    setImporting({});
    setBusy({});
    setNotes({});
    setSavedProject(null);
  };

  const withScene = (p: MotionProject | null, index: number, update: (scene: MotionScene) => MotionScene) => {
    if (!p) return p;
    const current = p.scenes[index];
    const next = update(current);
    return next === current ? p : { ...p, scenes: p.scenes.map((s, i) => (i === index ? next : s)) };
  };
  /** An edit: one undo step (edits sharing a `key` within a moment merge, e.g. typing). */
  const patchScene = (index: number, update: (scene: MotionScene) => MotionScene, key?: string) => hist.set((p) => withScene(p, index, update), key);
  /** A generated asset (voice, image, video): applied to every undo step, so undo can't take a paid result away. */
  const withSceneUid = (p: MotionProject | null, uid: string, update: (scene: MotionScene) => MotionScene) => {
    const index = p ? p.scenes.findIndex((s) => s.uid === uid) : -1;
    return index < 0 ? p : withScene(p, index, update); // the scene may have been deleted while it was generating
  };
  const patchAssets = (uid: string, update: (scene: MotionScene) => MotionScene) => hist.patchAll((p) => withSceneUid(p, uid, update));

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const result = await saveProject(topic, project);
      if (result.success) {
        setSavedProject(project);
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
    setExportMode("fast");
    const controller = new AbortController();
    exportAbort.current = controller;
    const onProgress = (fraction: number) => setExportPct(Math.round(fraction * 100));
    try {
      try {
        const result = await exportProject(project, onProgress, { preset: EXPORT_PRESETS[exportQuality], signal: controller.signal });
        download(result.blob, exportFilename(project.title, result.container, exportQuality));
        if (result.warnings.length > 0) say(result.warnings.join(" "));
      } catch (e) {
        if (!(e instanceof ExportUnavailableError)) throw e;
        // This browser cannot encode frame by frame (or the file would not fit in memory): record the tab as it plays.
        setExportMode("realtime");
        setExportPct(0);
        const blob = await exportProjectToWebm(project, onProgress, { quality: exportQuality, signal: controller.signal });
        download(blob, exportFilename(project.title, "realtime", exportQuality));
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Échec de l'export vidéo.");
    } finally {
      exportAbort.current = null;
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

  const runScene = async (uid: string, kind: BusyKind, job: () => Promise<{ error?: string }>) => {
    setBusy((b) => ({ ...b, [uid]: kind }));
    setNotes((n) => ({ ...n, [uid]: undefined }));
    try {
      const { error: code } = await job();
      if (alive.current) setNotes((n) => ({ ...n, [uid]: code ? { text: explain(code), error: true } : undefined }));
    } catch {
      if (alive.current) setNotes((n) => ({ ...n, [uid]: { text: "Connexion au serveur interrompue.", error: true } }));
    } finally {
      if (alive.current) setBusy((b) => ({ ...b, [uid]: undefined }));
    }
  };

  const sceneOf = (uid: string) => project?.scenes.find((s) => s.uid === uid);

  const makeVoice = (uid: string) => {
    const scene = sceneOf(uid);
    if (!scene) return Promise.resolve();
    return runScene(uid, "voice", async () => {
      const result = await synthesizeVoice(scene.voiceOver, voice.provider, voice.voiceId);
      if (!result.success) return { error: result.error };
      const seconds = result.duration ?? (await audioDuration(result.url));
      // The narration drives the scene length.
      patchAssets(uid, (s) => ({ ...s, audioUrl: result.url, ...(seconds ? { duration: fitDuration(seconds) } : {}) }));
      return {};
    });
  };

  const makeImage = (uid: string) => {
    const scene = sceneOf(uid);
    if (!project || !scene) return Promise.resolve();
    const { ratio } = project;
    return runScene(uid, "image", async () => {
      const result = await generateImage(scene.visualPrompt, ratio);
      if (!result.success) return { error: result.error };
      patchAssets(uid, (s) => ensureMediaLayer({ ...s, imageUrl: result.url }, ratio));
      return {};
    });
  };

  const makeVideo = (uid: string) => {
    const scene = sceneOf(uid);
    if (!project || !scene) return Promise.resolve();
    const { ratio } = project;
    return runScene(uid, "video", async () => {
      const start = await startVideoJob({ modelId: videoModelId, prompt: scene.visualPrompt, imageUrl: scene.imageUrl, ratio, duration: scene.duration, quality: videoQuality });
      if (!start.success) return { error: start.error };
      setNotes((n) => ({ ...n, [uid]: { text: "Plan vidéo en cours de génération (1 à 3 minutes)…", error: false } }));
      for (let attempt = 0; attempt < 150 && alive.current; attempt++) {
        await sleep(4000);
        const status = await checkVideoJob(start.id);
        if (!status.success) return { error: status.error };
        if (status.status === "succeeded") {
          patchAssets(uid, (s) => ensureMediaLayer({ ...s, videoUrl: status.url }, ratio));
          return {};
        }
      }
      return { error: "VIDEO_TIMEOUT" };
    });
  };

  const refine = (uid: string, instruction: string) => {
    const scene = sceneOf(uid);
    if (!project || !scene) return Promise.resolve();
    const { title, palette, ratio, scenes } = project;
    return runScene(uid, "refine", async () => {
      const result = await refineMotionScene({ title, palette, ratio, index: scenes.indexOf(scene), total: scenes.length, scene, instruction });
      if (!result.success) return { error: result.error };
      hist.set((p) => withSceneUid(p, uid, () => result.data)); // an edit: one undo step
      return {};
    });
  };

  const generateAll = async (kind: "voice" | "image") => {
    if (!project) return;
    setBulk(kind);
    for (const scene of project.scenes) {
      if (!alive.current) break;
      if (kind === "voice" && !scene.audioUrl && scene.voiceOver.trim()) await makeVoice(scene.uid);
      if (kind === "image" && !scene.imageUrl && scene.visualPrompt.trim()) await makeImage(scene.uid);
    }
    if (alive.current) setBulk(null);
  };

  // ---- render ----

  const scene = project?.scenes[Math.min(activeScene, (project?.scenes.length ?? 1) - 1)];
  const sceneIndex = project ? Math.min(activeScene, project.scenes.length - 1) : 0;

  const selectedLayer = scene && selected && selected.scene === scene.uid ? (scene.layers.find((l) => l.id === selected.layer) ?? null) : null;
  const say = (text: string) => {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 4500);
  };
  /** Selects a layer (or nothing). The music and a layer are never selected together. */
  const pick = (next: Selection | null) => {
    setSelected(next);
    if (next) setMusicSelected(false);
  };
  const pickMusic = () => {
    setMusicSelected(true);
    setSelected(null);
  };

  /** Every painted frame: the timeline follows by ref, the inspector gets a throttled copy as state. */
  const onFrame = (t: number) => {
    timelineRef.current?.setTime(t);
    timeRef.current = t;
    if (flushTimer.current === null) {
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        setPlayhead(timeRef.current);
      }, 120);
    }
  };
  /** Seconds into the active scene, from the player itself (exact, unlike the throttled state). */
  const localNow = () => Math.max(0, (playerRef.current?.getTime() ?? 0) - (project ? sceneStart(project, sceneIndex) : 0));

  // ---- editing: scenes ----

  const sceneCap = !!project && project.scenes.length >= MAX_SCENES;
  const capMessage = `Maximum de ${MAX_SCENES} scènes.`;
  /** Applies a scene operation. A refused one comes back as the same project: nothing changes and no undo step is made. */
  const applyScenes = (next: MotionProject, focus: number, seek: boolean) => {
    if (!project || next === project) return false;
    hist.set(() => next);
    setActiveScene(focus);
    if (seek) pendingSeek.current = focus;
    return true;
  };
  const selectScene = (index: number) => {
    setActiveScene(index);
    playerRef.current?.seekToScene(index);
  };
  const cutHere = () => {
    if (!project) return;
    if (sceneCap) return say(capMessage);
    const { index, local } = locate(project, playerRef.current?.getTime() ?? 0);
    // The playhead stays where it is, which is now the start of the second half.
    if (!applyScenes(splitScene(project, index, local), index + 1, false)) say("Coupe impossible ici : chaque morceau doit durer au moins 0,3 s.");
  };
  const copyScene = () => {
    if (!project) return;
    if (sceneCap) return say(capMessage);
    applyScenes(duplicateScene(project, sceneIndex), sceneIndex + 1, true);
  };
  const newScene = () => {
    if (!project) return;
    if (sceneCap) return say(capMessage);
    applyScenes(addScene(project, sceneIndex), sceneIndex + 1, true);
  };
  const dropScene = () => {
    if (!project) return;
    const next = deleteScene(project, sceneIndex);
    if (applyScenes(next, Math.min(sceneIndex, next.scenes.length - 1), true)) setSelected(null);
  };
  const canSplit = (() => {
    if (!project || sceneCap) return false;
    const here = locate(project, playhead);
    return here.local >= 0.3 && project.scenes[here.index].duration - here.local >= 0.3;
  })();

  // ---- editing: layers ----

  const insertLayer = (build: (s: MotionScene, ratio: AspectRatio, t: number) => ReturnType<typeof createLayer> | null, missing?: string) => {
    if (!project || !scene) return;
    const layer = build(scene, project.ratio, localNow());
    if (!layer) return say(missing ?? "Impossible d'ajouter ce calque.");
    const next = addLayer(scene, layer);
    if (next === scene) return say(`Maximum de ${MAX_LAYERS} calques par scène.`);
    patchScene(sceneIndex, () => next);
    pick({ scene: scene.uid, layer: next.layers[next.layers.length - 1].id }); // addLayer renames the layer on a collision: read the id back
  };
  const newLayer = (kind: NewLayerKind) => insertLayer((s, ratio, t) => createLayer(kind, s, ratio, t));
  const addCaptions = () => insertLayer((s, ratio) => generateCaptionLayer(s, ratio), "Cette scène n'a pas de narration à sous-titrer.");
  const captionEverything = () => {
    if (!project) return;
    let added = 0;
    const scenes = project.scenes.map((s) => {
      if (s.layers.some((l) => l.type === "captions")) return s;
      const layer = generateCaptionLayer(s, project.ratio);
      const next = layer ? addLayer(s, layer) : s;
      if (next !== s) added++;
      return next;
    });
    if (added === 0) return say("Aucune scène à sous-titrer : il faut une narration, et les scènes déjà sous-titrées sont ignorées.");
    hist.set(() => ({ ...project, scenes }));
    say(`Sous-titres ajoutés à ${added} scène${added > 1 ? "s" : ""}.`);
  };
  const editLayer = (patch: Record<string, unknown>, key: string) =>
    selectedLayer && patchScene(sceneIndex, (s) => updateLayer(s, selectedLayer.id, patch), `layer-${selectedLayer.id}-${key}`);
  const trimSelected = (edge: "start" | "end", t: number) =>
    selectedLayer && patchScene(sceneIndex, (s) => trimLayer(s, selectedLayer.id, edge, t), `trim-${selectedLayer.id}-${edge}`);
  const removeSelected = () => {
    if (!selectedLayer) return;
    patchScene(sceneIndex, (s) => deleteLayer(s, selectedLayer.id));
    setSelected(null);
  };
  const copyLayer = () => {
    if (!selectedLayer || !project || !scene) return;
    const next = duplicateLayer(scene, selectedLayer.id, project.ratio);
    if (next === scene) return say(`Maximum de ${MAX_LAYERS} calques par scène.`);
    patchScene(sceneIndex, () => next);
    pick({ scene: scene.uid, layer: next.layers[scene.layers.findIndex((l) => l.id === selectedLayer.id) + 1].id });
  };
  const restack = (to: LayerReorder) => {
    if (selectedLayer && project) patchScene(sceneIndex, (s) => reorderLayer(s, selectedLayer.id, to, project.ratio));
  };
  /** A number typed in the inspector: written at the playhead, so on an animated track it moves that keyframe. */
  const transform = (prop: TransformProp, value: number) => {
    if (!selectedLayer || !scene) return;
    const t = snapToFrame(Math.min(scene.duration, localNow()));
    patchScene(
      sceneIndex,
      (s) => {
        const layer = s.layers.find((l) => l.id === selectedLayer.id);
        return layer ? updateLayer(s, layer.id, { [prop]: setTrackAt(layer[prop], t, value, undefined, prop === "scale" || prop === "opacity" ? 3 : 2) }) : s;
      },
      `transform-${selectedLayer.id}-${prop}`,
    );
  };

  // ---- editing: music and imported media ----

  const setMusic = (music: Music | null, key?: string) =>
    hist.set((p) => {
      if (!p) return p;
      if (music) return { ...p, music };
      if (!p.music) return p;
      const rest = { ...p };
      delete rest.music;
      return rest;
    }, key);

  const importMedia = async (uid: string, kind: ImportKind, file: File) => {
    if (!project) return;
    const { ratio } = project;
    setImporting((m) => ({ ...m, [uid]: kind }));
    setNotes((n) => ({ ...n, [uid]: undefined }));
    try {
      const uploaded = await uploadFile(file, kind);
      patchAssets(uid, (s) => {
        if (kind === "image") return ensureMediaLayer({ ...s, imageUrl: uploaded.url }, ratio);
        const next = { ...s, videoUrl: uploaded.url };
        delete next.mediaOffset; // a new clip starts from its beginning
        return ensureMediaLayer(next, ratio);
      });
    } catch (e) {
      if (alive.current) setNotes((n) => ({ ...n, [uid]: { text: e instanceof UploadError ? e.message : "L'envoi a échoué. Réessayez.", error: true } }));
    } finally {
      if (alive.current) setImporting((m) => ({ ...m, [uid]: null }));
    }
  };

  // Keyboard: Ctrl/Cmd+Z undo, +Shift (or Y) redo, Ctrl/Cmd+D duplicate, Space play, ←/→ one frame (Shift: one second),
  // T text, S cut at the playhead, Delete the layer, Esc deselect. Ignored while typing in a field.
  // The handler is swapped every render so it always sees the current state.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKeyRef.current = (e) => {
      if (!project) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === "z" || key === "y") && !typing) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) hist.redo();
        else hist.undo();
        return;
      }
      if (mod && key === "d" && !typing) {
        e.preventDefault(); // the browser would bookmark the page
        if (selectedLayer) copyLayer();
        else copyScene();
        return;
      }
      if (typing || mod || e.altKey) return;
      const player = playerRef.current;
      if (e.code === "Space" && tag !== "BUTTON") {
        e.preventDefault();
        player?.togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (player) player.seek(player.getTime() + (e.shiftKey ? 1 : 1 / 30) * (e.key === "ArrowLeft" ? -1 : 1));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedLayer) {
        e.preventDefault();
        removeSelected();
      } else if (key === "t" && tag !== "BUTTON") {
        e.preventDefault();
        newLayer("text");
      } else if (key === "s" && tag !== "BUTTON") {
        e.preventDefault();
        cutHere();
      } else if (e.key === "Escape") {
        setSelected(null);
        setMusicSelected(false);
      }
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Estimated prices, shown before anyone spends (same numbers as the per-user caps).
  const videoEstimate = (s: MotionScene) =>
    videoModel && project ? videoCost(videoModel, { prompt: "", ratio: project.ratio, duration: s.duration, quality: videoQuality }) : 0;
  const tierEstimate = (q: VideoQuality, s: MotionScene) =>
    videoModel && project ? videoCost(videoModel, { prompt: "", ratio: project.ratio, duration: s.duration, quality: q }) : 0;
  const voiceEstimate = (s: MotionScene) => voiceCost(s.voiceOver.length, VOICE_RATES[voice.provider]);
  const remaining = project && {
    voice: project.scenes.reduce((n, s) => n + (s.audioUrl || !s.voiceOver.trim() ? 0 : voiceEstimate(s)), 0),
    video: project.scenes.reduce((n, s) => n + (s.videoUrl || !s.visualPrompt.trim() ? 0 : videoEstimate(s)), 0),
  };

  return (
    <div className="min-h-screen bg-ink text-cream selection:bg-pink/30">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-line bg-ink/85 px-5 backdrop-blur-md md:px-8">
        <button onClick={closeProject} className="flex items-center gap-3" aria-label="Retour à l'accueil">
          <LogoMark />
          <span className="font-display text-xl uppercase tracking-wide">NeuroStudio</span>
        </button>
        <div className="flex items-center gap-4 md:gap-5">
          <Link href="/archives" className="flex items-center gap-2 text-zinc-500 transition-colors hover:text-white">
            <History className="h-4 w-4" />
            <span className="label hidden text-inherit sm:inline">Archives</span>
          </Link>
          <AccountMenu auth={caps?.auth} />
        </div>
      </header>

      {error && (
        <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-6 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!project && !generating && (
        <>
          <SweepRuler />
          <div className="grid-rules">
            <div className="mx-auto grid max-w-7xl gap-12 px-6 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:py-20">
              <div className="space-y-8">
                <p className="label flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rotate-45 bg-amber" /> Motion design × IA
                </p>
                <KineticTitle />
                <p className="max-w-xl text-lg leading-relaxed text-zinc-400">
                  Décrivez votre vidéo. Claude Opus l&apos;anime — titres, formes, transitions — des voix IA la racontent, et des modèles vidéo génèrent les plans de fond.
                </p>
                <BriefForm gate={gate} maxSeconds={caps?.maxVideoSeconds ?? 60} onGenerate={generate} onDemo={openDemo} />
              </div>
              <div className="lg:sticky lg:top-24 lg:self-start">
                <HeroReel onOpen={() => openDemo("16:9")} />
              </div>
            </div>

            <div className="mx-auto grid max-w-7xl gap-px border-t border-line px-6 py-10 sm:grid-cols-3">
              {[
                ["01", "Écrire le brief", "Un sujet, un style, une durée. Claude écrit la narration et dirige chaque scène."],
                ["02", "Diriger la timeline", "Chaque calque, chaque keyframe est visible. Retouchez une scène en une phrase."],
                ["03", "Exporter", "Voix IA, fonds générés, plans vidéo : tout se mixe dans une vidéo prête à publier."],
              ].map(([n, title, text]) => (
                <div key={n} className="space-y-2 py-4 sm:px-6 sm:first:pl-0">
                  <p className="font-display text-4xl text-pink">{n}</p>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm leading-relaxed text-zinc-500">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {generating && (
        <div className="grid-rules flex min-h-[70vh] items-center px-6 py-16">
          <GeneratingTimeline stage={STAGES[stage]} />
        </div>
      )}

      {project && scene && (
        <div className="flex flex-col lg:h-[calc(100vh-4rem)]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-panel px-4 py-2.5">
            <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-0">
              <span className="label rounded bg-accent/15 px-2 py-1 text-indigo-300">{project.category}</span>
              <input
                value={project.title}
                onChange={(e) => hist.set((p) => (p ? { ...p, title: e.target.value } : p), "title")}
                aria-label="Titre du projet"
                className="min-w-0 flex-1 border-b border-transparent bg-transparent text-lg font-semibold outline-none transition-colors focus:border-pink/50"
              />
            </div>
            <span className="font-mono text-[11px] text-zinc-500">
              {project.ratio} · {projectDuration(project).toFixed(1)} s · {project.scenes.length} scènes
            </span>
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-1">
                <button onClick={hist.undo} disabled={!hist.canUndo} aria-label="Annuler" title="Annuler (Ctrl+Z)" className={`${toolButton} px-2.5`}>
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={hist.redo} disabled={!hist.canRedo} aria-label="Rétablir" title="Rétablir (Ctrl+Maj+Z)" className={`${toolButton} px-2.5`}>
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <button onClick={handleSave} disabled={saving || !canUse} title={canUse ? undefined : "Connectez-vous pour sauvegarder"} className={toolButton}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <CheckCircle2 className="h-3.5 w-3.5 text-mint" /> : <Save className="h-3.5 w-3.5" />}
                {saved ? "Enregistré" : "Sauvegarder"}
              </button>
              <button onClick={handleExportPdf} disabled={pdfBusy} className={toolButton}>
                {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} PDF
              </button>
              <select
                aria-label="Qualité d'export"
                value={exportQuality}
                onChange={(e) => setExportQuality(e.target.value as ExportQuality)}
                disabled={exportPct !== null}
                className="rounded-md border border-line-2 bg-panel-2 px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300 outline-none focus:border-accent disabled:opacity-40"
              >
                {EXPORT_QUALITIES.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
              {exportPct !== null && (
                <button onClick={() => exportAbort.current?.abort()} aria-label="Annuler l'export" className={toolButton}>
                  Annuler
                </button>
              )}
              <button
                onClick={handleExportVideo}
                disabled={exportPct !== null}
                className="flex items-center gap-2 rounded-md bg-cream px-3.5 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-ink transition-colors hover:bg-pink disabled:opacity-80"
              >
                {exportPct !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                {exportPct !== null ? `Export ${exportPct}%` : "Exporter la vidéo"}
              </button>
            </div>
          </div>
          {exportPct !== null && (
            <div className="relative h-1 bg-line">
              <div className="h-full bg-pink transition-[width]" style={{ width: `${exportPct}%` }} />
              <p className="absolute left-4 top-2 z-10 text-xs text-zinc-400">
                {exportMode === "realtime"
                  ? "Ce navigateur enregistre la vidéo en temps réel : gardez cet onglet visible jusqu'à la fin."
                  : "Export image par image, plus rapide que la lecture."}
              </p>
            </div>
          )}

          <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-h-[360px] min-w-0 lg:min-h-0">
              <MotionPlayer
                ref={playerRef}
                project={project}
                onSceneChange={setActiveScene}
                onFrame={onFrame}
                selection={selected}
                onSelect={pick}
                onEditStart={hist.begin}
                onEdit={hist.update}
                onEditEnd={hist.end}
              />
            </div>

            <aside className="min-h-0 space-y-4 lg:overflow-y-auto lg:pr-1">
              <section className="space-y-3 rounded-xl border border-line bg-panel p-3">
                <p className="label">Moteurs</p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Fournisseur de voix"
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
                  <select aria-label="Voix" value={voice.voiceId} onChange={(e) => setVoice({ ...voice, voiceId: e.target.value })} disabled={!providerInfo?.available} className={select}>
                    {providerInfo?.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <select aria-label="Moteur vidéo IA" value={videoModelId} onChange={(e) => setVideoModelId(e.target.value)} disabled={!caps?.videoAvailable} className={select}>
                  {caps?.videoModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {videoModel && <p className="font-mono text-[9px] text-zinc-600">{videoModel.note}</p>}
                <div className="space-y-1.5">
                  <p className="label">Qualité vidéo IA</p>
                  <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Qualité vidéo IA">
                    {VIDEO_QUALITIES.map((q) => (
                      <button
                        key={q}
                        onClick={() => setVideoQuality(q)}
                        aria-pressed={videoQuality === q}
                        className={clsx(
                          "rounded-md border px-1.5 py-1.5 text-center transition-colors",
                          videoQuality === q ? "border-accent bg-accent/20 text-cream" : "border-line-2 bg-panel-2 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200",
                        )}
                      >
                        <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider">{QUALITY_LABELS[q]}</span>
                        <span className="block font-mono text-[9px] opacity-70">{videoModel?.tiers[q].detail}</span>
                        <span className="block font-mono text-[9px] text-amber/90">≈ {formatUsd(tierEstimate(q, scene))}</span>
                      </button>
                    ))}
                  </div>
                  <p className="font-mono text-[9px] text-zinc-600">Prix pour cette scène ({scene.duration.toFixed(1)} s). Le prix réel dépend du fournisseur.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => generateAll("voice")} disabled={!voiceReady || bulk !== null} className={toolButton}>
                    {bulk === "voice" && <Loader2 className="h-3 w-3 animate-spin" />} Toutes les voix
                  </button>
                  <button onClick={() => generateAll("image")} disabled={!canUse || bulk !== null} className={toolButton}>
                    {bulk === "image" && <Loader2 className="h-3 w-3 animate-spin" />} Tous les fonds
                  </button>
                  <button onClick={captionEverything} aria-label="Sous-titrer toutes les scènes" className={toolButton}>
                    Sous-titrer tout
                  </button>
                </div>
                {remaining && (
                  <p className="font-mono text-[10px] text-zinc-500">
                    Tout générer : voix ≈ {formatUsd(remaining.voice)} · plans vidéo ≈ {formatUsd(remaining.video)}
                  </p>
                )}
                {caps?.quota && providerInfo?.id === "elevenlabs" && (
                  <p className="font-mono text-[10px] text-zinc-600">{caps.quota.remaining.toLocaleString("fr-FR")} caractères ElevenLabs restants</p>
                )}
                {!canUse && <p className="font-mono text-[10px] text-zinc-600">Connexion requise pour générer voix, images et vidéos.</p>}
                {canUse && !caps?.videoAvailable && <p className="font-mono text-[10px] text-zinc-600">REPLICATE_API_TOKEN manquant : plans vidéo IA désactivés.</p>}
              </section>

              <MusicPanel
                key={epoch}
                music={project.music ?? null}
                totalSeconds={projectDuration(project)}
                canUpload={canUse}
                onSet={setMusic}
                selected={musicSelected}
              />

              {selectedLayer && (
                <LayerInspector
                  key={`${scene.uid}-${selectedLayer.id}`}
                  layer={selectedLayer}
                  sceneDuration={scene.duration}
                  time={Math.min(scene.duration, Math.max(0, playhead - sceneStart(project, sceneIndex)))}
                  onChange={editLayer}
                  onTrim={trimSelected}
                  onDelete={removeSelected}
                  onTransform={transform}
                  onDuplicate={copyLayer}
                  canDuplicate={scene.layers.length < MAX_LAYERS}
                  onReorder={restack}
                  canReorder={(to) => reorderLayer(scene, selectedLayer.id, to, project.ratio) !== scene}
                />
              )}

              <SceneCard
                key={scene.uid}
                scene={scene}
                index={sceneIndex}
                total={project.scenes.length}
                busy={busy[scene.uid]}
                note={notes[scene.uid]}
                voiceReady={voiceReady}
                imageReady={canUse}
                videoReady={canUse && !!caps?.videoAvailable}
                videoBlocked={!!videoModel?.needsImage && !scene.imageUrl}
                motionReady={motionReady}
                estimates={{ voice: formatUsd(voiceEstimate(scene)), image: formatUsd(0), video: formatUsd(videoEstimate(scene)) }}
                onChange={(patch) => patchScene(sceneIndex, (s) => ({ ...s, ...patch }), `scene-${sceneIndex}-${Object.keys(patch).join(",")}`)}
                onTransition={(patch) => patchScene(sceneIndex, (s) => ({ ...s, transition: { ...s.transition, ...patch } }), `transition-${scene.uid}`)}
                onVoice={() => makeVoice(scene.uid)}
                onImage={() => makeImage(scene.uid)}
                onVideo={() => makeVideo(scene.uid)}
                onRefine={(instruction) => refine(scene.uid, instruction)}
                onImportMedia={(kind, file) => importMedia(scene.uid, kind, file)}
                importBusy={importing[scene.uid] ?? null}
                importDisabledReason={canUse ? undefined : "Connexion requise pour importer vos médias."}
              />
            </aside>
          </div>

          <div className="space-y-3 px-4 pb-4">
            <EditToolbar
              onAddText={() => newLayer("text")}
              onAddShape={newLayer}
              onAddCaptions={addCaptions}
              captionsDisabledReason={scene.voiceOver.trim() ? undefined : "Cette scène n'a pas de narration à sous-titrer"}
              onSplit={cutHere}
              canSplit={canSplit}
              onDuplicateScene={copyScene}
              onDeleteScene={dropScene}
              canDeleteScene={project.scenes.length > 1}
              onAddScene={newScene}
              sceneCount={project.scenes.length}
              maxScenes={MAX_SCENES}
              hasLayer={!!selectedLayer}
              onDuplicateLayer={copyLayer}
              onDeleteLayer={removeSelected}
              layerCount={scene.layers.length}
              maxLayers={MAX_LAYERS}
            />
            <Timeline
              ref={timelineRef}
              project={project}
              activeScene={sceneIndex}
              selectedLayerId={selectedLayer?.id ?? null}
              onSeek={(t) => playerRef.current?.seek(t)}
              onSelectLayer={(id) => pick(id ? { scene: scene.uid, layer: id } : null)}
              onSelectScene={selectScene}
              musicSelected={musicSelected}
              onSelectMusic={pickMusic}
              onEditStart={hist.begin}
              onEdit={hist.update}
              onEditEnd={hist.end}
            />
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-md border border-line-2 bg-panel px-4 py-2 text-sm text-cream shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
