"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Captions, Circle, Image as ImageIcon, Square, Type, ZoomIn, ZoomOut } from "lucide-react";
import clsx from "clsx";
import { musicGainCurve } from "@/lib/motion/audio-mix";
import { keyTimes, layerEnd, moveKeyframes, moveLayer, setSceneDuration, snapToFrame, snapToTenth, trimLayer } from "@/lib/motion/edit";
import { moveScene } from "@/lib/motion/scenes";
import { clock } from "@/lib/motion/timecode";
import { ZOOM_MAX, ZOOM_MIN, clampSceneShift, clampZoom, gainShape, isDragMove, sceneDropIndex, wheelZoomFactor, zoomAnchor, zoomScrollLeft } from "@/lib/motion/timeline-math";
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
  /**
   * A scene block was clicked, or Enter was pressed on it. Also called after a scene was moved (dragged, or Alt + arrows)
   * with the index it ENDED UP at; that call waits until the reordered project has been rendered, so the page's callback
   * already sees the new order.
   */
  onSelectScene?: (index: number) => void;
  /** The music row is the current selection. */
  musicSelected?: boolean;
  onSelectMusic?: () => void;
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
const ZOOM_STEP = 1.25; // factor of the "Zoom −" / "Zoom +" buttons

const zoomButton =
  "flex items-center justify-center rounded-md border border-line-2 bg-panel-2 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300 transition-colors hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

