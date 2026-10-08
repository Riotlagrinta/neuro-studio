"use client";

import { useCallback, useMemo, useState } from "react";
import * as H from "./history";

type Updater<T> = T | ((current: T) => T);
const resolve = <T,>(next: Updater<T>, current: T): T => (typeof next === "function" ? (next as (c: T) => T)(current) : next);

/** React wrapper over history.ts. `reset` starts a fresh history (opening or closing a project). */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState(() => H.createHistory(initial));

  const set = useCallback((next: Updater<T>, key?: string) => {
    const now = Date.now();
    setH((cur) => H.commit(cur, resolve(next, cur.present), { key, now }));
  }, []);
  const begin = useCallback(() => setH((cur) => H.begin(cur)), []);
  const update = useCallback((next: Updater<T>) => setH((cur) => H.update(cur, resolve(next, cur.present))), []);
  const end = useCallback(() => setH((cur) => H.end(cur)), []);
  const undo = useCallback(() => setH((cur) => H.undo(cur)), []);
  const redo = useCallback(() => setH((cur) => H.redo(cur)), []);
  const patchAll = useCallback((fn: (state: T) => T) => setH((cur) => H.patchAll(cur, fn)), []);
  const reset = useCallback((state: T) => setH(H.createHistory(state)), []);

  return useMemo(
    () => ({ present: h.present, canUndo: H.canUndo(h), canRedo: H.canRedo(h), set, begin, update, end, undo, redo, patchAll, reset }),
    [h, set, begin, update, end, undo, redo, patchAll, reset],
  );
}
