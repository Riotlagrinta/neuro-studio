"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Frame, Pause, Play, Repeat, SkipBack, SkipForward } from "lucide-react";
import clsx from "clsx";
import { loadFonts, resolveFontStacks } from "@/lib/motion/fonts";
import { renderFrame, SYSTEM_FONTS, type FontStacks } from "@/lib/motion/render";
import { MediaStage } from "@/lib/motion/stage";
import { timecode } from "@/lib/motion/timecode";
import { locate, projectDuration, sceneStart, type MotionProject } from "@/lib/motion/types";

export interface MotionPlayerHandle {
  seek(seconds: number): void;
  seekToScene(index: number): void;
}

interface Props {
  project: MotionProject;
  onSceneChange?: (index: number) => void;
  /** Called on every painted frame with the playhead time. Not React state: drive the DOM directly. */
  onFrame?: (seconds: number) => void;
  /** "studio": monitor + transport. "reel": chrome-free autoplaying loop (landing page). */
  variant?: "studio" | "reel";
  ref?: Ref<MotionPlayerHandle>;
}

const PREVIEW_WIDTH = { "16:9": 1280, "9:16": 720 } as const;
const PREVIEW_HEIGHT = { "16:9": 720, "9:16": 1280 } as const;

/** Largest box of the given aspect ratio that fits the element it is attached to. */
function useFit(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.floor(Math.min(width, height * aspect));
      setSize({ w, h: Math.floor(w / aspect) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);
  return { ref, size };
}

export default function MotionPlayer({ project, onSceneChange, onFrame, variant = "studio", ref }: Props) {
  const reel = variant === "reel";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<MediaStage | null>(null);
  const fontsRef = useRef<FontStacks>(SYSTEM_FONTS);
  const projectRef = useRef(project);
  const onSceneChangeRef = useRef(onSceneChange);
  const onFrameRef = useRef(onFrame);
  const timeRef = useRef(0);
  const sceneRef = useRef(-1);
  const loopRef = useRef(reel);
  const [playing, setPlaying] = useState(reel);
  const [loop, setLoop] = useState(reel);
  const [safeZones, setSafeZones] = useState(false);

  const portrait = project.ratio === "9:16";
  const { ref: stageBoxRef, size } = useFit(portrait ? 9 / 16 : 16 / 9);
  const total = projectDuration(project);

  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
    onFrameRef.current = onFrame;
    loopRef.current = loop;
  });

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    renderFrame(ctx, projectRef.current, timeRef.current, (s) => stageRef.current?.source(s) ?? null, fontsRef.current);
    if (clockRef.current) clockRef.current.textContent = timecode(timeRef.current);
    onFrameRef.current?.(timeRef.current);
  }, []);

  // Enter the scene under the playhead: start its video/narration at the right offset.
  const syncScene = useCallback((isPlaying: boolean, force = false) => {
    const p = projectRef.current;
    const { index, local } = locate(p, timeRef.current);
    if (!force && index === sceneRef.current) return;
    sceneRef.current = index;
    stageRef.current?.enter(p.scenes[index], local, isPlaying);
    onSceneChangeRef.current?.(index);
  }, []);

  // Stage + fonts live as long as the player does.
  useEffect(() => {
    const stage = new MediaStage(!reel);
    stageRef.current = stage;
    stage.sync(projectRef.current, draw);
    // A paused monitor on frame 0 is usually empty (reveals haven't started): open on a poster frame.
    if (!reel) timeRef.current = Math.min(1.5, projectDuration(projectRef.current) / 4);
    let cancelled = false;
    const stacks = resolveFontStacks();
    fontsRef.current = stacks;
    loadFonts(stacks).then(() => !cancelled && draw());
    return () => {
      cancelled = true;
      stage.dispose();
      stageRef.current = null;
    };
  }, [draw, reel]);

  // Project edits (text, new media, retouched animation) re-sync assets and repaint.
  useEffect(() => {
    projectRef.current = project;
    stageRef.current?.sync(project, draw);
    timeRef.current = Math.min(timeRef.current, projectDuration(project));
    sceneRef.current = -1;
    draw();
  }, [project, draw, size.w]);

  useEffect(() => {
    if (!playing) {
      stageRef.current?.pause();
      return;
    }
    let raf = 0;
    let last = performance.now();
    syncScene(true, true);

    const tick = (now: number) => {
      const end = projectDuration(projectRef.current);
      timeRef.current = Math.min(end, timeRef.current + (now - last) / 1000);
      last = now;
      if (timeRef.current >= end && loopRef.current) {
        timeRef.current = 0;
        sceneRef.current = -1;
      }
      syncScene(true);
      draw();
      if (timeRef.current >= end) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, syncScene]);

  const seek = useCallback(
    (t: number) => {
      timeRef.current = Math.max(0, Math.min(t, projectDuration(projectRef.current)));
      syncScene(playing, true);
      draw();
    },
    [draw, syncScene, playing],
  );

  useImperativeHandle(
    ref,
    () => ({
      seek,
      seekToScene: (index: number) => seek(sceneStart(projectRef.current, index)),
    }),
    [seek],
  );

  const toggle = () => {
    if (!playing && timeRef.current >= total - 0.05) seek(0);
    setPlaying((p) => !p);
  };

  const step = (direction: 1 | -1) => {
    const current = locate(projectRef.current, timeRef.current).index;
    const target = Math.min(projectRef.current.scenes.length - 1, Math.max(0, current + direction));
    seek(sceneStart(projectRef.current, target));
  };

  const canvas = (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH[project.ratio]}
      height={PREVIEW_HEIGHT[project.ratio]}
      onClick={reel ? undefined : toggle}
      className={clsx("block h-full w-full", !reel && "cursor-pointer")}
      aria-label="Aperçu de l'animation"
    />
  );

  if (reel) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: portrait ? "9 / 16" : "16 / 9" }}>
        {canvas}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div ref={stageBoxRef} className={clsx("flex flex-1 items-center justify-center", portrait ? "min-h-[380px]" : "min-h-[220px]")}>
        <div
          className="relative overflow-hidden rounded-lg bg-black shadow-[0_0_90px_-25px_rgba(99,102,241,0.45)] ring-1 ring-white/10"
          style={{ width: size.w || undefined, height: size.h || undefined, opacity: size.w ? 1 : 0 }}
        >
          {canvas}
          {safeZones && (
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              <div className="absolute inset-[5%] border border-dashed border-amber/70" />
              <div className="absolute inset-[10%] border border-dashed border-pink/50" />
              <div className="absolute left-1/2 top-0 h-full w-px bg-white/15" />
              <div className="absolute left-0 top-1/2 h-px w-full bg-white/15" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
        <button onClick={() => step(-1)} aria-label="Scène précédente" className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Lecture"}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-cream text-ink transition-colors hover:bg-pink"
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button onClick={() => step(1)} aria-label="Scène suivante" className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
          <SkipForward className="h-4 w-4" />
        </button>

        <span className="ml-2 font-mono text-sm tabular-nums text-cream">
          <span ref={clockRef}>{timecode(0)}</span>
          <span className="text-zinc-600"> / {timecode(total)}</span>
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setLoop((l) => !l)}
            aria-pressed={loop}
            aria-label="Lecture en boucle"
            title="Lecture en boucle"
            className={clsx("rounded p-1.5 transition-colors", loop ? "bg-accent/20 text-accent" : "text-zinc-500 hover:bg-white/5 hover:text-white")}
          >
            <Repeat className="h-4 w-4" />
          </button>
          <button
            onClick={() => setSafeZones((s) => !s)}
            aria-pressed={safeZones}
            aria-label="Zones de sécurité"
            title="Zones de sécurité (titres / actions)"
            className={clsx("rounded p-1.5 transition-colors", safeZones ? "bg-amber/20 text-amber" : "text-zinc-500 hover:bg-white/5 hover:text-white")}
          >
            <Frame className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
