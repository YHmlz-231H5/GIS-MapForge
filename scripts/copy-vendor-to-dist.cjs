#!/usr/bin/env node
/** Copy runtime vendor assets into dist/ for Electron file:// */
const { cpSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const dist = join(root, 'dist');
const distVendor = join(dist, 'vendor');
mkdirSync(distVendor, { recursive: true });

const csp = join(root, 'vendor', 'suppress-csp-warning.js');
if (existsSync(csp)) cpSync(csp, join(distVendor, 'suppress-csp-warning.js'));

const favicon = join(root, 'public', 'favicon.png');
if (existsSync(favicon)) {
  cpSync(favicon, join(dist, 'favicon.png'));
  console.log('[copy-vendor] favicon.png copied');
}

const assets = join(root, 'vendor', 'map-assets');
if (existsSync(assets)) {
  cpSync(assets, join(distVendor, 'map-assets'), { recursive: true });
  console.log('[copy-vendor] map-assets copied');
} else {
  console.warn('[copy-vendor] vendor/map-assets missing — run npm run fetch:map-assets');
}
console.log('[copy-vendor] done');
