"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import clsx from "clsx";
import { layerBox, type Box, type Point } from "@/lib/motion/manipulate";
import {
  beginGesture,
  CORNER_ORDER,
  cornerCursor,
  formatReadout,
  frameGeometry,
  HANDLE_HIT,
  measureAt,
  monitorScale,
  pastThreshold,
  pickAt,
  pickSlack,
  placeBox,
  READOUT_HEIGHT,
  readoutOrigin,
  selectionView,
  stepGesture,
  transitionPlacement,
  type Gesture,
  type GestureKind,
  type SelectionView,
  type TextMeasurer,
} from "@/lib/motion/overlay-math";
import type { Selection } from "@/lib/motion/selection";
import type { SnapGuide } from "@/lib/motion/snap";
import { FRAMES, locate, type MotionProject } from "@/lib/motion/types";

export interface MonitorOverlayHandle {
  /**
   * Puts the selection frame where the selected layer is at the playhead. The player calls it on every painted frame
   * (playback, scrubbing, undo): it only writes to the DOM, so nothing re-renders.
   */
  update(): void;
}

interface Props {
  project: MotionProject;
  selection: Selection | null;
  /** False while the video plays: the frame still follows the layer, but nothing can be picked or dragged. */
  interactive: boolean;
  /** Playhead in seconds. It isn't React state, so it is read when needed. */
  getTime: () => number;
  /** Real text metrics from the player's canvas. Without it text boxes are estimated. */
  measure?: TextMeasurer;
  onSelect: (selection: Selection | null) => void;
  /** A drag is: onEditStart, then many onEdit (each computed from the project as it was at the start), then onEditEnd. */
  onEditStart?: () => void;
  onEdit: (next: MotionProject) => void;
  onEditEnd?: () => void;
  ref?: Ref<MonitorOverlayHandle>;
}

/** What the DOM listeners and the imperative update read: always the props of the latest render. */
interface Live {
  project: MotionProject;
  selection: Selection | null;
  interactive: boolean;
  getTime: () => number;
  measure: TextMeasurer | undefined;
  onSelect: (selection: Selection | null) => void;
  onEditStart: (() => void) | undefined;
  onEdit: (next: MotionProject) => void;
  onEditEnd: (() => void) | undefined;
}

const HANDLES: { label: string; kind: GestureKind }[] = [
  { label: "Redimensionner (haut gauche)", kind: { type: "resize", corner: "tl" } },
  { label: "Redimensionner (haut droit)", kind: { type: "resize", corner: "tr" } },
  { label: "Redimensionner (bas droit)", kind: { type: "resize", corner: "br" } },
  { label: "Redimensionner (bas gauche)", kind: { type: "resize", corner: "bl" } },
  { label: "Poignée de rotation", kind: { type: "rotate" } },
];
const ROTATE_HANDLE = HANDLES.length - 1;

const NO_VIEW: SelectionView = { kind: "none" };

const sameGuides = (a: SnapGuide[], b: SnapGuide[]) => a.length === b.length && a.every((g, i) => g.axis === b[i].axis && g.at === b[i].at);

/** Sizes and turns an absolutely positioned element to cover `box` (frame pixels) on a monitor `factor` CSS pixels per frame pixel. */
function placeBoxEl(el: HTMLElement, box: Box, factor: number) {
  const w = box.w * factor;
  const h = box.h * factor;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.transform = `translate(${box.cx * factor - w / 2}px, ${box.cy * factor - h / 2}px) rotate(${box.rotation}deg)`;
}

/** What a press at `point` (CSS pixels) would land on, in the scene under the playhead. */
function probe(live: Live, point: Point, factor: number, slack: number) {
  const { project, getTime, measure } = live;
  const { index, local } = locate(project, getTime());
  const scene = project.scenes[index];
  if (!scene) return null;
  const measureFor = measureAt(measure, scene, local);
  return { index, local, scene, measureFor, id: pickAt(project, index, local, point, factor, measureFor, slack) };
}

