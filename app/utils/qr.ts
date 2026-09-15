import QRCode from "qrcode";

/**
 * QR codes encode the public event URL so scanning opens the event page.
 *
 * SVG generation is pure string building. PNG generation below is a small
 * Workers-native encoder (QR matrix from the pure-JS `qrcode` core +
 * `CompressionStream` deflate + hand-assembled PNG chunks) so `?format=png`
 * works on Pages Functions with zero Node APIs — the previous `pngjs`
 * path (`QRCode.toBuffer`) needs `nodejs_compat` and 500s without it.
 * On-page `<img>` embeds use PNG so right-click copy/save yields a PNG;
 * SVG remains available via `?format=svg` as a fallback.
 */

export function eventQrValue(eventId: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/events/${eventId}`;
}

const PNG_TARGET_WIDTH = 440;
const PNG_MARGIN_MODULES = 1;

/** PNG bytes for `<img>` / email usage. Throws on generation failure. */
export async function qrPngBytes(text: string): Promise<Uint8Array> {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const matrix = qr.modules.data as ArrayLike<number>;
  const margin = PNG_MARGIN_MODULES;
  const scale = Math.max(1, Math.floor(PNG_TARGET_WIDTH / (n + margin * 2)));
  const size = (n + margin * 2) * scale;

  // 8-bit grayscale, 1 byte/px, filter type 0 on every scanline.
  const raw = new Uint8Array((size + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: None
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin;
      const dark = mx >= 0 && mx < n && my >= 0 && my < n && matrix[my * n + mx];
      raw[p++] = dark ? 0 : 255;
    }
  }

  const idat = await deflateZlib(raw);
  return assemblePng(size, size, idat);
}

/** Inline SVG string (fallback / download option). Throws on failure. */
export async function qrSvgString(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

/** Raw-deflate via the Web `CompressionStream`, wrapped as a zlib stream. */
async function deflateZlib(input: Uint8Array): Promise<Uint8Array> {
  // "deflate-raw" (no header/trailer) + explicit zlib wrap — fully explicit,
  // identical behavior in Workers and Node.
  const deflated = new Uint8Array(
    await new Response(
      new Response(input as BodyInit).body!.pipeThrough(new CompressionStream("deflate-raw"))
    ).arrayBuffer()
  );
  const out = new Uint8Array(deflated.length + 6);
  out[0] = 0x78;
  out[1] = 0x9c; // zlib header: deflate, 32K window
  out.set(deflated, 2);
  writeUint32BE(out, out.length - 4, adler32(input));
  return out;
}

function assemblePng(width: number, height: number, idat: Uint8Array): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return concatBytes(
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0))
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32BE(out, 0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeUint32BE(out, 8 + data.length, crc32(concatBytes(typeBytes, data)));
  return out;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0);
}
