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
 * Observes `sentinelRef` (placed around the Meeting/Event Title field).
 * Once the title scrolls out of view above the sticky nav, emits the
 * current title + date so the global navigation header can show them readonly.
 * Emits `visible: false` on unmount so the header clears on route change.
 */
export function useCreateStickyHeader(
  title: string,
  date: string,
  sentinelRef: RefObject<HTMLElement>
) {
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Sentinel sits immediately after the Title + Date fields.
        // Show the header pill as soon as that point scrolls under the
        // sticky nav (rootMargin offsets for the ~72px header height).
        setScrolledPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0, rootMargin: "-72px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
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
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
