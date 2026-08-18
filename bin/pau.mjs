#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";
import { analyzeTrace, profileFor } from "../dist/index.js";

const args = process.argv.slice(2);
const command = args[0];

if (command !== "analyze" || !args[1]) {
  printUsage();
  process.exit(command === "--help" || command === "help" ? 0 : 1);
}

const file = args[1];
const jsonOutput = args.includes("--json");
const profileArg = optionValue(args, "--profile");

try {
  const source = await fs.readFile(file, "utf8");
  const trace = JSON.parse(source);
  const profile = profileArg ? profileFor(profileArg) : undefined;
  const receipt = analyzeTrace(trace, profile ? { profile } : {});
  if (jsonOutput) {
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    printReceipt(receipt);
  }
} catch (error) {
  console.error(`PAU analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function optionValue(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1) return undefined;
  const value = values[index + 1];
  if (value !== "basic" && value !== "heuristic") {
    throw new Error(`${flag} must be 'basic' or 'heuristic'.`);
  }
  return value;
}

function printReceipt(r) {
  const percent = (v) => v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
  const number = (v) => v === null ? "n/a" : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  console.log(`PAU CONTEXT RECEIPT${r.runId ? ` - ${r.runId}` : ""}`);
  console.log("-".repeat(60));
  console.log(`Profile             ${r.profile}`);
  console.log(`Physical tokens     ${number(r.totalTokens)}`);
  console.log(`PAU load            ${number(r.totalPAU)} PAU`);
  console.log(`Raw utilization     ${percent(r.rawUtilization)}`);
  console.log(`PAU utilization     ${percent(r.pauUtilization)}`);
  console.log(`Pig efficiency      ${percent(r.pigEfficiency)}`);
  console.log(`Duplicate tokens    ${percent(r.duplicateTokenRatio)}`);
  console.log(`Replay overhead     ${percent(r.replayOverheadRatio)}`);
  console.log(`Context health      ${r.contextHealthScore}/100`);
  console.log("");

  const hogs = [...r.segments]
    .sort((a, b) => (b.contextHogIndex ?? b.structuralPressureScore) - (a.contextHogIndex ?? a.structuralPressureScore))
    .slice(0, 5);
  console.log("TOP CONTEXT HOGS");
  console.log("-".repeat(60));
  for (const [index, segment] of hogs.entries()) {
    const score = segment.contextHogIndex ?? segment.structuralPressureScore;
    console.log(`${index + 1}. ${segment.id} [${segment.type}]`);
    console.log(`   ${segment.tokens.toLocaleString()} tokens | ${segment.pau.toLocaleString()} PAU | ${score.toFixed(1)}/10 ${segment.hogSeverity}`);
    if (segment.recommendations[0]) console.log(`   ${segment.recommendations[0]}`);
  }
}

function printUsage() {
  console.log("Usage:\n  pau analyze <trace.json> [--profile basic|heuristic] [--json]");
}
