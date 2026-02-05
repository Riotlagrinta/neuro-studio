"use client";

import { useEffect, useState } from "react";
import { getProjects } from "../actions";
import { 
  Sparkles, 
  ChevronLeft, 
  History, 
  Calendar, 
  ExternalLink,
  Loader2,
  Github
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function ArchivesPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-indigo-500/30">
      <header className="h-16 border-b border-[#1a1a1a] bg-black/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-8">
        <Link href="/" className="flex items-center gap-3">
          <ChevronLeft className="w-5 h-5 text-zinc-500" />
          <span className="font-bold uppercase text-xs tracking-widest text-zinc-400">Retour au Studio</span>
        </Link>
        <div className="flex items-center gap-3">
          <History className="w-5 h-5 text-indigo-500" />
          <span className="font-bold tracking-tight uppercase text-sm tracking-widest text-white">Archives de Production</span>
        </div>
        <a href="https://github.com/Riotlagrinta" target="_blank" className="text-zinc-500 hover:text-white transition-colors"><Github className="w-5 h-5" /></a>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-20">
        <div className="mb-16 space-y-4">
          <h1 className="text-5xl font-bold tracking-tighter">Votre Bibliothèque.</h1>
          <p className="text-zinc-500 text-xl max-w-xl">Retrouvez tous vos projets et scripts générés par NeuroStudio.</p>
        </div>

        {loading ? (
          <div className="h-[40vh] flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-20 text-center space-y-6">
            <Sparkles className="w-12 h-12 text-zinc-800 mx-auto" />
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">Aucun projet trouvé</p>
            <Link href="/" className="inline-block bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-indigo-500 hover:text-white transition-all">
              Créer votre premier projet
            </Link>
          </div>
        ) : (
          <div className="grid gap-6">
            {projects.map((project, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                key={project.id} 
                className="bg-[#0a0a0a] border border-[#1a1a1a] p-8 rounded-2xl group hover:border-indigo-500/50 transition-all flex flex-col md:flex-row justify-between items-center gap-8"
              >
                <div className="space-y-3 text-center md:text-left">
                  <div className="flex items-center gap-3 justify-center md:justify-start">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest px-2 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                      {project.category || "General"}
                    </span>
                    <div className="flex items-center gap-1.5 text-zinc-600">
                      <Calendar className="w-3 h-3" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">{new Date(project.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-indigo-400 transition-colors">{project.title}</h3>
                  <p className="text-zinc-500 text-sm italic">Sujet: {project.topic || "N/A"}</p>
                </div>
                <div className="flex gap-3">
                   <button 
                    onClick={() => alert("Fonctionnalité bientôt disponible : Réouverture du projet")}
                    className="flex items-center gap-2 px-5 py-3 bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded-xl border border-[#333] transition-all text-[10px] font-bold uppercase tracking-widest"
                   >
                     Consulter
                   </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
