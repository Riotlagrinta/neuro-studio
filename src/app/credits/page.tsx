"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ChevronLeft, Coins, Loader2, Minus, Plus } from "lucide-react";
import { getStudioCapabilities, signInWithGoogle, type StudioCapabilities } from "../actions";
import { getBillingSummary } from "../billing-actions";
import AccountMenu from "@/components/AccountMenu";
import type { BillingSummary, LedgerRow } from "@/lib/billing-types";
import { formatUsd } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type Summary = BillingSummary & { balanceKnown: boolean };

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Row({ row }: { row: LedgerRow }) {
  const gain = row.delta > 0;
  return (
    <li className="flex items-center justify-between gap-4 border-b border-line/60 px-4 py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", gain ? "bg-mint/15 text-mint" : "bg-white/5 text-zinc-400")} aria-hidden>
          {gain ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-cream">{row.label ?? "Mouvement"}</p>
          <p className="font-mono text-[10px] text-zinc-500">{dateFormat.format(new Date(row.at))}</p>
        </div>
      </div>
      <span className={clsx("shrink-0 font-mono text-sm tabular-nums", gain ? "text-mint" : "text-zinc-300")}>
        {gain ? "+" : "−"} {formatUsd(Math.abs(row.delta))}
      </span>
    </li>
  );
}

export default function CreditsPage() {
  const [caps, setCaps] = useState<StudioCapabilities | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getStudioCapabilities().then(setCaps).catch(() => setFailed(true));
    getBillingSummary().then(setSummary).catch(() => setFailed(true));
  }, []);

  const signedIn = !!caps?.auth.user;
  const allowed = !!caps?.auth.allowed;

  return (
    <div className="min-h-screen bg-ink text-cream selection:bg-pink/30">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-line bg-ink/85 px-5 backdrop-blur-md md:px-8">
        <Link href="/" className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="label text-inherit">Studio</span>
        </Link>
        <AccountMenu auth={caps?.auth} />
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-6 py-12">
        <div className="space-y-2">
          <p className="label flex items-center gap-2">
            <Coins className="h-3.5 w-3.5" aria-hidden /> Crédits
          </p>
          <h1 className="font-display text-4xl uppercase tracking-wide">Votre solde</h1>
        </div>

        {failed && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Impossible de charger vos crédits pour le moment. Réessayez dans un instant.
          </p>
        )}

        {!failed && (!caps || !summary) && (
          <div className="space-y-4" aria-busy="true" aria-label="Chargement des crédits">
            <div className="h-28 animate-pulse rounded-xl border border-line bg-panel" />
            <div className="h-40 animate-pulse rounded-xl border border-line bg-panel" />
          </div>
        )}

        {caps && summary && !summary.enabled && (
          <p className="rounded-lg border border-line bg-panel px-4 py-3 text-sm text-zinc-400">
            La facturation n&apos;est pas activée sur ce service : les actions ne consomment pas de crédits.
          </p>
        )}

        {caps && summary && summary.enabled && !signedIn && (
          <div className="space-y-4 rounded-xl border border-line bg-panel p-6">
            <p className="text-sm text-zinc-400">Connectez-vous pour voir vos crédits et suivre ce que vous consommez.</p>
            {caps.auth.configured && (
              <form action={signInWithGoogle}>
                <button className="rounded-md bg-cream px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-ink transition-colors hover:bg-pink">Se connecter</button>
              </form>
            )}
          </div>
        )}

        {caps && summary && summary.enabled && signedIn && !allowed && (
          <p className="rounded-lg border border-line bg-panel px-4 py-3 text-sm text-zinc-400">Votre compte n&apos;a pas accès : l&apos;accès est sur invitation.</p>
        )}

        {caps && summary && summary.enabled && allowed && (
          <>
            <section aria-label="Solde" className={clsx("rounded-xl border p-6", summary.balanceKnown && summary.balance < 1 ? "border-amber/50 bg-amber/5" : "border-line bg-panel")}>
              <p className="label">Crédits restants</p>
              <p className="mt-2 font-display text-6xl tabular-nums">{summary.balanceKnown ? (summary.balance <= 0 ? "0 $" : formatUsd(summary.balance)) : "—"}</p>
              {!summary.balanceKnown && <p className="mt-2 text-sm text-amber">Le solde n&apos;a pas pu être lu pour le moment : réessayez dans un instant.</p>}
              {summary.balanceKnown && summary.balance < 1 && <p className="mt-2 text-sm text-amber">Votre solde est bas : rechargez pour continuer à générer.</p>}
              <p className="mt-4 text-xs leading-relaxed text-zinc-500">
                1 crédit = 1 $ de prix affiché. Chaque action indique son prix avant de dépenser ; si une génération échoue, son prix vous est rendu automatiquement.
              </p>
            </section>

            <section aria-label="Recharger" className="space-y-3 rounded-xl border border-line bg-panel p-6">
              <p className="label">Recharger</p>
              {summary.topupInstructions ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">{summary.topupInstructions}</p>
              ) : (
                <p className="text-sm leading-relaxed text-zinc-400">
                  Le paiement en ligne n&apos;est pas encore disponible. Pour recharger, contactez l&apos;administrateur du service en indiquant l&apos;adresse e-mail de votre compte.
                </p>
              )}
              {caps.auth.user && (
                <p className="font-mono text-[11px] text-zinc-500">
                  Votre compte : <span className="text-zinc-300">{caps.auth.user.email}</span>
                </p>
              )}
            </section>

            <section aria-label="Historique" className="space-y-3">
              <p className="label">Historique</p>
              {summary.history.length === 0 ? (
                <p className="rounded-lg border border-line bg-panel px-4 py-6 text-center text-sm text-zinc-500">Aucun mouvement pour le moment.</p>
              ) : (
                <ul className="overflow-hidden rounded-xl border border-line bg-panel">
                  {summary.history.map((row) => (
                    <Row key={row.id} row={row} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {!caps && !failed && (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…
          </p>
        )}
      </main>
    </div>
  );
}
