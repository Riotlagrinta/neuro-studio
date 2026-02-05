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
  Mic2,
  Image as ImageIcon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { generateContent, ContentPlan, Scene, saveProject, getElevenLabsAudio } from "./actions";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
      setError("SYSTEM OVERLOAD. RETRY.");
    } finally {
      setIsGenerating(false);
    }
  };

  const masterExport = async () => {
    if (!plan) return;
    const html2pdf = (await import("html2pdf.js")).default;
    const element = document.createElement("div");
    element.innerHTML = `<div style="padding: 50px; background: white; color: black; font-family: sans-serif;">
      <h1 style="font-size: 40px; text-transform: uppercase;">${plan.title}</h1>
      ${plan.scenes.map(s => `<div style="margin-bottom: 30px; border-top: 2px solid black; padding-top: 10px;">
        <h3>SCENE ${s.id}</h3>
        <p style="font-size: 20px;">${s.voiceOver}</p>
        <img src="https://image.pollinations.ai/prompt/${encodeURIComponent(s.visualPrompt)}?width=800" style="width: 100%;" />
      </div>`).join("")}
    </div>`;
    html2pdf().from(element).set({ margin: 10, filename: 'production.pdf', html2canvas: { scale: 2, useCORS: true } }).save();
  };

  return (
    <div className="min-h-screen bg-[#020202] text-white selection:bg-white selection:text-black antialiased">
      {/* Top Header - Ultra Thin */}
      <header className="fixed top-0 inset-x-0 h-14 border-b border-white/5 bg-[#020202]/80 backdrop-blur-xl z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em]">NeuroStudio v2.6.PRO</span>
        </div>
        <div className="flex items-center gap-6">
           <a href="https://github.com/Riotlagrinta" target="_blank" className="hover:text-indigo-400 transition-colors"><Github className="w-4 h-4" /></a>
           <div className="h-4 w-px bg-white/10" />
           <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Production Mode</span>
        </div>
      </header>

      {/* Main Container */}
      <div className="pt-32 pb-20 px-6 sm:px-12 max-w-[1600px] mx-auto">
        
        {/* Landing/Search Area */}
        {!plan && !isGenerating && (
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-32"
          >
            <div className="space-y-8">
              <h1 className="text-huge italic">
                Crea<span className="text-zinc-800">tive</span> <br />
                Intelli<span className="text-indigo-600">gence</span>
              </h1>
              <p className="max-w-xl text-zinc-500 text-lg font-medium leading-relaxed">
                Le moteur de pré-production le plus puissant au monde. <br /> 
                Génération de scripts, storyboarding haute fidélité, et orchestration vocale.
              </p>
            </div>

            <div className="relative max-w-4xl group">
              <div className="absolute -inset-4 bg-indigo-500/10 rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
              <div className="relative bg-zinc-900/20 border border-white/5 p-4 rounded-3xl flex flex-col sm:flex-row gap-4 items-center">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="EX: DOCUMENTAIRE NOIR SUR L'IA..."
                  className="flex-1 bg-transparent px-6 py-6 text-2xl font-black uppercase tracking-tighter outline-none placeholder:text-zinc-800"
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                />
                <button
                  onClick={handleGenerate}
                  className="w-full sm:w-auto bg-white text-black px-12 py-6 rounded-2xl font-black uppercase tracking-[0.2em] text-xs hover:bg-indigo-500 hover:text-white transition-all duration-500"
                >
                  Initiate
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Loader - Full Minimalism */}
        {isGenerating && (
          <div className="h-[60vh] flex flex-col justify-center items-center gap-10">
             <div className="text-[10vw] font-black italic text-zinc-900 animate-pulse uppercase tracking-tighter leading-none">
               Processing
             </div>
             <div className="w-64 h-[2px] bg-white/5 relative overflow-hidden">
                <motion.div 
                  initial={{ left: "-100%" }}
                  animate={{ left: "100%" }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  className="absolute inset-0 w-1/2 bg-white"
                />
             </div>
          </div>
        )}

        {/* Studio View */}
        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-24">
              
              {/* Top Control Bar */}
              <div className="flex flex-col md:flex-row justify-between items-end gap-10 border-b border-white/5 pb-10">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{plan.category}</span>
                    <div className="w-1 h-1 bg-zinc-800 rounded-full" />
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Sequence 01</span>
                  </div>
                  <h2 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic leading-none">{plan.title}</h2>
                </div>
                <div className="flex gap-3">
                   <button onClick={() => saveProject(topic, plan)} className="p-4 bg-zinc-900 hover:bg-white hover:text-black transition-all rounded-xl border border-white/5"><Save className="w-5 h-5" /></button>
                   <button onClick={masterExport} className="p-4 bg-zinc-900 hover:bg-white hover:text-black transition-all rounded-xl border border-white/5"><Download className="w-5 h-5" /></button>
                   <button onClick={() => setPlan(null)} className="px-8 py-4 bg-white text-black font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-indigo-500 hover:text-white transition-all">New Project</button>
                </div>
              </div>

              {/* Grid of Scenes */}
              <div className="grid gap-20">
                {plan.scenes.map((scene, index) => (
                  <SceneBlock key={scene.id} scene={scene} index={index} />
                ))}
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SceneBlock({ scene, index }: { scene: Scene; index: number }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt)}?width=1280&height=720&nologo=true&model=flux`;

  const playVoice = async () => {
    if (isPlaying) return;
    try {
      const base64 = await getElevenLabsAudio(scene.voiceOver);
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      audio.onended = () => setIsPlaying(false);
      setIsPlaying(true);
      audio.play();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="group grid lg:grid-cols-[1fr,1.2fr] gap-12 sm:gap-24 items-start">
      {/* Text Context */}
      <div className="space-y-12 py-10 order-2 lg:order-1">
        <div className="flex items-center gap-8">
           <span className="text-5xl font-black italic text-zinc-900">0{index + 1}</span>
           <div className="h-px flex-1 bg-white/5" />
           <div className="flex items-center gap-4">
              <button onClick={playVoice} className={clsx("w-14 h-14 rounded-full flex items-center justify-center border transition-all", isPlaying ? "bg-indigo-600 border-indigo-500" : "bg-transparent border-white/10 hover:border-white/30")}>
                {isPlaying ? <div className="w-3 h-3 bg-white animate-pulse" /> : <Play className="w-4 h-4 fill-white" />}
              </button>
              <div className="text-right">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Duration</p>
                <p className="text-lg font-bold italic">{scene.duration}s</p>
              </div>
           </div>
        </div>

        <div className="space-y-6">
           <p className="text-3xl md:text-5xl font-black leading-[1.05] tracking-tighter uppercase italic text-zinc-200 hover:text-white transition-colors cursor-text">
             "{scene.voiceOver}"
           </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {scene.videoKeywords.split(",").map((kw, i) => (
            <span key={i} className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 border border-white/5 px-3 py-1.5 rounded-lg hover:border-white/20 hover:text-white transition-all cursor-pointer">#{kw.trim()}</span>
          ))}
        </div>
      </div>

      {/* Visual Block */}
      <div className="relative aspect-video lg:aspect-square bg-zinc-900 rounded-[2.5rem] overflow-hidden group/img order-1 lg:order-2 shadow-2xl">
         <img src={imageUrl} alt="" className="w-full h-full object-cover grayscale opacity-50 group-hover/img:grayscale-0 group-hover/img:opacity-100 transition-all duration-1000 scale-105 group-hover/img:scale-100" />
         <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
         <div className="absolute bottom-10 left-10 right-10 flex justify-between items-end translate-y-4 group-hover/img:translate-y-0 transition-transform duration-500">
            <div className="max-w-[70%]">
              <div className="flex items-center gap-2 mb-2 text-indigo-400">
                 <Sparkles className="w-4 h-4" />
                 <span className="text-[9px] font-black uppercase tracking-widest">Visual Prompt</span>
              </div>
              <p className="text-xs font-medium text-zinc-400 italic line-clamp-2">{scene.visualPrompt}</p>
            </div>
            <button className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/10 hover:bg-white hover:text-black transition-all">
              <Maximize2 className="w-4 h-4" />
            </button>
         </div>
      </div>
    </div>
  );
}
