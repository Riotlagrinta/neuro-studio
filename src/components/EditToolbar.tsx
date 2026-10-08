"use client";

import type { ReactNode } from "react";
import { Captions, Circle, Copy, Plus, Scissors, Square, Trash2, Type } from "lucide-react";
import clsx from "clsx";

// A button whose handler is missing is not rendered; the group around it disappears when it is left empty.
interface Props {
  onAddText?: () => void;
  onAddShape?: (kind: "rect" | "ellipse") => void;
  onAddCaptions?: () => void;
  /** Why subtitles can't be added right now (the scene has no narration): shown as the tooltip, and the button is disabled. */
  captionsDisabledReason?: string;
  onSplit?: () => void;
  /** The playhead is somewhere the scene can be cut. */
  canSplit?: boolean;
  onDuplicateScene?: () => void;
  onDeleteScene?: () => void;
  canDeleteScene?: boolean;
  onAddScene?: () => void;
  /** With maxScenes: at the cap, every button that makes a scene (cut, duplicate, add) is disabled. */
  sceneCount?: number;
  maxScenes?: number;
  /** A layer is selected: the "Calque" shortcuts appear. */
  hasLayer?: boolean;
  onDuplicateLayer?: () => void;
  onDeleteLayer?: () => void;
  /** With maxLayers: at the cap, every button that makes a layer (add, duplicate) is disabled. */
  layerCount?: number;
  maxLayers?: number;
}

const button =
  "flex items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="label mr-1" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

function Tool({
  label,
  text,
  title,
  icon,
  disabled,
  danger,
  onClick,
}: {
  /** Accessible name: the whole action. */
  label: string;
  /** Short visible label, hidden on narrow screens (the icon and the name remain). */
  text: string;
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(button, danger ? "hover:border-red-500/50 hover:text-red-400" : "hover:border-accent hover:text-white")}
    >
      {icon}
      <span className="hidden sm:inline">{text}</span>
    </button>
  );
}

const iconSize = "h-3.5 w-3.5";

export default function EditToolbar({
  onAddText,
  onAddShape,
  onAddCaptions,
  captionsDisabledReason,
  onSplit,
  canSplit = true,
  onDuplicateScene,
  onDeleteScene,
  canDeleteScene = true,
  onAddScene,
  sceneCount,
  maxScenes,
  hasLayer = false,
  onDuplicateLayer,
  onDeleteLayer,
  layerCount,
  maxLayers,
}: Props) {
  const scenesFull = sceneCount !== undefined && maxScenes !== undefined && sceneCount >= maxScenes;
  const layersFull = layerCount !== undefined && maxLayers !== undefined && layerCount >= maxLayers;
  const scenesFullTitle = `Maximum de ${maxScenes} scènes`;
  const layersFullTitle = `Maximum de ${maxLayers} calques`;
  // A tooltip says what the button does, or why it can't right now.
  const addLayerTitle = (action: string) => (layersFull ? layersFullTitle : action);
  const addSceneTitle = (action: string) => (scenesFull ? scenesFullTitle : action);

  const hasAdd = !!(onAddText || onAddShape || onAddCaptions);
  const hasScene = !!(onSplit || onDuplicateScene || onDeleteScene || onAddScene);
  const hasLayerTools = hasLayer && !!(onDuplicateLayer || onDeleteLayer);
  if (!hasAdd && !hasScene && !hasLayerTools) return null;

  return (
    <div role="group" aria-label="Outils de montage" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-panel px-3 py-2">
      {hasAdd && (
        <Group label="Ajouter">
          {onAddText && <Tool label="Ajouter un texte" text="Texte" title={addLayerTitle("Ajouter un texte (T)")} icon={<Type className={iconSize} />} disabled={layersFull} onClick={onAddText} />}
          {onAddShape && (
            <>
              <Tool label="Ajouter une forme" text="Forme" title={addLayerTitle("Ajouter une forme")} icon={<Square className={iconSize} />} disabled={layersFull} onClick={() => onAddShape("rect")} />
              <Tool label="Ajouter un cercle" text="Cercle" title={addLayerTitle("Ajouter un cercle")} icon={<Circle className={iconSize} />} disabled={layersFull} onClick={() => onAddShape("ellipse")} />
            </>
          )}
          {onAddCaptions && (
            <Tool
              label="Ajouter des sous-titres"
              text="Sous-titres"
              title={captionsDisabledReason ?? addLayerTitle("Ajouter des sous-titres animés d'après la narration")}
              icon={<Captions className={iconSize} />}
              disabled={!!captionsDisabledReason || layersFull}
              onClick={onAddCaptions}
            />
          )}
        </Group>
      )}

      {hasScene && (
        <Group label="Scène">
          {onSplit && (
            <Tool
              label="Couper à la tête de lecture"
              text="Couper"
              title={scenesFull ? scenesFullTitle : canSplit ? "Couper à la tête de lecture (S)" : "Couper à la tête de lecture : chaque partie doit durer au moins 0,3 s"}
              icon={<Scissors className={iconSize} />}
              disabled={scenesFull || !canSplit}
              onClick={onSplit}
            />
          )}
          {onDuplicateScene && <Tool label="Dupliquer la scène" text="Dupliquer" title={addSceneTitle("Dupliquer la scène")} icon={<Copy className={iconSize} />} disabled={scenesFull} onClick={onDuplicateScene} />}
          {onDeleteScene && (
            <Tool
              label="Supprimer la scène"
              text="Supprimer"
              title={canDeleteScene ? "Supprimer la scène" : "Un projet garde au moins une scène"}
              icon={<Trash2 className={iconSize} />}
              disabled={!canDeleteScene}
              danger
              onClick={onDeleteScene}
            />
          )}
          {onAddScene && <Tool label="Ajouter une scène" text="Ajouter" title={addSceneTitle("Ajouter une scène vide")} icon={<Plus className={iconSize} />} disabled={scenesFull} onClick={onAddScene} />}
        </Group>
      )}

      {hasLayerTools && (
        <Group label="Calque">
          {onDuplicateLayer && (
            <Tool label="Dupliquer le calque" text="Dupliquer" title={addLayerTitle("Dupliquer le calque (Ctrl/Cmd + D)")} icon={<Copy className={iconSize} />} disabled={layersFull} onClick={onDuplicateLayer} />
          )}
          {onDeleteLayer && <Tool label="Supprimer le calque" text="Supprimer" title="Supprimer le calque (Suppr)" icon={<Trash2 className={iconSize} />} danger onClick={onDeleteLayer} />}
        </Group>
      )}
    </div>
  );
}
