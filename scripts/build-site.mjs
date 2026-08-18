#!/usr/bin/env node
/**
 * Assembles the static profiler into site-dist/.
 *
 * The compiled library is copied to site-dist/lib because site/app.js imports it as
 * "./lib/index.js". Publishing the site without this step leaves the page rendering but the
 * profiler dead, so the build verifies the entry point exists before declaring success.
 */
import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "site");
const library = resolve(root, "dist");
const output = resolve(root, "site-dist");

await assertExists(resolve(library, "index.js"), 'dist/index.js is missing. Run "npm run build" first.');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(library, resolve(output, "lib"), { recursive: true });

// Bypasses Jekyll on GitHub Pages so directories such as lib/ are served verbatim.
await writeFile(resolve(output, ".nojekyll"), "", "utf8");

await assertExists(
  resolve(output, "lib", "index.js"),
  "site-dist/lib/index.js was not produced; the profiler would fail to load."
);
await assertExists(resolve(output, "index.html"), "site-dist/index.html is missing.");

const files = await readdir(output);
console.log(`Built static profiler at ${output} (${files.length} top-level entries).`);

async function assertExists(path, message) {
  try {
    await access(path);
  } catch {
    console.error(`build-site: ${message}`);
    process.exit(1);
  }
}
