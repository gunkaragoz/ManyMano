import { useEffect, useRef, useState } from "react";

/**
 * Session-backed state: survives refresh (same tab) but starts clean
 * in a new tab / after the tab is closed. Safe for SSR (Remix/CF).
 *
 * - First render always uses `initial` so server HTML and client
 *   hydration match (no hydration mismatch).
 * - After mount, restores any saved draft from sessionStorage.
 * - Writes back on every change (after restore).
 * - Returns a `clear` that removes the key and resets to initial, and
 *   `restored`: false until the saved draft (if any) has been applied, so a
 *   caller can wait before overwriting the draft on purpose (a prefill).
 */
export function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const getInitial = (): T =>
    typeof initial === "function" ? (initial as () => T)() : initial;

  // Keep initial in a ref so the restore effect only runs once per key
  // and doesn't re-run when inline initial objects change identity.
  const initialRef = useRef<T | null>(null);
  if (initialRef.current === null) {
    initialRef.current = getInitial();
  }

  const [value, setValue] = useState<T>(initialRef.current);
  const [didRestore, setDidRestore] = useState(false);

  // Restore once after mount (client only). Runs before any save,
  // so defaults never clobber an existing draft.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw != null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // corrupted draft or storage unavailable -> keep defaults
    }
    setDidRestore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on change, but only after restore has run.
  useEffect(() => {
    if (!didRestore) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full / private mode -> form still works in-memory
    }
  }, [key, value, didRestore]);

  const clear = () => {
    const next = initialRef.current as T;
    setValue(next);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  };

  return [value, setValue, clear, didRestore] as const;
}
