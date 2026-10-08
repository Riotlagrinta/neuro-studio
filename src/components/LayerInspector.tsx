"use client";

import { Circle, Image as ImageIcon, Square, Trash2, Type } from "lucide-react";
import type { FontFamily, Layer, Reveal } from "@/lib/motion/types";

interface Props {
  layer: Layer;
  sceneDuration: number;
  canDelete: boolean;
  /** Static properties (text, colour, size…). `key` lets typing in one field merge into one undo step. */
  onChange: (patch: Record<string, unknown>, key: string) => void;
  onTrim: (edge: "start" | "end", seconds: number) => void;
  onDelete: () => void;
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

const TITLES: Record<Layer["type"], { label: string; icon: React.ReactNode }> = {
  text: { label: "Texte", icon: <Type className="h-3.5 w-3.5" /> },
  rect: { label: "Forme", icon: <Square className="h-3.5 w-3.5" /> },
  ellipse: { label: "Cercle", icon: <Circle className="h-3.5 w-3.5" /> },
  media: { label: "Fond IA", icon: <ImageIcon className="h-3.5 w-3.5" /> },
};

const field = "w-full rounded-md border border-line-2 bg-ink px-2 py-1.5 text-sm text-cream outline-none focus:border-accent";

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

export default function LayerInspector({ layer, sceneDuration, canDelete, onChange, onTrim, onDelete }: Props) {
  const { label, icon } = TITLES[layer.type];
  const end = layer.end ?? sceneDuration;

  return (
    <section className="rounded-xl border border-pink/40 bg-panel" aria-label="Inspecteur de calque">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="label flex items-center gap-2 text-pink">
          {icon} Calque · {label}
        </p>
        <button
          onClick={onDelete}
          disabled={!canDelete}
          title={canDelete ? "Supprimer le calque (Suppr)" : "Une scène garde au moins un calque"}
          aria-label="Supprimer le calque"
          className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

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

        {(layer.type === "rect" || layer.type === "ellipse") && <Color label="Remplissage" value={layer.fill} onChange={(hex) => onChange({ fill: hex }, "fill")} />}
        {layer.type === "rect" && (
          <label className="block space-y-1">
            <span className="label">Arrondi (px)</span>
            <input type="number" min={0} max={1000} value={layer.radius} onChange={(e) => onChange({ radius: Math.min(1000, Math.max(0, Number(e.target.value) || 0)) }, "radius")} className={field} />
          </label>
        )}
        {layer.type === "media" && <p className="text-xs text-zinc-500">Le fond généré par l&apos;IA pour cette scène : déplacez ou rognez sa barre dans la timeline.</p>}
        <p className="font-mono text-[10px] text-zinc-600">Position, échelle et opacité sont animées : déplacez les losanges dans la timeline.</p>
      </div>
    </section>
  );
}

