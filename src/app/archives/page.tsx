"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2 } from "lucide-react";
import { getProjects, getStudioCapabilities, signInWithGoogle, type StudioCapabilities } from "../actions";
import AccountMenu from "@/components/AccountMenu";
import { SweepRuler } from "@/components/Hero";
import { explain } from "@/lib/errors";

export const dynamic = "force-dynamic";

interface Project {
  id: number;
  title: string;
  category: string;
  topic: string;
  plan: {
    ratio?: string;
    scenes?: { duration?: number }[];
  } | null;
  created_at: string;
}

const CLIP_COLORS = ["#6366f1", "#f472b6", "#fbbf24", "#34d399", "#38bdf8", "#a78bfa"];

/** The project's scenes as proportional coloured clips: its timeline at a glance. */
function Strip({ durations }: { durations: number[] }) {
  const total = durations.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="flex h-7 gap-0.5 overflow-hidden rounded-md" aria-hidden>
      {durations.map((d, i) => {
        const color = CLIP_COLORS[i % CLIP_COLORS.length];
        return <div key={i} className="rounded-sm" style={{ width: `${(d / total) * 100}%`, background: `${color}40`, border: `1px solid ${color}aa` }} />;
      })}
    </div>
  );
}

export default function ArchivesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [caps, setCaps] = useState<StudioCapabilities | null>(null);

  useEffect(() => {
    getStudioCapabilities().then(setCaps);
    getProjects()
      .then((result) => {
        if (result.success) setProjects(result.projects as Project[]);
        else setErrorCode(result.error);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-ink text-cream selection:bg-pink/30">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-line bg-ink/85 px-5 backdrop-blur-md md:px-8">
        <Link href="/" className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white">
          <ChevronLeft className="h-5 w-5" />
          <span className="label text-inherit">Retour au studio</span>
        </Link>
        <AccountMenu auth={caps?.auth} />
      </header>
      <SweepRuler />

      <main className="grid-rules">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <div className="mb-12 space-y-3">
            <p className="label flex items-center gap-2">
              <span className="inline-block h-2 w-2 rotate-45 bg-amber" /> Archives
            </p>
            <h1 className="font-display text-6xl uppercase leading-none tracking-tight md:text-7xl">Vos compositions</h1>
            <p className="max-w-xl text-lg text-zinc-500">Chaque projet garde ses scènes, ses voix et ses plans générés. Ils ne sont visibles que de vous.</p>
          </div>

          {loading ? (
            <div className="flex h-[30vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-pink" />
            </div>
          ) : errorCode === "NON_CONNECTÉ" ? (
            <div className="space-y-5 rounded-xl border border-line bg-panel p-12 text-center">
              <p className="font-semibold">Connectez-vous pour retrouver vos projets.</p>
              {caps?.auth.configured && (
                <form action={signInWithGoogle}>
                  <button className="rounded-lg bg-cream px-6 py-3 font-bold text-ink transition-colors hover:bg-pink">Se connecter avec Google</button>
                </form>
              )}
            </div>
          ) : errorCode ? (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
              {explain(errorCode)}
            </div>
          ) : projects.length === 0 ? (
            <div className="space-y-5 rounded-xl border border-line bg-panel p-12 text-center">
              <p className="label">Aucun projet pour l&apos;instant</p>
              <Link href="/" className="inline-block rounded-lg bg-cream px-6 py-3 font-bold text-ink transition-colors hover:bg-pink">
                Créer votre première composition
              </Link>
            </div>
          ) : (
            <div className="grid gap-4">
              {projects.map((project, i) => {
                const durations = (project.plan?.scenes ?? []).map((s) => s.duration ?? 0);
                const seconds = durations.reduce((a, b) => a + b, 0);
                return (
                  <motion.article
                    key={project.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="group grid gap-5 rounded-xl border border-line bg-panel p-5 transition-colors hover:border-accent/60 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="label rounded bg-accent/15 px-2 py-1 text-indigo-300">{project.category || "Motion"}</span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          {durations.length} scènes · {seconds.toFixed(0)} s · {project.plan?.ratio ?? "16:9"} · {new Date(project.created_at).toLocaleDateString("fr-FR")}
                        </span>
                      </div>
                      <h2 className="truncate text-2xl font-semibold transition-colors group-hover:text-pink">{project.title}</h2>
                      <Strip durations={durations} />
                      {project.topic && <p className="truncate text-sm italic text-zinc-600">{project.topic}</p>}
                    </div>
                    <Link
                      href={`/?project=${project.id}`}
                      className="rounded-lg border border-line-2 px-5 py-3 text-center font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors hover:border-pink hover:text-white"
                    >
                      Rouvrir
                    </Link>
                  </motion.article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
