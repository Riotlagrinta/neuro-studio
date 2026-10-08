// Prepaid credits: what a user is charged for an action. 1 credit = 1 USD of the price charged to the user, i.e. the
// estimated provider cost (src/lib/pricing.ts, src/lib/video-models.ts) times a markup. Shared by server and client
// (the studio shows the charged price before anyone spends), so it holds no secret. The environment is read on the
// server only: the client gets the markup through getStudioCapabilities and passes it to applyMarkup.

/** Off by default: without BILLING_ENABLED=true the app behaves as before (allow-list + daily caps, no ledger). */
export function billingEnabled(): boolean {
  return process.env.BILLING_ENABLED?.trim().toLowerCase() === "true";
}

/** BILLING_MARKUP: charged price = estimated cost x markup. At least 1 (never sell below cost), 1.5 by default. */
export function billingMarkup(): number {
  const v = Number(process.env.BILLING_MARKUP);
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 100) : 1.5;
}

/** SIGNUP_BONUS_USD: credits given once to each new user (0 by default). */
export function signupBonus(): number {
  const v = Number(process.env.SIGNUP_BONUS_USD);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1000) : 0;
}

/**
 * The charged price of an action costing `costUsd` to us, rounded UP to 4 decimals (the ledger's precision), so a charge
 * is never below the cost. Floating-point noise is removed first: 0.30000000000000004 x 1.5 charges 0.45, not 0.4501.
 */
export function applyMarkup(costUsd: number, markup: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  const m = Number.isFinite(markup) && markup >= 1 ? markup : 1; // a bad markup never means "free"
  return Math.ceil(Math.round(costUsd * m * 1e6) / 100) / 1e4;
}

/** Server-side charge for an action. */
export const chargeFor = (costUsd: number): number => applyMarkup(costUsd, billingMarkup());
