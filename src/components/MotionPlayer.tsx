"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Pause, Play } from "lucide-react";
import clsx from "clsx";
import { loadFonts, resolveFontStacks } from "@/lib/motion/fonts";
import { renderFrame, SYSTEM_FONTS, type FontStacks } from "@/lib/motion/render";
import { MediaStage } from "@/lib/motion/stage";
import { locate, projectDuration, sceneStart, type MotionProject } from "@/lib/motion/types";

export interface MotionPlayerHandle {
  seekToScene(index: number): void;
}

interface Props {
  project: MotionProject;
  onSceneChange?: (index: number) => void;
  ref?: Ref<MotionPlayerHandle>;
}

const PREVIEW_WIDTH = { "16:9": 1280, "9:16": 720 } as const;
const PREVIEW_HEIGHT = { "16:9": 720, "9:16": 1280 } as const;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function MotionPlayer({ project, onSceneChange, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<MediaStage | null>(null);
  const fontsRef = useRef<FontStacks>(SYSTEM_FONTS);
  const projectRef = useRef(project);
  const onSceneChangeRef = useRef(onSceneChange);
  const timeRef = useRef(0);
  const sceneRef = useRef(-1);
  const [playing, setPlaying] = useState(false);
  const [uiTime, setUiTime] = useState(0);

  const total = projectDuration(project);

  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
  });

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    renderFrame(ctx, projectRef.current, timeRef.current, (s) => stageRef.current?.source(s) ?? null, fontsRef.current);
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
    const stage = new MediaStage(true);
    stageRef.current = stage;
    stage.sync(projectRef.current, draw);
    let cancelled = false;
    const stacks = resolveFontStacks();
    fontsRef.current = stacks;
    loadFonts(stacks).then(() => !cancelled && draw());
    return () => {
      cancelled = true;
      stage.dispose();
      stageRef.current = null;
    };
  }, [draw]);

  // Project edits (text, new media, retouched animation) re-sync assets and repaint.
  useEffect(() => {
    projectRef.current = project;
    stageRef.current?.sync(project, draw);
    timeRef.current = Math.min(timeRef.current, projectDuration(project));
    sceneRef.current = -1;
    draw();
  }, [project, draw]);

  useEffect(() => {
    if (!playing) {
      stageRef.current?.pause();
      return;
    }
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    syncScene(true, true);

    const tick = (now: number) => {
      const end = projectDuration(projectRef.current);
      timeRef.current = Math.min(end, timeRef.current + (now - last) / 1000);
      last = now;
      syncScene(true);
      draw();
      const tenths = Math.floor(timeRef.current * 10);
      if (tenths !== shown) {
        shown = tenths;
        setUiTime(timeRef.current);
      }
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
      setUiTime(timeRef.current);
      syncScene(playing, true);
      draw();
    },
    [draw, syncScene, playing],
  );

  useImperativeHandle(
    ref,
    () => ({
      seekToScene: (index: number) => seek(sceneStart(projectRef.current, index)),
    }),
    [seek],
  );

  const toggle = () => {
    if (!playing && timeRef.current >= total - 0.05) seek(0);
    setPlaying((p) => !p);
  };

  const portrait = project.ratio === "9:16";

  return (
    <div className="space-y-3">
      <div
        className={clsx("relative mx-auto overflow-hidden rounded-2xl border border-[#1a1a1a] bg-black shadow-2xl", portrait ? "" : "w-full")}
        style={portrait ? { aspectRatio: "9 / 16", height: "min(68vh, 620px)" } : { aspectRatio: "16 / 9" }}
      >
        <canvas
          ref={canvasRef}
          width={PREVIEW_WIDTH[project.ratio]}
          height={PREVIEW_HEIGHT[project.ratio]}
          onClick={toggle}
          className="block h-full w-full cursor-pointer"
          aria-label="Aperçu de l'animation"
        />
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3">
        <button
          onClick={toggle}
          aria-label={playing ? "Pause" : "Lecture"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-indigo-500 hover:text-white"
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={total}
            step={0.01}
            value={Math.min(uiTime, total)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position dans la vidéo"
            className="w-full accent-indigo-500"
          />
          <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-1.5">
            {project.scenes.map((_, i) =>
              i === 0 ? null : (
                <span key={i} className="absolute top-0 h-1.5 w-px bg-zinc-600" style={{ left: `${(sceneStart(project, i) / total) * 100}%` }} />
              ),
            )}
          </div>
        </div>
        <span className="w-24 shrink-0 text-right font-mono text-[11px] text-zinc-500">
          {clock(Math.min(uiTime, total))} / {clock(total)}
        </span>
      </div>
    </div>
  );
}
