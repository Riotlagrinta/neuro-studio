"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Clapperboard, 
  ArrowLeft, 
  Sparkles, 
  Key, 
  Coins, 
  Film, 
  Layers, 
  ExternalLink, 
  CheckCircle2, 
  ShieldCheck, 
  HelpCircle, 
  Download, 
  BookOpen
} from "lucide-react";
import clsx from "clsx";

export const dynamic = "force-dynamic";

type DocSection = "free_strategy" | "api_keys" | "google_flow" | "montage" | "faq";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<DocSection>("free_strategy");

  return (
    <div className="min-h-screen bg-[#06070a] text-zinc-100 selection:bg-indigo-500/30 selection:text-white pb-24">
      
      {/* Header Navigation Aéré */}
      <header className="h-20 border-b border-white/[0.08] bg-[#06070a]/90 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between px-6 md:px-12">
        <div className="flex items-center gap-4">
          <Link 
            href="/"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 hover:text-white transition-all text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Retour au Studio</span>
          </Link>
          <div className="h-5 w-px bg-white/[0.1] hidden sm:block" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-white tracking-wide uppercase">Académie NeuroStudio</h1>
              <p className="text-[11px] text-zinc-400">Guide de production vidéo, clés API & stratégie 0 €</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/30"
          >
            <Clapperboard className="w-4 h-4" />
            <span>Ouvrir le Studio</span>
          </Link>
        </div>
      </header>

      {/* Contenu Principal Aéré */}
      <div className="max-w-7xl mx-auto px-6 md:px-12 pt-10 md:pt-14">
        
        {/* Hero Banner */}
        <div className="relative rounded-3xl bg-gradient-to-r from-indigo-950/40 via-[#0d101d] to-[#0b0d13] border border-indigo-500/20 p-8 md:p-12 mb-12 overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold tracking-wide">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Production Cinématographique Sans Frais Cachés</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
              Tout comprendre pour créer des films IA pro à <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-indigo-400">0 € / 0 FCFA</span>.
            </h2>
            <p className="text-zinc-400 text-sm md:text-base leading-relaxed">
              NeuroStudio a été conçu pour éliminer la frustration des abonnements coûteux. Ce guide vous dévoile comment exploiter les quotas gratuits de chaque IA, configurer vos clés personnelles (BYOK) et monter des vidéos complètes de 1m30 prêtes pour TikTok et YouTube.
            </p>
          </div>
        </div>

        {/* Navigation par Onglets Spacieux */}
        <div className="flex flex-wrap items-center gap-2.5 pb-8 border-b border-white/[0.08] mb-10">
          <button
            onClick={() => setActiveSection("free_strategy")}
            className={clsx(
              "flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold transition-all border",
              activeSection === "free_strategy"
                ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-500/10"
                : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white"
            )}
          >
            <Coins className="w-4 h-4 text-emerald-400" />
            <span>1. La Stratégie 100% Gratuite (0 €)</span>
          </button>

          <button
            onClick={() => setActiveSection("api_keys")}
            className={clsx(
              "flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold transition-all border",
              activeSection === "api_keys"
                ? "bg-amber-600/20 border-amber-500/40 text-amber-300 shadow-lg shadow-amber-500/10"
                : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white"
            )}
          >
            <Key className="w-4 h-4 text-amber-400" />
            <span>2. Le Guide des Clés API (BYOK)</span>
          </button>

          <button
            onClick={() => setActiveSection("google_flow")}
            className={clsx(
              "flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold transition-all border",
              activeSection === "google_flow"
                ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300 shadow-lg shadow-indigo-500/10"
                : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white"
            )}
          >
            <Film className="w-4 h-4 text-indigo-400" />
            <span>3. Continuité 8K & Google Flow</span>
          </button>

          <button
            onClick={() => setActiveSection("montage")}
            className={clsx(
              "flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold transition-all border",
              activeSection === "montage"
                ? "bg-violet-600/20 border-violet-500/40 text-violet-300 shadow-lg shadow-violet-500/10"
                : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white"
            )}
          >
            <Layers className="w-4 h-4 text-violet-400" />
            <span>4. Studio de Montage CapCut</span>
          </button>

          <button
            onClick={() => setActiveSection("faq")}
            className={clsx(
              "flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold transition-all border",
              activeSection === "faq"
                ? "bg-blue-600/20 border-blue-500/40 text-blue-300 shadow-lg shadow-blue-500/10"
                : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-zinc-400 hover:text-white"
            )}
          >
            <HelpCircle className="w-4 h-4 text-blue-400" />
            <span>5. FAQ & Dépannage</span>
          </button>
        </div>

        {/* SECTION 1 : LA STRATÉGIE 100% GRATUITE */}
        {activeSection === "free_strategy" && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div className="space-y-3">
              <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                <Coins className="w-6 h-6 text-emerald-400" />
                <span>Le Pipeline Showrunner 0 € : Comment sortir un film sans rien dépenser</span>
              </h3>
              <p className="text-zinc-400 text-sm max-w-3xl leading-relaxed">
                Les plateformes tout-en-un traditionnelles facturent souvent des abonnements de 30 $ à 100 $ par mois. Avec NeuroStudio, vous contournez ces coûts en exploitant le meilleur de chaque outil gratuit.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              
              {/* Étape 1 */}
              <div className="bg-[#0b0d13] border border-white/[0.08] hover:border-emerald-500/30 rounded-3xl p-6 space-y-4 transition-all">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-extrabold text-sm">
                  01
                </div>
                <h4 className="text-base font-bold text-white">Scénario & Casting (Gratuit)</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Sur le site, laissez le moteur sélectionné sur <strong className="text-white">⚡ Groq</strong>. Il utilise les modèles open-source de pointe (Llama 3.3 70B & Qwen 2.5) avec une latence quasi-nulle, <strong>100% gratuit et sans limite de génération</strong>.
                </p>
                <div className="pt-2 text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Coût : 0 € (inclus dans NeuroStudio)</span>
                </div>
              </div>

              {/* Étape 2 */}
              <div className="bg-[#0b0d13] border border-white/[0.08] hover:border-emerald-500/30 rounded-3xl p-6 space-y-4 transition-all">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-extrabold text-sm">
                  02
                </div>
                <h4 className="text-base font-bold text-white">Génération Vidéo Gratuite (Bulk Flow)</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Cliquez sur <strong className="text-white">« Bulk Flow Prompts »</strong> pour copier tous les prompts de vos scènes de 8s en 1 clic. Allez sur les plateformes qui offrent des crédits journaliers gratuits :
                </p>
                <ul className="text-xs text-zinc-300 space-y-1.5 pl-3 list-disc">
                  <li><strong className="text-white">Google Flow</strong> : Accès beta gratuit</li>
                  <li><strong className="text-white">Kling AI</strong> : 66 crédits offerts/jour</li>
                  <li><strong className="text-white">Luma Dream Machine</strong> : 30 clips/mois</li>
                  <li><strong className="text-white">MiniMax / Hailuo</strong> : Générations gratuites quotidiennes</li>
                </ul>
                <div className="pt-2 text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Coût : 0 € (avec les crédits quotidiens)</span>
                </div>
              </div>

              {/* Étape 3 */}
              <div className="bg-[#0b0d13] border border-white/[0.08] hover:border-emerald-500/30 rounded-3xl p-6 space-y-4 transition-all">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-extrabold text-sm">
                  03
                </div>
                <h4 className="text-base font-bold text-white">Montage & Export Sans Watermark</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Glissez vos vidéos 8s dans l&apos;onglet <strong className="text-white">« Studio de Montage CapCut »</strong>. L&apos;assembleur tourne directement sur la carte graphique de votre ordinateur : vous exportez votre film complet avec sous-titres animés <strong>sans aucun filigrane</strong>.
                </p>
                <div className="pt-2 text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Coût : 0 € (Moteur client ultra-léger)</span>
                </div>
              </div>

            </div>

            {/* Encadré d'or */}
            <div className="p-6 md:p-8 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1">
                <h4 className="text-base font-bold text-emerald-300">En résumé : Aucun abonnement obligatoire !</h4>
                <p className="text-xs md:text-sm text-emerald-100/80 leading-relaxed max-w-2xl">
                  Vous pouvez utiliser NeuroStudio dès aujourd&apos;hui de A à Z sans jamais entrer de carte bancaire. Les clés d&apos;API optionnelles ne servent qu&apos;à automatiser la génération directement dans l&apos;interface si vous êtes un utilisateur avancé.
                </p>
              </div>
              <Link
                href="/"
                className="px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap shadow-lg shadow-emerald-600/30 text-center"
              >
                Tester le Studio Gratuit
              </Link>
            </div>
          </div>
        )}

        {/* SECTION 2 : LE GUIDE DES CLÉS API (BYOK) */}
        {activeSection === "api_keys" && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div className="space-y-3">
              <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                <Key className="w-6 h-6 text-amber-400" />
                <span>Guide des Clés API (BYOK : Bring Your Own Key)</span>
              </h3>
              <p className="text-zinc-400 text-sm max-w-3xl leading-relaxed">
                Le système BYOK vous permet de brancher vos propres comptes développeurs. Vos clés ne transitent par aucun serveur tiers et restent stockées sur votre navigateur.
              </p>
            </div>

            {/* Tableau Récapitulatif */}
            <div className="overflow-x-auto rounded-3xl border border-white/[0.08] bg-[#0b0d13]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-zinc-400 font-bold uppercase tracking-wider">
                    <th className="p-4 sm:p-5">Service</th>
                    <th className="p-4 sm:p-5">Rôle dans NeuroStudio</th>
                    <th className="p-4 sm:p-5">Gratuité / Quotas</th>
                    <th className="p-4 sm:p-5">Lien d&apos;obtention</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-zinc-300">
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 sm:p-5 font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                      ElevenLabs
                    </td>
                    <td className="p-4 sm:p-5">Voix d&apos;acteurs studio ultra-réalistes</td>
                    <td className="p-4 sm:p-5 text-emerald-400 font-semibold">
                      🟢 10 000 caractères offerts/mois à vie
                    </td>
                    <td className="p-4 sm:p-5">
                      <a 
                        href="https://elevenlabs.io" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        <span>elevenlabs.io</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>

                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 sm:p-5 font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      Nano Banana (Google Imagen 3)
                    </td>
                    <td className="p-4 sm:p-5">Portraits 8K des personnages (Casting)</td>
                    <td className="p-4 sm:p-5 text-amber-300 font-semibold">
                      🟡 300 $ de crédits offerts (Google Cloud)
                    </td>
                    <td className="p-4 sm:p-5">
                      <a 
                        href="https://aistudio.google.com/app/apikey" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        <span>aistudio.google.com</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>

                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 sm:p-5 font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-violet-400" />
                      xAI Grok Imagine Video
                    </td>
                    <td className="p-4 sm:p-5">Rendu direct des clips vidéo 8s</td>
                    <td className="p-4 sm:p-5 text-amber-300 font-semibold">
                      🟡 25 $ de crédits au démarrage
                    </td>
                    <td className="p-4 sm:p-5">
                      <a 
                        href="https://console.x.ai" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        <span>console.x.ai</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>

                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 sm:p-5 font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                      ChatGPT (OpenAI GPT-4o)
                    </td>
                    <td className="p-4 sm:p-5">Scénario & retouche par prompt</td>
                    <td className="p-4 sm:p-5 text-zinc-400">
                      Optionnel (Groq est déjà gratuit à 100%)
                    </td>
                    <td className="p-4 sm:p-5">
                      <a 
                        href="https://platform.openai.com/api-keys" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        <span>platform.openai.com</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Tutoriel Pratique Étape par Étape */}
            <div className="grid md:grid-cols-2 gap-6">
              
              <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span>Tutoriel : Récupérer sa clé ElevenLabs gratuite</span>
                </div>
                <ol className="text-xs text-zinc-400 space-y-2 list-decimal pl-4 leading-relaxed">
                  <li>Rendez-vous sur <strong className="text-white">elevenlabs.io</strong> et créez un compte gratuit.</li>
                  <li>Cliquez sur votre photo de profil en bas à gauche, puis sur <strong className="text-white">Profile + API key</strong>.</li>
                  <li>Cliquez sur l&apos;icône de copie à côté de votre clé API secrète.</li>
                  <li>Sur NeuroStudio, ouvrez <strong className="text-white">« Clés API »</strong> en haut à droite et collez votre clé.</li>
                  <li>Vos 10 000 caractères gratuits sont désormais actifs pour tester les voix d&apos;acteurs !</li>
                </ol>
              </div>

              <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Tutoriel : Récupérer sa clé Google AI Studio</span>
                </div>
                <ol className="text-xs text-zinc-400 space-y-2 list-decimal pl-4 leading-relaxed">
                  <li>Rendez-vous sur <strong className="text-white">aistudio.google.com/app/apikey</strong> avec votre compte Google.</li>
                  <li>Cliquez sur <strong className="text-white">Create API Key</strong> (Créer une clé API).</li>
                  <li>Copiez la chaîne de caractères qui commence par <code className="text-amber-300">AIzaSy...</code>.</li>
                  <li>Collez-la dans le champ <strong className="text-white">Nano Banana / Imagen</strong> de NeuroStudio.</li>
                  <li>Vous pouvez maintenant générer les portraits 8K directement depuis vos fiches personnages.</li>
                </ol>
              </div>

            </div>

            {/* Sécurité */}
            <div className="p-5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center gap-3 text-xs text-indigo-300">
              <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              <span>
                <strong>Garantie Sécurité :</strong> NeuroStudio n&apos;enregistre aucune clé sur sa base de données. Elles résident uniquement dans le <code className="text-white">localStorage</code> de votre navigateur. Si vous videz votre cache ou cliquez sur « Effacer les clés », elles disparaissent immédiatement.
              </span>
            </div>
          </div>
        )}

        {/* SECTION 3 : CONTINUITÉ 8K & GOOGLE FLOW */}
        {activeSection === "google_flow" && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div className="space-y-3">
              <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                <Film className="w-6 h-6 text-indigo-400" />
                <span>La Continuité Visuelle 8K & La Méthode Google Flow</span>
              </h3>
              <p className="text-zinc-400 text-sm max-w-3xl leading-relaxed">
                Le plus grand défi des vidéos générées par IA est la cohérence : les visages et les vêtements changent à chaque scène si l&apos;on ne suit pas une méthode rigoureuse. Voici comment NeuroStudio résout ce problème.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              
              <div className="bg-[#0b0d13] border border-white/[0.08] rounded-3xl p-6 md:p-8 space-y-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 px-2.5 py-1 bg-amber-500/10 rounded-md">
                  Règle Fondamentale n°1
                </span>
                <h4 className="text-lg font-bold text-white">Le Casting & Les Ingrédients de Référence</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Avant de générer la moindre scène vidéo, vous devez impérativement générer le <strong className="text-white">portrait officiel 8K</strong> de chaque personnage (Onglet 1 du projet).
                </p>
                <div className="p-4 rounded-2xl bg-black/50 border border-white/[0.06] text-xs text-zinc-300 space-y-2">
                  <p className="font-semibold text-white">Dans Google Flow / Midjourney :</p>
                  <p className="text-zinc-400">
                    Importez cette image en tant qu&apos;<strong className="text-amber-300">Ingredient / Character Reference</strong>. L&apos;IA verrouillera ainsi les traits du visage, la carnation de peau et la tenue vestimentaire sur l&apos;ensemble de vos 11-12 scènes.
                  </p>
                </div>
              </div>

              <div className="bg-[#0b0d13] border border-white/[0.08] rounded-3xl p-6 md:p-8 space-y-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 px-2.5 py-1 bg-indigo-500/10 rounded-md">
                  Règle Fondamentale n°2
                </span>
                <h4 className="text-lg font-bold text-white">Le Format Standardisé de 8 Secondes</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Google Flow et Gemini Omni Flash sont calibrés pour des segments de <strong className="text-white">8 secondes maximum</strong>. Au-delà, l&apos;attention visuelle décroche et l&apos;IA subit des déformations physiques.
                </p>
                <div className="p-4 rounded-2xl bg-black/50 border border-white/[0.06] text-xs text-zinc-300 space-y-2">
                  <p className="font-semibold text-white">La Formule du Film de 1m30 :</p>
                  <p className="text-zinc-400">
                    11 à 12 scènes de 8 secondes = ~92 secondes au total. C&apos;est la durée d&apos;or pour capter l&apos;algorithme TikTok, Instagram Reels et YouTube Shorts avec une rétention maximale.
                  </p>
                </div>
              </div>

            </div>

            {/* Structure d'un Bon Prompt */}
            <div className="bg-[#0b0d13] border border-white/[0.08] rounded-3xl p-6 md:p-8 space-y-4">
              <h4 className="text-base font-bold text-white">Anatomie d&apos;un Prompt Vidéo NeuroStudio</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Chaque prompt généré par NeuroStudio respecte la structure cinématique imposée par les réalisateurs d&apos;Hollywood :
              </p>
              <div className="p-4 rounded-2xl bg-black/60 border border-amber-500/20 font-mono text-xs text-zinc-300 leading-relaxed">
                <span className="text-amber-400">Ultra-realistic cinematic video, 8 seconds.</span> [Lieu & Éclairage]. [Identité physique stricte répétée du personnage]. [Action précise dans la continuité du plan précédent]. [Cadrage caméra & Mouvement]. <span className="text-indigo-400">Cinematic lighting, shallow depth of field, 4K ultra detail, natural motion.</span>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 4 : STUDIO DE MONTAGE CAPCUT */}
        {activeSection === "montage" && (
          <div className="space-y-10 animate-in fade-in duration-300">
            <div className="space-y-3">
              <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                <Layers className="w-6 h-6 text-violet-400" />
                <span>Le Studio de Montage Neuro-Assembler (Style CapCut)</span>
              </h3>
              <p className="text-zinc-400 text-sm max-w-3xl leading-relaxed">
                Vous n&apos;avez plus besoin d&apos;installer des logiciels lourds comme Premiere Pro ou CapCut. NeuroStudio intègre son propre séquenceur vidéo sur navigateur.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              
              <div className="bg-[#0b0d13] border border-white/[0.08] rounded-3xl p-6 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-xs">
                  01
                </div>
                <h4 className="text-sm font-bold text-white">Glisser-Déposer les Scènes</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Dans l&apos;onglet 3 (Studio de Montage), chaque scène de 8s dispose de sa propre dropzone. Déposez simplement vos fichiers MP4 téléchargés de Google Flow ou Kling.
                </p>
              </div>

              <div className="bg-[#0b0d13] border border-white/[0.08] rounded-3xl p-6 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-xs">
                  02
                </div>
                <h4 className="text-sm font-bold text-white">Sous-Titres Animés Dynamiques</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Activez les sous-titres en 1 clic. Le moteur dessine automatiquement chaque réplique avec des polices percutantes (Impact / Montserrat), un contour noir et un surlignage mot par mot.
                </p>
              </div>

              <div className="bg-[#0b0d13] border border-white/[0.08] rounded-3xl p-6 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-xs">
                  03
                </div>
                <h4 className="text-sm font-bold text-white">Format 16:9 & 9:16 en 1 Clic</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Basculez entre le mode cinéma (16:9 pour grand écran) et le mode vertical (9:16 pour TikTok/Shorts). Le séquenceur recadre automatiquement le rendu lors de l&apos;assemblage final.
                </p>
              </div>

            </div>

            <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Exportation MP4 Haute Définition</span>
              </h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Lorsque toutes vos scènes sont importées, cliquez sur <strong className="text-white">« Exporter le Film Complet (MP4) »</strong>. Le moteur utilise l&apos;API native <code className="text-indigo-300">MediaRecorder</code> de votre navigateur pour compiler les flux vidéo, les pistes audio des dialogues et les sous-titres en un fichier MP4 unique prêt à publier.
              </p>
            </div>
          </div>
        )}

        {/* SECTION 5 : FAQ & DÉPANNAGE */}
        {activeSection === "faq" && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl">
            
            <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-2">
              <h4 className="text-sm font-bold text-white">Q : Mon ami peut-il tester le site depuis son propre ordinateur ?</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                <strong>R : Absolument !</strong> Le site est hébergé en ligne sur Vercel (<a href="https://neuro-studio-beige.vercel.app" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline">neuro-studio-beige.vercel.app</a>). Il lui suffit d&apos;ouvrir ce lien sur n&apos;importe quel navigateur moderne (Chrome, Edge, Safari, Firefox). Il n&apos;a rien à installer.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-2">
              <h4 className="text-sm font-bold text-white">Q : Pourquoi la voix ne joue pas quand je clique sur « Écouter » ?</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                <strong>R :</strong> Le lecteur utilise par défaut la synthèse vocale intégrée de votre navigateur (<code className="text-zinc-300">Web Speech API</code>). Vérifiez que le volume de votre ordinateur est allumé et que vous utilisez un navigateur récent (Chrome ou Edge offrent les meilleures voix françaises).
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-2">
              <h4 className="text-sm font-bold text-white">Q : Le site semble dense et compact sur mon écran, comment aérer la vue ?</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                <strong>R :</strong> Nous avons séparé l&apos;expérience en 3 onglets distincts (Casting, Découpage des Scènes, Studio de Montage) et créé cette page de documentation pour décharger l&apos;interface principale. Vous pouvez également replier les zones d&apos;affinage de scènes pour naviguer plus confortablement.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-[#0b0d13] border border-white/[0.08] space-y-2">
              <h4 className="text-sm font-bold text-white">Q : Mes projets créés sont-ils sauvegardés ?</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                <strong>R : Oui.</strong> Lorsque vous cliquez sur le bouton « Sauvegarder » sur un film généré, il est enregistré de manière permanente dans la base de données cloud PostgreSQL (Neon). Vous pouvez le retrouver à tout moment dans l&apos;onglet <strong className="text-white">Archives</strong>.
              </p>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
