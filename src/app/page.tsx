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
  Trash2,
  Mic2,
  MessageSquareText
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
      setError("AI Engine Overload. Try again.");
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
      setError("Cloud Sync Failed.");
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
        image: { type: 'jpeg' as const, quality: 1.0 },
        html2canvas: { scale: 3, useCORS: true }, 
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const } 
      };
      await html2pdf().from(element).set(opt).save();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-[#E2E2E2] antialiased font-sans overflow-x-hidden relative">
      {/* Background Aura Dynamique */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            x: [0, 30, 0],
            y: [0, 50, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full" 
        />
        <motion.div 
          animate={{ 
            scale: [1.2, 1, 1.2],
            x: [0, -30, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full" 
        />
      </div>

      {/* Header */}
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="fixed top-0 inset-x-0 h-16 border-b border-white/5 bg-black/40 backdrop-blur-2xl z-50 px-8 flex items-center justify-between"
      >
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setPlan(null)}>
          <motion.div 
            whileHover={{ rotate: 180, scale: 1.1 }}
            className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20"
          >
            <Sparkles className="w-5 h-5 text-white" />
          </motion.div>
          <span className="font-bold tracking-tighter text-white uppercase text-sm group-hover:tracking-widest transition-all duration-500">
            NeuroStudio <span className="text-white/40 font-medium">PRO</span>
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a href="https://github.com/Riotlagrinta" target="_blank" className="text-white/40 hover:text-white hover:scale-110 transition-all"><Github className="w-5 h-5" /></a>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5 shadow-inner">
             <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_#22c55e]" />
             <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Neural Link Active</span>
          </div>
        </div>
      </motion.header>

      {/* Main UI */}
      <div className="pt-32 pb-40 max-w-5xl mx-auto px-6 relative z-10">
        
        {/* Landing/Hero */}
        {!plan && !isGenerating && (
          <div className="space-y-24">
            <motion.div 
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-8"
            >
              <h1 className="text-7xl md:text-9xl font-black tracking-tighter text-white leading-[0.85] italic">
                DIRECT THE <br />
                <span className="text-indigo-500 drop-shadow-[0_0_30px_rgba(99,102,241,0.3)]">FUTURE.</span>
              </h1>
              <p className="max-w-xl text-white/40 text-xl font-medium leading-relaxed border-l-2 border-indigo-500/20 pl-6">
                L'IA ne remplace pas le réalisateur, elle lui donne des super-pouvoirs. 
                Générez des storyboards cinématographiques en un éclair.
              </p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative group max-w-2xl"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[2rem] blur-2xl opacity-0 group-hover:opacity-30 transition-opacity duration-700" />
              <div className="relative glass p-2 rounded-3xl flex items-center shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/5">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What's your vision?"
                  className="flex-1 bg-transparent px-6 py-4 outline-none text-lg font-medium placeholder:text-white/10"
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                />
                <motion.button
                  whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(99, 102, 241, 0.4)" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleGenerate}
                  className="bg-white text-black px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all flex items-center gap-2"
                >
                  <Wand2 className="w-5 h-5" /> Initiate
                </motion.button>
              </div>
            </motion.div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-12 pt-12 border-t border-white/5">
               <FeatureItem icon={MessageSquareText} title="Smart Script" delay={0.4} />
               <FeatureItem icon={ImageIcon} title="AI Storyboard" delay={0.5} />
               <FeatureItem icon={Mic2} title="Audio Engine" delay={0.6} />
            </div>
          </div>
        )}

        {/* Loader */}
        {isGenerating && (
          <div className="h-[50vh] flex flex-col justify-center items-center gap-12">
             <div className="relative">
                <motion.div 
                   animate={{ rotate: 360, borderTopColor: ["#6366f1", "#a855f7", "#6366f1"] }}
                   transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                   className="w-24 h-24 border-t-2 border-r-2 border-transparent rounded-full shadow-[0_0_30px_rgba(99,102,241,0.2)]" 
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-indigo-500 animate-pulse" />
                </div>
             </div>
             <div className="text-center space-y-2">
                <p className="text-white font-black uppercase tracking-[0.5em] text-xs">Neural Synthesis</p>
                <p className="text-white/20 text-[10px] font-mono uppercase tracking-widest animate-pulse italic">Assembling cinematic metadata...</p>
             </div>
          </div>
        )}

        {/* Studio Editor */}
        <AnimatePresence>
          {plan && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              className="space-y-16"
            >
              <div className="glass p-8 rounded-[2rem] flex flex-col md:flex-row justify-between items-center gap-8 shadow-3xl sticky top-20 z-40">
                <div className="space-y-2 text-center md:text-left">
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-3 py-1 bg-indigo-500/10 rounded-full">{plan.category}</span>
                  <h2 className="text-3xl font-black text-white tracking-tight italic uppercase">{plan.title}</h2>
                </div>
                <div className="flex gap-3">
                   <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-all text-xs font-bold uppercase tracking-widest">
                     {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> : (saveSuccess ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Save className="w-4 h-4" />)}
                     {saveSuccess ? "Synced" : "Cloud Save"}
                   </button>
                   <button onClick={masterExport} disabled={isExporting} className="flex items-center gap-3 px-8 py-4 bg-white text-black hover:bg-indigo-500 hover:text-white rounded-xl transition-all text-xs font-black uppercase tracking-widest shadow-lg">
                     {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                     Export Master
                   </button>
                   <button onClick={() => setPlan(null)} className="p-4 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all border border-red-500/10">
                      <Trash2 className="w-5 h-5" />
                   </button>
                </div>
              </div>

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

function FeatureItem({ icon: Icon, title, delay }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-center gap-4 opacity-40 hover:opacity-100 transition-opacity cursor-default group"
    >
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/5 group-hover:bg-indigo-500/10 group-hover:border-indigo-500/50 transition-all">
        <Icon className="w-5 h-5 group-hover:scale-110 transition-transform" />
      </div>
      <span className="text-xs font-black uppercase tracking-widest">{title}</span>
    </motion.div>
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
    <motion.div 
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      className="scene-card glass p-8 sm:p-10 rounded-[2.5rem] grid lg:grid-cols-[1.4fr,1fr] gap-12 items-center hover:shadow-[0_0_50px_rgba(99,102,241,0.1)] transition-all duration-700"
    >
      <div className="space-y-8 order-2 lg:order-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
             <span className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-xl text-[10px] font-black border border-white/5">0{index + 1}</span>
             <div className="h-px w-20 bg-white/5" />
             <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{scene.duration} Seconds</span>
          </div>
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={playVoice} 
            className={clsx("w-12 h-12 rounded-full flex items-center justify-center border transition-all shadow-xl", isPlaying ? "bg-indigo-600 border-indigo-500" : "bg-white/5 border-white/5 hover:border-indigo-500/50")}
          >
            {loadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : (isPlaying ? <div className="w-3 h-3 bg-white rounded-sm animate-pulse" /> : <Play className="w-4 h-4 fill-white" />)}
          </motion.button>
        </div>

        <p className="text-2xl md:text-4xl font-black leading-tight text-white uppercase italic tracking-tight">
          "{scene.voiceOver}"
        </p>

        <div className="flex flex-wrap gap-2">
          {scene.videoKeywords.split(",").map((kw, i) => (
            <span key={i} className="text-[9px] font-bold text-white/30 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 uppercase tracking-widest">#{kw.trim()}</span>
          ))}
        </div>
      </div>

      <motion.div 
        whileHover={{ scale: 1.05, rotateZ: 1 }}
        transition={{ duration: 0.8 }}
        className="relative aspect-video bg-zinc-900 rounded-[2rem] overflow-hidden border border-white/10 group shadow-2xl order-1 lg:order-2"
      >
         <img src={imageUrl} alt="" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all duration-1000 scale-110 group-hover:scale-100" />
         <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
         <div className="absolute bottom-6 left-6 right-6 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1 flex items-center gap-2">
               <Sparkles className="w-3 h-3" /> Visual Blueprint
            </p>
            <p className="text-[10px] font-medium text-white/60 italic line-clamp-2">{scene.visualPrompt}</p>
         </div>
            </motion.div>
          </motion.div>
        );
      }
      