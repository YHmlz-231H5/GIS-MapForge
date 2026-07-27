#!/usr/bin/env node
/** Copy vendor JS + map-assets (fonts/sprites) into dist/ for Electron file:// */
const { cpSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const distVendor = join(root, 'dist', 'vendor');
mkdirSync(distVendor, { recursive: true });

for (const f of ['maplibre-gl.js', 'maplibre-gl.css', 'pmtiles.js', 'suppress-csp-warning.js']) {
  const s = join(root, 'vendor', f);
  if (existsSync(s)) cpSync(s, join(distVendor, f));
}

const assets = join(root, 'vendor', 'map-assets');
if (existsSync(assets)) {
  cpSync(assets, join(distVendor, 'map-assets'), { recursive: true });
  console.log('[copy-vendor] map-assets copied');
} else {
  console.warn('[copy-vendor] vendor/map-assets missing — run scripts/fetch-map-assets.cjs');
}
console.log('[copy-vendor] done');
