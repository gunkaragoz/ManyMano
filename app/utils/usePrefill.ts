import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  isUnsupported,
  type PrefillLoad,
  type PrefillNote,
  type PrefillSource,
  type Unsupported,
} from "~/utils/prefill";

export type PrefillNotice =
  | { kind: "applied"; source: PrefillSource; notes: PrefillNote[] }
  | { kind: "missing"; source: "template" | "clone" }
  | { kind: "unsupported"; reason: string; eventId: string | null };

/**
 * Applies a template or copy to the create form once per navigation.
 *
 * Waits until every draft field has been restored from sessionStorage, then
 * replaces them (an explicit prefill beats an old draft — the persistent
 * state saves the replacement as the new draft), and strips `template` /
 * `from` from the URL so a refresh keeps the user's edits instead of
 * re-applying the source. Missing or unsupported sources leave the draft
 * alone and only raise a notice.
 *
 * The guard is a ref keyed on the location, so repeated effects (Strict
 * Mode, loader revalidation) never apply a source twice, while opening
 * another template — a new navigation — applies again.
 */
export function usePrefill<P extends { source: PrefillSource }>({
  load,
  restored,
  apply,
}: {
  load: PrefillLoad<P>;
  restored: boolean;
  apply: (prefill: P) => { notes: PrefillNote[] } | Unsupported;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const handledKey = useRef<string | null>(null);
  const [handledState, setHandledState] = useState<string | null>(null);
  const [notice, setNotice] = useState<PrefillNotice | null>(null);

  useEffect(() => {
    if (!restored || load.status === "none" || handledKey.current === location.key) return;
    handledKey.current = location.key;
    setHandledState(location.key);

    if (load.status === "ready") {
      const result = apply(load.prefill);
      const source = load.prefill.source;
      setNotice(
        isUnsupported(result)
          ? { kind: "unsupported", reason: result.reason, eventId: source.kind === "clone" ? source.eventId : null }
          : { kind: "applied", source, notes: result.notes }
      );
    } else if (load.status === "missing") {
      setNotice({ kind: "missing", source: load.source });
    } else {
      setNotice({ kind: "unsupported", reason: load.reason, eventId: load.eventId });
    }

    const params = new URLSearchParams(location.search);
    params.delete("template");
    params.delete("from");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true, preventScrollReset: true }
    );
    // `apply` closes over the form's setters, which are stable; the effect
    // must only re-run for a new load or navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, load, location.key]);

  return {
    /** True until a ready prefill has been applied — keep submit disabled. */
    pending: load.status === "ready" && handledState !== location.key,
    notice,
    dismiss: () => setNotice(null),
  };
}
