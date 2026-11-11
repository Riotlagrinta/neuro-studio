"use client";

import { useState } from "react";
import { 
  Key, 
  X, 
  Check, 
  Eye, 
  EyeOff, 
  Trash2, 
  ExternalLink,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { UserApiKeys } from "@/lib/types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userKeys: UserApiKeys;
  onSaveKeys: (keys: UserApiKeys) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  userKeys,
  onSaveKeys,
}: SettingsModalProps) {
  const [keys, setKeys] = useState<UserApiKeys>(userKeys);
  const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const toggleVisibility = (field: string) => {
    setShowKeys((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSave = () => {
    onSaveKeys(keys);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  const handleClear = () => {
    const emptyKeys: UserApiKeys = {
      openaiApiKey: "",
      grokApiKey: "",
      nanoBananaApiKey: "",
      elevenLabsApiKey: "",
    };
    setKeys(emptyKeys);
    onSaveKeys(emptyKeys);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-[#0b0d13] border border-white/[0.12] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/[0.08] pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Key className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">Paramètres & Clés API (BYOK)</h2>
            </div>
            <p className="text-xs text-zinc-400">
              Connectez vos clés personnelles pour générer directement depuis le site sans aucune limite de quota serveur.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Sécurité */}
        <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-3 text-xs text-indigo-300">
          <ShieldCheck className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold text-white">Stockage 100% Local & Sécurisé</p>
            <p className="text-indigo-200/80 leading-relaxed">
              Vos clés sont conservées exclusivement dans le stockage local de votre navigateur (<code className="text-indigo-300">localStorage</code>) et transmises de manière éphémère uniquement aux APIs respectives.
            </p>
          </div>
        </div>

        {/* Formulaire des Clés */}
        <div className="space-y-5">
          
          {/* 1. ChatGPT OpenAI */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>ChatGPT (OpenAI API)</span>
                <span className="text-[10px] text-zinc-500 font-normal">GPT-4o Scénario & Prompts</span>
              </label>
              <a 
                href="https://platform.openai.com/api-keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <span>Obtenir une clé</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="relative">
              <input
                type={showKeys.openai ? "text" : "password"}
                placeholder="sk-proj-..."
                value={keys.openaiApiKey || ""}
                onChange={(e) => setKeys({ ...keys, openaiApiKey: e.target.value })}
                className="w-full bg-black/60 border border-white/[0.1] focus:border-indigo-500 rounded-xl px-4 py-3 text-xs font-mono text-zinc-200 outline-none pr-10"
              />
              <button
                type="button"
                onClick={() => toggleVisibility("openai")}
                className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
              >
                {showKeys.openai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Permet de générer l&apos;intégralité des découpages de scènes et d&apos;affiner chaque scène avec ChatGPT GPT-4o.
            </p>
          </div>

          {/* 2. xAI Grok Imagine Video */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-violet-400" />
                <span>xAI Grok (Imagine Video API)</span>
                <span className="text-[10px] text-zinc-500 font-normal">Génération Vidéo 8s directe</span>
              </label>
              <a 
                href="https://console.x.ai" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <span>Obtenir une clé</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="relative">
              <input
                type={showKeys.grok ? "text" : "password"}
                placeholder="xai-..."
                value={keys.grokApiKey || ""}
                onChange={(e) => setKeys({ ...keys, grokApiKey: e.target.value })}
                className="w-full bg-black/60 border border-white/[0.1] focus:border-indigo-500 rounded-xl px-4 py-3 text-xs font-mono text-zinc-200 outline-none pr-10"
              />
              <button
                type="button"
                onClick={() => toggleVisibility("grok")}
                className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
              >
                {showKeys.grok ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Débloque le bouton &quot;Générer la vidéo 8s&quot; dans chaque scène pour obtenir le rendu MP4 prêt pour le montage.
            </p>
          </div>

          {/* 3. Nano Banana / Google AI Studio Imagen 3 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Nano Banana / Google AI Studio (Imagen 3)</span>
                <span className="text-[10px] text-zinc-500 font-normal">Portraits 8K Casting</span>
              </label>
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <span>Obtenir une clé</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="relative">
              <input
                type={showKeys.nanoBanana ? "text" : "password"}
                placeholder="AIzaSy..."
                value={keys.nanoBananaApiKey || ""}
                onChange={(e) => setKeys({ ...keys, nanoBananaApiKey: e.target.value })}
                className="w-full bg-black/60 border border-white/[0.1] focus:border-indigo-500 rounded-xl px-4 py-3 text-xs font-mono text-zinc-200 outline-none pr-10"
              />
              <button
                type="button"
                onClick={() => toggleVisibility("nanoBanana")}
                className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
              >
                {showKeys.nanoBanana ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Permet de générer instantanément les portraits photo-réalistes officiels de vos personnages comme Ingrédients Flow.
            </p>
          </div>

          {/* 4. ElevenLabs Voix */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span>ElevenLabs API</span>
                <span className="text-[10px] text-zinc-500 font-normal">Voix Ultra-Réalistes HD</span>
              </label>
              <a 
                href="https://elevenlabs.io" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <span>Obtenir une clé</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="relative">
              <input
                type={showKeys.eleven ? "text" : "password"}
                placeholder="sk_..."
                value={keys.elevenLabsApiKey || ""}
                onChange={(e) => setKeys({ ...keys, elevenLabsApiKey: e.target.value })}
                className="w-full bg-black/60 border border-white/[0.1] focus:border-indigo-500 rounded-xl px-4 py-3 text-xs font-mono text-zinc-200 outline-none pr-10"
              />
              <button
                type="button"
                onClick={() => toggleVisibility("eleven")}
                className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
              >
                {showKeys.eleven ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Génère des pistes audio professionnelles avec des voix de cinéma émotionnelles et multilingues.
            </p>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Effacer les clés</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-xs font-semibold transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/30"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Enregistré !</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Sauvegarder</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

