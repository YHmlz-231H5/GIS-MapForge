import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Renderer-only build. Main + preload compiled separately via tsc.
const CSP_DEV =
  // Dev: allow vite HMR (unsafe-eval, inline, localhost ws).
  // Electron flags this as "Insecure CSP" only in prod logs, but DevTools
  // warning only fires in PACKAGED builds (per Electron docs). In dev we
  // intentionally relax.
  "default-src 'self' 'unsafe-inline' data: blob: http://localhost:* ws://localhost:* https: pmtiles-range:; " +
  "img-src 'self' data: blob: https: http://localhost:*; " +
  "connect-src 'self' data: blob: https: http: ws://localhost:* wss://localhost:* http://localhost:* pmtiles-range:; " +
  "worker-src 'self' blob: https:; " +
  "style-src 'self' 'unsafe-inline' https:; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* https:; " +
  "font-src 'self' data: https:; " +
  "media-src 'self' data: blob: https:;";

const CSP_PROD =
  // Prod: tighter — no eval, no inline scripts (still allows data: for pmtiles).
  "default-src 'self' data: blob: https: pmtiles-range:; " +
  "img-src 'self' data: blob: https:; " +
  "connect-src 'self' data: blob: https: pmtiles-range:; " +
  "worker-src 'self' blob: https:; " +
  "style-src 'self' 'unsafe-inline' https:; " +
  "script-src 'self'; " +
  "font-src 'self' data: https:; " +
  "media-src 'self' data: blob: https:;";

export default defineConfig(({ command }) => ({
  base: './',
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src/renderer'),
      '@shared': path.join(__dirname, 'src/shared'),
      'vendor': path.join(__dirname, 'vendor'),
    },
  },
  // Serve project-root vendor/ (maplibre + map-assets fonts/sprites) in dev
  publicDir: false,
  plugins: [
    react(),
    {
      name: 'csp-substitute',
      transformIndexHtml(html) {
        const isBuild = command === 'build';
        const csp = isBuild ? CSP_PROD : CSP_DEV;
        return html.replace(/%CSP_RULES%/g, csp);
      },
    },
    {
      name: 'serve-vendor-static',
      configureServer(server) {
        const vendorRoot = path.resolve(__dirname, 'vendor');
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/vendor/')) return next();
          const rel = decodeURIComponent(req.url.split('?')[0]!.replace(/^\/vendor\/?/, ''));
          const fsPath = path.resolve(vendorRoot, rel);
          if (!fsPath.startsWith(vendorRoot + path.sep) && fsPath !== vendorRoot) return next();

          // Missing glyph PBFs must NOT fall through to Vite's HTML SPA —
          // MapLibre parsing HTML as PBF → "Unimplemented type: 4" + LOD seams.
          const isGlyphPbf =
            rel.replace(/\\/g, '/').includes('map-assets/fonts/') && rel.endsWith('.pbf');
          if (!fs.existsSync(fsPath) || !fs.statSync(fsPath).isFile()) {
            if (isGlyphPbf) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/x-protobuf');
              res.end();
              return;
            }
            return next();
          }
          if (fsPath.endsWith('.pbf')) res.setHeader('Content-Type', 'application/x-protobuf');
          else if (fsPath.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
          else if (fsPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
          else if (fsPath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
          else if (fsPath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
          fs.createReadStream(fsPath).pipe(res);
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
    copyPublicDir: false,
  },
}));
