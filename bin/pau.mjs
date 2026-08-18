#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";
import {
  analyzeTrace,
  buildOptimizationPlan,
  compareReceipts,
  evaluateBudget,
  getProfile,
  normalizeTrace,
  profileFor
} from "../dist/index.js";

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "help" || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}

try {
  if (command === "analyze") await analyzeCommand(args);
  else if (command === "plan") await planCommand(args);
  else if (command === "compare") await compareCommand(args);
  else if (command === "check") await checkCommand(args);
  else if (command === "convert") await convertCommand(args);
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`PAU command failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function analyzeCommand(values) {
  const file = requiredFile(values[1]);
  const receipt = await analyzeFile(file, values);
  if (hasFlag(values, "--json")) console.log(JSON.stringify(receipt, null, 2));
  else printReceipt(receipt);
}

async function planCommand(values) {
  const file = requiredFile(values[1]);
  const receipt = await analyzeFile(file, values);
  const policy = optionValue(values, "--policy") ?? "balanced";
  if (!["conservative", "balanced", "aggressive"].includes(policy)) {
    throw new Error("--policy must be conservative, balanced, or aggressive.");
  }
  const plan = buildOptimizationPlan(receipt, policy);
  if (hasFlag(values, "--json")) console.log(JSON.stringify(plan, null, 2));
  else printPlan(plan);
}

async function compareCommand(values) {
  const baselineFile = requiredFile(values[1]);
  const candidateFile = requiredFile(values[2]);
  const baseline = await analyzeFile(baselineFile, values);
  const candidate = await analyzeFile(candidateFile, values);
  const comparison = compareReceipts(baseline, candidate);
  if (hasFlag(values, "--json")) console.log(JSON.stringify(comparison, null, 2));
  else printComparison(comparison);
}

async function checkCommand(values) {
  const file = requiredFile(values[1]);
  const receipt = await analyzeFile(file, values);
  const thresholds = {
    maxTokens: numberOptionAny(values, "--max-tokens"),
    maxRawUtilization: numberOptionAny(values, "--max-raw", "--max-raw-utilization"),
    maxPAUUtilization: numberOptionAny(values, "--max-pau", "--max-pau-utilization"),
    maxDuplicateTokenRatio: numberOptionAny(values, "--max-duplicate", "--max-duplicate-ratio"),
    maxReplayOverheadRatio: numberOptionAny(values, "--max-replay", "--max-replay-overhead"),
    maxHogScore: numberOptionAny(values, "--max-hog", "--max-hog-score"),
    minContextHealthScore: numberOptionAny(values, "--min-health", "--min-context-health"),
    minPigEfficiency: numberOptionAny(values, "--min-efficiency", "--min-pig-efficiency")
  };
  for (const key of Object.keys(thresholds)) {
    if (thresholds[key] === undefined) delete thresholds[key];
  }
  if (Object.keys(thresholds).length === 0) {
    throw new Error("check requires at least one threshold flag.");
  }
  const result = evaluateBudget(receipt, thresholds);
  if (hasFlag(values, "--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(result.passed ? "PAU budget: PASS" : "PAU budget: FAIL");
    for (const violation of result.violations) {
      console.log(`- ${violation.message} actual=${violation.actual} threshold=${violation.threshold}`);
    }
  }
  if (!result.passed) process.exitCode = 2;
}

async function convertCommand(values) {
  const file = requiredFile(values[1]);
  const input = JSON.parse(await fs.readFile(file, "utf8"));
  const trace = normalizeTrace(input, normalizationOptions(values));
  console.log(JSON.stringify(trace, null, 2));
}

async function analyzeFile(file, values) {
  const input = JSON.parse(await fs.readFile(file, "utf8"));
  const trace = normalizeTrace(input, normalizationOptions(values));
  const profile = resolveProfile(optionValue(values, "--profile"), trace.analysisMode);
  return analyzeTrace(trace, {
    profile,
    nearDuplicates: !hasFlag(values, "--no-near-duplicates")
  });
}

function normalizationOptions(values) {
  const format = optionValue(values, "--format") ?? "auto";
  if (!["auto", "pau", "openai", "anthropic", "messages"].includes(format)) {
    throw new Error("--format must be auto, pau, openai, anthropic, or messages.");
  }
  const result = { format };
  const contextWindow = numberOption(values, "--context-window");
  if (contextWindow !== undefined) result.contextWindow = contextWindow;
  const model = optionValue(values, "--model");
  if (model !== undefined) result.model = model;
  return result;
}

function resolveProfile(name, mode) {
  if (!name) return profileFor(mode ?? "heuristic");
  if (name === "basic") return profileFor("basic");
  if (name === "heuristic") return profileFor("heuristic");
  return getProfile(name, mode);
}

function requiredFile(value) {
  if (!value || value.startsWith("--")) throw new Error("A JSON file path is required.");
  return value;
}

function optionValue(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function numberOption(values, flag) {
  const value = optionValue(values, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be numeric.`);
  return parsed;
}

