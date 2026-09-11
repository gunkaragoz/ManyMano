import { useEffect, useState, type RefObject } from "react";

export const CREATE_STICKY_HEADER_EVENT = "manymano:create-sticky-header";

export type CreateStickyHeaderDetail = {
  title: string;
  date: string;
  visible: boolean;
};

export function emitCreateStickyHeader(detail: CreateStickyHeaderDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CreateStickyHeaderDetail>(CREATE_STICKY_HEADER_EVENT, { detail }));
}

/**
 * Observes `sentinelRef` (a 1px marker placed immediately after the
 * Meeting/Event Title + Date fields). Once that point scrolls under the
 * sticky nav, emits the current title + date so the global navigation
 * header can show them readonly. Emits `visible: false` on unmount so the
 * header clears on route change.
 */
export function useCreateStickyHeader(
  title: string,
  date: string,
  sentinelRef: RefObject<HTMLElement>
) {
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof window === "undefined") return;

    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Sentinel above (or under) the ~72px sticky nav => title/date no longer visible.
        setScrolledPast(el.getBoundingClientRect().top < 80);
      });
    };

    // Initial check (covers restore-scroll / deep links landing mid-page).
    check();

    // IntersectionObserver gives us automatic updates; the scroll/resize
    // listeners are a fallback so it also updates when IO is throttled
    // or the sentinel moves without an intersection change.
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(check, { threshold: 0 })
        : null;
    observer?.observe(el);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      cancelAnimationFrame(raf);
    };
    // Ref object identity is stable; observe once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hasContent = title.trim().length > 0 || (date ?? "").trim().length > 0;
    emitCreateStickyHeader({
      title,
      date,
      visible: scrolledPast && hasContent,
    });
  }, [title, date, scrolledPast]);

  useEffect(() => {
    return () => emitCreateStickyHeader({ title: "", date: "", visible: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function formatStickyDate(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
