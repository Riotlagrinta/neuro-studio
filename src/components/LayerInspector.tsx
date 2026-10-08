"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BringToFront, Captions, ChevronDown, ChevronRight, Circle, Copy, Image as ImageIcon, SendToBack, Square, Trash2, Type } from "lucide-react";
import clsx from "clsx";
import type { LayerReorder } from "@/lib/motion/layers";
import { sampleAt } from "@/lib/motion/manipulate";
import { CAPTION_STYLES, type CaptionStyle, type FontFamily, type Layer, type Reveal } from "@/lib/motion/types";

/** The animatable properties the Transformation block edits. Values are those of the track: scale 1 = 100 %, opacity 0–1. */
export type TransformProp = "x" | "y" | "scale" | "rotation" | "opacity";

interface Props {
  layer: Layer;
  sceneDuration: number;
  /** Default true. */
  canDelete?: boolean;
  /** Static properties (text, colour, size…). `key` lets typing in one field merge into one undo step. */
  onChange: (patch: Record<string, unknown>, key: string) => void;
  onTrim: (edge: "start" | "end", seconds: number) => void;
  onDelete: () => void;
  /** Seconds from the scene start: the instant the Transformation block shows and edits. Default 0. */
  time?: number;
  /**
   * Sets one property AT `time`: on an animated track it is the keyframe at that instant, on a static one the value.
   * Without it the Transformation block is not shown.
   */
  onTransform?: (prop: TransformProp, value: number) => void;
  onDuplicate?: () => void;
  /** Default true. */
  canDuplicate?: boolean;
  /** Without it the stacking buttons are not shown. */
  onReorder?: (to: LayerReorder) => void;
  /** Tells which stacking buttons would do something; the others are disabled. Default: all enabled. */
  canReorder?: (to: LayerReorder) => boolean;
}

const FONTS: { id: FontFamily; label: string }[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
  { id: "display", label: "Affiche" },
];

const REVEALS: { id: Reveal; label: string }[] = [
  { id: "none", label: "Aucun" },
  { id: "fade", label: "Fondu" },
  { id: "words", label: "Mot par mot" },
  { id: "chars", label: "Lettre par lettre" },
  { id: "typewriter", label: "Machine à écrire" },
];

const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = { karaoke: "Karaoké", pop: "Pop", box: "Boîte", outline: "Contour" };

