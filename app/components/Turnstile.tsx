import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, params: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile-script-failed"));
    document.head.appendChild(s);
  });
  // Allow retry if the CDN load failed.
  scriptPromise.catch(() => {
    scriptPromise = null;
  });
  return scriptPromise;
}

interface TurnstileProps {
  siteKey: string;
  action: string;
  /** Pass navigation.state — widget resets to a fresh token when a submission settles. */
  resetKey?: string;
  /**
   * `interaction-only` (default) keeps the widget hidden unless Cloudflare
   * actually needs visitor interaction — cleanest UX, most visitors never
   * see the checkbox. Use `always` only where you want visible proof.
   */
  appearance?: "always" | "execute" | "interaction-only";
}

/**
 * Explicit-render Turnstile widget. Must be placed INSIDE its <form> so the
 * solved `cf-turnstile-response` token is submitted with the form data.
 * Tokens are single-use: after each completed submission the widget resets.
 */
export default function Turnstile({ siteKey, action, resetKey, appearance = "interaction-only" }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const prevResetKey = useRef(resetKey);

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // ignore — container may already be gone
          }
          widgetIdRef.current = null;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          appearance,
        });
      })
      .catch(() => {
        // CDN unreachable: form still submits; server fails closed when
        // TURNSTILE_SECRET_KEY is configured. Nothing else to do client-side.
      });
    return () => {
      cancelled = true;
    };
  }, [siteKey, action, appearance]);

  // Fresh single-use token for retries: reset only on transition TO idle.
  useEffect(() => {
    if (prevResetKey.current !== "idle" && resetKey === "idle" && widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // ignore
      }
    }
    prevResetKey.current = resetKey;
  }, [resetKey]);

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="cf-turnstile [&:empty]:hidden" />;
}
