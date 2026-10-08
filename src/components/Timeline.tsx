"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { Captions, Circle, Image as ImageIcon, Square, Type } from "lucide-react";
import clsx from "clsx";
import { keyTimes, layerEnd, moveKeyframes, moveLayer, setSceneDuration, snapToFrame, snapToTenth, trimLayer } from "@/lib/motion/edit";
import { clock } from "@/lib/motion/timecode";
import { projectDuration, sceneStart, type Layer, type MotionProject, type MotionScene } from "@/lib/motion/types";

export interface TimelineHandle {
  /** Moves the playhead without re-rendering (called every frame during playback). */
  setTime(seconds: number): void;
}

interface Props {
  project: MotionProject;
  activeScene: number;
  /** Selected layer of the active scene. */
  selectedLayerId: string | null;
  onSeek: (seconds: number) => void;
  onSelectLayer: (layerId: string | null) => void;
  /** A drag is: onEditStart, then many onEdit (each computed from the project as it was at the start), then onEditEnd. */
  onEditStart: () => void;
  onEdit: (next: MotionProject) => void;
  onEditEnd: () => void;
  ref?: Ref<TimelineHandle>;
}

type Drag =
  | { kind: "move" | "trim-start" | "trim-end"; sceneIndex: number; layerId: string }
  | { kind: "keys"; sceneIndex: number; layerId: string; from: number }
  | { kind: "scene-end"; sceneIndex: number };

const LABEL_W = 148;
const MIN_PPS = 28; // pixels per second; below this the timeline scrolls instead of shrinking
const CLIP_COLORS = ["#6366f1", "#f472b6", "#fbbf24", "#34d399", "#38bdf8", "#a78bfa"];
const STEPS = [1, 2, 5, 10, 15, 30, 60];

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
    case "captions":
      return { icon: <Captions className="h-3 w-3" />, text: "Sous-titres", color: "#fbbf24" };
  }
}

const sec = (t: number) => `${t.toFixed(2)} s`;

function Row({
  label,
  height,
  contentW,
  selected,
  onLabelClick,
  children,
}: {
  label: ReactNode;
  height: number;
  contentW: number;
  selected?: boolean;
  onLabelClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={clsx("flex border-b border-line/70", selected && "bg-white/[0.04]")} style={{ height }}>
      <div
        onClick={onLabelClick}
        className={clsx("sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line px-3", selected ? "bg-panel-2" : "bg-panel", onLabelClick && "cursor-pointer")}
        style={{ width: LABEL_W }}
      >
        {label}
      </div>
      <div className="relative shrink-0" style={{ width: contentW }}>
        {children}
      </div>
    </div>
  );
}

