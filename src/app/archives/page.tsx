"use client";

import { useEffect, useState } from "react";
import { getProjects, deleteProject, ContentPlan } from "../actions";
import { 
  Sparkles, 
  ChevronLeft, 
  History, 
  Calendar, 
  Loader2,
  Github,
  Trash2,
  ExternalLink
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export const dynamic = "force-dynamic";

interface Project {
  id: number;
  title: string;
  category: string;
  topic: string;
  plan: ContentPlan;
  created_at: string;
}

export default function ArchivesPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    getProjects()
      .then((data: Project[]) => setProjects(data))
      .finally(() => setLoading(false));
  }, []);

  const openProject = (project: Project) => {
    localStorage.setItem("neuro_current_plan", JSON.stringify(project.plan));
    if (project.topic) {
      localStorage.setItem("neuro_current_topic", project.topic);
    }
    router.push("/");
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Voulez-vous vraiment supprimer ce projet des archives Neon ?")) return;
    setDeletingId(id);
    try {
      const res = await deleteProject(id);
      if (res.success) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } else {
        alert("Erreur lors de la suppression du projet.");
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#06070a] text-white selection:bg-indigo-500/30">
      <header className="h-16 border-b border-white/[0.08] bg-[#06070a]/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-6 md:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-zinc-400 hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" />
          <span className="font-bold uppercase text-[11px] tracking-wider">Retour au Studio</span>
        </Link>
        <div className="flex items-center gap-2.5">
          <History className="w-4 h-4 text-indigo-400" />
          <span className="font-bold tracking-tight uppercase text-xs tracking-widest text-white">Archives de Production</span>
        </div>
        <a href="https://github.com/Riotlagrinta/neuro-studio" target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-white transition-colors">
          <Github className="w-5 h-5" />
        </a>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 md:py-16">
        <div className="mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Base de Données PostgreSQL Neon Connectée</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Votre Bibliothèque.</h1>
          <p className="text-zinc-400 text-base md:text-lg max-w-xl">
            Retrouvez tous vos films, castings, découpages de 8 secondes et dialogues sauvegardés.
          </p>
        </div>

        {loading ? (
          <div className="h-[40vh] flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-[#0b0d13] border border-white/[0.08] rounded-2xl p-16 text-center space-y-6">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto text-zinc-500">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-white font-bold text-base">Aucun film archivé pour le moment</p>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Générez votre première histoire dans le studio et cliquez sur &quot;Sauvegarder&quot; pour la retrouver ici à tout moment.
              </p>
            </div>
            <Link 
              href="/" 
              className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/30"
            >
              Créer votre premier film
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:gap-5">
            {projects.map((project, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                key={project.id} 
                className="bg-[#0b0d13] border border-white/[0.08] hover:border-indigo-500/40 p-6 md:p-7 rounded-2xl transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-6 group"
              >
                <div className="space-y-2.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-widest px-2.5 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                      {project.category || "Cinéma"}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-medium px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                      {project.plan?.scenes?.length || 0} scènes (8s)
                    </span>
                    <div className="flex items-center gap-1 text-zinc-500 text-[11px]">
                      <Calendar className="w-3 h-3" />
                      <span>{new Date(project.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</span>
                    </div>
                  </div>
                  <h3 className="text-xl md:text-2xl font-bold text-white group-hover:text-indigo-300 transition-colors">
                    {project.title}
                  </h3>
                  <p className="text-zinc-400 text-xs italic">
                    Sujet initial : &quot;{project.topic || "N/A"}&quot;
                  </p>
                </div>

                <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
                  <button 
                    onClick={() => openProject(project)}
                    className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-wider shadow-md shadow-indigo-600/25"
                  >
                    <span>Ouvrir dans le Studio</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDelete(project.id)}
                    disabled={deletingId === project.id}
                    className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-zinc-500 hover:text-red-400 border border-white/[0.06] transition-colors"
                    title="Supprimer ce projet de la base de données"
                  >
                    {deletingId === project.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
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
