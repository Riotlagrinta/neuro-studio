"use client";

import { useState } from "react";
import { 
  Loader2, 
  Play, 
  Sparkles, 
  Wand2, 
  Download,
  Save,
  Github,
  ChevronRight,
  Maximize2,
  Image as ImageIcon,
  CheckCircle2,
  FileDown,
  Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { generateContent, ContentPlan, Scene, saveProject, getElevenLabsAudio } from "./actions";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    setError("");
    setPlan(null);
    try {
      const result = await generateContent(topic);
      setPlan(result);
    } catch (err) {
      setError("Moteur IA indisponible. Réessayez.");
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
      setError("Erreur de synchronisation Cloud.");
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
        <div style="padding: 60px; font-family: 'Inter', sans-serif; background: #fff; color: #000;">
          <h1 style="font-size: 42px; font-weight: 800; letter-spacing: -2px; margin-bottom: 5px;">${plan.title}</h1>
          <p style="font-size: 12px; font-weight: 700; color: #6366f1; text-transform: uppercase; margin-bottom: 40px;">${plan.category} • Production Script</p>
          ${plan.scenes.map(s => `
            <div style="margin-bottom: 40px; border-top: 1px solid #eee; padding-top: 20px; page-break-inside: avoid;">
              <p style="font-size: 10px; font-weight: 800;">SCENE ${s.id} • ${s.duration}S</p>
              <p style="font-size: 22px; font-weight: 700; line-height: 1.2; margin: 15px 0;">"${s.voiceOver}"</p>
              <img src="https://image.pollinations.ai/prompt/${encodeURIComponent(s.visualPrompt)}?width=800" style="width: 100%; border-radius: 12px;" />
            </div>
          `).join("")}
        </div>
      `;
      const opt = { 
        margin: 10, 
        filename: 'production-docket.pdf', 
        html2canvas: { scale: 3, useCORS: true }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
      };
      await html2pdf().from(element).set(opt).save();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-[#E2E2E2] antialiased font-sans">
      {/* Top Header */}
      <header className="fixed top-0 inset-x-0 h-16 border-b border-white/5 bg-black/50 backdrop-blur-xl z-50 px-8 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setPlan(null)}>
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold tracking-tight text-white uppercase text-sm">NeuroStudio <span className="text-white/40">PRO</span></span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://github.com/Riotlagrinta" target="_blank" className="text-white/40 hover:text-white transition-colors"><Github className="w-5 h-5" /></a>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5">
             <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
             <span className="text-[10px] font-bold text-white/60 uppercase">System Ready</span>
          </div>
        </div>
      </header>

      {/* Main UI */}
      <div className="pt-32 pb-40 max-w-5xl mx-auto px-6">
        
        {/* Landing/Hero */}
        {!plan && !isGenerating && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-20">
            <div className="space-y-6">
              <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-white leading-[0.9]">
                Direct your <br />
                <span className="text-indigo-500">Masterpiece.</span>
              </h1>
              <p className="max-w-xl text-white/40 text-xl font-medium leading-relaxed">
                Transform ideas into cinematic production plans. AI scriptwriting, 
                visual storyboarding, and pro voice-over orchestration.
              </p>
            </div>

            <div className="relative group max-w-2xl">
              <div className="absolute -inset-1 bg-indigo-500/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative glass p-2 rounded-3xl flex items-center shadow-2xl">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="The secrets of the ocean, a futuristic car reveal..."
                  className="flex-1 bg-transparent px-6 py-4 outline-none text-lg font-medium placeholder:text-white/10"
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                />
                <button
                  onClick={handleGenerate}
                  className="bg-white text-black px-8 py-4 rounded-2xl font-bold hover:bg-indigo-500 hover:text-white transition-all duration-300 flex items-center gap-2"
                >
                  <Wand2 className="w-5 h-5" /> Generate
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-10 pt-10 border-t border-white/5">
               <Feature icon={MessageSquareText} title="Smart Scripting" />
               <Feature icon={ImageIcon} title="AI Storyboard" />
               <Feature icon={Mic2} title="Pro Voices" />
            </div>
          </motion.div>
        )}

        {/* Loader */}
        {isGenerating && (
          <div className="h-[50vh] flex flex-col justify-center items-center gap-8">
             <div className="relative w-20 h-20">
                <div className="absolute inset-0 border-4 border-white/5 rounded-full" />
                <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin" />
             </div>
             <p className="text-white/40 font-bold uppercase tracking-[0.3em] text-xs animate-pulse">Orchestrating AI Assets...</p>
          </div>
        )}

        {/* Studio Editor */}
        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="space-y-16">
              
              {/* Toolbar */}
              <div className="glass p-8 rounded-[2rem] flex flex-col md:flex-row justify-between items-center gap-8 shadow-3xl sticky top-20 z-40">
                <div className="space-y-2 text-center md:text-left">
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-3 py-1 bg-indigo-500/10 rounded-full">{plan.category}</span>
                  <h2 className="text-3xl font-black text-white tracking-tight">{plan.title}</h2>
                </div>
                <div className="flex gap-3">
                   <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-all text-xs font-bold">
                     {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> : (saveSuccess ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Save className="w-4 h-4" />)}
                     {saveSuccess ? "Saved" : "Cloud Sync"}
                   </button>
                   <button onClick={masterExport} disabled={isExporting} className="flex items-center gap-2 px-5 py-3 bg-white text-black hover:bg-indigo-500 hover:text-white rounded-xl transition-all text-xs font-bold shadow-lg">
                     {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                     Export PDF
                   </button>
                   <button onClick={() => setPlan(null)} className="p-3 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all border border-red-500/10">
                      <Trash2 className="w-5 h-5" />
                   </button>
                </div>
              </div>

              {/* Scenes */}
              <div className="grid gap-12">
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
    <div className="flex items-center gap-4 opacity-40 hover:opacity-100 transition-opacity cursor-default">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/5">
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-xs font-black uppercase tracking-widest">{title}</span>
    </div>
  );
}

function SceneCard({ scene, index }: { scene: Scene; index: number }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt)}?width=1280&height=720&nologo=true&model=flux`;

  const playVoice = async () => {
    if (isPlaying) return;
    setLoadingAudio(true);
    try {
      const base64 = await getElevenLabsAudio(scene.voiceOver);
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      audio.onended = () => setIsPlaying(false);
      setIsPlaying(true);
      audio.play();
    } catch (e) { console.error(e); } finally { setLoadingAudio(false); }
  };

  return (
    <div className="scene-card glass p-8 rounded-[2.5rem] grid lg:grid-cols-[1.4fr,1fr] gap-12 items-center">
      <div className="space-y-8 order-2 lg:order-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
             <span className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-xl text-[10px] font-black border border-white/5">0{index + 1}</span>
             <div className="h-px w-20 bg-white/5" />
             <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{scene.duration} Seconds</span>
          </div>
          <button 
            onClick={playVoice} 
            className={clsx("w-12 h-12 rounded-full flex items-center justify-center border transition-all shadow-xl", isPlaying ? "bg-indigo-600 border-indigo-500 shadow-indigo-500/20" : "bg-white/5 border-white/5 hover:border-indigo-500/50")}
          >
            {loadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : (isPlaying ? <div className="w-3 h-3 bg-white rounded-sm animate-pulse" /> : <Play className="w-4 h-4 fill-white" />)}
          </button>
        </div>

        <p className="text-2xl md:text-3xl font-bold leading-tight text-white/90">
          "{scene.voiceOver}"
        </p>

        <div className="flex flex-wrap gap-2">
          {scene.videoKeywords.split(",").map((kw, i) => (
            <span key={i} className="text-[9px] font-bold text-white/30 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 uppercase tracking-widest">#{kw.trim()}</span>
          ))}
        </div>
      </div>

      <div className="relative aspect-video bg-zinc-900 rounded-[2rem] overflow-hidden border border-white/10 group shadow-2xl order-1 lg:order-2">
         <img src={imageUrl} alt="" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" />
         <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
         <div className="absolute bottom-6 left-6 right-6 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1 flex items-center gap-2">
               <Sparkles className="w-3 h-3" /> Visual Prompt
            </p>
            <p className="text-[10px] font-medium text-white/60 italic line-clamp-2">{scene.visualPrompt}</p>
         </div>
      </div>
    </div>
  );
}

// Missing imports in previous blocks
import { Mic2 } from "lucide-react";
import { MessageSquareText } from "lucide-react";