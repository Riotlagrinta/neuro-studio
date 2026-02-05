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
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { generateContent, ContentPlan, Scene, saveProject, getElevenLabsAudio } from "./actions";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [error, setError] = useState("");

  const loadingSteps = [
    "Analyse du sujet par NeuroDirector...",
    "Écriture du script à fort impact...",
    "Conception du storyboard cinématographique...",
    "Optimisation des prompts visuels IA...",
    "Génération finale du plan de production..."
  ];

  const handleSave = async () => {
    if (!plan || !topic) return;
    setIsSaving(true);
    try {
      await saveProject(topic, plan);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setError("Erreur lors de la sauvegarde dans le Cloud.");
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
      setError("Désolé, une erreur est survenue lors de la création.");
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

  const exportToMarkdown = () => {
    if (!plan) return;

    const content = `# ${plan.title}
Catégorie : ${plan.category}

${plan.scenes.map((s, i) => `## Scène ${i + 1} (${s.duration}s)
**Voix-off :**
${s.voiceOver}

**Visuel (Prompt IA) :**
${s.visualPrompt}

**Mots-clés :** ${s.videoKeywords}
---`).join("\n\n")}

Généré par NeuroStudio`;

    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${plan.title.replace(/\s+/g, "_")}_script.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500/30 font-sans antialiased">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div 
            className="flex items-center gap-3 group cursor-pointer" 
            onClick={() => setPlan(null)}
          >
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="font-black text-2xl tracking-tighter text-white uppercase italic text-shadow-glow">NeuroStudio</h1>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/Riotlagrinta/neuro-studio" target="_blank" className="text-zinc-400 hover:text-white transition-colors">
              <Github className="w-5 h-5" />
            </a>
            <div className="hidden sm:block h-8 w-px bg-zinc-800" />
            <div className="px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-black text-indigo-400 uppercase tracking-widest">
              AI Powered Production
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-16 relative">
        {/* Landing Page */}
        {!plan && !isGenerating && (
          <motion.section 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-20 mb-20"
          >
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-bold text-zinc-400">
                <Zap className="w-3 h-3 text-yellow-500 fill-current" />
                <span>Nouveau : ElevenLabs + Supabase Cloud</span>
              </div>
              <h2 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.9] text-balance">
                VOTRE VISION, <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-purple-400 to-pink-500 font-black">
                  ACCÉLÉRÉE PAR L'IA.
                </span>
              </h2>
              <p className="text-zinc-400 text-lg md:text-2xl max-w-3xl mx-auto leading-relaxed font-medium">
                Créez, sauvegardez dans le cloud et donnez vie à vos scripts avec des voix ultra-réalistes.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 text-left">
              {[
                { icon: MessageSquareText, title: "Scripts Narratifs", desc: "Des scripts optimisés pour la rétention, écrits par des modèles experts.", color: "text-indigo-400" },
                { icon: Save, title: "Cloud Sync", desc: "Sauvegardez vos projets instantanément sur votre base de données Supabase.", color: "text-purple-400" },
                { icon: Play, title: "Voix ElevenLabs", desc: "Transformez vos textes en voix humaines avec la meilleure technologie TTS au monde.", color: "text-pink-400" }
              ].map((feature, i) => (
                <div key={i} className="group p-8 bg-zinc-900/40 border border-zinc-800 rounded-3xl hover:bg-zinc-900/60 transition-all duration-300 relative overflow-hidden shadow-2xl">
                  <feature.icon className={clsx("w-10 h-10 mb-6", feature.color)} />
                  <h3 className="font-black text-xl mb-3 uppercase tracking-tight">{feature.title}</h3>
                  <p className="text-zinc-500 leading-relaxed font-medium">{feature.desc}</p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Search Input */}
        <section className={clsx("max-w-3xl mx-auto transition-all duration-1000", plan ? "mb-16" : "mb-24")}>
          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 rounded-[2.5rem] blur-xl opacity-20 group-hover:opacity-40 transition duration-1000"></div>
            <div className="relative bg-zinc-900/90 backdrop-blur-md p-4 rounded-[2.5rem] border border-zinc-800 shadow-3xl">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 flex items-center px-6">
                  <Wand2 className="w-5 h-5 text-indigo-400 mr-4" />
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                    placeholder="De quoi parle votre prochaine vidéo ?"
                    className="w-full bg-transparent py-4 outline-none placeholder:text-zinc-600 text-xl font-bold"
                    disabled={isGenerating}
                  />
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !topic.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white px-10 py-4 rounded-[1.8rem] font-black uppercase tracking-widest text-sm transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3"
                >
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                  {isGenerating ? "Processing..." : "Lancer"}
                </button>
              </div>
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-6 text-center font-bold uppercase tracking-tighter">{error}</p>}
        </section>

        {/* Loading State */}
        {isGenerating && (
          <div className="max-w-2xl mx-auto space-y-12 py-20">
            <div className="space-y-6 text-center">
              <p className="text-2xl font-black italic uppercase text-indigo-400 animate-pulse">{loadingSteps[loadingStep]}</p>
              <div className="h-4 w-full bg-zinc-900 rounded-full overflow-hidden p-1 border border-zinc-800 shadow-inner">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${((loadingStep + 1) / loadingSteps.length) * 100}%` }}
                  className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* Results Section */}
        <AnimatePresence>
          {plan && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-16"
            >
              {/* Toolbar */}
              <div className="bg-zinc-900/80 backdrop-blur-2xl border border-zinc-800 rounded-[2.5rem] p-10 flex flex-col md:flex-row justify-between items-center gap-10 shadow-3xl">
                <div className="text-center md:text-left">
                  <div className="flex items-center gap-4 mb-4 justify-center md:justify-start">
                    <span className="text-[11px] font-black text-white uppercase tracking-[0.3em] bg-indigo-600 px-4 py-1.5 rounded-full shadow-lg">
                      {plan.category}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Live Production</span>
                  </div>
                  <h3 className="text-4xl md:text-6xl font-black tracking-tighter italic uppercase text-white leading-none">
                    {plan.title}
                  </h3>
                </div>
                <div className="flex flex-wrap justify-center gap-4">
                  <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className={clsx(
                      "flex items-center gap-3 px-8 py-5 rounded-2xl transition-all font-black uppercase tracking-widest text-xs shadow-2xl border",
                      saveSuccess 
                        ? "bg-green-600 text-white border-green-500" 
                        : "bg-zinc-800 text-white hover:bg-zinc-700 border-zinc-700"
                    )}
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : (saveSuccess ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />)}
                    {saveSuccess ? "Sauvegardé !" : (isSaving ? "Sauvegarde..." : "Cloud Save")}
                  </button>
                  <button 
                    onClick={exportToMarkdown}
                    className="flex items-center gap-3 px-8 py-5 bg-white text-black hover:bg-zinc-200 rounded-2xl transition-all font-black uppercase tracking-widest text-xs shadow-2xl"
                  >
                    <Download className="w-5 h-5" />
                    Exporter .MD
                  </button>
                </div>
              </div>

              {/* Timeline */}
              <div className="space-y-12">
                {plan.scenes.map((scene, index) => (
                  <SceneCard 
                    key={scene.id} 
                    scene={scene} 
                    index={index} 
                    onUpdate={(field, val) => updateScene(scene.id, field, val)} 
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

function SceneCard({ scene, index, onUpdate }: { scene: Scene; index: number; onUpdate: (field: keyof Scene, val: string) => void }) {
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
      alert("Erreur lors du chargement de la voix ElevenLabs");
    } finally {
      setLoadingAudio(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="grid lg:grid-cols-[1fr,450px] gap-8 bg-zinc-900/30 border border-zinc-800/50 rounded-[2.5rem] p-8 hover:bg-zinc-900/50 hover:border-indigo-500/30 transition-all duration-500 shadow-2xl"
    >
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 flex items-center justify-center bg-indigo-600 rounded-2xl text-white font-black italic shadow-lg">
              {index + 1}
            </span>
            <div className="flex items-center gap-2">
              <input 
                type="number"
                value={scene.duration}
                onChange={(e) => onUpdate("duration", e.target.value)}
                className="w-8 bg-transparent text-lg font-black font-mono outline-none text-white focus:text-indigo-400"
              />
              <span className="text-[10px] font-black text-zinc-600 uppercase">sec</span>
            </div>
          </div>
          <button 
            onClick={playAudio}
            disabled={loadingAudio || isPlaying}
            className={clsx(
              "flex items-center gap-3 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all",
              isPlaying 
                ? "bg-indigo-600 text-white" 
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
            )}
          >
            {loadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : (isPlaying ? <Zap className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />)}
            {loadingAudio ? "Chargement..." : (isPlaying ? "Voix Active" : "ElevenLabs Voice")}
          </button>
        </div>

        <textarea
          value={scene.voiceOver}
          onChange={(e) => onUpdate("voiceOver", e.target.value)}
          className="w-full h-full min-h-[160px] bg-transparent text-xl md:text-2xl leading-relaxed text-white font-bold outline-none resize-none italic p-4 rounded-3xl focus:bg-white/5 transition-all"
        />

        <div className="pt-6 border-t border-zinc-800/50 flex flex-wrap gap-2">
            {scene.videoKeywords.split(",").map((kw, i) => (
              <a 
                key={i} 
                href={`https://www.pexels.com/fr-fr/chercher/video/${encodeURIComponent(kw.trim())}/`}
                target="_blank"
                className="text-[9px] text-zinc-500 font-black bg-zinc-950 px-3 py-1.5 rounded-full border border-zinc-800 uppercase tracking-widest hover:border-indigo-500 hover:text-white transition-all shadow-sm"
              >
                #{kw.trim()}
              </a>
            ))}
        </div>
      </div>

      <div className="relative aspect-[16/9] lg:aspect-auto bg-zinc-950 rounded-[2rem] overflow-hidden border-4 border-zinc-800 shadow-3xl group">
        <img
          src={imageUrl}
          alt={scene.visualPrompt}
          className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent p-8 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity">
           <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-2">Visual Blueprint</p>
           <p className="text-xs text-zinc-300 italic font-medium leading-relaxed">{scene.visualPrompt}</p>
        </div>
      </div>
    </motion.div>
  );
}