// Who is calling, may they, and may they still spend today?
// Every server action that costs money or touches a user's data goes through here.
// Fail-closed: any doubt (no session, not invited, quota hit, database unreachable) refuses
// BEFORE a paid API is called.

import { auth } from "@/auth";
import { allowedEmail } from "./allowlist";
import { billingEnabled, chargeFor, signupBonus } from "./billing";
import type { LedgerReason, LedgerRow } from "./billing-types";
import { dailyCostCapUsd } from "./pricing";
import { CONFIRM_ATTEMPTS } from "./upload";

export type UsageKind = "motion" | "refine" | "voice" | "image" | "video" | "upload";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export type AccessError = "NON_CONNECTÉ" | "ACCÈS_REFUSÉ" | "QUOTA_ATTEINTE" | "SOLDE_INSUFFISANT" | "SERVICE_INDISPONIBLE";

/**
 * Actions of each kind allowed per user over a rolling 24 hours.
 * "upload" counts signatures issued for a direct browser-to-Cloudinary upload (storage and bandwidth are not free).
 */
export const DAILY_LIMITS: Record<UsageKind, number> = { motion: 6, refine: 40, voice: 60, image: 80, video: 8, upload: 40 };

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const user = (await auth())?.user;
    return user?.id && user.email ? { id: user.id, email: user.email, name: user.name, image: user.image } : null;
  } catch {
    return null; // auth not configured (missing AUTH_SECRET…) counts as signed out
  }
}

/** Signed in AND still invited (an invitation can be withdrawn while a token is still valid). */
export async function requireUser(): Promise<{ ok: true; user: SessionUser } | { ok: false; error: AccessError }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "NON_CONNECTÉ" };
  if (!allowedEmail(user.email)) return { ok: false, error: "ACCÈS_REFUSÉ" };
  return { ok: true, user };
}

/**
 * Reserves one action of `kind` costing about `estimatedCostUsd`, optionally tagged with an external id `ref`.
 * Checking the limits and recording the event happen in one atomic call (reserve_usage, db/schema.sql: it locks the
 * user first, so parallel requests cannot all pass the check). Call `refund` if the provider then fails.
 *
 * With billing on (BILLING_ENABLED=true) the same atomic call also charges the user's credits (reserve_charged) and
 * refuses with SOLDE_INSUFFISANT when they do not cover the charged price; the daily limits and the cap still apply.
 */
export async function authorize(
  kind: UsageKind,
  estimatedCostUsd: number,
  ref?: string,
): Promise<{ ok: true; user: SessionUser; eventId: string } | { ok: false; error: AccessError }> {
  const who = await requireUser();
  if (!who.ok) return who;
  try {
    const { sql } = await import("./db");
    const cost = Math.max(0, estimatedCostUsd);
    if (billingEnabled()) {
      const rows = await sql`
        SELECT out_event, out_status FROM reserve_charged(
          ${who.user.id}::uuid, ${kind}::text, ${cost}::numeric, ${chargeFor(cost)}::numeric, ${DAILY_LIMITS[kind]}::int,
          ${dailyCostCapUsd()}::numeric, ${ref ?? null}::text
        )
      `;
      const row = rows[0];
      if (!row) return { ok: false, error: "SERVICE_INDISPONIBLE" };
      if (row.out_status === "ok" && row.out_event !== null && row.out_event !== undefined) return { ok: true, user: who.user, eventId: String(row.out_event) };
      return { ok: false, error: row.out_status === "balance" ? "SOLDE_INSUFFISANT" : "QUOTA_ATTEINTE" };
    }
    const rows = await sql`
      SELECT reserve_usage(
        ${who.user.id}::uuid, ${kind}::text, ${cost}::numeric, ${DAILY_LIMITS[kind]}::int, ${dailyCostCapUsd()}::numeric, ${ref ?? null}::text
      ) AS id
    `;
    const id = rows[0]?.id;
    if (id === null || id === undefined) return { ok: false, error: "QUOTA_ATTEINTE" };
    return { ok: true, user: who.user, eventId: String(id) };
  } catch (error) {
    console.error("authorize failed:", error);
    return { ok: false, error: "SERVICE_INDISPONIBLE" };
  }
}

/** The provider call failed: the user shouldn't pay or lose quota for it. */
export async function refund(eventId: string): Promise<void> {
  try {
    const { sql } = await import("./db");
    // With billing on, the charge goes back to the user's credits too (exactly once, however often this is called).
    if (billingEnabled()) await sql`SELECT refund_event(${eventId}::bigint)`;
    else await sql`UPDATE usage_events SET refunded = true WHERE id = ${eventId}::bigint`;
  } catch (error) {
    console.error("refund failed:", error);
  }
}