/** What the Scènes row needs to draw a scene that is being dragged. */
interface SceneDragView {
  uid: string;
  /** Where the floating block starts (seconds). */
  floatAt: number;
  /** Where the slot it will land in starts (seconds): the insertion marker. */
  slotAt: number;
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
        className={clsx("sticky left-0 z-[60] flex shrink-0 items-center gap-2 border-r border-line px-3", selected ? "bg-panel-2" : "bg-panel", onLabelClick && "cursor-pointer")}
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

export default function Timeline({
  project,
  activeScene,
  selectedLayerId,
  onSeek,
  onSelectLayer,
  onEditStart,
  onEdit,
  onEditEnd,
  onSelectScene,
  musicSelected = false,
  onSelectMusic,
  ref,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const ppsRef = useRef(MIN_PPS);
  const basePpsRef = useRef(MIN_PPS);
  // The zoom last asked for. State lags behind when wheel events come faster than renders; this doesn't.
  const zoomRef = useRef(ZOOM_MIN);
  // scrollLeft to apply once the new zoom has been laid out (the browser would cap it to the old, narrower content).
  const pendingScroll = useRef<number | null>(null);
  // Work to do after the next render: a reorder moves DOM nodes (focus is lost) and the page must see the new order.
  const afterCommit = useRef<{ focusUid?: string; select?: number }>({});
  const stopSceneDrag = useRef<(() => void) | null>(null);
  const timeRef = useRef(0);
  const scrubbing = useRef(false);
  const [viewW, setViewW] = useState(900);
  const [info, setInfo] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [sceneDrag, setSceneDrag] = useState<SceneDragView | null>(null);

  const total = projectDuration(project);
  // zoom 1 fits the view (never below MIN_PPS, then it scrolls); the zoom multiplies that.
  const basePps = Math.max(MIN_PPS, total > 0 ? (viewW - LABEL_W - 28) / total : MIN_PPS);
  const pps = basePps * zoom;
  const contentW = Math.ceil(total * pps) + 28;
  const step = STEPS.find((s) => s * pps >= 56) ?? 60;
  const scene: MotionScene | undefined = project.scenes[activeScene];
  const activeStart = sceneStart(project, Math.min(activeScene, project.scenes.length - 1));
  const music = project.music;
  const envelope = useMemo(() => gainShape(musicGainCurve(project), total), [project, total]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setViewW(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const place = useCallback((seconds: number) => {
    timeRef.current = seconds;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${seconds * ppsRef.current}px)`;
  }, []);

  const setTime = useCallback(
    (seconds: number) => {
      place(seconds);
      const scroller = scrollerRef.current;
      if (scroller) {
        const x = seconds * ppsRef.current;
        const left = scroller.scrollLeft;
        const visible = scroller.clientWidth - LABEL_W;
        if (x > left + visible - 40 || x < left) scroller.scrollLeft = Math.max(0, x - 80);
      }
    },
    [place],
  );

  // Before paint, so bars and playhead never disagree for a frame: the playhead goes to the new scale (resize, longer
  // scenes, zoom) and the scroll position chosen by a zoom is applied now that the content has its new width.
  useLayoutEffect(() => {
    ppsRef.current = pps;
    basePpsRef.current = basePps;
    place(timeRef.current);
    if (pendingScroll.current !== null && scrollerRef.current) scrollerRef.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [pps, basePps, place]);

  useImperativeHandle(ref, () => ({ setTime }), [setTime]);

  /** Zooms keeping the instant under `anchorX` (px from the scroller's left edge) in place; default: the playhead, else the middle. */
  const zoomTo = useCallback((requested: number, anchorX?: number) => {
    const scroller = scrollerRef.current;
    const next = clampZoom(requested);
    if (!scroller || next === zoomRef.current) return;
    const oldPps = basePpsRef.current * zoomRef.current;
    const left = pendingScroll.current ?? scroller.scrollLeft;
    const anchor = anchorX ?? zoomAnchor(LABEL_W + timeRef.current * oldPps - left, LABEL_W, scroller.clientWidth);
    pendingScroll.current = zoomScrollLeft(left, anchor, LABEL_W, oldPps, basePpsRef.current * next);
    zoomRef.current = next;
    setZoom(next);
  }, []);

  // Ctrl/Cmd + wheel zooms around the pointer. A native listener: React's wheel handlers are passive and can't stop the browser's own page zoom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * wheelZoomFactor(e.deltaY, e.deltaMode), e.clientX - el.getBoundingClientRect().left);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  useLayoutEffect(() => {
    const { focusUid, select } = afterCommit.current;
    if (focusUid === undefined && select === undefined) return;
    afterCommit.current = {};
    if (focusUid !== undefined) scrollerRef.current?.querySelector<HTMLElement>(`[data-scene="${CSS.escape(focusUid)}"]`)?.focus();
    if (select !== undefined) onSelectScene?.(select);
  });

  // A reorder still in progress must not outlive the timeline: its listeners would edit a project that is gone.
  useEffect(() => () => stopSceneDrag.current?.(), []);

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

  /**
   * Press on a scene block: under DRAG_THRESHOLD px of travel it is a click (select the scene), beyond it the block is
   * dragged to reorder. Like beginDrag, every move is computed from the project as it was at the start: the target is
   * decided against the layout at drag start (the live one reshuffles as the scenes move), and one drag is one undo step.
   * Esc (or the browser cancelling the pointer) puts everything back.
   */
  const beginSceneDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    stopSceneDrag.current?.();
    const base = project;
    const durations = base.scenes.map((s) => s.duration);
    const uid = base.scenes[index].uid;
    const startAt = sceneStart(base, index);
    const [startX, startY] = [e.clientX, e.clientY];
    const abort = new AbortController();
    const { signal } = abort;
    let dragging = false;
    let target = index;
    let slotAt = startAt;

    const leave = () => {
      abort.abort();
      stopSceneDrag.current = null;
    };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (!isDragMove(dx, ev.clientY - startY)) return;
        dragging = true;
        onEditStart();
      }
      const shift = dx / ppsRef.current;
      const to = sceneDropIndex(durations, index, shift);
      if (to !== target) {
        target = to;
        const next = moveScene(base, index, to);
        slotAt = sceneStart(next, to);
        onEdit(next);
      }
      setSceneDrag({ uid, floatAt: startAt + clampSceneShift(durations, index, shift), slotAt });
      setInfo(`Scène ${index + 1} → position ${to + 1}`);
    };
    const up = () => {
      leave();
      if (!dragging) {
        onSelectScene?.(index);
        return;
      }
      afterCommit.current = { focusUid: uid, select: target };
      setSceneDrag(null);
      setInfo(null);
      onEditEnd();
    };
    const cancel = () => {
      leave();
      if (!dragging) return;
      onEdit(base);
      setSceneDrag(null);
      setInfo(null);
      onEditEnd();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      // Capture phase + stop: the page's own Esc (deselect) must not also fire.
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", move, { signal });
    window.addEventListener("pointerup", up, { signal });
    window.addEventListener("pointercancel", cancel, { signal });
    window.addEventListener("keydown", key, { signal, capture: true });
    stopSceneDrag.current = leave;
  };

  /** On a focused scene block: Alt + ← / → moves it one place (one undo step), Enter selects it. */
  const onSceneKey = (e: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onSelectScene?.(index);
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    // The page's own arrow shortcuts (frame by frame) and the browser's (history back) must not also fire.
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const to = index + (e.key === "ArrowRight" ? 1 : -1);
    const next = moveScene(project, index, to);
    if (next === project) return;
    afterCommit.current = { focusUid: project.scenes[index].uid, select: to };
    onEditStart();
    onEdit(next);
    onEditEnd();
  };

  const ticks: number[] = [];
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(t);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel" aria-label="Timeline">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line px-4 py-2">
        <span className="label">Timeline</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="label flex items-center gap-4 normal-case tracking-normal" aria-live="polite">
            {info ? (
              <span className="text-pink">{info}</span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="relative inline-block h-2 w-2 rotate-45 bg-amber" /> keyframe
                </span>
                <span className="hidden lg:inline">Glissez les scènes, les barres, leurs bords et les losanges pour monter</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Zoom −" title="Zoom arrière (Ctrl + molette)" disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom / ZOOM_STEP)} className={zoomButton}>
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <input
              type="range"
              aria-label="Zoom de la timeline"
              aria-valuetext={`${Math.round(zoom * 100)} %`}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step="any"
              value={zoom}
              onChange={(e) => zoomTo(Number(e.target.value))}
              className="h-1 w-24 cursor-pointer accent-accent"
            />
            <button type="button" aria-label="Zoom +" title="Zoom avant (Ctrl + molette)" disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom * ZOOM_STEP)} className={zoomButton}>
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Tout voir : zoom 100 %" onClick={() => zoomTo(ZOOM_MIN)} className={zoomButton}>
              Ajuster
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollerRef} className="relative max-h-[290px] overflow-auto">
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
              const dragged = sceneDrag?.uid === s.uid;
              return (
                <div
                  key={s.uid}
                  className={clsx(
                    "absolute bottom-1 top-1 select-none rounded-md border",
                    dragged ? "z-40 cursor-grabbing shadow-lg shadow-black/60 ring-2 ring-pink" : "z-30 cursor-grab",
                    !dragged && i === activeScene && "ring-1 ring-white/70",
                  )}
                  style={{
                    left,
                    width: Math.max(8, s.duration * pps - 2),
                    background: `${color}33`,
                    borderColor: `${color}aa`,
                    transform: dragged ? `translateX(${sceneDrag.floatAt * pps - left}px)` : undefined,
                  }}
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
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Scène ${i + 1}`}
                    aria-pressed={i === activeScene}
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    data-scene={s.uid}
                    title="Glisser pour déplacer la scène (Alt + ← / → au clavier)"
                    onPointerDown={(e) => beginSceneDrag(e, i)}
                    onKeyDown={(e) => onSceneKey(e, i)}
                    // Focusing scrolls the block into view: not under the sticky labels.
                    style={{ scrollMarginLeft: LABEL_W }}
                    className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white"
                  />
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
            {sceneDrag && <div className="pointer-events-none absolute inset-y-0.5 z-40 w-[3px] rounded-full bg-pink shadow-[0_0_8px_1px_rgba(244,114,182,0.8)]" style={{ left: sceneDrag.slotAt * pps }} />}
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

          {/* Music: one bar over the whole video; its outline is the real gain (fades, volume, ducking under the narration) */}
          <Row
            label={<span className="label text-accent">Musique</span>}
            height={32}
            contentW={contentW}
            selected={!!music && musicSelected}
            onLabelClick={music ? onSelectMusic : undefined}
          >
            {music ? (
              <button
                type="button"
                aria-label={`Musique ${music.name}`.trim()}
                aria-pressed={musicSelected}
                title={`${music.name} · volume ${Math.round(music.volume * 100)} % · fondu ${sec(music.fadeIn)} / ${sec(music.fadeOut)}${music.duck ? " · baisse sous la voix" : ""}`}
                onClick={onSelectMusic}
                className={clsx(
                  "absolute inset-y-[3px] left-0 z-30 block overflow-hidden rounded-sm border border-accent/60 bg-accent/10 text-left outline-none focus-visible:ring-1 focus-visible:ring-white",
                  musicSelected && "ring-1 ring-white",
                )}
                style={{ width: total * pps }}
              >
                {envelope && (
                  // Seconds across, gain down (1 = top); the margin keeps the 1.5 px line inside the box at full gain.
                  <svg className="absolute inset-0 h-full w-full" viewBox={`0 -0.06 ${total} 1.12`} preserveAspectRatio="none" aria-hidden>
                    <polygon points={envelope.area} className="fill-accent/30" />
                    <polyline points={envelope.line} fill="none" className="stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
                <span className="relative block truncate px-2 font-mono text-[10px] leading-[24px] text-cream">♪ {music.name}</span>
              </button>
            ) : (
              <div
                className="absolute inset-y-1.5 left-0 flex items-center rounded-sm border border-dashed border-line-2 px-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600"
                style={{ width: total * pps }}
              >
                Aucune musique
              </div>
            )}
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