export default function MonitorOverlay({ project, selection, interactive, getTime, measure, onSelect, onEditStart, onEdit, onEditEnd, ref }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stemRef = useRef<SVGLineElement>(null);
  const handleEls = useRef<(HTMLDivElement | null)[]>([]);
  const readoutRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  const live = useRef<Live>({ project, selection, interactive, getTime, measure, onSelect, onEditStart, onEdit, onEditEnd });
  const size = useRef({ w: 0, h: 0 });
  /** Last position of a mouse over the picture, CSS pixels from the monitor's corner. */
  const hover = useRef<Point | null>(null);
  const drag = useRef<{ stop: () => void } | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);

  const paintHover = useCallback(() => {
    const outline = hoverRef.current;
    const surface = surfaceRef.current;
    if (!outline || !surface) return;
    const { project, selection, interactive } = live.current;
    const factor = monitorScale(size.current.w, project.ratio);
    const point = hover.current;
    const found = interactive && !drag.current && point && factor > 0 ? probe(live.current, point, factor, pickSlack("mouse")) : null;
    const layer = found?.id ? found.scene.layers.find((l) => l.id === found.id) : undefined;
    const box = found && layer ? layerBox(layer, found.scene, found.local, found.measureFor) : null;
    const selected = !!layer && found?.scene.uid === selection?.scene && layer.id === selection?.layer;
    surface.style.cursor = !layer ? "default" : selected ? "move" : "pointer";
    outline.hidden = !(found && box && !selected);
    if (found && box && !selected) placeBoxEl(outline, placeBox(box, transitionPlacement(project, found.index, found.local), FRAMES[project.ratio]), factor);
  }, []);

  const update = useCallback(() => {
    const { project, selection, getTime, measure } = live.current;
    const factor = monitorScale(size.current.w, project.ratio);
    const view = factor > 0 ? selectionView(project, selection, getTime(), (scene, local) => measureAt(measure, scene, local)) : NO_VIEW;

    const group = groupRef.current;
    const hint = hintRef.current;
    if (hint) hint.hidden = view.kind !== "hidden";
    if (group) group.hidden = view.kind !== "frame";
    if (view.kind === "frame" && group) {
      const geometry = frameGeometry(view.screen, factor);
      if (frameRef.current) placeBoxEl(frameRef.current, view.screen, factor);
      const stem = stemRef.current;
      if (stem) {
        stem.setAttribute("x1", String(geometry.stemFrom.x));
        stem.setAttribute("y1", String(geometry.stemFrom.y));
        stem.setAttribute("x2", String(geometry.rotate.x));
        stem.setAttribute("y2", String(geometry.rotate.y));
      }
      const points = [...geometry.corners, geometry.rotate];
      points.forEach((p, i) => {
        const el = handleEls.current[i];
        if (!el) return;
        el.style.transform = `translate(${p.x - HANDLE_HIT / 2}px, ${p.y - HANDLE_HIT / 2}px) rotate(${view.screen.rotation}deg)`;
        el.style.cursor = i === ROTATE_HANDLE ? "grab" : cornerCursor(CORNER_ORDER[i], view.screen.rotation);
      });
      const readout = readoutRef.current;
      if (readout) {
        const text = formatReadout(view.layer, view.local);
        if (readout.textContent !== text) readout.textContent = text;
        const at = readoutOrigin(geometry.corners, text.length, size.current);
        readout.style.transform = `translate(${at.x}px, ${at.y}px)`;
      }
    }
    paintHover();
  }, [paintHover]);

  useImperativeHandle(ref, () => ({ update }), [update]);

  // The listeners below outlive a render: they read the props of the latest one from here.
  useEffect(() => {
    live.current = { project, selection, interactive, getTime, measure, onSelect, onEditStart, onEdit, onEditEnd };
    update();
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      size.current = { w: entry.contentRect.width, h: entry.contentRect.height };
      update();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [update]);

  // Playback starts, or the monitor goes away, in the middle of a drag: the edit ends where it stands.
  useEffect(() => {
    if (!interactive) drag.current?.stop();
  }, [interactive]);
  useEffect(() => {
    const active = drag;
    return () => active.current?.stop();
  }, []);

  /** The pointer's position in the monitor (CSS pixels) and the monitor's scale, read where the monitor is right now. */
  const pointerInfo = (e: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const factor = rect ? monitorScale(rect.width, live.current.project.ratio) : 0;
    return rect && factor > 0 ? { point: { x: e.clientX - rect.left, y: e.clientY - rect.top }, factor } : null;
  };

  /**
   * A drag edit. Every pointer move recomputes the result from the project as it was when the press began (never from
   * the previous move), so it can't drift and returning to the start leaves the project untouched. Escape puts the
   * project back and ends the drag; the page's own Escape (deselect) doesn't see that key press.
   */
  const startDrag = (e: ReactPointerEvent<HTMLElement>, gesture: Gesture, waitForDrag: boolean) => {
    const { pointerId } = e;
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch {
      // The pointer is already gone: the window listeners below still end the drag.
    }
    // A press on a layer is a click until it has moved a few pixels.
    let armed = !waitForDrag;
    live.current.onEditStart?.();

    const apply = (ev: PointerEvent) => {
      const info = pointerInfo(ev);
      if (!info) return;
      // The cursor is the pointer's: once the drag is over, what is under it is what a hover looks for.
      if (ev.pointerType !== "touch") hover.current = info.point;
      if (!armed) {
        if (!pastThreshold(gesture.press, info.point)) return;
        armed = true;
      }
      const step = stepGesture(gesture, info.point, { shift: ev.shiftKey, alt: ev.altKey });
      live.current.onEdit(step.project);
      setGuides((current) => (sameGuides(current, step.guides) ? current : step.guides));
    };
    const finish = (revert: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      drag.current = null;
      if (revert) live.current.onEdit(gesture.base);
      setGuides((current) => (current.length === 0 ? current : []));
      live.current.onEditEnd?.();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) apply(ev);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.type === "pointerup") apply(ev);
      finish(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    drag.current = { stop: () => finish(false) };
  };

  const pressable = (e: ReactPointerEvent) => interactive && !drag.current && e.button === 0 && e.isPrimary;

  // A press on the picture: select what is under it (the topmost layer that isn't the backdrop) and start moving it.
  const onSurfaceDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const info = pointerInfo(e);
    if (!pressable(e) || !info) return;
    const found = probe(live.current, info.point, info.factor, pickSlack(e.pointerType));
    if (!found) return;
    if (!found.id) {
      if (selection) onSelect(null);
      return;
    }
    if (selection?.scene !== found.scene.uid || selection.layer !== found.id) onSelect({ scene: found.scene.uid, layer: found.id });
    const gesture = beginGesture({ kind: { type: "move" }, project, sceneIndex: found.index, layerId: found.id, local: found.local, measure: found.measureFor, press: info.point, factor: info.factor });
    if (gesture) startDrag(e, gesture, true);
  };

  const onSurfaceMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current || e.pointerType === "touch") return;
    hover.current = pointerInfo(e)?.point ?? null;
    paintHover();
  };

  const onSurfaceLeave = () => {
    hover.current = null;
    paintHover();
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>, kind: GestureKind) => {
    const info = pointerInfo(e);
    if (!pressable(e) || !info) return;
    const view = selectionView(project, selection, getTime(), (scene, local) => measureAt(measure, scene, local));
    if (view.kind !== "frame") return;
    const gesture = beginGesture({
      kind,
      project,
      sceneIndex: view.index,
      layerId: view.layer.id,
      local: view.local,
      measure: measureAt(measure, project.scenes[view.index], view.local),
      press: info.point,
      factor: info.factor,
    });
    if (gesture) startDrag(e, gesture, false);
  };

  const frame = FRAMES[project.ratio];
  const catches = interactive ? "pointer-events-auto" : "pointer-events-none";

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 select-none">
      <div
        ref={surfaceRef}
        role="group"
        aria-label="Sélection dans le moniteur"
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerLeave={onSurfaceLeave}
        className={clsx("absolute inset-0 touch-none", catches)}
      />

      {/* What a press would pick */}
      <div ref={hoverRef} hidden className="absolute left-0 top-0 border border-sky/80" />

      {/* Magnetic guides, while a layer is moved */}
      {guides.map((g) => (
        <div
          key={`${g.axis}${g.at}`}
          aria-hidden
          className={clsx("absolute bg-pink", g.axis === "x" ? "inset-y-0 w-px -translate-x-1/2" : "inset-x-0 h-px -translate-y-1/2")}
          style={g.axis === "x" ? { left: `${(g.at / frame.width) * 100}%` } : { top: `${(g.at / frame.height) * 100}%` }}
        />
      ))}

      {/* The selected layer: its frame, a stem to the rotation handle, four corners, the live values */}
      <div ref={groupRef} hidden className="absolute inset-0">
        <div ref={frameRef} className="absolute left-0 top-0 border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
        <svg className="absolute inset-0 h-full w-full overflow-visible drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]" aria-hidden>
          <line ref={stemRef} stroke="white" strokeWidth={1} />
        </svg>
        {HANDLES.map((handle, i) => (
          <div
            key={handle.label}
            ref={(el) => {
              handleEls.current[i] = el;
            }}
            role="button"
            aria-label={handle.label}
            onPointerDown={(e) => onHandleDown(e, handle.kind)}
            style={{ width: HANDLE_HIT, height: HANDLE_HIT }}
            className={clsx("absolute left-0 top-0 flex touch-none items-center justify-center", catches)}
          >
            <span className={clsx("pointer-events-none block border border-ink bg-white", i === ROTATE_HANDLE ? "h-[11px] w-[11px] rounded-full" : "h-[9px] w-[9px]")} />
          </div>
        ))}
        <div
          ref={readoutRef}
          style={{ height: READOUT_HEIGHT, lineHeight: `${READOUT_HEIGHT}px` }}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded bg-black/75 px-1.5 font-mono text-[10px] tabular-nums text-cream"
        />
      </div>

      <div
        ref={hintRef}
        hidden
        role="status"
        className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-amber"
      >
        Calque hors champ à cet instant
      </div>
    </div>
  );
}
