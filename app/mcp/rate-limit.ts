// Fixed-window limiter kept in isolate memory. Best-effort only: it resets
// when the isolate is evicted and isn't shared across isolates. Bounded by
// both expiry and entry count, so a flood of distinct keys can't grow it.

export interface WindowLimiter {
  /** Counts one hit; false once the key is over its limit for the window. */
  hit(key: string, now?: number): boolean;
  readonly size: number;
}

export function createWindowLimiter(opts: { limit: number; windowMs: number; maxKeys: number }): WindowLimiter {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return {
    get size() {
      return entries.size;
    },
    hit(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry || now > entry.resetAt) {
        if (entry) entries.delete(key);
        if (entries.size >= opts.maxKeys) {
          for (const [k, v] of entries) {
            if (now > v.resetAt) entries.delete(k);
          }
          // Still full: drop the oldest keys (Map keeps insertion order).
          const it = entries.keys();
          while (entries.size >= opts.maxKeys) {
            const oldest = it.next();
            if (oldest.done) break;
            entries.delete(oldest.value);
          }
        }
        entries.set(key, { count: 1, resetAt: now + opts.windowMs });
        return opts.limit >= 1;
      }
      entry.count += 1;
      return entry.count <= opts.limit;
    },
  };
}
