"use client";

import { useState } from "react";
import { generateContent, ContentPlan, Scene } from "./actions";
import { Copy, Clapperboard, Download, Loader2, Play, Image as ImageIcon, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import clsx from "clsx";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
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
      setError("Erreur : Vérifiez votre clé API Groq ou réessayez.");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-400">
            <Sparkles className="w-6 h-6" />
            <h1 className="font-bold text-xl tracking-tight text-white">NeuroStudio</h1>
          </div>
          <div className="text-sm text-zinc-500">Free Edition</div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Input Section */}
        <section className="text-center space-y-6 mb-16">
          <h2 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">
            Créez du contenu sans limite.
          </h2>
          <p className="text-zinc-400 text-lg">
            Entrez un sujet, NeuroStudio écrit le script et génère les visuels.
          </p>
          
          <div className="relative max-w-xl mx-auto group">
            <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-200"></div>
            <div className="relative flex gap-2 bg-zinc-900 p-2 rounded-lg border border-zinc-800">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="Ex: Les secrets des pyramides, Tutoriel Python..."
                className="flex-1 bg-transparent px-4 py-2 outline-none placeholder:text-zinc-600"
                disabled={isGenerating}
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-md font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Génération...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" /> Go
                  </>
                )}
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </section>

        {/* Results Section */}
        <AnimatePresence>
          {plan && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {/* Title Card */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex justify-between items-start">
                <div>
                  <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1">{plan.category}</div>
                  <h3 className="text-2xl font-bold">{plan.title}</h3>
                </div>
                <button className="text-zinc-500 hover:text-white transition-colors" title="Télécharger le script">
                  <Download className="w-5 h-5" />
                </button>
              </div>

              {/* Timeline */}
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium uppercase tracking-widest pl-2">
                  <Clapperboard className="w-4 h-4" /> Timeline de Production
                </div>

                {plan.scenes.map((scene, index) => (
                  <SceneCard key={scene.id} scene={scene} index={index} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

function SceneCard({ scene, index }: { scene: Scene; index: number }) {
  // Construction de l'URL Pollinations
  // On ajoute un seed aléatoire ou fixe pour garder la cohérence si besoin, ici simple prompt
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.visualPrompt)}?width=1280&height=720&nologo=true&model=flux`;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
      className="grid md:grid-cols-2 gap-6 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 overflow-hidden group hover:border-zinc-700 transition-colors"
    >
      {/* Script Side */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="bg-zinc-800 text-zinc-400 text-xs font-mono px-2 py-1 rounded">
            Scène {index + 1}
          </span>
          <span className="text-zinc-500 text-xs font-mono">{scene.duration}s</span>
        </div>
        <p className="text-lg leading-relaxed text-zinc-200">
          {scene.voiceOver}
        </p>
        <div className="mt-auto pt-4 border-t border-zinc-800/50 flex gap-2">
           <div className="text-xs text-zinc-500 font-mono bg-zinc-950 px-2 py-1 rounded border border-zinc-800">
              Mots-clés vidéo: {scene.videoKeywords}
           </div>
        </div>
      </div>

      {/* Visual Side */}
      <div className="relative aspect-video bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 shadow-inner">
        {/* L'image se génère automatiquement via l'URL */}
        <img
          src={imageUrl}
          alt={scene.visualPrompt}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3 translate-y-full group-hover:translate-y-0 transition-transform">
          <p className="text-[10px] text-zinc-300 line-clamp-2 italic">
            Prompt: {scene.visualPrompt}
          </p>
        </div>
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] text-white flex gap-1 items-center">
           <ImageIcon className="w-3 h-3" /> IA Generated
        </div>
      </div>
    </motion.div>
  );
}