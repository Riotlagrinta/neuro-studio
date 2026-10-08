// Undo / redo as plain functions over an immutable state (so it can be tested without React).
//
//   commit  : one edit = one step (typing coalesces into a single step)
//   begin / update / end : a drag — many live updates, but ONE step in the end
//   patchAll: changes that must survive undo (e.g. a paid voice that has just been generated)

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Edits sharing a key within COALESCE_MS merge into one undo step. */
  lastKey?: string;
  lastAt: number;
  /** State when the current drag started. */
  base?: T;
}

const MAX_STEPS = 100;
export const COALESCE_MS = 900;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], lastAt: 0 });

const pushPast = <T>(past: T[], state: T) => [...past, state].slice(-MAX_STEPS);

export function commit<T>(h: History<T>, next: T, opts: { key?: string; now: number }): History<T> {
  if (next === h.present) return h;
  const coalesce = opts.key !== undefined && opts.key === h.lastKey && opts.now - h.lastAt < COALESCE_MS && h.past.length > 0;
  return {
    ...h,
    past: coalesce ? h.past : pushPast(h.past, h.present),
    present: next,
    future: [],
    lastKey: opts.key,
    lastAt: opts.now,
  };
}

export const begin = <T>(h: History<T>): History<T> => (h.base === undefined ? { ...h, base: h.present } : h);

/** A live change during a drag: shows immediately, isn't an undo step yet. */
export const update = <T>(h: History<T>, next: T): History<T> => (next === h.present ? h : { ...h, present: next });

export function end<T>(h: History<T>): History<T> {
  if (h.base === undefined) return h;
  const { base, ...rest } = h;
  if (base === h.present) return { ...rest, base: undefined };
  return { ...rest, base: undefined, past: pushPast(h.past, base), future: [], lastKey: undefined };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { ...h, past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: undefined, base: undefined };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { ...h, past: pushPast(h.past, h.present), present: h.future[0], future: h.future.slice(1), lastKey: undefined, base: undefined };
}

/** Applies a change to every step, so undo/redo can never take it away. */
export function patchAll<T>(h: History<T>, fn: (state: T) => T): History<T> {
  return { ...h, past: h.past.map(fn), present: fn(h.present), future: h.future.map(fn), base: h.base === undefined ? undefined : fn(h.base) };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
