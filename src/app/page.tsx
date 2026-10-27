"use client";

import { useState, useEffect } from "react";
import { 
  Loader2, 
  Play, 
  Sparkles, 
  Clapperboard, 
  Save,
  CheckCircle2,
  FileDown,
  History,
  Copy,
  Check,
  Download,
  Smartphone,
  Monitor,
  Users,
  Film,
  ExternalLink,
  ArrowRight,
  Camera,
  Zap,
  Rocket,
  Search,
  Smile,
  Shield,
  Layers,
  Clock,
  Plus,
  Trash2,
  Mic
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import clsx from "clsx";
import { 
  generateContent, 
  saveProject, 
  getElevenLabsAudio, 
  getQuota, 
  generateCharacterImage, 
  generateImage,
  generateSceneAudio,
  generateVoiceAudio
} from "./actions";
import { 
  AVAILABLE_VOICES,
  type ContentPlan, 
  type Character, 
  type Scene,
  type VoiceOption
} from "@/lib/types";

export const dynamic = "force-dynamic";

type AspectRatio = "16:9" | "9:16";
type ActiveTab = "characters" | "scenes" | "overview";

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
  const [quota, setQuota] = useState<{remaining: number, total: number} | null>(null);
  const [globalRatio, setGlobalRatio] = useState<AspectRatio>("16:9");
  const [activeTab, setActiveTab] = useState<ActiveTab>("characters");

  useEffect(() => {
    getQuota().then(setQuota);
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
  }, []);

  const handleGenerate = async (customTopic?: string, customGenre?: string) => {
    const promptToUse = (customTopic || topic).trim();
    if (!promptToUse) return;
    const genreToUse = customGenre || selectedGenre;
    setIsGenerating(true);
    setError("");
    setPlan(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: promptToUse,
          genre: genreToUse,
          format: globalRatio,
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
        const fallbackResult = await generateContent(promptToUse, genreToUse, globalRatio);
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
                      Synopsis de l'Intrigue
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
              </div>

              {/* CONTENU ONGLET 1 : LE CASTING */}
              {activeTab === "characters" && (
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                      <span>
                        <strong>Règle d'or Flow :</strong> Générez l'image de chaque personnage une par une. Téléchargez-la et injectez-la comme <em>Ingredient</em> dans Google Flow pour figer son apparence sur toutes vos scènes.
                      </span>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {plan.characters?.map((character, idx) => (
                      <CharacterCard 
                        key={character.id || idx} 
                        character={character} 
                        index={idx}
                        onUpdate={(updates) => updateCharacter(idx, updates)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* CONTENU ONGLET 2 : DÉCOUPAGE SCÈNES 8s */}
              {activeTab === "scenes" && (
                <div className="space-y-8">
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Film className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <span>
                        Chaque scène est calibrée à <strong>8 secondes</strong> avec des mouvements de caméra et des descriptions physiques répétées adaptées au genre ({plan.genre}).
                      </span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {plan.scenes?.map((scene, idx) => (
                      <SceneRowCard 
                        key={scene.id || idx} 
                        scene={scene} 
                        index={idx} 
                        ratio={globalRatio}
                        characters={plan.characters}
                        onUpdate={(updates) => updateScene(idx, updates)}
                        onDelete={plan.scenes.length > 1 ? () => handleDeleteScene(idx) : undefined}
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

            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant Carte Personnage (Génération 1 par 1)
// ---------------------------------------------------------------------------
function CharacterCard({ 
  character, 
  index, 
  onUpdate 
}: { 
  character: Character; 
  index: number; 
  onUpdate: (updates: Partial<Character>) => void;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);

  const handleGeneratePortrait = async () => {
    setIsGenerating(true);
    try {
      const result = await generateCharacterImage(character.visualPrompt);
      if (result.success && result.url) {
        onUpdate({ imageUrl: result.url });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePreviewVoice = async () => {
    setIsPlayingVoice(true);
    try {
      const voiceToUse = character.voiceId || "fr-FR-HenriNeural";
      const sampleText = `Bonjour, je suis la voix de ${character.name}.`;
      const result = await generateVoiceAudio(sampleText, voiceToUse);
      if (result.success && result.url) {
        const audio = new Audio(result.url);
        audio.onended = () => setIsPlayingVoice(false);
        audio.play();
      } else {
        setIsPlayingVoice(false);
      }
    } catch {
      setIsPlayingVoice(false);
    }
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(character.visualPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadImage = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${character.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-ref.webp`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      alert("Erreur de téléchargement");
    }
  };

  return (
    <div className="bg-[#0b0d13] border border-white/[0.08] hover:border-indigo-500/40 rounded-2xl p-5 flex flex-col justify-between transition-all group">
      <div className="space-y-4">
        
        {/* Slot Photo / Image de référence */}
        <div className="relative aspect-square w-full rounded-xl bg-white/[0.02] border border-white/[0.06] overflow-hidden flex items-center justify-center">
          {character.imageUrl ? (
            <img 
              src={character.imageUrl} 
              alt={character.name} 
              className="w-full h-full object-cover rounded-xl group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="text-center p-6 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto text-zinc-500">
                <Users className="w-6 h-6" />
              </div>
              <p className="text-xs text-zinc-500">Aucune image de référence</p>
            </div>
          )}

          {character.imageUrl && (
            <button
              onClick={() => downloadImage(character.imageUrl!)}
              className="absolute top-3 right-3 p-2 rounded-lg bg-black/70 hover:bg-black text-white backdrop-blur-md border border-white/20 transition-all shadow-lg"
              title="Télécharger l'image de référence"
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          {isGenerating && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-indigo-400">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">Génération Portrait...</span>
            </div>
          )}
        </div>

        {/* Détails du personnage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-400 px-2 py-0.5 bg-indigo-500/10 rounded">
              Personnage 0{index + 1}
            </span>
            <span className="text-xs text-zinc-400 font-medium">{character.age} ans</span>
          </div>
          <h3 className="text-lg font-bold text-white tracking-tight">{character.name}</h3>
          <p className="text-xs text-zinc-400">{character.role}</p>
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
            <button
              onClick={handlePreviewVoice}
              disabled={isPlayingVoice}
              className="text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
              title="Écouter un échantillon de cette voix"
            >
              {isPlayingVoice ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
              <span>{isPlayingVoice ? "Écoute..." : "Tester la voix"}</span>
            </button>
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

        {/* Prompt visuel en anglais */}
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block">
            Prompt Portrait Réf (Google Flow)
          </label>
          <textarea
            value={character.visualPrompt}
            onChange={(e) => onUpdate({ visualPrompt: e.target.value })}
            className="w-full bg-black/50 border border-white/[0.08] rounded-xl p-2.5 text-xs text-zinc-300 font-mono outline-none focus:border-indigo-500/50 min-h-[70px] resize-none"
          />
        </div>
      </div>

      {/* Actions 1 par 1 */}
      <div className="pt-4 flex gap-2">
        <button
          onClick={handleGeneratePortrait}
          disabled={isGenerating}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md shadow-indigo-600/20"
        >
          {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          <span>{character.imageUrl ? "Régénérer" : "Générer Portrait"}</span>
        </button>

        <button
          onClick={copyPrompt}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs font-semibold border border-white/[0.1] transition-all"
          title="Copier le prompt du portrait"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? "Copié !" : "Copier"}</span>
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
  onUpdate,
  onDelete
}: { 
  scene: Scene; 
  index: number; 
  ratio: AspectRatio; 
  characters: Character[];
  onUpdate: (updates: Partial<Scene>) => void;
  onDelete?: () => void;
}) {
  const [copiedFlow, setCopiedFlow] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const copyFlowPrompt = () => {
    navigator.clipboard.writeText(scene.visualPrompt);
    setCopiedFlow(true);
    setTimeout(() => setCopiedFlow(false), 2000);
  };

  const playVoice = async () => {
    if (isPlaying) return;
    setLoadingAudio(true);
    try {
      const result = await generateSceneAudio(scene, characters);
      if (result.success && result.url) {
        setAudioUrl(result.url);
        onUpdate({ audioUrl: result.url });
        const audio = new Audio(result.url);
        audio.onended = () => setIsPlaying(false);
        setIsPlaying(true);
        audio.play();
      }
    } finally { 
      setLoadingAudio(false); 
    }
  };

  const handleGenerateSceneFrame = async () => {
    setIsGeneratingImage(true);
    try {
      const result = await generateImage(scene.visualPrompt, ratio);
      if (result.success && result.url) {
        onUpdate({ imageUrl: result.url });
      }
    } finally {
      setIsGeneratingImage(false);
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
            </div>
            <p className="text-xs text-zinc-500">{scene.setting}</p>
          </div>
        </div>

        {/* Boutons d'action */}
        <div className="flex items-center gap-2">
          <button
            onClick={copyFlowPrompt}
            className={clsx(
              "flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg",
              copiedFlow 
                ? "bg-emerald-600 text-white shadow-emerald-600/30" 
                : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/25 hover:scale-[1.02]"
            )}
          >
            {copiedFlow ? <Check className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-amber-300" />}
            <span>{copiedFlow ? "Copié pour Google Flow !" : "Copier le Prompt Flow"}</span>
          </button>

          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-zinc-500 hover:text-red-400 border border-white/[0.06] transition-colors"
              title="Supprimer cette scène"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        
        {/* Narration & Dialogues */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-indigo-400" />
                <span>Dialogues & Répliques (8s)</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={playVoice}
                  disabled={loadingAudio}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-xs text-indigo-300 hover:text-white font-medium transition-colors border border-indigo-500/30 shadow-sm"
                >
                  {loadingAudio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{isPlaying ? "Lecture en cours..." : "Générer les Voix (Multi-Acteurs)"}</span>
                </button>
                {audioUrl && (
                  <a
                    href={audioUrl}
                    download={`scene-${index + 1}-dialogues.mp3`}
                    className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white border border-white/[0.08]"
                    title="Télécharger l'audio complet de la scène"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Affichage des répliques détaillées par personnage si disponibles */}
            {scene.dialogues && scene.dialogues.length > 0 ? (
              <div className="space-y-2 bg-black/40 border border-white/[0.08] rounded-xl p-3.5">
                {scene.dialogues.map((dlg, dIdx) => (
                  <div key={dIdx} className="text-xs space-y-0.5 border-b border-white/[0.04] last:border-b-0 pb-2 last:pb-0">
                    <span className="font-bold text-indigo-400 uppercase tracking-wider text-[10px]">
                      {dlg.speaker} :
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

        {/* Prompt Vidéo Flow & First Frame */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Prompt Vidéo Google Flow (Anglais)</span>
              </label>
              <button
                onClick={handleGenerateSceneFrame}
                disabled={isGeneratingImage}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white font-medium transition-colors"
              >
                {isGeneratingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                <span>{scene.imageUrl ? "Régénérer First Frame" : "Générer First Frame"}</span>
              </button>
            </div>
            <textarea
              value={scene.visualPrompt}
              onChange={(e) => onUpdate({ visualPrompt: e.target.value })}
              className="w-full bg-black/60 border border-amber-500/20 focus:border-amber-500/50 rounded-xl p-3.5 text-xs font-mono text-zinc-300 outline-none min-h-[110px] leading-relaxed"
            />
          </div>

          {scene.imageUrl && (
            <div className="flex items-center gap-3 p-2 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <img 
                src={scene.imageUrl} 
                alt="Scene frame" 
                className="w-16 h-12 object-cover rounded-lg border border-white/10"
              />
              <span className="text-xs text-zinc-400 flex-1">Image clé (First Frame)</span>
              <a
                href={scene.imageUrl}
                target="_blank"
                rel="noreferrer"
                download
                className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 transition-colors"
                title="Ouvrir l'image"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
