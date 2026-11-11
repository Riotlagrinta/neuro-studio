"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Loader2, 
  Play, 
  Square,
  Volume2,
  Sparkles, 
  Clapperboard, 
  Save,
  CheckCircle2,
  FileDown,
  History,
  Copy,
  Check,
  Smartphone,
  Monitor,
  Users,
  Film,
  ExternalLink,
  ArrowRight,
  Zap,
  Rocket,
  Search,
  Smile,
  Shield,
  Layers,
  Clock,
  Plus,
  Trash2,
  Mic,
  Scissors,
  Upload,
  Pause,
  Download,
  Key,
  FileText,
  Wand2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import clsx from "clsx";
import { 
  generateContent, 
  saveProject, 
  generateVoiceAudio,
  refineScene,
  generateElevenLabsAudioWithKey,
  generateNanoBananaImageWithKey,
  generateGrokVideoWithKey
} from "./actions";
import { SettingsModal } from "@/components/settings-modal";
import { BulkPromptsModal } from "@/components/bulk-prompts-modal";
import { 
  speakSingleLine, 
  playSceneDialogues 
} from "@/lib/speech";
import { renderMontageSequence } from "@/lib/video-assembler";
import { 
  AVAILABLE_VOICES,
  type ContentPlan, 
  type Character, 
  type Scene,
  type UserApiKeys
} from "@/lib/types";

export const dynamic = "force-dynamic";

type AspectRatio = "16:9" | "9:16";
type ActiveTab = "characters" | "scenes" | "editor";

const GENRES = [
  { id: "all", name: "Tous Genres", icon: Sparkles },
  { id: "action", name: "Action & Thriller", icon: Zap },
  { id: "scifi", name: "Sci-Fi & Futuriste", icon: Rocket },
  { id: "drama", name: "Drame & Émotion", icon: Film },
  { id: "mystery", name: "Mystère & Enquête", icon: Search },
  { id: "comedy", name: "Comédie & Satire", icon: Smile },
  { id: "epic", name: "Épopée & Légende", icon: Shield },
];

const PRESET_TOPICS = [
  {
    genre: "Sci-Fi & Futuriste",
    title: "Lagos 2085 : L'IA Clandestine",
    desc: "Dans un Lagos cyberpunk aux gratte-ciels néon, une jeune hackeuse découvre une IA douée de conscience cachée dans le réseau ferroviaire.",
  },
  {
    genre: "Action & Thriller",
    title: "Poursuite Nocturne & Puce Cryptée",
    desc: "Une course-poursuite haletante à moto à travers des ruelles étroites et un marché nocturne pour livrer une puce de données avant le lever du jour.",
  },
  {
    genre: "Drame & Émotion",
    title: "Le Stagiaire et le Vieil Homme",
    desc: "Un jeune stagiaire paye de sa poche pour un vieil homme délaissé qui s'avère être le président de l'institution.",
  },
  {
    genre: "Mystère & Enquête",
    title: "L'Ombre du Manoir Oublié",
    desc: "Un inspecteur chevronné pénètre dans une demeure coloniale abandonnée où des fréquences radio s'activent mystérieusement à minuit.",
  }
];

