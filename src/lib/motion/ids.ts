/** A short unique id. Scenes carry one for life: array positions change when scenes are reordered, ids don't. */
export function newUid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const isUid = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v);
