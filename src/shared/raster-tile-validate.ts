/**
 * Detect blocked / non-image tile payloads (OSM "Access blocked" PNG, HTML 403 pages, etc.).
 */

export function isImageMagic(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // WebP (RIFF....WEBP)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Scan ASCII/latin1 for common block / error pages embedded in a 200 response. */
export function looksLikeBlockedTile(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 4096);
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(buf[i]!);
  return /access\s*blocked|cloudflare|forbidden|access denied|rate.?limit|captcha/i.test(s);
}

export function validateRasterTileBytes(buf: Uint8Array): { ok: true } | { ok: false; reason: string } {
  if (!buf.length) return { ok: false, reason: 'empty body' };
  if (looksLikeBlockedTile(buf)) return { ok: false, reason: 'blocked / error page in body' };
  if (!isImageMagic(buf)) return { ok: false, reason: 'not an image (bad magic)' };
  return { ok: true };
}
