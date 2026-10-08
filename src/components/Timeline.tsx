"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Circle, Image as ImageIcon, Square, Type } from "lucide-react";
import clsx from "clsx";
import { clock } from "@/lib/motion/timecode";
import { projectDuration, sceneStart, type Layer, type MotionProject, type MotionScene, type Track } from "@/lib/motion/types";

export interface TimelineHandle {
  /** Moves the playhead without re-rendering (called every frame during playback). */
  setTime(seconds: number): void;
}

interface Props {
  project: MotionProject;
  activeScene: number;
  onSeek: (seconds: number) => void;
  ref?: Ref<TimelineHandle>;
}

const LABEL_W = 148;
const MIN_PPS = 28; // pixels per second; below this the timeline scrolls instead of shrinking
const CLIP_COLORS = ["#6366f1", "#f472b6", "#fbbf24", "#34d399", "#38bdf8", "#a78bfa"];
const STEPS = [1, 2, 5, 10, 15, 30, 60];

/** Times at which a layer has a keyframe, relative to its scene. */
function keyTimes(layer: Layer): number[] {
  const tracks: Track[] = [layer.x, layer.y, layer.rotation, layer.scale, layer.opacity];
  if ("w" in layer) tracks.push(layer.w, layer.h);
  const times = new Set<number>();
  for (const track of tracks) if (Array.isArray(track)) for (const key of track) times.add(Math.round(key.t * 100) / 100);
  return [...times].sort((a, b) => a - b);
}

function layerLabel(layer: Layer): { icon: ReactNode; text: string; color: string } {
  switch (layer.type) {
    case "text":
      return { icon: <Type className="h-3 w-3" />, text: `« ${layer.text.replace(/\s+/g, " ").slice(0, 16)} »`, color: "#f5f3ff" };
    case "rect":
      return { icon: <Square className="h-3 w-3" />, text: "Forme", color: "#6366f1" };
    case "ellipse":
      return { icon: <Circle className="h-3 w-3" />, text: "Cercle", color: "#f472b6" };
    case "media":
      return { icon: <ImageIcon className="h-3 w-3" />, text: "Fond IA", color: "#38bdf8" };
  }
}

