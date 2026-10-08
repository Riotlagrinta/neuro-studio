// Shapes shared by the billing server code, the credits page and the studio. Types only: no logic, no secrets.
// "Crédit" = 1 USD of the price CHARGED to the user (the estimated provider cost times the markup).

/** What the studio needs to price things and gate paid actions (from getStudioCapabilities). */
export interface BillingInfo {
  enabled: boolean;
  /** Credits left, 0 when billing is off or the user is signed out. */
  balance: number;
  /** Charged price = estimated provider cost x markup. */
  markup: number;
}

export interface PackView {
  id: string;
  /** Credits the pack adds. */
  credits: number;
  /** Price in the currency's own unit (XOF has no decimals). Decided by the server, never by the browser. */
  amount: number;
  currency: "XOF" | "XAF";
}

export type LedgerReason = "topup" | "debit" | "refund" | "bonus" | "adjustment";

export interface LedgerRow {
  id: string;
  /** Positive = credits added, negative = credits spent. */
  delta: number;
  reason: LedgerReason;
  /** ISO timestamp. */
  at: string;
  /** Short French label, e.g. "Voix", "Plan vidéo", "Recharge". */
  label?: string;
}

export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "canceled";

export interface BillingSummary {
  enabled: boolean;
  balance: number;
  markup: number;
  packs: PackView[];
  /** The most recent ledger rows, newest first (at most 30). */
  history: LedgerRow[];
  /** Payments started by this user and not settled yet. */
  pending: number;
  /** The configured payment provider, or null when none is configured (the page then explains it). */
  provider: { id: string; label: string; methods: string } | null;
  /** How to buy credits while there is no automatic payment: text written by the owner (BILLING_TOPUP_INSTRUCTIONS). */
  topupInstructions: string | null;
}

export type CheckoutResult = { success: true; url: string; paymentId: string } | { success: false; error: string };

export type RefreshResult = { success: true; status: PaymentStatus; balance: number } | { success: false; error: string };
