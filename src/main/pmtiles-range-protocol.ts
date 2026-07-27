/**
 * Custom Chromium protocol for exact byte-range reads of local .pmtiles.
 *
 * Why: ipcRenderer.invoke structured-clone of ArrayBuffer/Uint8Array has been
 * observed to corrupt tile bytes in this app (looks like adjacent-tile LOD seams).
 * Fetching via protocol.handle returns a real Response.arrayBuffer() instead.
 *
 * Must call registerPmtilesRangeScheme() BEFORE app.whenReady(),
 * and registerPmtilesRangeHandler() inside whenReady().
 */
import { protocol } from 'electron';
import * as fs from 'fs';
import { resolve, normalize } from 'path';

const { existsSync, statSync, openSync, readSync, closeSync } = fs;

const SCHEME = 'pmtiles-range';

export function registerPmtilesRangeScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

function assertReadablePmtilesPath(filePath: string): string {
  const abs = resolve(normalize(filePath));
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error(`Not a file: ${abs}`);
  if (!abs.toLowerCase().endsWith('.pmtiles')) {
    throw new Error('Only .pmtiles files can be previewed');
  }
  return abs;
}

export function registerPmtilesRangeHandler() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const u = new URL(request.url);
      const filePath = u.searchParams.get('path');
      const offset = Number(u.searchParams.get('o'));
      const length = Number(u.searchParams.get('l'));

      if (!filePath) {
        return new Response('missing path', { status: 400 });
      }
      if (!Number.isFinite(offset) || !Number.isFinite(length) || offset < 0 || length <= 0) {
        return new Response('invalid range', { status: 400 });
      }
      if (length > 16 * 1024 * 1024) {
        return new Response('range too large', { status: 400 });
      }

      const abs = assertReadablePmtilesPath(filePath);
      const size = statSync(abs).size;
      if (offset >= size) {
        return new Response(new Uint8Array(0), {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '0',
          },
        });
      }

      const toRead = Math.min(Math.floor(length), size - Math.floor(offset));
      const buf = Buffer.alloc(toRead);
      const fd = openSync(abs, 'r');
      try {
        const bytesRead = readSync(fd, buf, 0, toRead, Math.floor(offset));
        const body = bytesRead === toRead ? buf : buf.subarray(0, bytesRead);
        // Copy into a standalone Uint8Array so Response never aliases Buffer pool memory.
        const exact = new Uint8Array(body.byteLength);
        exact.set(body);
        return new Response(exact, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(exact.byteLength),
            'Cache-Control': 'no-store',
          },
        });
      } finally {
        closeSync(fd);
      }
    } catch (e) {
      const msg = (e as Error).message || String(e);
      return new Response(msg, { status: 500 });
    }
  });
}

export const PMTILES_RANGE_SCHEME = SCHEME;