export default function Home() {
  const [topic, setTopic] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("Tous Genres");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [error, setError] = useState("");
  const [globalRatio, setGlobalRatio] = useState<AspectRatio>("16:9");
  const [activeTab, setActiveTab] = useState<ActiveTab>("characters");
  const [userKeys, setUserKeys] = useState<UserApiKeys>({});
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [preferredEngine, setPreferredEngine] = useState<"groq" | "chatgpt">("groq");

  useEffect(() => {
    const savedPlan = localStorage.getItem("neuro_current_plan");
    if (savedPlan) {
      try {
        const parsed = JSON.parse(savedPlan);
        setPlan(parsed);
        const savedTopic = localStorage.getItem("neuro_current_topic");
        if (savedTopic) setTopic(savedTopic);
        localStorage.removeItem("neuro_current_plan");
        localStorage.removeItem("neuro_current_topic");
      } catch (e) {
        console.error("Erreur de chargement du plan archivé :", e);
      }
    }

    const savedKeys = localStorage.getItem("neuro_user_api_keys");
    if (savedKeys) {
      try {
        const parsed = JSON.parse(savedKeys);
        setUserKeys(parsed);
        if (parsed.openaiApiKey) {
          setPreferredEngine("chatgpt");
        }
      } catch (e) {
        console.error("Erreur de chargement des clés API :", e);
      }
    }
  }, []);

  const handleSaveUserKeys = (newKeys: UserApiKeys) => {
    setUserKeys(newKeys);
    localStorage.setItem("neuro_user_api_keys", JSON.stringify(newKeys));
    if (newKeys.openaiApiKey && !userKeys.openaiApiKey) {
      setPreferredEngine("chatgpt");
    }
  };

  const activeKeysCount = Object.values(userKeys).filter((v) => Boolean(v?.trim())).length;

  const handleGenerate = async (customTopic?: string, customGenre?: string) => {
    const promptToUse = (customTopic || topic).trim();
    if (!promptToUse) return;
    const genreToUse = customGenre || selectedGenre;
    setIsGenerating(true);
    setError("");
    setPlan(null);
    try {
      const activeOpenAiKey = preferredEngine === "chatgpt" ? userKeys.openaiApiKey : undefined;
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: promptToUse,
          genre: genreToUse,
          format: globalRatio,
          userOpenAiKey: activeOpenAiKey,
        }),
      });

      const result = await response.json();
      if (result.success && result.data) {
        setPlan(result.data);
        setActiveTab("characters");
      } else {
        setError(result.error || "ERREUR_GENERATION_IA");
      }
    } catch {
      try {
        const activeOpenAiKey = preferredEngine === "chatgpt" ? userKeys.openaiApiKey : undefined;
        const fallbackResult = await generateContent(
          promptToUse, 
          genreToUse, 
          globalRatio,
          activeOpenAiKey
        );
        if (fallbackResult.success && fallbackResult.data) {
          setPlan(fallbackResult.data);
          setActiveTab("characters");
        } else {
          setError(fallbackResult.error || "ERREUR_GENERATION_IA");
        }
      } catch {
        setError("ERREUR_CONNEXION_SERVEUR : Impossible de contacter l'API de génération.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!plan || !topic) return;
    setIsSaving(true);
    try {
      const result = await saveProject(topic, plan);
      if (result.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setError(result.error || "SAVE_ERROR");
      }
    } catch {
      setError("NETWORK_ERROR");
    } finally {
      setIsSaving(false);
    }
  };

  const updateCharacter = (index: number, updates: Partial<Character>) => {
    if (!plan) return;
    const newCharacters = [...plan.characters];
    newCharacters[index] = { ...newCharacters[index], ...updates };
    setPlan({ ...plan, characters: newCharacters });
  };

  const updateScene = (index: number, updates: Partial<Scene>) => {
    if (!plan) return;
    const newScenes = [...plan.scenes];
    newScenes[index] = { ...newScenes[index], ...updates };
    setPlan({ ...plan, scenes: newScenes });
  };

  const handleAddScene = () => {
    if (!plan) return;
    const newId = plan.scenes.length + 1;
    const lastScene = plan.scenes[plan.scenes.length - 1];
    const newScene: Scene = {
      id: newId,
      title: `Scène ${newId}`,
      duration: 8,
      setting: lastScene?.setting || "Même décor",
      charactersInvolved: lastScene?.charactersInvolved || [],
      voiceOver: "Narration suite de l'action...",
      visualPrompt: `Ultra-realistic cinematic video, 8 seconds. ${lastScene?.setting || "Same environment"}. Continuing the scene naturally, seamless motion raccord, natural acting, shallow depth of field, 4K ultra detail.`,
      cameraStyle: "Dynamic tracking shot, 4K",
      emotion: "Intense suspense",
    };
    setPlan({ ...plan, scenes: [...plan.scenes, newScene] });
  };

  const handleDeleteScene = (index: number) => {
    if (!plan || plan.scenes.length <= 1) return;
    const newScenes = plan.scenes.filter((_, i) => i !== index).map((s, i) => ({ ...s, id: i + 1 }));
    setPlan({ ...plan, scenes: newScenes });
  };

  const totalSeconds = (plan?.scenes?.length || 0) * 8;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSecs = totalSeconds % 60;
  const runtimeFormatted = `${minutes}m${remainingSecs < 10 ? "0" : ""}${remainingSecs}`;

  const masterExport = async () => {
    if (!plan) return;
    setIsExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.createElement("div");
      element.innerHTML = `
        <div style="padding: 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff; color: #111;">
          <h1 style="font-size: 28px; margin-bottom: 6px; color: #000;">${plan.title}</h1>
          <p style="font-size: 13px; color: #6366f1; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">
            ${plan.genre} • Tonalité : ${plan.tone} • Format ${globalRatio} (8s / scène)
          </p>
          <div style="margin: 20px 0; padding: 15px; background: #f8fafc; border-left: 4px solid #6366f1; border-radius: 4px;">
            <p style="margin: 0 0 5px 0; font-size: 14px;"><strong>Logline :</strong> ${plan.logline}</p>
            <p style="margin: 0; font-size: 13px; color: #475569;"><strong>Synopsis :</strong> ${plan.synopsis}</p>
          </div>

          <h2 style="font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-top: 30px;">
            1. CASTING & MODÈLES PERSONNAGES (RÉFÉRENCES FLOW)
          </h2>
          ${plan.characters.map((c, i) => `
            <div style="margin-top: 15px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px;">
              <p style="margin: 0; font-size: 15px; font-weight: bold;">${i + 1}. ${c.name} (${c.age} ans) — ${c.role}</p>
              <p style="margin: 4px 0; font-size: 12px; color: #64748b;">
                ${c.appearance.height} • ${c.appearance.skinTone} • ${c.appearance.build} • ${c.appearance.outfit}
              </p>
              <p style="margin: 6px 0 0 0; font-size: 11px; color: #334155; font-style: italic; background: #f1f5f9; padding: 6px; border-radius: 4px;">
                Prompt Portrait : ${c.visualPrompt}
              </p>
            </div>
          `).join("")}

          <h2 style="font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-top: 35px;">
            2. SCÉNARIO & DÉCOUPAGE TECHNIQUE (8s PAR SCÈNE)
          </h2>
          ${plan.scenes.map(s => `
            <div style="margin-top: 25px; padding-top: 15px; border-top: 1px dashed #cbd5e1;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 14px; color: #0f172a;">SCÈNE ${s.id} : ${s.title} (08 SECONDES)</strong>
                <span style="font-size: 12px; color: #64748b;">${s.setting}</span>
              </div>
              <p style="font-size: 14px; font-weight: 500; color: #1e293b; margin: 8px 0; padding: 10px; background: #f8fafc; border-radius: 6px;">
                « ${s.voiceOver} »
              </p>
              <p style="font-size: 11px; color: #475569; font-family: monospace; background: #f1f5f9; padding: 8px; border-radius: 4px; margin-top: 6px;">
                <strong>Prompt Google Flow :</strong> ${s.visualPrompt}
              </p>
            </div>
          `).join("")}
        </div>
      `;
      const opt = { 
        margin: 10, 
        filename: `${plan.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}-flow-production.pdf`, 
        html2canvas: { scale: 2 }, 
        jsPDF: { unit: 'mm', format: 'a4' } 
      };
      await html2pdf().from(element).set(opt).save();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06070a] text-zinc-100 selection:bg-indigo-500/30 selection:text-white">
      
      {/* Navigation Studio */}
      <header className="h-18 border-b border-white/[0.08] bg-[#06070a]/85 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-3.5 cursor-pointer" onClick={() => setPlan(null)}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 flex items-center justify-center shadow-[0_0_20px_-3px_rgba(99,102,241,0.6)] border border-white/20">
            <Clapperboard className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight uppercase text-sm tracking-wider text-white">NeuroStudio</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 uppercase tracking-widest">
                Flow Engine
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 font-medium tracking-tight">Studio Tous Genres • Scènes de 8s</span>
          </div>
        </div>

        <div className="flex items-center gap-4 md:gap-6">
          {/* Switch Ratio */}
          <div className="flex bg-white/[0.04] rounded-xl p-1 border border-white/[0.08]">
             <button 
              onClick={() => setGlobalRatio("16:9")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-[11px] font-semibold tracking-wide", 
                globalRatio === "16:9" 
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" 
                  : "text-zinc-400 hover:text-white"
              )}
             >
               <Monitor className="w-3.5 h-3.5" /> 16:9 Cinéma
             </button>
             <button 
              onClick={() => setGlobalRatio("9:16")}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-[11px] font-semibold tracking-wide", 
                globalRatio === "9:16" 
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" 
                  : "text-zinc-400 hover:text-white"
              )}
             >
               <Smartphone className="w-3.5 h-3.5" /> 9:16 TikTok
             </button>
          </div>

          <a 
            href="https://flow.google.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all hover:scale-[1.02]"
          >
            <span>Google Flow</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-semibold text-zinc-300 hover:text-white transition-all hover:scale-[1.02]"
            title="Paramètres & Clés API (BYOK)"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Clés API</span>
            {activeKeysCount > 0 ? (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                {activeKeysCount}
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500 hidden md:inline">BYOK</span>
            )}
          </button>

          <Link href="/archives" className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors">
            <History className="w-4 h-4" />
            <span className="hidden md:inline text-xs font-medium">Archives</span>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-10 md:py-16">
        
        {/* Écran d'accueil */}
        {!plan && !isGenerating && (
          <div className="space-y-12 max-w-4xl mx-auto">
            <div className="space-y-6 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold tracking-wide">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sci-Fi, Action, Thriller, Comédie, Drame, Épopée : Tous les genres calibrés pour Flow</span>
              </div>
              <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.1] text-white">
                Donnez vie à vos histoires sur <br className="hidden sm:inline" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-300 to-amber-300">
                  Google Flow
                </span>
              </h1>
              <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto font-normal leading-relaxed">
                Créez la bible visuelle de vos personnages <span className="text-zinc-200 font-semibold">(fiches & visages 1 par 1)</span> et votre découpage cinématique de 8 secondes avec des prompts ultra-détaillés prêts pour Gemini Omni Flash.
              </p>
            </div>

            {/* Sélecteur de Genre */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {GENRES.map((g) => {
                const Icon = g.icon;
                const isSelected = selectedGenre === g.name;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGenre(g.name)}
                    className={clsx(
                      "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border",
                      isSelected 
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30" 
                        : "bg-white/[0.03] hover:bg-white/[0.06] text-zinc-400 border-white/[0.08] hover:text-white"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{g.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Input Pitch */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-2">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Moteur Scénario & Prompts :
                </span>
                <div className="flex bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setPreferredEngine("groq")}
                    className={clsx(
                      "px-2.5 py-1 rounded-md text-[10px] font-bold transition-all",
                      preferredEngine === "groq"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-zinc-400 hover:text-white"
                    )}
                  >
                    ⚡ Groq (Gratuit & Rapide)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!userKeys.openaiApiKey?.trim()) {
                        setShowSettingsModal(true);
                      } else {
                        setPreferredEngine("chatgpt");
                      }
                    }}
                    className={clsx(
                      "px-2.5 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1",
                      preferredEngine === "chatgpt" && userKeys.openaiApiKey?.trim()
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-zinc-400 hover:text-white"
                    )}
                  >
                    {userKeys.openaiApiKey?.trim() ? <Check className="w-3 h-3 text-emerald-300" /> : <Key className="w-3 h-3 text-amber-400" />}
                    <span>ChatGPT GPT-4o {userKeys.openaiApiKey?.trim() ? "(Actif)" : "(Clé requise)"}</span>
                  </button>
                </div>
              </div>

              <div className="bg-[#0b0d13] border border-white/[0.12] p-2.5 rounded-2xl shadow-2xl shadow-indigo-950/20 focus-within:border-indigo-500/60 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={`Votre idée de film (${selectedGenre}) : une intrigue, une scène clé, un univers...`}
                  className="flex-1 bg-transparent px-5 py-4 outline-none text-base md:text-lg text-white placeholder:text-zinc-600"
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                />
                <button
                  onClick={() => handleGenerate()}
                  disabled={isGenerating || !topic.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-7 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 hover:scale-[1.01]"
                >
                  <Sparkles className="w-5 h-5" /> 
                  <span>Créer le Film</span>
                </button>
              </div>
            </div>
            </div>

            {/* Suggestions Multi-Genres */}
            <div className="space-y-4">
              <span className="text-xs uppercase font-bold tracking-widest text-zinc-500 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Inspirations multi-genres pour Google Flow
              </span>
              <div className="grid sm:grid-cols-2 gap-3.5">
                {PRESET_TOPICS.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setTopic(preset.desc);
                      setSelectedGenre(preset.genre);
                      handleGenerate(preset.desc, preset.genre);
                    }}
                    className="text-left p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.07] hover:border-indigo-500/40 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 px-2 py-0.5 bg-indigo-500/10 rounded">
                        {preset.genre}
                      </span>
                    </div>
                    <p className="font-semibold text-sm text-zinc-200 group-hover:text-indigo-300 transition-colors mb-1">
                      {preset.title}
                    </p>
                    <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                      {preset.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium text-center">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Chargement */}
        {isGenerating && (
          <div className="h-[55vh] flex flex-col justify-center items-center gap-6 text-center">
             <div className="relative">
                <div className="w-20 h-20 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center animate-pulse">
                  <Clapperboard className="w-10 h-10 text-indigo-400" />
                </div>
                <div className="absolute inset-0 blur-2xl bg-indigo-500/30 animate-pulse" />
             </div>
             <div className="space-y-2">
               <h3 className="text-xl font-bold text-white">Écriture du film ({selectedGenre}) & Casting en cours...</h3>
               <p className="text-zinc-500 text-sm max-w-md mx-auto">
                 NeuroDirector adapte la mise en scène, les caméras et calibre les scènes de 8 secondes pour Google Flow.
               </p>
             </div>
          </div>
        )}

        {/* PROJET GÉNÉRÉ */}
        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              
              {/* Header Projet */}
              <div className="bg-[#0b0d13] border border-white/[0.1] p-6 md:p-8 rounded-2xl shadow-xl space-y-6">
                <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6 border-b border-white/[0.06] pb-6">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-md">
                        {plan.genre}
                      </span>
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 rounded-md">
                        {plan.tone}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-md flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        <span>{runtimeFormatted} ({plan.scenes.length} scènes de 8s • 1m30 max)</span>
                      </span>
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-md">
                        Format {globalRatio}
                      </span>
                    </div>
                    <input 
                      value={plan.title} 
                      onChange={(e) => setPlan({...plan, title: e.target.value})} 
                      className="block w-full bg-transparent text-2xl md:text-4xl font-extrabold text-white outline-none border-b border-transparent focus:border-indigo-500/40 transition-all pt-1" 
                    />
                  </div>

                  {/* Actions Rapides */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <a
                      href="https://flow.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold rounded-xl transition-all text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20"
                    >
                      <span>Ouvrir Google Flow</span>
                      <ArrowRight className="w-4 h-4" />
                    </a>

                    <button 
                      onClick={() => setShowBulkModal(true)} 
                      className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500/20 to-amber-600/20 hover:from-amber-500/30 text-amber-300 rounded-xl border border-amber-500/40 transition-all text-xs font-bold uppercase tracking-wider shadow-sm"
                    >
                      <FileText className="w-4 h-4 text-amber-400" />
                      <span>Bulk Flow Prompts</span>
                    </button>

                    <button 
                      onClick={handleSave} 
                      disabled={isSaving} 
                      className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-xl border border-white/[0.1] transition-all text-xs font-semibold"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (saveSuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />)}
                      <span>{saveSuccess ? "Enregistré" : "Sauvegarder"}</span>
                    </button>

                    <button 
                      onClick={masterExport} 
                      disabled={isExporting} 
                      className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-xl border border-white/[0.1] transition-all text-xs font-semibold"
                    >
                      {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                      <span>PDF Script</span>
                    </button>
                  </div>
                </div>

                {/* Logline & Synopsis */}
                <div className="grid md:grid-cols-2 gap-4 text-sm bg-white/[0.02] p-4 rounded-xl border border-white/[0.05]">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 block mb-1">
                      Accroche Narrative (Logline)
                    </span>
                    <p className="text-zinc-300 leading-relaxed">{plan.logline}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                      Synopsis de l&apos;Intrigue
                    </span>
                    <p className="text-zinc-300 leading-relaxed">{plan.synopsis}</p>
                  </div>
                </div>
              </div>

              {/* Onglets Casting & Scènes */}
              <div className="flex border-b border-white/[0.08] gap-8">
                <button
                  onClick={() => setActiveTab("characters")}
                  className={clsx(
                    "pb-3.5 text-sm font-bold flex items-center gap-2.5 transition-all relative",
                    activeTab === "characters" ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Users className="w-4 h-4" />
                  <span>1. Le Casting & Personnages ({plan.characters?.length || 0})</span>
                  {activeTab === "characters" && (
                    <motion.div layoutId="tabLine" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
                  )}
                </button>

                <button
                  onClick={() => setActiveTab("scenes")}
                  className={clsx(
                    "pb-3.5 text-sm font-bold flex items-center gap-2.5 transition-all relative",
                    activeTab === "scenes" ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Film className="w-4 h-4" />
                  <span>2. Découpage des Scènes 8s ({plan.scenes?.length || 0})</span>
                  {activeTab === "scenes" && (
                    <motion.div layoutId="tabLine" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
                  )}
                </button>

                <button
                  onClick={() => setActiveTab("editor")}
                  className={clsx(
                    "pb-3.5 text-sm font-bold flex items-center gap-2.5 transition-all relative",
                    activeTab === "editor" ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Clapperboard className="w-4 h-4 text-amber-400" />
                  <span>3. Studio de Montage CapCut ({plan.scenes?.filter((s) => Boolean(s.videoUrl)).length || 0}/{plan.scenes?.length || 0})</span>
                  {activeTab === "editor" && (
                    <motion.div layoutId="tabLine" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
                  )}
                </button>
              </div>

              {/* CONTENU ONGLET 1 : LE CASTING */}
              {activeTab === "characters" && (
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <span>
                        <strong>Mode Showrunner Google Flow :</strong> Copiez le prompt 8K de chaque personnage, créez votre image de référence (Midjourney / Flow), puis injectez-la comme <em>Ingredient</em> pour figer l&apos;identité sur l&apos;ensemble de vos scènes.
                      </span>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {plan.characters?.map((character, idx) => (
                      <CharacterCard 
                        key={character.id || idx} 
                        character={character} 
                        index={idx}
                        userKeys={userKeys}
                        onUpdate={(updates) => updateCharacter(idx, updates)}
                        onOpenSettings={() => setShowSettingsModal(true)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* CONTENU ONGLET 2 : DÉCOUPAGE SCÈNES 8s */}
              {activeTab === "scenes" && (
                <div className="space-y-8">
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Film className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <span>
                        Chaque scène est calibrée à <strong>8 secondes</strong> avec des mouvements de caméra et des descriptions physiques répétées adaptées au genre ({plan.genre}).
                      </span>
                    </div>
                    <button
                      onClick={() => setShowBulkModal(true)}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all hover:scale-[1.02] whitespace-nowrap"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Exporter les Prompts (Bulk Flow)</span>
                    </button>
                  </div>

                  <div className="space-y-6">
                    {plan.scenes?.map((scene, idx) => (
                      <SceneRowCard 
                        key={scene.id || idx} 
                        scene={scene} 
                        index={idx} 
                        ratio={globalRatio}
                        characters={plan.characters}
                        userKeys={userKeys}
                        planContext={{ title: plan.title, genre: plan.genre }}
                        preferredEngine={preferredEngine}
                        onUpdate={(updates) => updateScene(idx, updates)}
                        onDelete={plan.scenes.length > 1 ? () => handleDeleteScene(idx) : undefined}
                        onOpenSettings={() => setShowSettingsModal(true)}
                      />
                    ))}

                    <button
                      onClick={handleAddScene}
                      className="w-full py-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-dashed border-white/[0.12] hover:border-indigo-500/50 text-zinc-300 hover:text-white flex items-center justify-center gap-2 text-xs uppercase font-bold tracking-wider transition-all"
                    >
                      <Plus className="w-4 h-4 text-indigo-400" />
                      <span>Ajouter une scène de 8s ({plan.scenes.length + 1}e scène • Extension 1m30)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* CONTENU ONGLET 3 : STUDIO DE MONTAGE & ASSEMBLAGE */}
              {activeTab === "editor" && (
                <MontageStudio
                  plan={plan}
                  format={globalRatio}
                  onFormatChange={setGlobalRatio}
                  onUpdateScene={updateScene}
                />
              )}

            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal Clés API (BYOK) */}
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          userKeys={userKeys}
          onSaveKeys={handleSaveUserKeys}
        />

        {/* Modal Exportation Groupée des Prompts (Bulk Flow) */}
        {plan && (
          <BulkPromptsModal
            isOpen={showBulkModal}
            onClose={() => setShowBulkModal(false)}
            plan={plan}
            format={globalRatio}
          />
        )}

      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Carte Personnage (Casting & Ingrédient Google Flow)
// ---------------------------------------------------------------------------
function CharacterCard({ 
  character, 
  index, 
  userKeys,
  onUpdate,
  onOpenSettings
}: { 
  character: Character; 
  index: number; 
  userKeys?: UserApiKeys;
  onUpdate: (updates: Partial<Character>) => void;
  onOpenSettings?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [isGeneratingEleven, setIsGeneratingEleven] = useState(false);

  const handlePreviewVoice = () => {
    if (isPlayingVoice) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      setIsPlayingVoice(false);
      return;
    }

    setIsPlayingVoice(true);
    const voiceToUse = character.voiceId || "fr-FR-HenriNeural";
    const sampleText = `Bonjour, je suis la voix de ${character.name}. Prêt pour la direction.`;
    const played = speakSingleLine(sampleText, voiceToUse, () => setIsPlayingVoice(false));
    if (!played) {
      generateVoiceAudio(sampleText, voiceToUse)
        .then((res) => {
          if (res.success && res.url) {
            const audio = new Audio(res.url);
            audio.onended = () => setIsPlayingVoice(false);
            audio.play();
          } else {
            setIsPlayingVoice(false);
          }
        })
        .catch(() => setIsPlayingVoice(false));
    }
  };

  const handleElevenLabsVoice = async () => {
    if (!userKeys?.elevenLabsApiKey?.trim()) {
      onOpenSettings?.();
      return;
    }
    setIsGeneratingEleven(true);
    try {
      const sampleText = `Bonjour, je suis la voix officielle de ${character.name} en haute fidélité.`;
      const res = await generateElevenLabsAudioWithKey(sampleText, character.voiceId, userKeys.elevenLabsApiKey);
      if (res.success && res.url) {
        const audio = new Audio(res.url);
        audio.play();
      }
    } catch (e) {
      console.error("Erreur ElevenLabs :", e);
    } finally {
      setIsGeneratingEleven(false);
    }
  };

  const handleGenerateNanoBanana = async () => {
    if (!userKeys?.nanoBananaApiKey?.trim()) {
      onOpenSettings?.();
      return;
    }
    setIsGeneratingImage(true);
    setImageError("");
    try {
      const res = await generateNanoBananaImageWithKey(character.visualPrompt, userKeys.nanoBananaApiKey);
      if (res.success && res.url) {
        onUpdate({ imageUrl: res.url });
      } else {
        setImageError(res.error || "Échec génération image");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur image";
      setImageError(msg);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(character.visualPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const initialLetters = character.name
    ? character.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "ID";

  return (
    <div className="bg-[#0b0d13] border border-white/[0.08] hover:border-indigo-500/40 rounded-2xl p-5 flex flex-col justify-between transition-all group shadow-sm">
      <div className="space-y-4">
        
        {/* Slot Visuel / Badge Ingrédient Casting */}
        <div className="relative aspect-video w-full rounded-xl bg-gradient-to-br from-indigo-950/25 via-[#0c0e14] to-zinc-900 border border-white/[0.08] overflow-hidden flex flex-col items-center justify-center p-4 text-center">
          {character.imageUrl ? (
            <div className="relative w-full h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={character.imageUrl} 
                alt={character.name} 
                className="w-full h-full object-cover rounded-lg"
              />
              <button
                onClick={() => onUpdate({ imageUrl: undefined })}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-red-500/80 text-white backdrop-blur-md transition-all text-xs"
                title="Retirer l'image"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-12 h-12 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-300 font-extrabold text-base tracking-wider shadow-inner">
                {initialLetters}
              </div>
              <div>
                <p className="text-xs font-bold text-white tracking-wide">{character.name}</p>
                <p className="text-[10px] text-zinc-400">{character.role}</p>
              </div>
              <div className="flex items-center gap-3 justify-center">
                <button
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors block"
                >
                  {showUrlInput ? "Fermer" : "+ Lier URL"}
                </button>
                <button
                  onClick={handleGenerateNanoBanana}
                  disabled={isGeneratingImage}
                  className="text-[10px] text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors font-medium flex items-center gap-1"
                >
                  {isGeneratingImage ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                  <span>Générer (Nano Banana)</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {imageError && (
          <p className="text-[10px] text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">{imageError}</p>
        )}

        {showUrlInput && !character.imageUrl && (
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://... (URL image)"
              className="flex-1 bg-black/60 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) {
                    onUpdate({ imageUrl: val });
                    setShowUrlInput(false);
                  }
                }
              }}
            />
          </div>
        )}

        {/* Détails du personnage */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-400 px-2 py-0.5 bg-indigo-500/10 rounded">
              Personnage 0{index + 1}
            </span>
            <span className="text-xs text-zinc-400 font-medium">{character.age} ans</span>
          </div>
          <h3 className="text-base font-bold text-white tracking-tight">{character.name}</h3>
        </div>

        {/* Fiche d'identité stricte */}
        <div className="bg-white/[0.02] p-3 rounded-xl border border-white/[0.05] text-[11px] space-y-1 text-zinc-300">
          <div><strong className="text-zinc-500">Taille :</strong> {character.appearance?.height || "1m75"}</div>
          <div><strong className="text-zinc-500">Teint :</strong> {character.appearance?.skinTone || "Dark black skin"}</div>
          <div><strong className="text-zinc-500">Tenue :</strong> {character.appearance?.outfit}</div>
        </div>

        {/* Sélecteur de Voix Neuronale */}
        <div className="space-y-1.5 bg-white/[0.02] p-3 rounded-xl border border-white/[0.05]">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
              <Mic className="w-3 h-3" />
              <span>Voix du Personnage</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePreviewVoice}
                className="text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
                title="Tester la voix avec Web Speech"
              >
                {isPlayingVoice ? (
                  <>
                    <Square className="w-3 h-3 fill-current text-indigo-400" />
                    <span className="text-indigo-400 font-bold">Stop</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Tester</span>
                  </>
                )}
              </button>
              <button
                onClick={handleElevenLabsVoice}
                disabled={isGeneratingEleven}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                title="Tester avec ElevenLabs"
              >
                {isGeneratingEleven ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                <span>ElevenLabs</span>
              </button>
            </div>
          </div>
          <select
            value={character.voiceId || "fr-FR-HenriNeural"}
            onChange={(e) => onUpdate({ voiceId: e.target.value })}
            className="w-full bg-black/60 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500 cursor-pointer"
          >
            {AVAILABLE_VOICES.map((v) => (
              <option key={v.id} value={v.id} className="bg-[#111] text-white">
                {v.name} ({v.tag})
              </option>
            ))}
          </select>
        </div>

        {/* Prompt visuel en anglais (Ingrédient Flow) */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold text-amber-400 uppercase tracking-widest block flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            <span>Prompt Ingrédient 8K (Google Flow / Midjourney)</span>
          </label>
          <textarea
            value={character.visualPrompt}
            onChange={(e) => onUpdate({ visualPrompt: e.target.value })}
            className="w-full bg-black/50 border border-amber-500/20 focus:border-amber-500/50 rounded-xl p-2.5 text-xs text-zinc-300 font-mono outline-none min-h-[75px] resize-none"
          />
        </div>
      </div>

      {/* Action Pro : Copier le Prompt Ingrédient */}
      <div className="pt-4 flex gap-2">
        <button
          onClick={copyPrompt}
          className={clsx(
            "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md",
            copied 
              ? "bg-emerald-600 text-white shadow-emerald-600/30" 
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 hover:scale-[1.01]"
          )}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? "Prompt Copié !" : "Copier le Prompt"}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Ligne Scène 8s (Google Flow)
// ---------------------------------------------------------------------------
function SceneRowCard({ 
  scene, 
  index, 
  ratio,
  characters,
  userKeys,
  planContext,
  preferredEngine,
  onUpdate,
  onDelete,
  onOpenSettings
}: { 
  scene: Scene; 
  index: number; 
  ratio: AspectRatio; 
  characters: Character[];
  userKeys: UserApiKeys;
  planContext: { title: string; genre: string };
  preferredEngine?: "groq" | "chatgpt";
  onUpdate: (updates: Partial<Scene>) => void;
  onDelete?: () => void;
  onOpenSettings?: () => void;
}) {
  const [copiedFlow, setCopiedFlow] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [showRefine, setShowRefine] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState("");
  const [isGeneratingGrok, setIsGeneratingGrok] = useState(false);
  const [grokError, setGrokError] = useState("");
  const stopSpeechRef = useRef<(() => void) | null>(null);

  const copyFlowPrompt = () => {
    navigator.clipboard.writeText(scene.visualPrompt);
    setCopiedFlow(true);
    setTimeout(() => setCopiedFlow(false), 2000);
  };

  const handleRefine = async () => {
    if (!refineInstruction.trim()) return;
    setIsRefining(true);
    setRefineError("");
    try {
      const activeKey = preferredEngine === "chatgpt" ? userKeys.openaiApiKey : undefined;
      const res = await refineScene(
        scene, 
        refineInstruction.trim(), 
        planContext, 
        activeKey
      );
      if (res.success && res.scene) {
        onUpdate(res.scene);
        setRefineInstruction("");
        setShowRefine(false);
      } else {
        setRefineError(res.error || "Erreur lors de la réécriture.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setRefineError(msg);
    } finally {
      setIsRefining(false);
    }
  };

  const handleGenerateGrokVideo = async () => {
    if (!userKeys.grokApiKey?.trim()) {
      onOpenSettings?.();
      return;
    }
    setIsGeneratingGrok(true);
    setGrokError("");
    try {
      const res = await generateGrokVideoWithKey(scene.visualPrompt, userKeys.grokApiKey, ratio);
      if (res.success && res.url) {
        onUpdate({ videoUrl: res.url });
      } else {
        setGrokError(res.error || "Échec génération xAI Grok Video");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur Grok";
      setGrokError(msg);
    } finally {
      setIsGeneratingGrok(false);
    }
  };

  const togglePlayDialogues = () => {
    if (isPlaying) {
      stopSpeechRef.current?.();
      setIsPlaying(false);
      setActiveLineIndex(null);
      return;
    }

    if (scene.dialogues && scene.dialogues.length > 0) {
      setIsPlaying(true);
      stopSpeechRef.current = playSceneDialogues(
        scene.dialogues,
        characters,
        (lineIdx) => setActiveLineIndex(lineIdx),
        () => {
          setIsPlaying(false);
          setActiveLineIndex(null);
        }
      );
    } else if (scene.voiceOver) {
      setIsPlaying(true);
      const ok = speakSingleLine(scene.voiceOver, "fr-FR-HenriNeural", () => setIsPlaying(false));
      if (!ok) setIsPlaying(false);
    }
  };

  return (
    <div className="bg-[#0b0d13] border border-white/[0.08] hover:border-white/[0.15] rounded-2xl p-6 transition-all space-y-6">
      
      {/* En-tête de scène */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-extrabold flex items-center justify-center text-sm">
            0{index + 1}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-white">{scene.title || `Scène ${index + 1}`}</h4>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 uppercase tracking-widest">
                08s Flow
              </span>
              {scene.videoUrl && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Vidéo Prête
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">{scene.setting}</p>
          </div>
        </div>

        {/* Boutons d'action */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bouton Affiner avec l'IA */}
          <button
            onClick={() => setShowRefine(!showRefine)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all border",
              showRefine
                ? "bg-indigo-600 text-white border-indigo-500"
                : "bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border-white/[0.08]"
            )}
            title="Modifier cette scène avec un prompt réalisateur"
          >
            <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Affiner avec l&apos;IA</span>
          </button>

          {/* Bouton Générer Vidéo avec Grok */}
          <button
            onClick={handleGenerateGrokVideo}
            disabled={isGeneratingGrok}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 hover:text-white border border-violet-500/30 transition-all hover:scale-[1.02]"
            title={userKeys.grokApiKey ? "Générer la vidéo 8s directement avec Grok" : "Configurer la clé xAI Grok"}
          >
            {isGeneratingGrok ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            )}
            <span>{isGeneratingGrok ? "Grok 8s en cours..." : "Générer Vidéo (Grok)"}</span>
          </button>

          {/* Bouton Copier le Prompt Flow */}
          <button
            onClick={copyFlowPrompt}
            className={clsx(
              "flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg",
              copiedFlow 
                ? "bg-emerald-600 text-white shadow-emerald-600/30" 
                : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/25 hover:scale-[1.02]"
            )}
          >
            {copiedFlow ? <Check className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-amber-300" />}
            <span>{copiedFlow ? "Copié !" : "Copier Prompt Flow"}</span>
          </button>

          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-zinc-500 hover:text-red-400 border border-white/[0.06] transition-colors"
              title="Supprimer cette scène"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Zone Interactive d'Affinage par Prompt IA */}
      {showRefine && (
        <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Consigne Réalisateur ({preferredEngine === "chatgpt" && userKeys.openaiApiKey ? "ChatGPT GPT-4o" : "Groq"}) :</span>
            </span>
            <button 
              onClick={() => setShowRefine(false)}
              className="text-[11px] text-zinc-500 hover:text-white"
            >
              Fermer
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={refineInstruction}
              onChange={(e) => setRefineInstruction(e.target.value)}
              placeholder="Ex: Ajoute de la pluie battante nocturne, fais monter la colère de Malik et termine par un gros plan caméra..."
              className="flex-1 bg-black/60 border border-white/[0.12] rounded-xl px-4 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && handleRefine()}
            />
            <button
              onClick={handleRefine}
              disabled={isRefining || !refineInstruction.trim()}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/30"
            >
              {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
              <span>{isRefining ? "Réécriture..." : "Appliquer la Retouche"}</span>
            </button>
          </div>
          {refineError && (
            <p className="text-xs text-red-400 bg-red-500/10 p-2.5 rounded-xl border border-red-500/20">
              {refineError}
            </p>
          )}
        </div>
      )}

      {/* Alerte Erreur Grok */}
      {grokError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <span>{grokError}</span>
          <button onClick={() => setGrokError("")} className="text-zinc-500 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Aperçu Vidéo Grok si déjà générée */}
      {scene.videoUrl && (
        <div className="relative rounded-2xl overflow-hidden border border-emerald-500/30 bg-black aspect-video max-w-md shadow-lg">
          <video src={scene.videoUrl} controls className="w-full h-full object-cover" />
          <div className="absolute top-2 left-2 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
            Vidéo Grok 8s prête pour Montage
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        
        {/* Narration & Dialogues */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-indigo-400" />
                <span>Dialogues & Répliques (8s)</span>
              </label>
              <button
                onClick={togglePlayDialogues}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border shadow-sm",
                  isPlaying
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse"
                    : "bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white border-indigo-500/30"
                )}
                title="Écouter le dialogue avec Web Speech"
              >
                {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isPlaying ? "Arrêter la lecture" : "Écouter la Scène (Multi-Voix)"}</span>
              </button>
            </div>

            {/* Affichage des répliques détaillées par personnage avec surlignage dynamique */}
            {scene.dialogues && scene.dialogues.length > 0 ? (
              <div className="space-y-2 bg-black/40 border border-white/[0.08] rounded-xl p-3.5">
                {scene.dialogues.map((dlg, dIdx) => (
                  <div 
                    key={dIdx} 
                    className={clsx(
                      "text-xs space-y-0.5 border-b border-white/[0.04] last:border-b-0 pb-2 last:pb-0 rounded-lg p-1.5 transition-colors",
                      activeLineIndex === dIdx ? "bg-indigo-500/10 border border-indigo-500/30" : ""
                    )}
                  >
                    <span className="font-bold text-indigo-400 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                      {activeLineIndex === dIdx && <Volume2 className="w-3 h-3 text-indigo-400 animate-pulse" />}
                      <span>{dlg.speaker} :</span>
                    </span>
                    <p className="text-zinc-200 italic font-medium leading-relaxed">« {dlg.text} »</p>
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                value={scene.voiceOver}
                onChange={(e) => onUpdate({ voiceOver: e.target.value })}
                className="w-full bg-black/40 border border-white/[0.08] rounded-xl p-3.5 text-sm text-zinc-200 outline-none focus:border-indigo-500/50 min-h-[90px] leading-relaxed"
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] text-zinc-400">
            <span className="px-2.5 py-1 rounded bg-white/[0.03] border border-white/[0.06]">
              🎥 <strong>Caméra :</strong> {scene.cameraStyle}
            </span>
            <span className="px-2.5 py-1 rounded bg-white/[0.03] border border-white/[0.06]">
              🎭 <strong>Émotion :</strong> {scene.emotion}
            </span>
          </div>
        </div>

        {/* Prompt Vidéo Flow */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Prompt Vidéo Google Flow (Anglais)</span>
              </label>
              <button
                onClick={copyFlowPrompt}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 font-medium transition-colors"
                title="Copier ce prompt"
              >
                {copiedFlow ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedFlow ? "Copié !" : "Copier"}</span>
              </button>
            </div>
            <textarea
              value={scene.visualPrompt}
              onChange={(e) => onUpdate({ visualPrompt: e.target.value })}
              className="w-full bg-black/60 border border-amber-500/20 focus:border-amber-500/50 rounded-xl p-3.5 text-xs font-mono text-zinc-300 outline-none min-h-[120px] leading-relaxed"
            />
          </div>

          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-[11px] text-zinc-400">
            <p>
              💡 <strong>Conseil Réalisation :</strong> Collez ce prompt dans Google Flow avec les images de vos personnages en <em>Ingredients</em> pour garantir la continuité des visages et des costumes.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Studio de Montage & Assemblage Vidéo (Neuro-Assembler CapCut)
// ---------------------------------------------------------------------------
function MontageStudio({
  plan,
  format,
  onFormatChange,
  onUpdateScene
}: {
  plan: ContentPlan;
  format: AspectRatio;
  onFormatChange: (fmt: AspectRatio) => void;
  onUpdateScene: (index: number, updates: Partial<Scene>) => void;
}) {
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [isPlayingSequence, setIsPlayingSequence] = useState(false);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState("");
  const [exportSuccessUrl, setExportSuccessUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const scenes = plan.scenes || [];
  const currentScene = scenes[activeSceneIndex] || scenes[0];
  const uploadedClipsCount = scenes.filter((s) => Boolean(s.videoUrl)).length;

  // Enchaînement automatique des scènes en prévisualisation
  const handleVideoEnded = () => {
    if (!isPlayingSequence) return;
    if (activeSceneIndex < scenes.length - 1) {
      setActiveSceneIndex((prev) => prev + 1);
    } else {
      setIsPlayingSequence(false);
      setActiveSceneIndex(0);
    }
  };

  useEffect(() => {
    if (isPlayingSequence && videoRef.current && currentScene?.videoUrl) {
      videoRef.current.play().catch(() => {});
    }
  }, [activeSceneIndex, isPlayingSequence, currentScene]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlayingSequence) {
      videoRef.current.pause();
      setIsPlayingSequence(false);
    } else {
      setIsPlayingSequence(true);
      videoRef.current.play().catch(() => {});
    }
  };

  const handleFileUpload = (index: number, file: File) => {
    const url = URL.createObjectURL(file);
    onUpdateScene(index, { videoUrl: url });
    setActiveSceneIndex(index);
  };

  const handleExport = async () => {
    if (uploadedClipsCount === 0) {
      setExportError("Veuillez importer au moins un clip vidéo pour lancer l'assemblage.");
      return;
    }

    setIsExporting(true);
    setExportError("");
    setExportProgress(0);
    setExportSuccessUrl(null);

    try {
      const blob = await renderMontageSequence({
        scenes,
        format,
        burnSubtitles,
        onProgress: (pct) => setExportProgress(Math.round(pct)),
      });

      const downloadUrl = URL.createObjectURL(blob);
      setExportSuccessUrl(downloadUrl);

      // Téléchargement automatique local direct
      const a = document.createElement("a");
      a.href = downloadUrl;
      const cleanTitle = (plan.title || "film").toLowerCase().replace(/[^a-z0-9]/g, "-");
      a.download = `${cleanTitle}-${format.replace(":", "-")}-montage.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur lors du rendu du montage";
      setExportError(msg);
    } finally {
      setIsExporting(false);
    }
  };

  const currentDialogue = currentScene?.dialogues?.[0];
  const subtitleText = currentDialogue?.text || currentScene?.voiceOver;

  return (
    <div className="space-y-8">
      {/* Bannière de présentation */}
      <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Clapperboard className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span>
            <strong>Neuro-Assembler CapCut :</strong> Glissez les clips générés sur Google Flow en face de chaque scène. L&apos;outil synchronise automatiquement les sous-titres et assemble la vidéo finale directement sur votre machine.
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] font-bold text-zinc-400">Format :</span>
          <div className="flex bg-black/50 p-0.5 rounded-lg border border-white/[0.08]">
            <button
              onClick={() => onFormatChange("9:16")}
              className={clsx(
                "px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1",
                format === "9:16" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              <Smartphone className="w-3 h-3" />
              <span>9:16 Shorts/TikTok</span>
            </button>
            <button
              onClick={() => onFormatChange("16:9")}
              className={clsx(
                "px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1",
                format === "16:9" ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
              )}
            >
              <Monitor className="w-3 h-3" />
              <span>16:9 Cinéma</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        
        {/* COLONNE GAUCHE (7 cols) : LE MONITEUR VIDÉO & CONTROLES */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-[#0b0d13] border border-white/[0.08] rounded-2xl p-5 space-y-4 shadow-xl">
            
            {/* Header du moniteur */}
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Moniteur de Montage ({format})
                </span>
              </div>
              <div className="text-[11px] text-zinc-400 font-mono">
                Scène {activeSceneIndex + 1} / {scenes.length} • {uploadedClipsCount} clip(s) prêt(s)
              </div>
            </div>

            {/* Écran Vidéo Responsive (Container avec Ratio sélectionné) */}
            <div className={clsx(
              "relative mx-auto rounded-xl bg-black border border-white/[0.1] overflow-hidden flex items-center justify-center shadow-2xl",
              format === "9:16" ? "w-[280px] sm:w-[320px] aspect-[9/16]" : "w-full aspect-video"
            )}>
              {currentScene?.videoUrl ? (
                <video
                  ref={videoRef}
                  src={currentScene.videoUrl}
                  className="w-full h-full object-cover"
                  playsInline
                  onEnded={handleVideoEnded}
                />
              ) : (
                <div className="p-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto text-zinc-500">
                    <Film className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-300">Scène 0{activeSceneIndex + 1} en attente</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Glissez le clip MP4 Google Flow ci-contre</p>
                  </div>
                </div>
              )}

              {/* Overlay Sous-titres Dynamiques CapCut */}
              {burnSubtitles && subtitleText && (
                <div className="absolute bottom-8 left-4 right-4 text-center pointer-events-none transition-all">
                  {currentDialogue?.speaker && (
                    <span className="inline-block px-2.5 py-0.5 mb-1.5 rounded bg-indigo-600/90 text-white font-extrabold text-[10px] uppercase tracking-wider shadow-md">
                      {currentDialogue.speaker}
                    </span>
                  )}
                  <div className="bg-black/75 px-3.5 py-1.5 rounded-xl border border-white/10 shadow-lg max-w-[90%] mx-auto backdrop-blur-sm">
                    <p className="text-amber-300 font-black text-xs sm:text-sm tracking-wide leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                      « {subtitleText.replace(/["«»]/g, "")} »
                    </p>
                  </div>
                </div>
              )}

              {/* Badge format en haut à gauche */}
              <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-zinc-300">
                08s • {currentScene?.cameraStyle || "Cinématique"}
              </div>
            </div>

            {/* Barre de contrôle du lecteur */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePlay}
                    disabled={!currentScene?.videoUrl}
                    className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white transition-all shadow-md shadow-indigo-600/20"
                    title={isPlayingSequence ? "Pause" : "Lire la séquence"}
                  >
                    {isPlayingSequence ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveSceneIndex((prev) => Math.max(0, prev - 1))}
                      disabled={activeSceneIndex === 0}
                      className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-zinc-300 transition-colors text-xs font-bold"
                      title="Scène précédente"
                    >
                      ◀
                    </button>
                    <button
                      onClick={() => setActiveSceneIndex((prev) => Math.min(scenes.length - 1, prev + 1))}
                      disabled={activeSceneIndex === scenes.length - 1}
                      className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-zinc-300 transition-colors text-xs font-bold"
                      title="Scène suivante"
                    >
                      ▶
                    </button>
                  </div>
                </div>

                {/* Switch sous-titres */}
                <button
                  onClick={() => setBurnSubtitles(!burnSubtitles)}
                  className={clsx(
                    "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border",
                    burnSubtitles 
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-300" 
                      : "bg-white/[0.03] border-white/[0.08] text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Sous-titres CapCut {burnSubtitles ? "Activés" : "Désactivés"}</span>
                </button>
              </div>

              {/* Bouton d'exportation pro en bas du lecteur */}
              <div className="pt-2">
                <button
                  onClick={handleExport}
                  disabled={isExporting || uploadedClipsCount === 0}
                  className={clsx(
                    "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-xl",
                    uploadedClipsCount === 0 
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/[0.05]" 
                      : isExporting
                      ? "bg-indigo-700 text-white cursor-wait"
                      : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25 hover:scale-[1.01]"
                  )}
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Rendu du Montage en cours ({exportProgress}%) ...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Générer et Exporter le Film Final MP4 ({uploadedClipsCount}/{scenes.length} clips)</span>
                    </>
                  )}
                </button>

                {exportError && (
                  <p className="text-xs text-red-400 mt-2 text-center bg-red-500/10 border border-red-500/20 p-2 rounded-lg">
                    {exportError}
                  </p>
                )}

                {exportSuccessUrl && !isExporting && (
                  <p className="text-xs text-emerald-400 mt-2 text-center bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-lg flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Montage final prêt et téléchargé sur votre machine !</span>
                  </p>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* COLONNE DROITE (5 cols) : LA TIMELINE SÉQUENTIELLE PAR SCÈNE */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Film className="w-4 h-4 text-indigo-400" />
              <span>Timeline des Scènes ({scenes.length} x 8s)</span>
            </h3>
            <span className="text-[11px] text-zinc-400">
              Total : ~{Math.round(scenes.length * 8)} secondes
            </span>
          </div>

          <div className="space-y-3 max-h-[650px] overflow-y-auto pr-1">
            {scenes.map((scene, idx) => {
              const isSelected = activeSceneIndex === idx;
              const hasVideo = Boolean(scene.videoUrl);

              return (
                <div
                  key={scene.id || idx}
                  onClick={() => setActiveSceneIndex(idx)}
                  className={clsx(
                    "p-4 rounded-xl border transition-all cursor-pointer space-y-3",
                    isSelected
                      ? "bg-indigo-950/20 border-indigo-500 shadow-md shadow-indigo-500/10"
                      : "bg-[#0b0d13] border-white/[0.08] hover:border-white/[0.15]"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={clsx(
                        "w-6 h-6 rounded-lg text-[10px] font-black flex items-center justify-center",
                        isSelected ? "bg-indigo-600 text-white" : "bg-white/[0.05] text-zinc-400"
                      )}>
                        0{idx + 1}
                      </span>
                      <h4 className="text-xs font-bold text-white tracking-tight">
                        {scene.title || `Scène ${idx + 1}`}
                      </h4>
                    </div>

                    <span className={clsx(
                      "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                      hasVideo
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                    )}>
                      {hasVideo ? "Clip Chargé" : "En attente MP4"}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 line-clamp-1 italic">
                    « {scene.dialogues?.[0]?.text || scene.voiceOver} »
                  </p>

                  {/* Actions Clip : Upload / Retirer / Rogner */}
                  <div className="pt-1 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                    <label className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all border",
                      hasVideo 
                        ? "bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 border-white/[0.08]"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500 shadow-sm"
                    )}>
                      <Upload className="w-3.5 h-3.5" />
                      <span>{hasVideo ? "Remplacer le clip" : "Glisser / Importer MP4"}</span>
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(idx, file);
                        }}
                      />
                    </label>

                    {hasVideo && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            const cur = scene.trimStart || 0;
                            onUpdateScene(idx, { trimStart: Math.max(0, cur + 0.5) });
                          }}
                          className="px-2 py-1 rounded bg-white/[0.03] hover:bg-white/[0.08] text-[10px] text-zinc-300 border border-white/[0.06]"
                          title="Rogner 0.5s au début"
                        >
                          <Scissors className="w-3 h-3 inline mr-1" />
                          Trim +0.5s
                        </button>
                        <button
                          onClick={() => onUpdateScene(idx, { videoUrl: undefined })}
                          className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
                          title="Supprimer ce clip"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