function Row({ label, height, contentW, children }: { label: ReactNode; height: number; contentW: number; children?: ReactNode }) {
  return (
    <div className="flex border-b border-line/70" style={{ height }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-panel px-3" style={{ width: LABEL_W }}>
        {label}
      </div>
      <div className="relative shrink-0" style={{ width: contentW }}>
        {children}
      </div>
    </div>
  );
}

export default function Timeline({ project, activeScene, onSeek, ref }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const ppsRef = useRef(MIN_PPS);
  const timeRef = useRef(0);
  const dragging = useRef(false);
  const [viewW, setViewW] = useState(900);

  const total = projectDuration(project);
  const pps = Math.max(MIN_PPS, (viewW - LABEL_W - 28) / total);
  const contentW = Math.ceil(total * pps) + 28;
  const step = STEPS.find((s) => s * pps >= 56) ?? 60;
  const scene: MotionScene | undefined = project.scenes[activeScene];
  const activeStart = sceneStart(project, Math.min(activeScene, project.scenes.length - 1));

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setViewW(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setTime = useCallback((seconds: number) => {
    timeRef.current = seconds;
    const x = seconds * ppsRef.current;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
    const scroller = scrollerRef.current;
    if (scroller) {
      const left = scroller.scrollLeft;
      const visible = scroller.clientWidth - LABEL_W;
      if (x > left + visible - 40 || x < left) scroller.scrollLeft = Math.max(0, x - 80);
    }
  }, []);

  // Keep the playhead on the right pixel when the zoom changes (resize, longer scenes…).
  useEffect(() => {
    ppsRef.current = pps;
    setTime(timeRef.current);
  }, [pps, setTime]);

  useImperativeHandle(ref, () => ({ setTime }), [setTime]);

  const seekFromPointer = (clientX: number) => {
    const area = areaRef.current;
    if (!area) return;
    const t = (clientX - area.getBoundingClientRect().left) / ppsRef.current;
    onSeek(Math.max(0, Math.min(total, t)));
  };

  const ticks: number[] = [];
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(t);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel" aria-label="Timeline">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="label">Timeline</span>
        <span className="label flex items-center gap-4 normal-case tracking-normal">
          <span className="flex items-center gap-1.5">
            <span className="relative inline-block h-2 w-2 rotate-45 bg-amber" /> keyframe
          </span>
          <span className="hidden sm:inline">Cliquez ou glissez pour placer la tête de lecture</span>
        </span>
      </div>

      <div ref={scrollerRef} className="relative max-h-[250px] overflow-auto">
        <div className="relative" style={{ width: LABEL_W + contentW }}>
          {/* Ruler */}
          <Row label={<span className="label">Temps</span>} height={28} contentW={contentW}>
            <div className="ruler-ticks absolute inset-0" style={{ backgroundSize: `${step * pps}px 100%, ${(step * pps) / 5}px 45%` }} />
            {ticks.map((t) => (
              <span key={t} className="absolute top-1 pl-1.5 font-mono text-[10px] text-zinc-500" style={{ left: t * pps }}>
                {clock(t)}
              </span>
            ))}
          </Row>

          {/* Scenes */}
          <Row label={<span className="label">Scènes</span>} height={36} contentW={contentW}>
            {project.scenes.map((s, i) => {
              const left = sceneStart(project, i) * pps;
              const color = CLIP_COLORS[i % CLIP_COLORS.length];
              const overlap = i > 0 && s.transition.type !== "none" ? Math.min(s.transition.duration * pps, s.duration * pps) : 0;
              return (
                <div
                  key={s.id}
                  className={clsx("absolute top-1 bottom-1 overflow-hidden rounded-md border", i === activeScene ? "ring-1 ring-white/70" : "")}
                  style={{ left, width: Math.max(8, s.duration * pps - 2), background: `${color}33`, borderColor: `${color}aa` }}
                >
                  {overlap > 0 && (
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{ width: overlap, background: `repeating-linear-gradient(135deg, ${color}77 0 3px, transparent 3px 6px)` }}
                      title={`Transition : ${s.transition.type}`}
                    />
                  )}
                  <span className="relative block truncate px-2 pt-1 font-mono text-[10px] leading-tight text-cream">
                    {String(i + 1).padStart(2, "0")} · {s.voiceOver.trim() ? s.voiceOver.slice(0, 40) : "silence"}
                  </span>
                </div>
              );
            })}
          </Row>

          {/* Voice */}
          <Row label={<span className="label text-mint/80">Voix</span>} height={24} contentW={contentW}>
            {project.scenes.map((s, i) => {
              const left = sceneStart(project, i) * pps;
              const width = Math.max(8, s.duration * pps - 2);
              return s.audioUrl ? (
                <div
                  key={s.id}
                  className="absolute top-1 bottom-1 rounded-sm border border-mint/50"
                  style={{
                    left,
                    width,
                    background: "repeating-linear-gradient(90deg, rgba(52,211,153,0.55) 0 2px, rgba(52,211,153,0.15) 2px 4px)",
                  }}
                />
              ) : (
                <div key={s.id} className="absolute top-1.5 bottom-1.5 rounded-sm border border-dashed border-line-2" style={{ left, width }} />
              );
            })}
          </Row>

          {/* Media */}
          <Row label={<span className="label text-sky/80">Média IA</span>} height={24} contentW={contentW}>
            {project.scenes.map((s, i) => {
              const left = sceneStart(project, i) * pps;
              const width = Math.max(8, s.duration * pps - 2);
              const kind = s.videoUrl ? "vidéo" : s.imageUrl ? "image" : null;
              return kind ? (
                <div
                  key={s.id}
                  className={clsx("absolute top-1 bottom-1 overflow-hidden rounded-sm border px-2 font-mono text-[9px] uppercase leading-[16px]", s.videoUrl ? "border-amber/60 bg-amber/25 text-amber" : "border-sky/60 bg-sky/20 text-sky")}
                  style={{ left, width }}
                >
                  {kind}
                </div>
              ) : (
                <div key={s.id} className="absolute top-1.5 bottom-1.5 rounded-sm border border-dashed border-line-2" style={{ left, width }} />
              );
            })}
          </Row>

          {/* Layers of the active scene */}
          {scene && (
            <>
              <div className="sticky left-0 flex items-center border-b border-line/70 bg-panel-2 px-3" style={{ height: 24, width: LABEL_W + contentW }}>
                <span className="label sticky left-3">Calques — scène {String(activeScene + 1).padStart(2, "0")}</span>
              </div>
              {scene.layers.map((layer) => {
                const { icon, text, color } = layerLabel(layer);
                const from = activeStart + layer.start;
                const to = activeStart + (layer.end ?? scene.duration);
                return (
                  <Row
                    key={layer.id}
                    height={24}
                    contentW={contentW}
                    label={
                      <>
                        <span style={{ color }}>{icon}</span>
                        <span className="truncate text-[11px] text-zinc-300">{text}</span>
                      </>
                    }
                  >
                    <div
                      className="absolute top-[5px] bottom-[5px] rounded-sm"
                      style={{ left: from * pps, width: Math.max(6, (to - from) * pps), background: `${color}30`, border: `1px solid ${color}66` }}
                    />
                    {keyTimes(layer)
                      .filter((t) => t >= layer.start - 0.001 && activeStart + t <= to + 0.001)
                      .map((t) => (
                        <span key={t} className="keyframe" style={{ left: (activeStart + t) * pps }} />
                      ))}
                  </Row>
                );
              })}
            </>
          )}

          {/* Playhead + scrub surface */}
          <div
            ref={areaRef}
            className="absolute top-0 bottom-0 z-20 cursor-ew-resize touch-pan-y"
            style={{ left: LABEL_W, width: contentW }}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromPointer(e.clientX);
            }}
            onPointerMove={(e) => dragging.current && seekFromPointer(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <div ref={playheadRef} className="pointer-events-none absolute top-0 bottom-0 w-px bg-pink shadow-[0_0_10px_1px_rgba(244,114,182,0.7)]">
              <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-pink" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
