// Who is calling, may they, and may they still spend today?
// Every server action that costs money or touches a user's data goes through here.
// Fail-closed: any doubt (no session, not invited, quota hit, database unreachable) refuses
// BEFORE a paid API is called.

import { auth } from "@/auth";
import { allowedEmail } from "./allowlist";
import { dailyCostCapUsd } from "./pricing";

export type UsageKind = "motion" | "refine" | "voice" | "image" | "video" | "upload";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export type AccessError = "NON_CONNECTÉ" | "ACCÈS_REFUSÉ" | "QUOTA_ATTEINTE" | "SERVICE_INDISPONIBLE";

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
 * Reserves one action of `kind` costing about `estimatedCostUsd`. Checking the limits and recording
 * the event happen in a single statement. Call `refund` if the provider then fails.
 */
export async function authorize(
  kind: UsageKind,
  estimatedCostUsd: number,
): Promise<{ ok: true; user: SessionUser; eventId: string } | { ok: false; error: AccessError }> {
  const who = await requireUser();
  if (!who.ok) return who;
  try {
    const { sql } = await import("./db");
    const cost = Math.max(0, estimatedCostUsd);
    const rows = await sql`
      WITH used AS (
        SELECT COUNT(*) FILTER (WHERE kind = ${kind}::text) AS n,
               COALESCE(SUM(cost_usd), 0) AS spent
        FROM usage_events
        WHERE user_id = ${who.user.id}::uuid AND NOT refunded AND created_at > now() - interval '24 hours'
      )
      INSERT INTO usage_events (user_id, kind, cost_usd)
      SELECT ${who.user.id}::uuid, ${kind}::text, ${cost}::numeric
      FROM used
      WHERE n < ${DAILY_LIMITS[kind]}::int AND spent + ${cost}::numeric <= ${dailyCostCapUsd()}::numeric
      RETURNING id
    `;
    if (rows.length === 0) return { ok: false, error: "QUOTA_ATTEINTE" };
    return { ok: true, user: who.user, eventId: String(rows[0].id) };
  } catch (error) {
    console.error("authorize failed:", error);
    return { ok: false, error: "SERVICE_INDISPONIBLE" };
  }
}

/** The provider call failed: the user shouldn't pay or lose quota for it. */
export async function refund(eventId: string): Promise<void> {
  try {
    const { sql } = await import("./db");
    await sql`UPDATE usage_events SET refunded = true WHERE id = ${eventId}::bigint`;
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

/** Refund the event tied to a job that ended in failure. */
export async function refundByRef(userId: string, ref: string): Promise<void> {
  try {
    const { sql } = await import("./db");
    await sql`UPDATE usage_events SET refunded = true WHERE user_id = ${userId}::uuid AND ref = ${ref}::text`;
  } catch (error) {
    console.error("refundByRef failed:", error);
  }
}