/** Attach an external id (e.g. a Replicate job) to an event, so ownership can be checked later. */
export async function tagEvent(eventId: string, ref: string): Promise<void> {
  try {
    const { sql } = await import("./db");
    await sql`UPDATE usage_events SET ref = ${ref}::text WHERE id = ${eventId}::bigint`;
  } catch (error) {
    console.error("tagEvent failed:", error);
  }
}

/** Is this external id one of this user's video jobs? */
export async function ownsVideoJob(userId: string, ref: string): Promise<boolean> {
  try {
    const { sql } = await import("./db");
    const rows = await sql`
      SELECT 1 FROM usage_events WHERE user_id = ${userId}::uuid AND kind = 'video' AND ref = ${ref}::text LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Takes one of the CONFIRM_ATTEMPTS checks of an upload we issued to this user (the event carries its public id as `ref`).
 * This is what makes "issued" true, and what keeps a user from spending the account-wide Cloudinary Admin API budget
 * (500 calls an hour on the Free plan) with made-up or repeated ids: the Admin API is only called after a "granted".
 */
export async function claimUploadCheck(userId: string, publicId: string): Promise<"granted" | "refused" | "unavailable"> {
  try {
    const { sql } = await import("./db");
    const rows = await sql`
      UPDATE usage_events SET confirm_attempts = confirm_attempts + 1
      WHERE user_id = ${userId}::uuid AND kind = 'upload' AND ref = ${publicId}::text AND NOT refunded
        AND created_at > now() - interval '24 hours' AND confirm_attempts < ${CONFIRM_ATTEMPTS}::int
      RETURNING id
    `;
    return rows.length > 0 ? "granted" : "refused";
  } catch (error) {
    console.error("claimUploadCheck failed:", error);
    return "unavailable";
  }
}

/** Refund the event tied to a job that ended in failure. */
export async function refundByRef(userId: string, ref: string): Promise<void> {
  try {
    const { sql } = await import("./db");
    if (billingEnabled()) await sql`SELECT refund_by_ref(${userId}::uuid, ${ref}::text)`;
    else await sql`UPDATE usage_events SET refunded = true WHERE user_id = ${userId}::uuid AND ref = ${ref}::text`;
  } catch (error) {
    console.error("refundByRef failed:", error);
  }
}

/**
 * Credits left. Grants the signup bonus first when one is configured (once per user: the ledger refuses a second
 * ('bonus', 'signup') row). Null when the database cannot say: the caller must then refuse or hide, never guess.
 */
export async function getBalance(userId: string): Promise<number | null> {
  try {
    const { sql } = await import("./db");
    const bonus = signupBonus();
    if (bonus > 0) await sql`SELECT credit_user(${userId}::uuid, ${bonus}::numeric, 'bonus', 'signup')`;
    const rows = await sql`SELECT credit_balance(${userId}::uuid) AS balance`;
    const balance = Number(rows[0]?.balance);
    return Number.isFinite(balance) ? balance : null;
  } catch (error) {
    console.error("getBalance failed:", error);
    return null;
  }
}

const USAGE_LABELS: Record<string, string> = {
  motion: "Génération",
  refine: "Retouche",
  voice: "Voix",
  image: "Image",
  video: "Plan vidéo",
  upload: "Envoi",
};

const REASON_LABELS: Record<LedgerReason, string> = {
  topup: "Recharge",
  bonus: "Crédit offert",
  adjustment: "Ajustement",
  debit: "Consommation",
  refund: "Remboursement",
};

/** The user's latest ledger rows, newest first, with a short French label each. */
export async function getLedger(userId: string, limit = 30): Promise<LedgerRow[]> {
  try {
    const { sql } = await import("./db");
    const rows = await sql`
      SELECT l.id, l.delta, l.reason, l.created_at, e.kind
      FROM credit_ledger l
      LEFT JOIN usage_events e ON l.reason IN ('debit', 'refund') AND e.id::text = l.ref
      WHERE l.user_id = ${userId}::uuid
      ORDER BY l.id DESC
      LIMIT ${Math.min(100, Math.max(1, Math.trunc(limit)))}::int
    `;
    return rows.map((r) => {
      const reason = r.reason as LedgerReason;
      const what = reason === "debit" || reason === "refund" ? USAGE_LABELS[String(r.kind)] : undefined;
      return {
        id: String(r.id),
        delta: Number(r.delta),
        reason,
        at: new Date(String(r.created_at)).toISOString(),
        label: what ? (reason === "refund" ? `${what} (remboursé)` : what) : REASON_LABELS[reason],
      };
    });
  } catch (error) {
    console.error("getLedger failed:", error);
    return [];
  }
}
