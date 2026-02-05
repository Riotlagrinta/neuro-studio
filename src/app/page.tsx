"use client";

import { useState, useEffect } from "react";
import { 
  Loader2, 
  Play, 
  Sparkles, 
  Wand2, 
  Download,
  Save,
  Github,
  ChevronRight,
  Image as ImageIcon,
  CheckCircle2,
  FileDown,
  Trash2,
  Mic2,
  MessageSquareText,
  Clapperboard,
  Layout as LayoutIcon,
  History
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import clsx from "clsx";
import { generateContent, ContentPlan, Scene, saveProject, getElevenLabsAudio, getQuota } from "./actions";

export const dynamic = "force-dynamic";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<{remaining: number, total: number} | null>(null);

  useEffect(() => {
    getQuota().then(setQuota);
  }, []);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    setError("");
    setPlan(null);
    try {
      const result = await generateContent(topic);
      setPlan(result);
    } catch (err: any) {
      console.error("HandleGenerate Error:", err);
      setError(err.message || "AI Engine error. Please retry.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!plan || !topic) return;
    setIsSaving(true);
    try {
      await saveProject(topic, plan);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError("Cloud sync failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const masterExport = async () => {
    if (!plan) return;
    setIsExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.createElement("div");
      element.innerHTML = `
        <div style="padding: 40px; font-family: sans-serif; background: white; color: black;">
          <h1 style="font-size: 32px; margin-bottom: 0;">${plan.title}</h1>
          <p style="color: #666; text-transform: uppercase; font-size: 12px; margin-bottom: 30px;">${plan.category} • Script</p>
          ${plan.scenes.map(s => `
            <div style="margin-bottom: 30px; border-top: 1px solid #eee; padding-top: 20px; page-break-inside: avoid;">
              <p style="font-size: 10px; font-weight: bold;">SCENE ${s.id}</p>
              <p style="font-size: 18px; margin: 10px 0;">"${s.voiceOver}"</p>
              <img src="https://image.pollinations.ai/prompt/${encodeURIComponent(s.visualPrompt)}?width=800" style="width: 100%; border-radius: 8px;" />
            </div>
          `).join("")}
        </div>
      `;
      const opt = { 
        margin: 10, 
        filename: 'production.pdf', 
        image: { type: 'jpeg' as const, quality: 1.0 },
        html2canvas: { scale: 2, useCORS: true }, 
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const } 
      };
      await html2pdf().from(element).set(opt).save();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-indigo-500/30">
      
      {/* Header */}
      <header className="h-16 border-b border-[#1a1a1a] bg-black/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-8">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setPlan(null)}>
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold tracking-tight uppercase text-sm tracking-widest">NeuroStudio</span>
        </div>
        <div className="flex items-center gap-6">
          {quota && (
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Audio Quota</span>
              <span className="text-[10px] font-bold text-indigo-400">{quota.remaining.toLocaleString()} chars left</span>
            </div>
          )}
          <Link href="/archives" className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors">
            <History className="w-5 h-5" />
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest">Archives</span>
          </Link>
          <a href="https://github.com/Riotlagrinta" target="_blank" className="text-zinc-500 hover:text-white transition-colors"><Github className="w-5 h-5" /></a>
          <div className="h-4 w-px bg-[#1a1a1a]" />
          <div className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
            Professional v3.0
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-20">
        
        {/* Landing */}
        {!plan && !isGenerating && (
          <div className="space-y-16">
            <div className="space-y-6 max-w-3xl">
              <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-tight">
                Créez vos storyboards <br />
                <span className="text-zinc-500">avec une IA de pointe.</span>
              </h1>
              <p className="text-zinc-400 text-xl leading-relaxed">
                NeuroStudio transforme vos idées en plans de production complets. 
                Scripts viraux, visuels cinématographiques et voix ElevenLabs.
              </p>
            </div>

            <div className="max-w-2xl bg-[#0a0a0a] border border-[#1a1a1a] p-2 rounded-2xl flex items-center shadow-2xl">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Quel est votre sujet ?"
                className="flex-1 bg-transparent px-6 py-4 outline-none text-lg placeholder:text-zinc-700"
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim()}
                className="bg-white text-black px-8 py-4 rounded-xl font-bold hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2"
              >
                <Wand2 className="w-5 h-5" /> Générer
              </button>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }} 
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm font-bold flex items-center gap-3"
              >
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                {error}
              </motion.div>
            )}

            <div className="grid md:grid-cols-3 gap-8 pt-10 border-t border-[#1a1a1a]">
               <Feature icon={MessageSquareText} title="Scripting IA" />
               <Feature icon={ImageIcon} title="Storyboard" />
               <Feature icon={Mic2} title="Voix Pro" />
            </div>
          </div>
        )}

        {/* Loading */}
        {isGenerating && (
          <div className="h-[40vh] flex flex-col justify-center items-center gap-6">
             <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
             <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs animate-pulse">Génération du storyboard...</p>
          </div>
        )}

        {/* Studio Editor */}
        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
              
              {/* Toolbar */}
              <div className="bg-[#0a0a0a] border border-[#1a1a1a] p-8 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl">
                <div>
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest px-2 py-1 bg-indigo-500/10 rounded">{plan.category}</span>
                  <h2 className="text-3xl font-bold mt-2">{plan.title}</h2>
                </div>
                <div className="flex gap-3">
                   <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded-lg border border-[#333] transition-all text-xs font-bold">
                     {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> : (saveSuccess ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Save className="w-4 h-4" />)}
                     {saveSuccess ? "Sauvegardé" : "Enregistrer"}
                   </button>
                   <button onClick={masterExport} disabled={isExporting} className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-indigo-500 hover:text-white rounded-lg transition-all text-xs font-bold">
                     {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                     Exporter PDF
                   </button>
                </div>
              </div>

              {/* Grid Layout for Scenes */}
              <div className="grid gap-8">
                {plan.scenes.map((scene, index) => (
                  <SceneCard key={scene.id} scene={scene} index={index} />
                ))}
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title }: any) {
  return (
    <div className="flex items-center gap-4 group">
      <div className="w-12 h-12 rounded-xl bg-[#0a0a0a] border border-[#1a1a1a] flex items-center justify-center group-hover:border-indigo-500 transition-colors">
        <Icon className="w-6 h-6 text-zinc-500 group-hover:text-indigo-500 transition-colors" />
      </div>
      <span className="text-sm font-bold uppercase tracking-widest text-zinc-500">{title}</span>
    </div>
  );
}

