"use client";

import { useState } from "react";
import { generateContent, ContentPlan, Scene } from "./actions";
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
  Github
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
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
            <h1 className="font-black text-2xl tracking-tighter text-white uppercase italic">NeuroStudio</h1>
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
        {/* Landing Page (Visible if no plan and not loading) */}
        {!plan && !isGenerating && (
          <motion.section 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-20 mb-20"
          >
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-bold text-zinc-400">
                <Zap className="w-3 h-3 text-yellow-500 fill-current" />
                <span>Nouveau : NeuroDirector PRO est arrivé</span>
              </div>
              <h2 className="text-6xl md:text-8xl font-black tracking-tight leading-[0.9] text-balance">
                VOTRE VISION, <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-purple-400 to-pink-500">
                  ACCÉLÉRÉE PAR L'IA.
                </span>
              </h2>
              <p className="text-zinc-400 text-lg md:text-2xl max-w-3xl mx-auto leading-relaxed font-medium">
                Passez d'une idée brute à un plan de production complet en un clin d'œil. 
                Scénarisation, storyboarding et recherche de stock clips, tout-en-un.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 text-left">
              {[
                { 
                  icon: MessageSquareText, 
                  title: "Scripts Narratifs", 
                  desc: "Des scripts optimisés pour la rétention, écrits par des modèles entraînés sur les meilleures productions.",
                  color: "text-indigo-400"
                },
                { 
                  icon: Wand2, 
                  title: "Storyboarding Visuel", 
                  desc: "Visualisez instantanément l'esthétique de votre projet avec des rendus IA de haute qualité.",
                  color: "text-purple-400"
                },
                { 
                  icon: MonitorPlay, 
                  title: "Accès Stock Média", 
                  desc: "Gagnez des heures de recherche avec des suggestions de clips Pexels synchronisées sur vos scènes.",
                  color: "text-pink-400"
                }
              ].map((feature, i) => (
                <div key={i} className="group p-8 bg-zinc-900/40 border border-zinc-800 rounded-3xl hover:bg-zinc-900/60 transition-all duration-300 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-150 transition-transform">
                    <feature.icon className="w-24 h-24" />
                  </div>
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
            <div className="absolute -inset-2 bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 rounded-[2rem] blur-xl opacity-20 group-hover:opacity-40 transition duration-1000"></div>
            <div className="relative bg-zinc-900/90 backdrop-blur-md p-3 rounded-[2rem] border border-zinc-800 shadow-3xl">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 flex items-center px-6">
                  <Play className="w-5 h-5 text-zinc-600 mr-3 fill-current" />
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                    placeholder="Ex: Documentaire sur Mars, Tuto Web3, Histoire de l'IA..."
                    className="w-full bg-transparent py-4 outline-none placeholder:text-zinc-600 text-xl font-bold"
                    disabled={isGenerating}
                  />
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !topic.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white px-10 py-4 rounded-[1.5rem] font-black uppercase tracking-widest text-sm transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3"
                >
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                  {isGenerating ? "Processing..." : "Lancer"}
                </button>
              </div>
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-6 text-center font-bold uppercase tracking-tighter">{error}</p>}
        </section>

        {/* Loader Simulation */}
        {isGenerating && (
          <div className="max-w-2xl mx-auto space-y-12 py-20">
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em]">Phase de Création</p>
                  <p className="text-2xl font-black italic uppercase">{loadingSteps[loadingStep]}</p>
                </div>
                <span className="text-4xl font-black tabular-nums text-zinc-800">
                  {Math.round(((loadingStep + 1) / loadingSteps.length) * 100)}%
                </span>
              </div>
              <div className="h-4 w-full bg-zinc-900 rounded-full overflow-hidden p-1 border border-zinc-800">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${((loadingStep + 1) / loadingSteps.length) * 100}%` }}
                  className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full shadow-[0_0_20px_rgba(99,102,241,0.5)]"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 opacity-50 grayscale">
               {[1,2,3].map(i => (
                 <div key={i} className="aspect-square bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-zinc-800" />
                 </div>
               ))}
            </div>
          </div>
        )}

        {/* Content View */}
        <AnimatePresence>
          {plan && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-16"
            >
              {/* Toolbar */}
              <div className="bg-zinc-900/80 backdrop-blur-2xl border border-zinc-800 rounded-[2.5rem] p-10 flex flex-col md:flex-row justify-between items-center gap-10 shadow-3xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:rotate-12 transition-transform duration-1000">
                  <Sparkles className="w-40 h-40" />
                </div>
                <div className="text-center md:text-left relative">
                  <div className="flex items-center gap-4 mb-4 justify-center md:justify-start">
                    <span className="text-[11px] font-black text-white uppercase tracking-[0.3em] bg-indigo-600 px-4 py-1.5 rounded-full shadow-lg shadow-indigo-500/40">
                      {plan.category}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Project Archive 2026</span>
                  </div>
                  <h3 className="text-4xl md:text-6xl font-black tracking-tighter italic uppercase text-white leading-none">
                    {plan.title}
                  </h3>
                </div>
                <div className="flex gap-4 relative">
                  <button 
                    onClick={exportToMarkdown}
                    className="flex items-center gap-3 px-8 py-5 bg-white text-black hover:bg-zinc-200 rounded-2xl transition-all font-black uppercase tracking-widest text-xs shadow-2xl"
                  >
                    <Download className="w-5 h-5" />
                    Exporter .MD
                  </button>
                </div>
              </div>

              {/* Storyboard Grid */}
              <div className="space-y-12">
                <div className="flex items-center gap-6">
                  <h4 className="text-xs font-black uppercase tracking-[0.5em] text-zinc-500 whitespace-nowrap">Production Timeline</h4>
                  <div className="h-px w-full bg-zinc-900" />
                </div>

                {plan.scenes.map((scene, index) => (
                  <SceneCard 
                    key={scene.id} 
                    scene={scene} 
                    index={index} 
                    onUpdate={(field, val) => updateScene(scene.id, field, val)} 
                  />
                ))}
              </div>

              {/* Bottom Nav */}
              <div className="flex flex-col items-center gap-8 py-20 border-t border-zinc-900">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-px bg-zinc-900" />
                  <Sparkles className="w-5 h-5 text-indigo-500" />
                  <div className="w-12 h-px bg-zinc-900" />
                </div>
                <button 
                  onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setPlan(null); }}
                  className="px-10 py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-2xl text-[10px] font-black uppercase tracking-[0.4em] transition-all hover:scale-105 active:scale-95 shadow-xl"
                >
                  Démarrer un nouveau projet
                </button>
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
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt)}?width=1280&height=720&nologo=true&model=flux`;

  const toggleAudio = () => {
    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(scene.voiceOver);
    utterance.lang = "fr-FR";
    utterance.onend = () => setIsPlaying(false);
    
    setIsPlaying(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="grid lg:grid-cols-[1fr,450px] gap-8 bg-zinc-900/30 border border-zinc-800/50 rounded-[2.5rem] p-8 hover:bg-zinc-900/50 hover:border-indigo-500/30 transition-all duration-500 group shadow-2xl"
    >
      {/* Content */}
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 flex items-center justify-center bg-indigo-600 rounded-2xl text-white font-black italic shadow-lg shadow-indigo-500/20">
              {index + 1}
            </span>
            <div>
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest leading-none mb-1">Scène</p>
              <div className="flex items-center gap-2">
                <input 
                  type="number"
                  value={scene.duration}
                  onChange={(e) => onUpdate("duration", e.target.value)}
                  className="w-8 bg-transparent text-lg font-black font-mono outline-none text-white focus:text-indigo-400 transition-colors"
                />
                <span className="text-xs font-bold text-zinc-600 uppercase tracking-tighter">secondes</span>
              </div>
            </div>
          </div>
          <button 
            onClick={toggleAudio}
            className={clsx(
              "flex items-center gap-3 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl",
              isPlaying 
                ? "bg-red-500/10 text-red-500 border border-red-500/20 shadow-red-500/10" 
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
            )}
          >
            {isPlaying ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Stop</>
            ) : (
              <><Play className="w-4 h-4 fill-current" /> Lecture Voix</>
            )}
          </button>
        </div>

        <div className="relative flex-1 group/text">
          <textarea
            value={scene.voiceOver}
            onChange={(e) => onUpdate("voiceOver", e.target.value)}
            className="w-full h-full min-h-[160px] bg-transparent text-xl md:text-2xl leading-relaxed text-white font-bold outline-none resize-none placeholder:text-zinc-800 focus:bg-white/5 p-4 rounded-3xl transition-all italic"
            placeholder="Écriture du script..."
          />
          <div className="absolute top-0 -left-4 w-1 h-0 bg-indigo-500 rounded-full group-hover/text:h-full transition-all duration-700" />
        </div>

        <div className="space-y-6 pt-6 border-t border-zinc-800/50">
          <div className="flex flex-wrap gap-2">
            {scene.videoKeywords.split(",").map((kw, i) => (
              <a 
                key={i} 
                href={`https://www.pexels.com/fr-fr/chercher/video/${encodeURIComponent(kw.trim())}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-zinc-500 font-black bg-zinc-950 px-3 py-1.5 rounded-full border border-zinc-800 uppercase tracking-widest hover:border-indigo-500 hover:text-white transition-all shadow-sm"
              >
                #{kw.trim()}
              </a>
            ))}
          </div>
          <a 
            href={`https://www.pexels.com/fr-fr/chercher/video/${encodeURIComponent(scene.videoKeywords)}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 text-[10px] font-black text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-5 py-3 rounded-xl border border-white/5 transition-all uppercase tracking-[0.2em] shadow-lg"
          >
            <MonitorPlay className="w-4 h-4" />
            Library Pexels
          </a>
        </div>
      </div>

      {/* Media Preview */}
      <div className="relative aspect-[9/12] lg:aspect-auto bg-zinc-950 rounded-[2rem] overflow-hidden border-4 border-zinc-800 shadow-3xl group/media">
        <img
          src={imageUrl}
          alt={scene.visualPrompt}
          className="w-full h-full object-cover transition-transform duration-1000 group-hover/media:scale-110 group-hover/media:rotate-1"
          loading="lazy"
        />
        
        {/* Visual Prompt Badge */}
        <div className="absolute bottom-6 inset-x-6">
          <div className="bg-black/80 backdrop-blur-xl p-6 rounded-2xl border border-white/10 shadow-2xl translate-y-4 opacity-0 group-hover/media:translate-y-0 group-hover/media:opacity-100 transition-all duration-500">
            <div className="flex items-center gap-2 text-indigo-400 mb-3">
              <Sparkles className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em]">AI Visual Blueprint</span>
            </div>
            <p className="text-xs text-zinc-300 font-medium leading-relaxed italic line-clamp-4">
              {scene.visualPrompt}
            </p>
          </div>
        </div>

        <div className="absolute top-6 right-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl text-[10px] font-black text-white flex gap-2 items-center border border-white/10 shadow-2xl">
           <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
           <span className="uppercase tracking-widest">Live Studio</span>
        </div>
      </div>
    </motion.div>
  );
}