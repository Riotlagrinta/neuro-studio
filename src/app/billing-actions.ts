"use server";

// Read-only billing endpoints. Like every exported "use server" function these are public HTTP endpoints, so each one
// checks the session itself. Credits are only ever ADDED by credit_user (db/schema.sql), never from the browser.

import { getBalance, getLedger, requireUser } from "@/lib/access";
import { billingEnabled, billingMarkup } from "@/lib/billing";
import type { BillingSummary } from "@/lib/billing-types";

const EMPTY: BillingSummary = { enabled: false, balance: 0, markup: 1, packs: [], history: [], pending: 0, provider: null, topupInstructions: null };

/** What the credits page shows. Never throws; when the database cannot answer, the balance is reported as unknown (null). */
export async function getBillingSummary(): Promise<BillingSummary & { balanceKnown: boolean }> {
  if (!billingEnabled()) return { ...EMPTY, balanceKnown: true };
  const who = await requireUser();
  if (!who.ok) return { ...EMPTY, enabled: true, markup: billingMarkup(), balanceKnown: true };
  const [balance, history] = await Promise.all([getBalance(who.user.id), getLedger(who.user.id, 30)]);
  return {
    enabled: true,
    balance: balance ?? 0,
    balanceKnown: balance !== null,
    markup: billingMarkup(),
    packs: [],
    history,
    pending: 0,
    provider: null,
    topupInstructions: process.env.BILLING_TOPUP_INSTRUCTIONS?.trim().slice(0, 1000) || null,
  };
}

/** Just the balance, for the header badge and for refreshing it after a paid action. Null = not applicable or unknown. */
export async function getMyBalance(): Promise<number | null> {
  if (!billingEnabled()) return null;
  const who = await requireUser();
  return who.ok ? getBalance(who.user.id) : null;
}
