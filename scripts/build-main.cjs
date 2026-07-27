// Build main process bundle using esbuild
const { build, context } = require("esbuild");
const path = require("path");

const watch = process.argv.includes("--watch");

const config = {
  entryPoints: [path.resolve(__dirname, "../src/main/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron", "better-sqlite3", "osmium"],
  sourcemap: true,
  logLevel: "info",
  outfile: path.resolve(__dirname, "../dist-electron/main/index.cjs"),
};

async function run() {
  if (watch) {
    const ctx = await context(config);
    await ctx.watch();
    console.log("Watching main process for changes...");
  } else {
    await build(config);
    console.log(`Built: ${config.outfile}`);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
