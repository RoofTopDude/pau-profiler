#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const source = resolve(root, "site");
const library = resolve(root, "dist");
const output = resolve(root, "site-dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await cp(library, resolve(output, "lib"), { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "", "utf8");

console.log(`Built static profiler at ${output}`);