const TITLES: Record<Layer["type"], { label: string; icon: ReactNode }> = {
  text: { label: "Texte", icon: <Type className="h-3.5 w-3.5" /> },
  rect: { label: "Forme", icon: <Square className="h-3.5 w-3.5" /> },
  ellipse: { label: "Cercle", icon: <Circle className="h-3.5 w-3.5" /> },
  media: { label: "Fond IA", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  captions: { label: "Sous-titres", icon: <Captions className="h-3.5 w-3.5" /> },
};

const ORDER: { to: LayerReorder; label: string; title: string; icon: ReactNode }[] = [
  { to: "front", label: "Premier plan", title: "Mettre au premier plan", icon: <BringToFront className="h-4 w-4" /> },
  { to: "forward", label: "Avancer", title: "Avancer d'un cran", icon: <ArrowUp className="h-4 w-4" /> },
  { to: "backward", label: "Reculer", title: "Reculer d'un cran", icon: <ArrowDown className="h-4 w-4" /> },
  { to: "back", label: "Arrière-plan", title: "Envoyer à l'arrière-plan (au-dessus du fond)", icon: <SendToBack className="h-4 w-4" /> },
];

/**
 * What the Transformation block edits. `unit` is how much bigger the number shown is than the track's value (percent
 * for scale and opacity). x and y are limited to what every frame accepts (sanitize.ts allows [-3, 4] frames).
 */
const TRANSFORMS: { prop: TransformProp; caption: string; name: string; unit: number; decimals: number; min: number; max: number; step: number }[] = [
  { prop: "x", caption: "X", name: "Position X", unit: 1, decimals: 2, min: -3240, max: 4320, step: 1 },
  { prop: "y", caption: "Y", name: "Position Y", unit: 1, decimals: 2, min: -3240, max: 4320, step: 1 },
  { prop: "scale", caption: "Échelle (%)", name: "Échelle (%)", unit: 100, decimals: 1, min: 5, max: 2000, step: 1 },
  { prop: "rotation", caption: "Rotation (°)", name: "Rotation (°)", unit: 1, decimals: 2, min: -3600, max: 3600, step: 1 },
  { prop: "opacity", caption: "Opacité (%)", name: "Opacité (%)", unit: 100, decimals: 1, min: 0, max: 100, step: 1 },
];

const ANIMATED = "Animé : la valeur modifie la keyframe à l'instant courant";

const field = "w-full rounded-md border border-line-2 bg-ink px-2 py-1.5 text-sm text-cream outline-none focus:border-accent";
const iconButton = "rounded p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500";

/** <input type=color> only understands #rrggbb; anything else (rgba, names) shows as white until changed. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : "#ffffff";
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-500">{value.length > 9 ? "…" : value}</span>
        <input type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-7 w-10 cursor-pointer rounded border border-line-2 bg-ink p-0.5" />
      </span>
    </label>
  );
}

// `+ 0` turns -0 into 0: "-0" must neither be shown nor reach the project.
const rounded = (v: number, decimals: number) => (Number.isFinite(v) ? Number(v.toFixed(decimals)) + 0 : 0);

/**
 * A number the user types into. Each valid value is committed at once (clamped to [min, max], to `decimals`), but
 * what is typed stays on screen until the field loses focus: "-", "1." or a number being clamped would otherwise be
 * overwritten by the committed value while the user is still typing.
 */
function NumberField({
  caption,
  name = caption,
  value,
  min,
  max,
  step,
  decimals = 0,
  animated = false,
  onCommit,
}: {
  caption: string;
  /** Accessible name, when it needs to say more than the caption. */
  name?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  /** The property has keyframes: the value is the one at the playhead. */
  animated?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block space-y-1" title={animated ? ANIMATED : undefined}>
      <span className="label flex items-center gap-1.5">
        {caption}
        {animated && <span role="img" aria-label={ANIMATED} className="inline-block h-2 w-2 shrink-0 rotate-45 border border-black/50 bg-amber" />}
      </span>
      <input
        type="number"
        aria-label={name}
        min={min}
        max={max}
        step={step}
        value={draft ?? String(rounded(value, decimals))}
        onChange={(e) => {
          setDraft(e.target.value);
          // An empty field (or one holding "-") reads as "": that is not a 0.
          const typed = e.target.value.trim() === "" ? NaN : Number(e.target.value);
          if (Number.isFinite(typed)) onCommit(rounded(Math.min(max, Math.max(min, typed)), decimals));
        }}
        onBlur={() => setDraft(null)}
        className={field}
      />
    </label>
  );
}

/** A compact collapsible block. The content is only mounted while it is open. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <button type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="label flex w-full items-center gap-1.5 text-left transition-colors hover:text-zinc-300">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && (
        <div id={id} role="group" aria-label={title} className="space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

export default function LayerInspector({
  layer,
  sceneDuration,
  canDelete = true,
  onChange,
  onTrim,
  onDelete,
  time,
  onTransform,
  onDuplicate,
  canDuplicate = true,
  onReorder,
  canReorder,
}: Props) {
  const { label, icon } = TITLES[layer.type];
  const end = layer.end ?? sceneDuration;
  const at = time !== undefined && Number.isFinite(time) ? time : 0;

  return (
    <section className="rounded-xl border border-pink/40 bg-panel" aria-label="Inspecteur de calque">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="label flex items-center gap-2 text-pink">
          {icon} Calque · {label}
        </p>
        <div className="flex items-center gap-0.5">
          {onDuplicate && (
            <button type="button" onClick={onDuplicate} disabled={!canDuplicate} title="Dupliquer le calque (Ctrl/Cmd + D)" aria-label="Dupliquer le calque" className={iconButton}>
              <Copy className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={!canDelete}
            title={canDelete ? "Supprimer le calque (Suppr)" : "Ce calque ne peut pas être supprimé"}
            aria-label="Supprimer le calque"
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {onReorder && (
        <div role="group" aria-label="Ordre des calques" className="flex items-center justify-between gap-2 border-b border-line px-4 py-1.5">
          <span className="label">Ordre</span>
          <div className="flex items-center gap-0.5">
            {ORDER.map(({ to, label: name, title, icon: glyph }) => (
              <button key={to} type="button" onClick={() => onReorder(to)} disabled={canReorder ? !canReorder(to) : false} title={title} aria-label={name} className={iconButton}>
                {glyph}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="label">Début (s)</span>
            <input type="number" step={0.05} min={0} value={Number(layer.start.toFixed(2))} onChange={(e) => onTrim("start", Number(e.target.value) || 0)} className={field} />
          </label>
          <label className="space-y-1">
            <span className="label">Fin (s)</span>
            <input type="number" step={0.05} max={sceneDuration} value={Number(end.toFixed(2))} onChange={(e) => onTrim("end", Number(e.target.value) || end)} className={field} />
          </label>
        </div>

        {layer.type === "text" && (
          <>
            <label className="block space-y-1">
              <span className="label">Texte</span>
              <textarea aria-label="Texte" value={layer.text} onChange={(e) => onChange({ text: e.target.value }, "text")} className={`${field} min-h-[64px] resize-none`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="label">Taille (px)</span>
                <input type="number" min={8} max={600} value={layer.size} onChange={(e) => onChange({ size: Math.min(600, Math.max(8, Number(e.target.value) || layer.size)) }, "size")} className={field} />
              </label>
              <label className="space-y-1">
                <span className="label">Police</span>
                <select aria-label="Police" value={layer.font} onChange={(e) => onChange({ font: e.target.value }, "font")} className={field}>
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Color label="Couleur" value={layer.color} onChange={(hex) => onChange({ color: hex }, "color")} />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="label">Apparition</span>
                <select aria-label="Apparition" value={layer.reveal} onChange={(e) => onChange({ reveal: e.target.value }, "reveal")} className={field}>
                  {REVEALS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="label">Durée (s)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  max={6}
                  disabled={layer.reveal === "none"}
                  value={layer.revealDuration}
                  onChange={(e) => onChange({ revealDuration: Math.min(6, Math.max(0.1, Number(e.target.value) || layer.revealDuration)) }, "revealDuration")}
                  className={`${field} disabled:opacity-40`}
                />
              </label>
            </div>
          </>
        )}

        {layer.type === "captions" && (
          <>
            <label className="block space-y-1">
              <span className="label">Texte</span>
              <textarea
                aria-label="Texte des sous-titres"
                maxLength={1200}
                value={layer.text}
                onChange={(e) => onChange({ text: e.target.value }, "text")}
                className={`${field} min-h-[88px] resize-none`}
              />
            </label>
            <label className="block space-y-1">
              <span className="label">Style</span>
              <select aria-label="Style des sous-titres" value={layer.style} onChange={(e) => onChange({ style: e.target.value }, "style")} className={field}>
                {CAPTION_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {CAPTION_STYLE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <Section title="Apparence">
              <div className="grid grid-cols-2 gap-3">
                <NumberField caption="Taille (px)" value={layer.size} min={16} max={400} step={1} onCommit={(size) => onChange({ size }, "size")} />
                <NumberField caption="Graisse" value={layer.weight} min={100} max={900} step={100} onCommit={(weight) => onChange({ weight }, "weight")} />
                <label className="space-y-1">
                  <span className="label">Police</span>
                  <select aria-label="Police" value={layer.font} onChange={(e) => onChange({ font: e.target.value }, "font")} className={field}>
                    {FONTS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField caption="Interligne" value={layer.lineHeight} min={0.9} max={2} step={0.05} decimals={2} onCommit={(lineHeight) => onChange({ lineHeight }, "lineHeight")} />
                {/* 2160 = twice the narrowest frame: what sanitize.ts accepts in both ratios. */}
                <NumberField caption="Largeur max (px)" value={layer.maxWidth} min={100} max={2160} step={10} onCommit={(maxWidth) => onChange({ maxWidth }, "maxWidth")} />
                <div className="flex items-end">
                  <button
                    type="button"
                    aria-pressed={layer.uppercase}
                    aria-label="Majuscules"
                    title="Afficher les sous-titres en majuscules"
                    onClick={() => onChange({ uppercase: !layer.uppercase }, "uppercase")}
                    className={clsx(
                      "w-full rounded-md border px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors",
                      layer.uppercase ? "border-accent bg-accent/15 text-white" : "border-line-2 bg-ink text-zinc-400 hover:border-accent hover:text-white",
                    )}
                  >
                    Majuscules
                  </button>
                </div>
              </div>
              <Color label="Couleur" value={layer.color} onChange={(hex) => onChange({ color: hex }, "color")} />
              <Color label="Surbrillance" value={layer.highlight} onChange={(hex) => onChange({ highlight: hex }, "highlight")} />
            </Section>
          </>
        )}

        {(layer.type === "rect" || layer.type === "ellipse") && <Color label="Remplissage" value={layer.fill} onChange={(hex) => onChange({ fill: hex }, "fill")} />}
        {layer.type === "rect" && (
          <label className="block space-y-1">
            <span className="label">Arrondi (px)</span>
            <input type="number" min={0} max={1000} value={layer.radius} onChange={(e) => onChange({ radius: Math.min(1000, Math.max(0, Number(e.target.value) || 0)) }, "radius")} className={field} />
          </label>
        )}
        {layer.type === "media" && <p className="text-xs text-zinc-500">Le fond généré par l&apos;IA pour cette scène : déplacez ou rognez sa barre dans la timeline.</p>}

        {onTransform && (
          <Section title="Transformation">
            <div className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3">
              {TRANSFORMS.map(({ prop, caption, name, unit, decimals, min, max, step }) => (
                <NumberField
                  key={prop}
                  caption={caption}
                  name={name}
                  value={sampleAt(layer[prop], at) * unit}
                  min={min}
                  max={max}
                  step={step}
                  decimals={decimals}
                  animated={Array.isArray(layer[prop])}
                  onCommit={(shown) => onTransform(prop, Math.round((shown / unit) * 10000) / 10000)}
                />
              ))}
            </div>
          </Section>
        )}

        <p className="font-mono text-[10px] text-zinc-600">Position, échelle et opacité sont animées : déplacez les losanges dans la timeline.</p>
      </div>
    </section>
  );
}
