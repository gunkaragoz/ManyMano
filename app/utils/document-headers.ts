// Shared by SSR and the prerendered public pages.
export const DOCUMENT_SECURITY_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  // React Router's hydration scripts need unsafe-inline; user content is
  // still escaped by React. Turnstile and Web Analytics are allowlisted.
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com https://static.cloudflareinsights.com",
    "frame-src https://challenges.cloudflare.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; "),
};

export function setDocumentSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}
