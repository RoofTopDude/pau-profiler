import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../bin/pau.mjs", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const trace = "examples/research-agent.json";

/**
 * Runs the CLI and resolves with stdout, stderr, and the exit code. Non-zero exits are
 * expected for budget and validation failures, so they resolve rather than reject.
 *
 * stdin is always closed: commands that read a file must never be left waiting on a pipe.
 */
function pau(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
  });
}

test("help lists every command", async () => {
  const { code, stdout } = await pau(["help"]);
  assert.equal(code, 0);
  for (const command of ["analyze", "plan", "compare", "check", "series", "report", "validate", "profile", "convert"]) {
    assert.ok(stdout.includes(command), `help must document ${command}`);
  }
});

test("version reports the package version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const { code, stdout } = await pau(["--version"]);
  assert.equal(code, 0);
  assert.ok(stdout.includes(manifest.version));
});

test("analyze emits a receipt as JSON", async () => {
  const { code, stdout } = await pau(["analyze", trace, "--json"]);
  assert.equal(code, 0);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.schemaVersion, "0.3");
  assert.ok(receipt.totalTokens > 0);
  assert.ok(receipt.pauInterval.high > receipt.totalPAU);
  assert.ok(receipt.eviction.method.length > 0);
});

test("analyze reads a trace from stdin", async () => {
  const payload = await readFile(new URL(`../${trace}`, import.meta.url), "utf8");
  const { code, stdout } = await pau(["analyze", "-", "--json"], { input: payload });
  assert.equal(code, 0);
  assert.ok(JSON.parse(stdout).totalTokens > 0);
});

test("check exits 2 when a threshold is violated and 0 when met", async () => {
  const failing = await pau(["check", trace, "--max-hog-score", "1"]);
  assert.equal(failing.code, 2);
  assert.ok(failing.stdout.includes("FAIL"));

  const passing = await pau(["check", trace, "--max-hog-score", "10"]);
  assert.equal(passing.code, 0);
  assert.ok(passing.stdout.includes("PASS"));
});

test("check without any threshold is an error, not a silent pass", async () => {
  const { code, stderr } = await pau(["check", trace]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("threshold"));
});

test("check reads thresholds from a config file", async () => {
  const { code, stdout } = await pau(["check", trace, "--config", "examples/pau.config.json"]);
  assert.equal(code, 2);
  assert.ok(stdout.includes("Replay overhead exceeded."));
});

test("report renders markdown at the requested disclosure tier", async () => {
  const developer = await pau(["report", trace, "--tier", "developer"]);
  assert.equal(developer.code, 0);
  assert.ok(developer.stdout.includes("### Context hog ranking"));

  const user = await pau(["report", trace, "--tier", "user"]);
  assert.equal(user.code, 0);
  assert.ok(!user.stdout.includes("### Context hog ranking"));
});

test("an invalid tier is rejected", async () => {
  const { code, stderr } = await pau(["report", trace, "--tier", "public"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("--tier"));
});

test("series accepts multiple traces and reports growth", async () => {
  const { code, stdout } = await pau([
    "series",
    "examples/series/turn-1.json",
    "examples/series/turn-2.json",
    "examples/series/turn-3.json",
    "examples/series/turn-4.json",
    "--json"
  ]);
  assert.equal(code, 0);
  const series = JSON.parse(stdout);
  assert.equal(series.points.length, 4);
  assert.ok(series.points[3].totalTokens > series.points[0].totalTokens);
  assert.equal(series.receipts, undefined, "receipts are omitted unless requested");
});

test("validate exits 2 on a malformed trace", async () => {
  const { code, stdout } = await pau(["validate", "-", "--json"], {
    input: JSON.stringify({ segments: [{ id: "a", type: "bogus" }] })
  });
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout).valid, false);
});

test("profile prints a manifest for a named profile", async () => {
  const { code, stdout } = await pau(["profile", "coding", "--json"]);
  assert.equal(code, 0);
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.identity.profileId, "pau-coding");
});

test("convert normalizes an OpenAI payload into a PAU trace", async () => {
  const { code, stdout } = await pau(["convert", "examples/openai-messages.json", "--format", "openai"]);
  assert.equal(code, 0);
  const converted = JSON.parse(stdout);
  assert.ok(Array.isArray(converted.segments));
  assert.ok(converted.segments.length > 0);
});

test("an unknown command fails with guidance", async () => {
  const { code, stderr } = await pau(["frobnicate"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("pau help"));
});

test("a missing file fails with a readable error", async () => {
  const { code, stderr } = await pau(["analyze", "does-not-exist.json"]);
  assert.equal(code, 1);
  assert.ok(stderr.includes("pau analyze"));
});
