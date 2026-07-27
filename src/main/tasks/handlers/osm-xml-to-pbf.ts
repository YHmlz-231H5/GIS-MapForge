/**
 * Convert OSM XML (.osm) → OSM PBF (.osm.pbf) via @osmix/pbf (pure JS).
 */
import { readFileSync, writeFileSync } from 'fs';
import { osmBlockToPbfBlobBytes, concatUint8, MAX_ENTITIES_PER_BLOCK } from '@osmix/pbf';

const encoder = new TextEncoder();
const GRANULARITY = 1e7;

function extractElements(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\s[^>]*?/>|<${tag}\\s[\\s\\S]*?</${tag}>`, 'g');
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[0]);
  return out;
}

function attr(el: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(el);
  return m ? m[1] : null;
}

function parseTags(el: string): Array<[string, string]> {
  const tags: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const m of el.matchAll(/<tag\s+k="([^"]*)"\s+v="([^"]*)"\s*\/>/g)) {
    const key = `${m[1]}\0${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push([m[1], m[2]]);
  }
  return tags;
}

function parseNodeRefs(el: string): bigint[] {
  const refs: bigint[] = [];
  for (const m of el.matchAll(/<nd\s+ref="(-?\d+)"\s*\/>/g)) refs.push(BigInt(m[1]));
  return refs;
}

function parseMembers(el: string): Array<{ type: string; ref: bigint; role: string }> {
  const members: Array<{ type: string; ref: bigint; role: string }> = [];
  for (const m of el.matchAll(/<member\s+([^>]+?)\s*\/>/g)) {
    const attrs = m[1];
    const type = /type="(node|way|relation)"/.exec(attrs)?.[1];
    const ref = /ref="(-?\d+)"/.exec(attrs)?.[1];
    const role = /role="([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (type && ref) members.push({ type, ref: BigInt(ref), role });
  }
  return members;
}

class StringTable {
  map = new Map<string, number>([['', 0]]);
  list: Uint8Array[] = [encoder.encode('')];
  sid(s: string): number {
    const key = s ?? '';
    let i = this.map.get(key);
    if (i !== undefined) return i;
    i = this.list.length;
    this.map.set(key, i);
    this.list.push(encoder.encode(key));
    return i;
  }
}

function deltaEncode(values: bigint[]): number[] {
  const out: number[] = [];
  let prev = 0n;
  for (const v of values) {
    out.push(Number(v - prev));
    prev = v;
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

const TYPE_CODE: Record<string, number> = { node: 0, way: 1, relation: 2 };

export async function convertOsmXmlToPbf(
  osmPath: string,
  pbfPath: string
): Promise<{ nodes: number; ways: number; relations: number; bytes: number }> {
  const xml = readFileSync(osmPath, 'utf8');
  const nodeEls = extractElements(xml, 'node').sort(
    (a, b) => Number(attr(a, 'id')) - Number(attr(b, 'id'))
  );
  const wayEls = extractElements(xml, 'way').sort(
    (a, b) => Number(attr(a, 'id')) - Number(attr(b, 'id'))
  );
  const relEls = extractElements(xml, 'relation').sort(
    (a, b) => Number(attr(a, 'id')) - Number(attr(b, 'id'))
  );

  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const el of nodeEls) {
    const lat = parseFloat(attr(el, 'lat') || 'NaN');
    const lon = parseFloat(attr(el, 'lon') || 'NaN');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  const header: Parameters<typeof osmBlockToPbfBlobBytes>[0] = {
    required_features: ['OsmSchema-V0.6'],
    optional_features: [],
    writingprogram: 'app-map-downloader',
    source: 'Overpass/OSM XML',
  };
  if (Number.isFinite(minLon)) {
    (header as { bbox: { left: number; right: number; top: number; bottom: number } }).bbox = {
      left: minLon,
      right: maxLon,
      top: maxLat,
      bottom: minLat,
    };
  }

  const parts: Uint8Array[] = [await osmBlockToPbfBlobBytes(header)];
  const limit = Math.min(MAX_ENTITIES_PER_BLOCK || 8000, 4000);

  for (const batch of chunk(nodeEls, limit)) {
    if (!batch.length) continue;
    const st = new StringTable();
    const nodes = batch.map((el) => {
      const tags = parseTags(el);
      return {
        id: Number(attr(el, 'id')),
        lat: Math.round(parseFloat(attr(el, 'lat') || '0') * GRANULARITY),
        lon: Math.round(parseFloat(attr(el, 'lon') || '0') * GRANULARITY),
        keys: tags.map(([k]) => st.sid(k)),
        vals: tags.map(([, v]) => st.sid(v)),
      };
    });
    parts.push(
      await osmBlockToPbfBlobBytes({
        stringtable: st.list,
        granularity: GRANULARITY,
        primitivegroup: [{ nodes, ways: [], relations: [] }],
      })
    );
  }

  for (const batch of chunk(wayEls, limit)) {
    if (!batch.length) continue;
    const st = new StringTable();
    const ways = batch.map((el) => {
      const tags = parseTags(el);
      return {
        id: Number(attr(el, 'id')),
        keys: tags.map(([k]) => st.sid(k)),
        vals: tags.map(([, v]) => st.sid(v)),
        refs: deltaEncode(parseNodeRefs(el)),
      };
    });
    parts.push(
      await osmBlockToPbfBlobBytes({
        stringtable: st.list,
        granularity: GRANULARITY,
        primitivegroup: [{ nodes: [], ways, relations: [] }],
      })
    );
  }

  for (const batch of chunk(relEls, limit)) {
    if (!batch.length) continue;
    const st = new StringTable();
    const relations = batch.map((el) => {
      const tags = parseTags(el);
      const members = parseMembers(el);
      return {
        id: Number(attr(el, 'id')),
        keys: tags.map(([k]) => st.sid(k)),
        vals: tags.map(([, v]) => st.sid(v)),
        roles_sid: members.map((m) => st.sid(m.role)),
        memids: deltaEncode(members.map((m) => m.ref)),
        types: members.map((m) => TYPE_CODE[m.type] ?? 0),
      };
    });
    parts.push(
      await osmBlockToPbfBlobBytes({
        stringtable: st.list,
        granularity: GRANULARITY,
        primitivegroup: [{ nodes: [], ways: [], relations }],
      })
    );
  }

  const fileBytes = concatUint8(...parts);
  writeFileSync(pbfPath, Buffer.from(fileBytes));
  return {
    nodes: nodeEls.length,
    ways: wayEls.length,
    relations: relEls.length,
    bytes: fileBytes.byteLength,
  };
}
