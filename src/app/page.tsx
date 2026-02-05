"use client";

import { useState } from "react";
import { 
  Clapperboard, 
  Download, 
  Loader2, 
  Play, 
  Image as ImageIcon, 
  Sparkles, 
  Wand2, 
  Zap, 
  MonitorPlay, 
  MessageSquareText,
  ChevronRight,
  Github,
  Save,
  CheckCircle2,
  History,
  LayoutGrid,
  FileDown
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
  const [loadingStep, setLoadingStep] = useState(0);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"studio" | "archive">("studio");

  const loadingSteps = [
    "NEURAL SYNAPSE ANALYSIS...",
    "CONSTRUCTING NARRATIVE ARC...",
    "DREAMING VISUAL ASSETS...",
    "CALIBRATING CINEMATIC LIGHTING...",
    "FINALIZING PRODUCTION METADATA..."
  ];

  const masterExport = async () => {
    if (!plan) return;
    setIsExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const element = document.createElement("div");
      element.innerHTML = `
        <div style="padding: 60px; font-family: 'Helvetica', 'Arial', sans-serif; color: #000; background: #fff; max-width: 800px; margin: auto;">
          <div style="border-bottom: 4px solid #000; padding-bottom: 20px; margin-bottom: 40px;">
            <h1 style="font-size: 56px; font-weight: 900; text-transform: uppercase; line-height: 0.9; margin: 0; letter-spacing: -2px;">${plan.title}</h1>
            <p style="font-size: 14px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 4px; margin-top: 15px;">${plan.category} • PRODUCTION DOCKET</p>
          </div>
          
          <div style="display: grid; gap: 50px;">
            ${plan.scenes.map((s, i) => `
              <div style="page-break-inside: avoid; border-bottom: 1px solid #eee; padding-bottom: 40px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                  <span style="font-size: 11px; font-weight: 900; background: #000; color: #fff; padding: 5px 15px; border-radius: 2px; text-transform: uppercase;">SCENE 0${i + 1}</span>
                  <span style="font-size: 11px; color: #999; font-weight: 700;">TIMING: ${s.duration}S</span>
                </div>
                <p style="font-size: 26px; font-weight: 800; font-style: italic; line-height: 1.1; margin-bottom: 30px; letter-spacing: -1px;">"${s.voiceOver}"</p>
                <div style="background: #f9f9f9; border-radius: 20px; overflow: hidden; margin-bottom: 20px; border: 1px solid #eee;">
                  <img src="https://image.pollinations.ai/prompt/${encodeURIComponent(s.visualPrompt)}?width=800&height=450&nologo=true&model=flux" style="width: 100%; display: block;" />
                </div>
                <div style="display: grid; grid-template-cols: 1fr 1fr; gap: 20px;">
                  <div>
                    <p style="font-size: 9px; font-weight: 900; text-transform: uppercase; color: #aaa; margin-bottom: 5px;">Visual Prompt</p>
                    <p style="font-size: 10px; color: #666; font-style: italic; line-height: 1.4;">${s.visualPrompt}</p>
                  </div>
                  <div>
                    <p style="font-size: 9px; font-weight: 900; text-transform: uppercase; color: #aaa; margin-bottom: 5px;">Stock Keywords</p>
                    <p style="font-size: 10px; color: #6366f1; font-weight: 700;">${s.videoKeywords.toUpperCase()}</p>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
          
          <div style="margin-top: 60px; text-align: center; border-top: 1px solid #000; padding-top: 30px;">
            <p style="font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 5px; color: #000;">NEUROSTUDIO PRO • ARCHIVE SYSTEM 2026</p>
          </div>
        </div>
      `;

      const opt = {
        margin: 0,
        filename: `${plan.title.replace(/\s+/g, "_")}_MASTER_DOCKET.pdf`,
        image: { type: 'jpeg', quality: 1.0 },
        html2canvas: { scale: 4, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().from(element).set(opt).save();
    } catch (err) {
      console.error(err);
      alert("Export System Error.");
    } finally {
      setIsExporting(false);
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
      console.error(err);
      setError("Cloud Sync Failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setIsGenerating(true);
    setError("");
    setPlan(null);
    setLoadingStep(0);

    const interval = setInterval(() => {
      setLoadingStep(prev => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
    }, 2500);

    try {
      const result = await generateContent(topic);
      setPlan(result);
    } catch (err) {
      setError("AI Engine Overloaded. Try again.");
      console.error(err);
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
    }
  };

  const updateScene = (id: number, field: keyof Scene, value: string | number) => {
    if (!plan) return;
    const newScenes = plan.scenes.map(s => 
      s.id === id ? { ...s, [field]: value } : s
    );
    setPlan({ ...plan, scenes: newScenes });
  };

  return (
    <main className="min-h-screen bg-black text-white selection:bg-indigo-500/50 antialiased font-sans overflow-hidden">
      <div className="grain-overlay" />
      
      {/* Navigation */}
      <nav className="fixed left-0 top-0 h-full w-20 border-r border-white/5 bg-black/40 backdrop-blur-3xl z-50 flex flex-col items-center py-10 gap-10">
        <div className="w-12 h-12 bg-white flex items-center justify-center rounded-2xl shadow-[0_0_20px_rgba(255,255,255,0.2)]">
          <Sparkles className="text-black w-6 h-6" />
        </div>
        <div className="flex flex-col gap-6">
          <NavIcon icon={LayoutGrid} active={activeTab === "studio"} onClick={() => setActiveTab("studio")} label="Studio" />
          <NavIcon icon={History} active={activeTab === "archive"} onClick={() => setActiveTab("archive")} label="Archives" />
        </div>
        <div className="mt-auto">
          <a href="https://github.com/Riotlagrinta/neuro-studio" target="_blank">
            <Github className="w-5 h-5 text-zinc-600 hover:text-white transition-colors" />
          </a>
        </div>
      </nav>

      <div className="pl-20 relative z-10">
        <header className="h-20 border-b border-white/5 bg-black/20 backdrop-blur-md px-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
             <span className="text-[10px] font-black tracking-[0.4em] text-zinc-500 uppercase">System Status</span>
             <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
               <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
               <span className="text-[9px] font-black text-green-500 uppercase tracking-widest text-shadow-glow">Llama-3-Neural-Active</span>
             </div>
          </div>
          <div className="text-[11px] font-black tracking-widest uppercase italic text-white/40">
            NeuroStudio <span className="text-white">Professional v2.4</span>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-10 py-20">
          {activeTab === "studio" && (
            <>
              {!plan && !isGenerating && (
                <motion.section initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-24 mb-32">
                  <div className="space-y-10">
                    <h2 className="text-[12vw] font-black leading-[0.8] tracking-tighter uppercase italic">
                      Vision <br />
                      <span className="text-zinc-800">Unleashed</span>
                    </h2>
                    <p className="text-zinc-500 text-2xl md:text-3xl max-w-2xl font-light leading-relaxed">
                      AI-driven production engine for the next generation of storytellers.
                    </p>
                  </div>
                  <div className="flex flex-col md:flex-row gap-16 border-t border-white/5 pt-16">
                    <FeatureBlock number="01" title="Neural Scripts" text="AI models fine-tuned for high-retention cinematic storytelling." />
                    <FeatureBlock number="02" title="Photoreal Story" text="Instant visualization via multi-modal diffusion engines." />
                    <FeatureBlock number="03" title="Cloud Backbone" text="Ultra-secure storage for your creative intellectual property." />
                  </div>
                </motion.section>
              )}

              <section className={clsx("transition-all duration-1000 ease-in-out", plan ? "mb-16" : "mb-20")}>
                <div className="relative max-w-4xl group">
                  <div className="bg-zinc-900/40 border border-white/10 p-6 rounded-[2.5rem] backdrop-blur-2xl shadow-3xl">
                    <div className="flex flex-col sm:flex-row gap-6">
                      <div className="flex-1 flex items-center px-4">
                        <Wand2 className="w-6 h-6 text-indigo-500 mr-6" />
                        <input
                          type="text"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                          placeholder="INPUT CREATIVE BRIEF..."
                          className="w-full bg-transparent py-4 outline-none placeholder:text-zinc-800 text-2xl font-black uppercase tracking-tighter italic"
                          disabled={isGenerating}
                        />
                      </div>
                      <button
                        onClick={handleGenerate}
                        disabled={isGenerating || !topic.trim()}
                        className="bg-white text-black hover:bg-zinc-200 px-12 py-5 rounded-[1.8rem] font-black uppercase tracking-[0.2em] text-xs transition-all flex items-center justify-center gap-4"
                      >
                        {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : "Initiate Engine"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {isGenerating && (
                <div className="py-32 space-y-16">
                  <div className="space-y-4 text-center">
                     <span className="text-[12px] font-black tracking-[0.5em] text-indigo-500 uppercase animate-pulse">{loadingSteps[loadingStep]}</span>
                     <div className="h-[1px] w-full bg-white/5 mt-10">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${((loadingStep + 1) / loadingSteps.length) * 100}%` }} className="h-full bg-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.5)]" />
                     </div>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {plan && (
                  <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="space-y-32 pb-40">
                    <div className="flex flex-col md:flex-row justify-between items-end gap-10">
                      <div className="space-y-4">
                        <span className="text-[11px] font-black uppercase tracking-[0.6em] text-indigo-500">{plan.category}</span>
                        <h3 className="text-6xl md:text-8xl font-black tracking-tighter uppercase leading-[0.85] italic">
                          {plan.title}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        <ActionButton icon={Save} onClick={handleSave} loading={isSaving} active={saveSuccess} label={saveSuccess ? "Synced" : "Cloud Save"} />
                        <ActionButton icon={FileDown} onClick={masterExport} loading={isExporting} label={isExporting ? "Exporting..." : "Master Export"} />
                      </div>
                    </div>

                    <div className="grid gap-40">
                      {plan.scenes.map((scene, index) => (
                        <SceneStudio key={scene.id} scene={scene} index={index} onUpdate={updateScene} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {activeTab === "archive" && (
            <div className="py-20 text-center space-y-10">
               <h2 className="text-6xl font-black italic opacity-20 uppercase tracking-tighter">Under Construction</h2>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function NavIcon({ icon: Icon, active, onClick, label }: any) {
  return (
    <button onClick={onClick} className="group relative">
      <Icon className={clsx("w-6 h-6 transition-all duration-500", active ? "text-white" : "text-zinc-700 hover:text-zinc-400")} />
      {active && <motion.div layoutId="nav-glow" className="absolute -inset-4 bg-white/5 rounded-2xl blur-md -z-10" />}
      <span className="absolute left-16 top-1/2 -translate-y-1/2 bg-white text-black text-[9px] font-black px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}

function FeatureBlock({ number, title, text }: any) {
  return (
    <div className="flex-1 space-y-4 group">
      <div className="text-[10px] font-black text-indigo-500 font-mono">{number}</div>
      <h4 className="text-xl font-black uppercase italic tracking-tight group-hover:text-indigo-400 transition-colors">{title}</h4>
      <p className="text-zinc-600 text-sm leading-relaxed font-medium">{text}</p>
    </div>
  );
}

function ActionButton({ icon: Icon, onClick, loading, active, label }: any) {
  return (
    <button 
      onClick={onClick}
      disabled={loading}
      className={clsx(
        "flex items-center gap-3 px-8 py-5 rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] transition-all border",
        active ? "bg-indigo-600 border-indigo-500" : "bg-white/5 border-white/10 hover:bg-white/10 shadow-2xl"
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {label}
    </button>
  );
}

function SceneStudio({ scene, index, onUpdate }: any) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt)}?width=1280&height=720&nologo=true&model=flux`;

  const playAudio = async () => {
    if (isPlaying) return;
    setLoadingAudio(true);
    try {
      const base64Audio = await getElevenLabsAudio(scene.voiceOver);
      const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
      audio.onended = () => setIsPlaying(false);
      setIsPlaying(true);
      audio.play();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAudio(false);
    }
  };

  return (
    <div className="group relative grid lg:grid-cols-[1.2fr,1fr] gap-20 items-center">
      <div className="space-y-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-[10px] font-black text-indigo-500 font-mono tracking-widest uppercase">Index 0{index + 1}</span>
            <div className="flex items-center gap-2">
              <input 
                type="number"
                value={scene.duration}
                onChange={(e) => onUpdate(scene.id, "duration", e.target.value)}
                className="w-8 bg-transparent text-xl font-black text-white focus:text-indigo-500 transition-colors outline-none italic"
              />
              <span className="text-[9px] font-black text-zinc-700 tracking-[0.2em] uppercase">Secs</span>
            </div>
          </div>
          <button 
            onClick={playAudio}
            className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/5 rounded-full transition-all group-hover:border-indigo-500/30 shadow-xl"
          >
            {loadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : (isPlaying ? <div className="w-3 h-3 bg-indigo-500 rounded-sm animate-pulse shadow-[0_0_10px_indigo]" /> : <Play className="w-4 h-4 fill-white" />)}
          </button>
        </div>
        <textarea
          value={scene.voiceOver}
          onChange={(e) => onUpdate(scene.id, "voiceOver", e.target.value)}
          className="w-full bg-transparent text-3xl md:text-5xl font-black leading-[1.1] tracking-tighter text-white outline-none resize-none italic placeholder:text-zinc-900 transition-all hover:text-zinc-300"
          rows={4}
        />
        <div className="flex flex-wrap gap-4 opacity-40 group-hover:opacity-100 transition-opacity">
           {scene.videoKeywords.split(",").map((kw: string, i: number) => (
             <span key={i} className="text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white cursor-pointer transition-colors">#{kw.trim()}</span>
           ))}
        </div>
      </div>
      <div className="relative aspect-[4/5] bg-zinc-950 rounded-[3rem] overflow-hidden border border-white/5 shadow-3xl group-hover:border-indigo-500/20 transition-all duration-700">
        <img src={imageUrl} alt={scene.visualPrompt} className="w-full h-full object-cover grayscale-[0.5] group-hover:grayscale-0 transition-all duration-1000 scale-105 group-hover:scale-100" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
        <div className="absolute bottom-10 left-10 right-10 space-y-4 translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
           <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white">Visual Blueprint</span>
           </div>
           <p className="text-xs font-medium text-zinc-400 leading-relaxed italic line-clamp-3">{scene.visualPrompt}</p>
        </div>
      </div>
    </div>
  );
}