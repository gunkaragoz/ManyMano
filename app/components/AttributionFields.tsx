import { useEffect, useState } from "react";
import { readAttribution, type StoredAttribution } from "~/utils/attribution";

/**
 * Hidden inputs carrying the visit's landing page + channel into a create
 * form, so the action can count the conversion (see app/utils/conversions.ts).
 * Filled after hydration; a no-JS submit is simply counted as unattributed.
 */
export function AttributionFields() {
  const [attr, setAttr] = useState<StoredAttribution | null>(null);
  useEffect(() => setAttr(readAttribution()), []);
  if (!attr) return null;
  return (
    <>
      <input type="hidden" name="attrLanding" value={attr.landing} />
      <input type="hidden" name="attrChannel" value={attr.channel} />
    </>
  );
}