function numberOptionAny(values, ...flags) {
  for (const flag of flags) {
    const result = numberOption(values, flag);
    if (result !== undefined) return result;
  }
  return undefined;
}

function hasFlag(values, flag) {
  return values.includes(flag);
}

function printReceipt(receipt) {
  const percent = (value) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const number = (value) => value === null ? "n/a" : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  console.log(`PAU CONTEXT RECEIPT${receipt.runId ? ` - ${receipt.runId}` : ""}`);
  console.log("-".repeat(68));
  console.log(`Profile             ${receipt.profile}`);
  console.log(`Physical tokens     ${number(receipt.totalTokens)}`);
  console.log(`PAU load            ${number(receipt.totalPAU)} PAU`);
  console.log(`Raw utilization     ${percent(receipt.rawUtilization)}`);
  console.log(`PAU utilization     ${percent(receipt.pauUtilization)}`);
  console.log(`Pig efficiency      ${percent(receipt.pigEfficiency)}`);
  console.log(`Duplicate tokens    ${percent(receipt.duplicateTokenRatio)}`);
  console.log(`Replay overhead     ${percent(receipt.replayOverheadRatio)}`);
  console.log(`Context health      ${receipt.contextHealthScore}/100`);
  console.log(`Max hog score       ${receipt.maxHogScore.toFixed(1)}/10`);
  console.log("");

  const hogs = [...receipt.segments]
    .sort((a, b) => b.effectiveHogScore - a.effectiveHogScore)
    .slice(0, 5);
  console.log("TOP CONTEXT HOGS");
  console.log("-".repeat(68));
  for (const [index, segment] of hogs.entries()) {
    console.log(`${index + 1}. ${segment.id} [${segment.type}]`);
    console.log(`   ${segment.tokens.toLocaleString()} tokens | ${segment.pau.toLocaleString()} PAU | ${segment.effectiveHogScore.toFixed(1)}/10 ${segment.hogSeverity} | ${segment.scoreConfidence} confidence`);
    if (segment.recommendations[0]) console.log(`   ${segment.recommendations[0]}`);
  }
  if (receipt.warnings.length > 0) {
    console.log("\nWARNINGS");
    for (const warning of receipt.warnings) console.log(`- ${warning}`);
  }
}

function printPlan(plan) {
  console.log(`PAU OPTIMIZATION PLAN - ${plan.policy}`);
  console.log("-".repeat(68));
  console.log(`Current-context savings   ${plan.totalCurrentTokenSavings.toLocaleString()} tokens`);
  console.log(`Future replay savings     ${plan.totalFutureReplayTokenSavings.toLocaleString()} tokens`);
  console.log(`Projected context         ${plan.projectedTotalTokens.toLocaleString()} tokens`);
  console.log(`Projected PAU             ${plan.projectedTotalPAU.toLocaleString()} PAU`);
  console.log("");
  for (const action of plan.actions.slice(0, 10)) {
    console.log(`${action.action.toUpperCase()} ${action.segmentId}`);
    console.log(`  save ${action.currentTokenSavings.toLocaleString()} now / ${action.futureReplayTokenSavings.toLocaleString()} replay tokens | ${action.confidence}`);
    console.log(`  ${action.reason}`);
  }
}

function printComparison(comparison) {
  console.log(`PAU COMPARISON - ${comparison.verdict.toUpperCase()}`);
  console.log("-".repeat(68));
  for (const finding of comparison.findings) console.log(`- ${finding}`);
}

function printUsage() {
  console.log(`PAU Profiler CLI

Usage:
  pau analyze <trace.json> [--format auto|pau|openai|anthropic] [--profile basic|heuristic|coding|rag|browser] [--json]
  pau plan <trace.json> [--policy conservative|balanced|aggressive] [--json]
  pau compare <baseline.json> <candidate.json> [--json]
  pau check <trace.json> --max-hog-score 7 --max-replay-overhead 0.25 --min-context-health 70
  pau convert <messages.json> [--format auto|openai|anthropic]

Shared options:
  --context-window <tokens>
  --model <name>
  --no-near-duplicates
`);
}
