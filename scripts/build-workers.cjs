#!/usr/bin/env node
// Build .mjs worker scripts (not bundled, since they dynamically
// `import` osmium at runtime — only transpiled by esbuild's
// `format: esm` so callers can spawn with `node`).

const { build, context } = require("esbuild");
const path = require("path");

const watch = process.argv.includes("--watch");

const config = {
  entryPoints: [
    path.resolve(__dirname, "../src/main/tasks/handlers/pbf-osm-api.worker.mjs"),
    path.resolve(__dirname, "../src/main/tasks/handlers/merge-helper.mjs"),
    path.resolve(__dirname, "../src/main/tasks/handlers/raster-xyz.worker.mjs"),
  ],
  outdir: path.resolve(__dirname, "../dist-electron/workers"),
  outExtension: { '.js': '.mjs' },  // preserve ESM extension for Node loader
  bundle: false,  // let Node resolve deps from project root node_modules
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
};

async function run() {
  if (watch) {
    const ctx = await context(config);
    await ctx.watch();
    console.log("Watching worker scripts for changes...");
  } else {
    await build(config);
    console.log(`Built worker scripts to ${config.outdir}`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