function SceneCard({ scene, index }: { scene: Scene; index: number }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt)}?width=1280&height=720&nologo=true&seed=${index + 42}`;

  const playVoice = async () => {
    if (isPlaying) return;
    setLoadingAudio(true);
    try {
      const audioUrl = await getElevenLabsAudio(scene.voiceOver);
      const audio = new Audio(audioUrl);
      audio.onended = () => setIsPlaying(false);
      setIsPlaying(true);
      audio.play();
    } catch (e) { 
      console.error(e);
      alert("Échec de lecture audio via Cloudinary.");
    } finally { 
      setLoadingAudio(false); 
    }
  };

  return (
    <div className="studio-card p-8 grid lg:grid-cols-[1.5fr,1fr] gap-12 items-center">
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
             <span className="w-8 h-8 flex items-center justify-center bg-[#1a1a1a] rounded text-[10px] font-bold border border-[#333]">0{index + 1}</span>
             <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{scene.duration} Secondes</span>
          </div>
          <button 
            onClick={playVoice} 
            className={clsx("w-10 h-10 rounded-full flex items-center justify-center border transition-all", isPlaying ? "bg-indigo-600 border-indigo-500" : "bg-[#1a1a1a] border-[#333] hover:border-indigo-500")}
          >
            {loadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : (isPlaying ? <div className="w-2 h-2 bg-white rounded-sm animate-pulse" /> : <Play className="w-4 h-4 fill-white" />)}
          </button>
        </div>

        <p className="text-2xl font-bold leading-snug text-zinc-100">
          "{scene.voiceOver}"
        </p>

        <div className="flex flex-wrap gap-2">
          {scene.videoKeywords && typeof scene.videoKeywords === "string" ? scene.videoKeywords.split(",").map((kw, i) => (
            <span key={i} className="text-[9px] font-bold text-zinc-600 bg-black px-2 py-1 rounded border border-[#1a1a1a] uppercase tracking-widest">#{kw.trim()}</span>
          )) : null}
        </div>
      </div>

      <div className="relative aspect-video bg-[#0a0a0a] rounded-xl overflow-hidden border border-[#1a1a1a] group shadow-inner flex items-center justify-center">
         {!imageLoaded && !imageError && (
           <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
             <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
             <span className="text-[8px] font-bold text-zinc-700 uppercase tracking-widest">IA Drawing...</span>
           </div>
         )}

         {imageError ? (
            <div className="flex flex-col items-center gap-2 text-zinc-700">
               <ImageIcon className="w-8 h-8 opacity-20" />
               <span className="text-[10px] font-bold uppercase tracking-widest">Image unavailable</span>
            </div>
         ) : (
            <img 
              src={imageUrl} 
              alt="" 
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              className={clsx(
                "w-full h-full object-cover transition-all duration-1000",
                imageLoaded ? "opacity-80 group-hover:opacity-100 scale-100" : "opacity-0 scale-105"
              )} 
            />
         )}

         <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
         <div className="absolute bottom-4 left-4 right-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
            <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-1 flex items-center gap-1">
               <Sparkles className="w-3 h-3" /> IA Visual
            </p>
            <p className="text-[10px] text-zinc-500 font-medium italic line-clamp-2">{scene.visualPrompt}</p>
         </div>
      </div>
    </div>
  );
}