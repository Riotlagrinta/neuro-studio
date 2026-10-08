"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Coins } from "lucide-react";
import { getMyBalance } from "@/app/billing-actions";
import { formatUsd } from "@/lib/pricing";

/** The studio dispatches this on `window` after a paid action: the balance has just changed. */
export const CREDITS_CHANGED = "neuro:credits-changed";

/** Remaining credits in the header, linking to the credits page. Nothing at all when billing is off or the balance is unknown. */
export default function CreditsBadge() {
  const [balance, setBalance] = useState<number | null | undefined>(undefined); // undefined = still loading

  const load = useCallback(() => {
    getMyBalance()
      .then(setBalance)
      .catch(() => setBalance(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(CREDITS_CHANGED, load);
    return () => window.removeEventListener(CREDITS_CHANGED, load);
  }, [load]);

  if (balance === null) return null;
  if (balance === undefined) return <span className="h-7 w-20 animate-pulse rounded-lg bg-white/5" aria-hidden />;

  const low = balance < 1;
  return (
    <Link
      href="/credits"
      aria-label={`Crédits restants : ${formatUsd(balance)}. Voir et recharger`}
      className={clsx(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold tabular-nums transition-colors",
        low ? "border-amber/60 bg-amber/10 text-amber hover:bg-amber/20" : "border-line-2 bg-panel-2 text-zinc-200 hover:border-accent hover:text-white",
      )}
    >
      <Coins className="h-3.5 w-3.5" aria-hidden />
      {balance <= 0 ? "0 $" : formatUsd(balance)}
    </Link>
  );
}