export default function Timeline({ project, activeScene, selectedLayerId, onSeek, onSelectLayer, onEditStart, onEdit, onEditEnd, ref }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const ppsRef = useRef(MIN_PPS);
  const timeRef = useRef(0);
  const scrubbing = useRef(false);
  const [viewW, setViewW] = useState(900);
  const [info, setInfo] = useState<string | null>(null);

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

  /**
   * Starts a drag edit. Each pointer move recomputes the result from the project as it was when the
   * drag began (never from the previous move), so it can't drift, and returning to the start leaves
   * the project untouched.
   */
  const beginDrag = (e: ReactPointerEvent, drag: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    const base = project;
    const original = base.scenes[drag.sceneIndex];
    const layer = drag.kind === "scene-end" ? undefined : original.layers.find((l) => l.id === drag.layerId);
    if (drag.kind !== "scene-end" && !layer) return;
    const startX = e.clientX;
    onEditStart();

    const compute = (dt: number): MotionScene => {
      switch (drag.kind) {
        case "move":
          return moveLayer(original, drag.layerId, snapToFrame(layer!.start + dt) - layer!.start);
        case "trim-start":
          return trimLayer(original, drag.layerId, "start", snapToFrame(layer!.start + dt));
        case "trim-end":
          return trimLayer(original, drag.layerId, "end", snapToFrame(layerEnd(original, layer!) + dt));
        case "keys":
          return moveKeyframes(original, drag.layerId, drag.from, snapToFrame(drag.from + dt));
        case "scene-end":
          return setSceneDuration(original, snapToTenth(original.duration + dt));
      }
    };

    const pendingDt = { current: 0 };
    const describe = (next: MotionScene) => {
      if (drag.kind === "scene-end") return `Durée de la scène : ${sec(next.duration)}`;
      const l = next.layers.find((x) => x.id === drag.layerId);
      if (!l) return null;
      if (drag.kind === "keys") return `Keyframe : ${sec(snapToFrame(drag.from + pendingDt.current))}`;
      return `Début ${sec(l.start)} · Fin ${sec(layerEnd(next, l))}`;
    };

    const apply = (clientX: number) => {
      const dt = (clientX - startX) / ppsRef.current;
      pendingDt.current = dt;
      const next = compute(dt);
      onEdit(next === original ? base : { ...base, scenes: base.scenes.map((s, i) => (i === drag.sceneIndex ? next : s)) });
      setInfo(describe(next));
    };
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setInfo(null);
      onEditEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const ticks: number[] = [];
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(t);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel" aria-label="Timeline">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2">
        <span className="label">Timeline</span>
        <span className="label flex items-center gap-4 normal-case tracking-normal" aria-live="polite">
          {info ? (
            <span className="text-pink">{info}</span>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="relative inline-block h-2 w-2 rotate-45 bg-amber" /> keyframe
              </span>
              <span className="hidden sm:inline">Glissez les barres, leurs bords et les losanges pour monter</span>
            </>
          )}
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
                  key={s.uid}
                  className={clsx("absolute bottom-1 top-1 rounded-md border", i === activeScene ? "ring-1 ring-white/70" : "")}
                  style={{ left, width: Math.max(8, s.duration * pps - 2), background: `${color}33`, borderColor: `${color}aa` }}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-md">
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
                  <span
                    role="separator"
                    aria-label={`Durée de la scène ${i + 1}`}
                    title="Glisser pour changer la durée de la scène"
                    onPointerDown={(e) => beginDrag(e, { kind: "scene-end", sceneIndex: i })}
                    className="absolute -right-1 bottom-0 top-0 z-30 w-2.5 cursor-col-resize rounded-sm bg-white/0 transition-colors hover:bg-white/50"
                  />
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
                  key={s.uid}
                  className="absolute bottom-1 top-1 rounded-sm border border-mint/50"
                  style={{ left, width, background: "repeating-linear-gradient(90deg, rgba(52,211,153,0.55) 0 2px, rgba(52,211,153,0.15) 2px 4px)" }}
                />
              ) : (
                <div key={s.uid} className="absolute bottom-1.5 top-1.5 rounded-sm border border-dashed border-line-2" style={{ left, width }} />
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
                  key={s.uid}
                  className={clsx("absolute bottom-1 top-1 overflow-hidden rounded-sm border px-2 font-mono text-[9px] uppercase leading-[16px]", s.videoUrl ? "border-amber/60 bg-amber/25 text-amber" : "border-sky/60 bg-sky/20 text-sky")}
                  style={{ left, width }}
                >
                  {kind}
                </div>
              ) : (
                <div key={s.uid} className="absolute bottom-1.5 top-1.5 rounded-sm border border-dashed border-line-2" style={{ left, width }} />
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
                const to = activeStart + layerEnd(scene, layer);
                const selected = layer.id === selectedLayerId;
                const grab = (e: ReactPointerEvent, kind: "move" | "trim-start" | "trim-end") => {
                  onSelectLayer(layer.id);
                  beginDrag(e, { kind, sceneIndex: activeScene, layerId: layer.id });
                };
                return (
                  <Row
                    key={layer.id}
                    height={24}
                    contentW={contentW}
                    selected={selected}
                    onLabelClick={() => onSelectLayer(layer.id)}
                    label={
                      <>
                        <span style={{ color }}>{icon}</span>
                        <span className={clsx("truncate text-[11px]", selected ? "text-white" : "text-zinc-300")}>{text}</span>
                      </>
                    }
                  >
                    <div
                      role="button"
                      aria-label={`Calque ${text}`}
                      aria-pressed={selected}
                      onPointerDown={(e) => grab(e, "move")}
                      className={clsx("absolute bottom-[3px] top-[3px] z-30 cursor-grab rounded-sm active:cursor-grabbing", selected && "ring-1 ring-white")}
                      style={{ left: from * pps, width: Math.max(8, (to - from) * pps), background: `${color}${selected ? "55" : "30"}`, border: `1px solid ${color}${selected ? "cc" : "66"}` }}
                    >
                      <span aria-label="Début du calque" onPointerDown={(e) => grab(e, "trim-start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-sm bg-white/0 hover:bg-white/40" />
                      <span aria-label="Fin du calque" onPointerDown={(e) => grab(e, "trim-end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-sm bg-white/0 hover:bg-white/40" />
                    </div>
                    {keyTimes(layer)
                      .filter((t) => t >= layer.start - 0.001 && activeStart + t <= to + 0.001)
                      .map((t) => (
                        <span
                          key={t}
                          role="button"
                          aria-label={`Keyframe à ${t.toFixed(2)} s`}
                          title="Glisser pour décaler cette pose dans le temps"
                          onPointerDown={(e) => {
                            onSelectLayer(layer.id);
                            beginDrag(e, { kind: "keys", sceneIndex: activeScene, layerId: layer.id, from: t });
                          }}
                          className="absolute bottom-0 top-0 z-40 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
                          style={{ left: (activeStart + t) * pps }}
                        >
                          <span className="block h-[9px] w-[9px] rotate-45 border border-black/50 bg-amber" />
                        </span>
                      ))}
                  </Row>
                );
              })}
            </>
          )}

          {/* Scrub surface: below the bars, so dragging empty space moves the playhead */}
          <div
            ref={areaRef}
            className="absolute bottom-0 top-0 z-20 cursor-ew-resize touch-pan-y"
            style={{ left: LABEL_W, width: contentW }}
            onPointerDown={(e) => {
              scrubbing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromPointer(e.clientX);
            }}
            onPointerMove={(e) => scrubbing.current && seekFromPointer(e.clientX)}
            onPointerUp={() => (scrubbing.current = false)}
            onPointerCancel={() => (scrubbing.current = false)}
          />

          {/* Playhead: above everything, never intercepts the pointer */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-50" style={{ left: LABEL_W, width: contentW }}>
            <div ref={playheadRef} className="absolute bottom-0 top-0 w-px bg-pink shadow-[0_0_10px_1px_rgba(244,114,182,0.7)]">
              <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5.5px] border-t-[8px] border-x-transparent border-t-pink" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
