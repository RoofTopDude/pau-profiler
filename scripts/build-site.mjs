#!/usr/bin/env node
/**
 * Assembles the static profiler into site-dist/.
 *
 * The compiled library is copied to site-dist/lib because site/app.js imports it as
 * "./lib/index.js". Publishing the site without this step leaves the page rendering but the
 * profiler dead, so the build verifies its own output before declaring success: the library
 * entry point must exist, and every local asset index.html references must be present.
 */
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
await verifyReferencedAssets();

const files = await readdir(output);
console.log(`Built static profiler at ${output} (${files.length} top-level entries).`);

/**
 * Every local file index.html points at must exist in the output. A renamed or deleted asset
 * is otherwise invisible until someone loads the published page and sees a broken image.
 */
async function verifyReferencedAssets() {
  const html = await readFile(resolve(output, "index.html"), "utf8");
  const references = new Set();

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    // Skip anchors, absolute URLs, and protocol-relative links; only local files are ours.
    if (!target || target.startsWith("#") || target.startsWith("//") || /^[a-z]+:/i.test(target)) {
      continue;
    }
    references.add(target.split("?")[0]);
  }

  const missing = [];
  for (const reference of references) {
    try {
      await access(resolve(output, reference));
    } catch {
      missing.push(reference);
    }
  }

  if (missing.length > 0) {
    console.error(`build-site: index.html references missing asset(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`Verified ${references.size} referenced asset(s).`);
}

async function assertExists(path, message) {
  try {
    await access(path);
  } catch {
    console.error(`build-site: ${message}`);
    process.exit(1);
  }
}
