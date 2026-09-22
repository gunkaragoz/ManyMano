export function escapeHtml(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A location can be an address ("Room 302") or a meeting link
 * ("https://meet.google.com/xyz"). Returns the value as a safe absolute URL
 * when it is one, else null — only http(s) is accepted, so a "javascript:" or
 * "data:" value is never turned into a link.
 */
export function asExternalUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || /\s/.test(raw)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Bare words like "Gym" parse as https://gym — require a dot in the host so
  // a plain room name never becomes a link.
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

/** A location line for an HTML email: linked when it is a meeting link. */
export function locationHtml(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const url = asExternalUrl(raw);
  const body = url
    ? `<a href="${escapeHtml(url)}" style="color: #2563eb;">${escapeHtml(raw)}</a>`
    : escapeHtml(raw);
  return `<p><strong>Location:</strong> ${body}</p>`;
}
