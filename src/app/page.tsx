"use client";

import { useState, useEffect } from "react";
import { 
  Loader2, 
  Play, 
  Sparkles, 
  Wand2, 
  Save,
  Github,
  Image as ImageIcon,
  CheckCircle2,
  FileDown,
  Mic2,
  MessageSquareText,
  Clapperboard,
  History,
  Edit3,
  RefreshCw,
  Download,
  Music,
  Smartphone,
  Monitor
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import clsx from "clsx";
import { generateContent, ContentPlan, Scene, saveProject, getElevenLabsAudio, getQuota, generateVideo, generateImage } from "./actions";

export const dynamic = "force-dynamic";

type AspectRatio = "16:9" | "9:16";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<{remaining: number, total: number} | null>(null);
  const [globalRatio, setGlobalRatio] = useState<AspectRatio>("16:9");

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
      if (result.success && result.data) {
        setPlan(result.data);
      } else {
        setError(result.error || "AI_ERROR");
      }
    } catch {
      setError("SERVER_CONNECTION_ERROR");
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

  const updateScene = (index: number, updates: Partial<Scene>) => {
    if (!plan) return;
    const newScenes = [...plan.scenes];
    newScenes[index] = { ...newScenes[index], ...updates };
    setPlan({ ...plan, scenes: newScenes });
  };

  const masterExport = async () => {
    if (!plan) return;
    setIsExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.createElement("div");
      element.innerHTML = `
        <div style="padding: 40px; font-family: sans-serif; background: white; color: black;">
          <h1 style="font-size: 32px;">${plan.title}</h1>
          <p style="color: #666; text-transform: uppercase;">${plan.category} • Ratio ${globalRatio}</p>
          ${plan.scenes.map(s => `
            <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
              <p>SCENE ${s.id}</p>
              <p style="font-size: 18px;">"${s.voiceOver}"</p>
            </div>
          `).join("")}
        </div>
      `;
      const opt = { margin: 10, filename: 'neuro-prod.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } };
      await html2pdf().from(element).set(opt).save();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-indigo-500/30">
      
      <header className="h-16 border-b border-[#1a1a1a] bg-black/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-8">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setPlan(null)}>
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center shadow-[0_0_15px_-3px_rgba(79,70,229,0.5)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold tracking-tight uppercase text-sm tracking-widest">NeuroStudio</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex bg-[#111] rounded-lg p-1 border border-[#222]">
             <button 
              onClick={() => setGlobalRatio("16:9")}
              className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-md transition-all text-[10px] font-bold uppercase tracking-widest", globalRatio === "16:9" ? "bg-indigo-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300")}
             >
               <Monitor className="w-3 h-3" /> YouTube
             </button>
             <button 
              onClick={() => setGlobalRatio("9:16")}
              className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-md transition-all text-[10px] font-bold uppercase tracking-widest", globalRatio === "9:16" ? "bg-indigo-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300")}
             >
               <Smartphone className="w-3 h-3" /> TikTok
             </button>
          </div>
          <Link href="/archives" className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors">
            <History className="w-5 h-5" />
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest">Archives</span>
          </Link>
          <div className="h-4 w-px bg-[#1a1a1a]" />
          <div className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
            Production v5.2
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-20">
        {!plan && !isGenerating && (
          <div className="space-y-16">
            <div className="space-y-6 max-w-3xl">
              <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-tight">
                Racontez des vies <br />
                <span className="text-zinc-500">au format {globalRatio === "16:9" ? "cinéma" : "mobile"}.</span>
              </h1>
              <p className="text-zinc-400 text-xl leading-relaxed">
                NeuroStudio adapte vos biopics pour toutes les plateformes. 
                Éditez vos scènes et téléchargez-les instantanément.
              </p>
            </div>

            <div className="max-w-2xl bg-[#0a0a0a] border border-[#1a1a1a] p-2 rounded-2xl flex items-center shadow-2xl">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Le sujet de votre biopic..."
                className="flex-1 bg-transparent px-6 py-4 outline-none text-lg placeholder:text-zinc-700"
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim()}
                className="bg-white text-black px-8 py-4 rounded-xl font-bold hover:bg-indigo-600 hover:text-white transition-all flex items-center gap-2"
              >
                <Wand2 className="w-5 h-5" /> Écrire l'Histoire
              </button>
            </div>
          </div>
        )}

        {isGenerating && (
          <div className="h-[40vh] flex flex-col justify-center items-center gap-6 text-center">
             <div className="relative">
                <Loader2 className="w-16 h-12 text-indigo-500 animate-spin" />
                <div className="absolute inset-0 blur-xl bg-indigo-500/30 animate-pulse" />
             </div>
             <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs animate-pulse">Recherche biographique en cours...</p>
          </div>
        )}

        <AnimatePresence>
          {plan && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
              <div className="bg-[#0a0a0a] border border-[#1a1a1a] p-8 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl">
                <div className="flex-1">
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest px-2 py-1 bg-indigo-500/10 rounded tracking-[0.2em]">{plan.category}</span>
                  <input value={plan.title} onChange={(e) => setPlan({...plan, title: e.target.value})} className="block w-full bg-transparent text-3xl font-bold mt-2 outline-none border-b border-transparent focus:border-indigo-500/30 transition-all" />
                </div>
                <div className="flex gap-3">
                   <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded-lg border border-[#333] transition-all text-xs font-bold uppercase tracking-widest">
                     {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (saveSuccess ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Save className="w-4 h-4" />)}
                     {saveSuccess ? "Enregistré" : "Sauvegarder"}
                   </button>
                   <button onClick={masterExport} disabled={isExporting} className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-indigo-500 hover:text-white rounded-lg transition-all text-xs font-bold uppercase tracking-widest">
                     {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                     PDF Script
                   </button>
                </div>
              </div>

              <div className="grid gap-12">
                {plan.scenes.map((scene, index) => (
                  <SceneCard 
                    key={scene.id} 
                    scene={scene} 
                    index={index} 
                    ratio={globalRatio}
                    onUpdate={(updates) => updateScene(index, updates)}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title }: { icon: React.ElementType, title: string }) {
  return (
    <div className="flex items-center gap-4 group">
      <div className="w-12 h-12 rounded-xl bg-[#0a0a0a] border border-[#1a1a1a] flex items-center justify-center group-hover:border-indigo-500 transition-colors">
        <Icon className="w-6 h-6 text-zinc-500 group-hover:text-indigo-500 transition-colors" />
      </div>
      <span className="text-sm font-bold uppercase tracking-widest text-zinc-500">{title}</span>
    </div>
  );
}

function SceneCard({ scene, index, ratio, onUpdate }: { scene: Scene; index: number; ratio: AspectRatio; onUpdate: (updates: Partial<Scene>) => void }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(scene.imageUrl || null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);

  const fallbackImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt.slice(0, 150))}?nologo=true&width=${ratio === "16:9" ? 1280 : 720}&height=${ratio === "16:9" ? 720 : 1280}&seed=${index + 999}`;

  const playVoice = async () => {
    if (isPlaying) return;
    setLoadingAudio(true);
    try {
      const result = await getElevenLabsAudio(scene.voiceOver);
      if (result.success && result.url) {
        setAudioUrl(result.url);
        const audio = new Audio(result.url);
        audio.onended = () => setIsPlaying(false);
        setIsPlaying(true);
        audio.play();
      }
    } finally { 
      setLoadingAudio(false); 
    }
  };

  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch { alert("Erreur de téléchargement"); }
  };

  const handleGenerateImage = async () => {
    setIsGeneratingImage(true);
    try {
      const result = await generateImage(scene.visualPrompt, ratio);
      if (result.success && result.url) {
        setImageUrl(result.url);
        onUpdate({ imageUrl: result.url });
      }
    } finally { setIsGeneratingImage(false); }
  };

  const handleGenerateVideo = async () => {
    setIsGeneratingVideo(true);
    try {
      await generateVideo(imageUrl || fallbackImageUrl, scene.visualPrompt);
      setIsSimulated(true);
    } finally { setIsGeneratingVideo(false); }
  };

  return (
    <div className="studio-card p-10 grid lg:grid-cols-[1fr,1fr] gap-16 items-start">
      <div className="space-y-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
             <span className="w-10 h-10 flex items-center justify-center bg-[#1a1a1a] rounded-lg text-xs font-bold border border-[#333]">0{index + 1}</span>
             <div className="flex flex-col">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{scene.duration} Secondes</span>
                <span className="text-[9px] font-medium text-indigo-500 uppercase tracking-widest">Format {ratio}</span>
             </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleGenerateImage} disabled={isGeneratingImage} className={clsx("w-12 h-12 rounded-xl flex items-center justify-center border transition-all shadow-lg", imageUrl ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-[#1a1a1a] border-[#333] text-zinc-500 hover:border-indigo-500")}>
              {isGeneratingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
            </button>
            <button onClick={handleGenerateVideo} disabled={isGeneratingVideo} className={clsx("w-12 h-12 rounded-xl flex items-center justify-center border transition-all shadow-lg", isSimulated ? "bg-green-500/20 text-green-500 border-green-500/30" : "bg-[#1a1a1a] border-[#333] text-zinc-500 hover:border-green-500")}>
              {isGeneratingVideo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Clapperboard className="w-5 h-5" />}
            </button>
            <button onClick={playVoice} className="w-12 h-12 rounded-xl flex items-center justify-center border bg-white text-black hover:bg-indigo-500 hover:text-white transition-all shadow-lg">
              {loadingAudio ? <Loader2 className="w-5 h-5 animate-spin" /> : (isPlaying ? <div className="w-3 h-3 bg-current rounded-sm animate-pulse" /> : <Play className="w-5 h-5 fill-current" />)}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2 italic">Script Narration</label>
            <textarea value={scene.voiceOver} onChange={(e) => onUpdate({ voiceOver: e.target.value })} className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 text-xl font-bold text-zinc-100 outline-none focus:border-indigo-500/50 transition-all min-h-[100px] resize-none leading-relaxed" />
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2 italic">Prompt Visuel IA</label>
            <textarea value={scene.visualPrompt} onChange={(e) => onUpdate({ visualPrompt: e.target.value })} className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 text-sm font-medium text-zinc-400 outline-none focus:border-indigo-500/50 transition-all min-h-[80px] resize-none leading-relaxed italic" />
          </div>
        </div>

        <div className="flex gap-4 border-t border-[#1a1a1a] pt-6">
          {imageUrl && <button onClick={() => downloadFile(imageUrl, `biopic-${index+1}.webp`)} className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] rounded-lg text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white border border-[#333] transition-colors"><Download className="w-3 h-3" /> Image</button>}
          {audioUrl && <button onClick={() => downloadFile(audioUrl, `audio-${index+1}.mp3`)} className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] rounded-lg text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white border border-[#333] transition-colors"><Music className="w-3 h-3" /> Audio</button>}
        </div>
      </div>

      <div className={clsx("relative rounded-2xl overflow-hidden border border-[#1a1a1a] shadow-2xl bg-[#0a0a0a] flex items-center justify-center group self-center transition-all duration-500", ratio === "16:9" ? "aspect-video w-full" : "aspect-[9/16] w-[60%] mx-auto")}>
         {(isGeneratingVideo || isGeneratingImage) && (
           <div className="absolute inset-0 bg-black/90 z-20 flex flex-col items-center justify-center gap-4">
             <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
             <span className="text-[10px] font-bold text-white uppercase tracking-widest">IA Drawing...</span>
           </div>
         )}
         <motion.img 
          src={imageUrl || fallbackImageUrl} 
          key={imageUrl || fallbackImageUrl + ratio}
          alt="" 
          animate={isSimulated ? { scale: [1, 1.15], y: ratio === "9:16" ? [0, -20] : [0, 0], x: ratio === "16:9" ? [0, 15] : [0, 0] } : {}}
          transition={isSimulated ? { duration: 15, repeat: Infinity, repeatType: "reverse", ease: "linear" } : {}}
          className="w-full h-full object-cover z-10 block" 
         />
         <div className="absolute bottom-6 left-6 z-30 flex gap-2">
            <span className="px-3 py-1.5 bg-black/80 backdrop-blur-md rounded-full border border-white/10 text-[9px] font-bold uppercase tracking-widest text-indigo-400">
               {ratio} {isSimulated ? "Animé" : "HD"}
            </span>
         </div>
      </div>
    </div>
  );
}
