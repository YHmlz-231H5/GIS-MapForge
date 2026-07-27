/**
 * merge-helper.mjs — pure-JS OSM XML tile merger (no native osmium).
 *
 * Reads tile_*.osm XML files, dedupes by element id, writes merged.osm
 * (nodes → ways → relations). Planetiler accepts .osm as well as .pbf.
 *
 * @param {string} tileDir - directory containing tile_*.osm files
 * @returns {string} absolute path to merged.osm
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/** Extract <node|way|relation> elements (self-closing or with body). */
function extractElements(xml, tag) {
  const re = new RegExp(
    `<${tag}\\s[^>]*?/>|<${tag}\\s[\\s\\S]*?</${tag}>`,
    'g'
  );
  const out = [];
  for (const m of xml.matchAll(re)) out.push(m[0]);
  return out;
}

function elementId(el) {
  const m = /\bid="(-?\d+)"/.exec(el);
  return m ? m[1] : null;
}

export function mergePbf(tileDir) {
  const tiles = readdirSync(tileDir)
    .filter((f) => f.startsWith('tile_') && f.endsWith('.osm'))
    .map((f) => join(tileDir, f))
    .sort();

  if (tiles.length === 0) {
    throw new Error('No OSM tiles found');
  }

  const nodes = new Map();
  const ways = new Map();
  const rels = new Map();

  for (const t of tiles) {
    const xml = readFileSync(t, 'utf8');
    for (const el of extractElements(xml, 'node')) {
      const id = elementId(el);
      if (id) nodes.set(id, el);
    }
    for (const el of extractElements(xml, 'way')) {
      const id = elementId(el);
      if (id) ways.set(id, el);
    }
    for (const el of extractElements(xml, 'relation')) {
      const id = elementId(el);
      if (id) rels.set(id, el);
    }
  }

  send({
    kind: 'log',
    stream: 'out',
    line: `merge: ${nodes.size} nodes, ${ways.size} ways, ${rels.size} relations from ${tiles.length} tiles`,
  });

  const MERGED = join(tileDir, 'merged.osm');
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osm version="0.6" generator="app-map-downloader">',
    ...nodes.values(),
    ...ways.values(),
    ...rels.values(),
    '</osm>',
    '',
  ];
  writeFileSync(MERGED, parts.join('\n'), 'utf8');
  send({ kind: 'log', stream: 'out', line: `wrote ${MERGED}` });
  return MERGED;
}
