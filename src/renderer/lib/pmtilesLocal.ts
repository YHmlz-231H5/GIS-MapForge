/**
 * Shared local PMTiles protocol helpers for Electron preview / style studio.
 *
 * Tile bytes are read via custom scheme `pmtiles-range://` (main process
 * protocol.handle), NOT ipcRenderer.invoke — IPC structured-clone of
 * ArrayBuffer has corrupted MVT payloads (adjacent tiles looking like
 * different zoom / LOD seams).
 */
import maplibregl from 'maplibre-gl';
import { Protocol, PMTiles } from 'pmtiles';

let protocolSingleton: Protocol | null = null;

export function ensurePmtilesProtocol(): Protocol {
  if (!protocolSingleton) {
    protocolSingleton = new Protocol({ metadata: true });
    maplibregl.addProtocol('pmtiles', protocolSingleton.tile);
  }
  return protocolSingleton;
}

/** Build a fetch URL handled by main `pmtiles-range` protocol. */
export function pmtilesRangeUrl(filePath: string, offset: number, length: number): string {
  const u = new URL('pmtiles-range://localhost/');
  u.searchParams.set('path', filePath);
  u.searchParams.set('o', String(Math.floor(offset)));
  u.searchParams.set('l', String(Math.floor(length)));
  return u.toString();
}

/**
 * Guarantee an ArrayBuffer whose byteLength === payload length.
 * Never return TypedArray.buffer (may be a larger pooled slab).
 */
export function toExactArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const src =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new ArrayBuffer(src.byteLength);
  new Uint8Array(out).set(src);
  return out;
}

export class ElectronFileSource {
  constructor(
    private filePath: string,
    private key: string
  ) {}

  getKey() {
    return this.key;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal) {
    const url = pmtilesRangeUrl(this.filePath, offset, length);
    const res = await fetch(url, { signal, cache: 'no-store' });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`pmtiles-range ${res.status}: ${msg || 'read failed'}`);
    }
    const raw = await res.arrayBuffer();
    const data = toExactArrayBuffer(raw);
    if (data.byteLength === 0 && length > 0) {
      // EOF is OK (offset past end); mid-file empty is not.
      // protocol returns empty only when offset >= size.
    }
    return { data };
  }
}

export function keyForPmtilesPath(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) h = (Math.imul(31, h) + p.charCodeAt(i)) | 0;
  // Bust Protocol/MapLibre caches whenever we re-attach the same path.
  return `local-${(h >>> 0).toString(36)}-${Date.now().toString(36)}`;
}

export function attachLocalPmtiles(filePath: string): { pm: PMTiles; sourceKey: string } {
  const sourceKey = keyForPmtilesPath(filePath);
  const protocol = ensurePmtilesProtocol();
  const pm = new PMTiles(new ElectronFileSource(filePath, sourceKey));
  protocol.add(pm);
  return { pm, sourceKey };
}
