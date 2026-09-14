import QRCode from "qrcode";

/**
 * QR codes encode the public event URL so scanning opens the event page.
 * Generated server-side with the pure-JS `qrcode` package (no canvas,
 * no native deps) so it runs on Cloudflare Workers (nodejs_compat provides
 * Buffer for PNG output).
 */

export function eventQrValue(eventId: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/events/${eventId}`;
}

const PNG_OPTIONS = {
  width: 440,
  margin: 1,
  errorCorrectionLevel: "M" as const,
};

/** PNG bytes for `<img>` / email usage. Throws on generation failure. */
export async function qrPngBytes(text: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(text, PNG_OPTIONS);
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Inline SVG string (fallback / download option). Throws on failure. */
export async function qrSvgString(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
