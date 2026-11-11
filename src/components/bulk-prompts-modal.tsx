"use client";

import { useState } from "react";
import { 
  X, 
  Copy, 
  Check, 
  Download, 
  Sparkles, 
  Film, 
  FileText,
  Clock,
  Layers
} from "lucide-react";
import clsx from "clsx";
import type { ContentPlan } from "@/lib/types";

interface BulkPromptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: ContentPlan;
  format: "16:9" | "9:16";
}

export function BulkPromptsModal({
  isOpen,
  onClose,
  plan,
  format,
}: BulkPromptsModalProps) {
  const [activeMode, setActiveMode] = useState<"prompts_only" | "full_script">("prompts_only");
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedSceneId, setCopiedSceneId] = useState<number | null>(null);

  if (!isOpen) return null;

  // Génération du texte pour les prompts uniquement (prêt pour copier-coller dans Google Flow)
  const generatePromptsOnlyText = () => {
    return plan.scenes
      .map((scene, idx) => {
        const num = String(idx + 1).padStart(2, "0");
        return `// ==========================================
// SCÈNE ${num} : ${scene.title.toUpperCase()} (08 SECONDES)
// Lieu : ${scene.setting} | Format : ${format}
// Caméra : ${scene.cameraStyle}
// ==========================================
${scene.visualPrompt.trim()}
`;
      })
      .join("\n\n");
  };

  // Génération du dossier technique complet
  const generateFullScriptText = () => {
    const totalSecs = plan.scenes.length * 8;
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const timeFormatted = `${mins}m${secs < 10 ? "0" : ""}${secs}`;

    const casting = plan.characters
      .map((c, i) => {
        return `PERSONNAGE ${i + 1} : ${c.name} (${c.age} ans) — ${c.role}
- Taille : ${c.appearance.height} | Teint : ${c.appearance.skinTone}
- Tenue vestimentaire : ${c.appearance.outfit}
- Prompt Portrait 8K (First Frame Flow) :
${c.visualPrompt}
`;
      })
      .join("\n");

    const scenesText = plan.scenes
      .map((s, idx) => {
        const num = String(idx + 1).padStart(2, "0");
        const dialoguesText = s.dialogues && s.dialogues.length > 0
          ? s.dialogues.map((d) => `  ${d.speaker} : « ${d.text} »`).join("\n")
          : `  Voiceover : « ${s.voiceOver} »`;

        return `--------------------------------------------------
SCÈNE ${num} : ${s.title} (08s)
Décor : ${s.setting}
Caméra : ${s.cameraStyle} | Émotion : ${s.emotion}
Personnages présents : ${(s.charactersInvolved || []).join(", ") || "Tous"}

DIALOGUES & RÉPLIQUES :
${dialoguesText}

PROMPT VIDÉO GOOGLE FLOW (ANGLAIS) :
${s.visualPrompt}
`;
      })
      .join("\n");

    return `==================================================
DOSSIER DE PRODUCTION CIBLÉ GOOGLE FLOW
TITRE : ${plan.title}
GENRE : ${plan.genre} | TONALITÉ : ${plan.tone}
DURÉE : ${timeFormatted} (${plan.scenes.length} scènes de 8s) | FORMAT : ${format}
==================================================

LOGLINE :
${plan.logline}

SYNOPSIS :
${plan.synopsis}

==================================================
1. CASTING & INGRÉDIENTS PERSONNAGES
==================================================
${casting}

==================================================
2. DÉCOUPAGE TECHNIQUE DES SCÈNES SÉQUENTIELLES (8s)
==================================================
${scenesText}
`;
  };

  const currentText = activeMode === "prompts_only" ? generatePromptsOnlyText() : generateFullScriptText();

  const handleCopyAll = () => {
    navigator.clipboard.writeText(currentText);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopySingle = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSceneId(id);
    setTimeout(() => setCopiedSceneId(null), 1800);
  };

  const handleDownloadTxt = () => {
    const filename = `${plan.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${activeMode === "prompts_only" ? "prompts-flow" : "dossier-production"}.txt`;
    const blob = new Blob([currentText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl bg-[#0b0d13] border border-white/[0.12] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/[0.08] pb-5 flex-shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Export Groupé des Prompts (Bulk Flow)</h2>
                <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                  <span>{plan.title}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                    <Clock className="w-3 h-3" />
                    {plan.scenes.length} scènes de 8s (Total : {plan.scenes.length * 8}s)
                  </span>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contrôles & Sélecteur de Mode */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
          <div className="flex bg-white/[0.04] rounded-xl p-1 border border-white/[0.08]">
            <button
              onClick={() => setActiveMode("prompts_only")}
              className={clsx(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeMode === "prompts_only"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Prompts Vidéo Uniquement</span>
            </button>
            <button
              onClick={() => setActiveMode("full_script")}
              className={clsx(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeMode === "full_script"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-zinc-400 hover:text-white"
              )}
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Dossier Complet (Casting + Dialogues)</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleDownloadTxt}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.1] text-xs font-semibold transition-colors"
              title="Télécharger sous format texte brut (.txt)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Télécharger .txt</span>
            </button>

            <button
              onClick={handleCopyAll}
              className={clsx(
                "flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg",
                copiedAll
                  ? "bg-emerald-600 text-white shadow-emerald-600/30"
                  : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-amber-500/25 hover:scale-[1.02]"
              )}
            >
              {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedAll ? "Tous les prompts copiés !" : "Tout Copier (1 Clic)"}</span>
            </button>
          </div>
        </div>

        {/* Zone de Contenu Défilante */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {activeMode === "prompts_only" ? (
            <div className="space-y-3">
              {plan.scenes.map((scene, idx) => {
                const isCopied = copiedSceneId === scene.id;
                return (
                  <div
                    key={scene.id || idx}
                    className="p-4 rounded-2xl bg-black/50 border border-white/[0.08] hover:border-amber-500/30 transition-all space-y-2 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-extrabold flex items-center justify-center text-xs">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="text-xs font-bold text-white">{scene.title}</span>
                        <span className="text-[10px] text-amber-300 font-mono px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                          08s Flow
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopySingle(scene.id, scene.visualPrompt)}
                        className={clsx(
                          "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all border",
                          isCopied
                            ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30"
                            : "bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-white border-white/[0.08]"
                        )}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? "Copié" : "Copier"}</span>
                      </button>
                    </div>
                    <p className="text-xs font-mono text-zinc-300 bg-black/60 p-3 rounded-xl border border-white/[0.04] leading-relaxed selection:bg-amber-500/30">
                      {scene.visualPrompt}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <pre className="p-4 rounded-2xl bg-black/60 border border-white/[0.08] text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed select-all">
              {currentText}
            </pre>
          )}
        </div>

        {/* Footer Astuce */}
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-300 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              <strong>Conseil Flow :</strong> Ouvrez Google Flow et collez vos prompts les uns après les autres pour générer vos 11-12 plans et assembler votre film de 1m30 dans l&apos;onglet Studio de Montage.
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}

