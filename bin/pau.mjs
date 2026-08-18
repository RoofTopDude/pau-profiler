#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  analyzeTrace,
  analyzeTraceSeries,
  buildOptimizationPlan,
  compareReceipts,
  defineProfile,
  describeProfile,
  evaluateBudget,
  getProfile,
  normalizeTrace,
  profileFor,
  profiles,
  renderReceiptMarkdown,
  validatePAUTrace
} from "../dist/index.js";
import {
  printBudget,
  printComparison,
  printManifest,
  printPlan,
  printReceipt,
  printSeries,
  printValidation
} from "./render.mjs";

const DEFAULT_CONFIG_FILES = ["pau.config.json", ".paurc.json"];
const POLICIES = ["conservative", "balanced", "aggressive"];
const TIERS = ["user", "developer", "auditor"];
const FORMATS = ["auto", "pau", "openai", "anthropic", "messages"];

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || ["help", "--help", "-h"].includes(command)) {
  printUsage();
  process.exit(0);
}

if (["--version", "-v", "version"].includes(command)) {
  console.log(await packageVersion());
  process.exit(0);
}

try {
  const args = parseArgs(argv.slice(1));
  const config = await loadConfig(args);
  await run(command, args, config);
} catch (error) {
  console.error(`pau ${command}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function run(name, args, config) {
  switch (name) {
    case "analyze": return analyzeCommand(args, config);
    case "plan": return planCommand(args, config);
    case "compare": return compareCommand(args, config);
    case "check": return checkCommand(args, config);
    case "series": return seriesCommand(args, config);
    case "report": return reportCommand(args, config);
    case "validate": return validateCommand(args);
    case "profile": return profileCommand(args, config);
    case "convert": return convertCommand(args, config);
    default: throw new Error(`unknown command. Run "pau help" for the command surface.`);
  }
}

async function analyzeCommand(args, config) {
  const receipt = await analyzeInput(firstPath(args), args, config);
  if (args.flags.json) return emit(args, JSON.stringify(receipt, null, 2));
  if (args.flags.markdown) {
    return emit(args, renderReceiptMarkdown(receipt, { tier: resolveTier(args, config) }));
  }
  printReceipt(receipt);
}

async function planCommand(args, config) {
  const receipt = await analyzeInput(firstPath(args), args, config);
  const policy = resolvePolicy(args, config);
  const plan = buildOptimizationPlan(receipt, policy);
  if (args.flags.json) return emit(args, JSON.stringify(plan, null, 2));
  if (args.flags.markdown) {
    return emit(args, renderReceiptMarkdown(receipt, { tier: resolveTier(args, config), plan }));
  }
  printPlan(plan);
}

async function compareCommand(args, config) {
  const [baselinePath, candidatePath] = args.positional;
  if (!baselinePath || !candidatePath) throw new Error("compare requires a baseline and a candidate path.");
  const baseline = await analyzeInput(baselinePath, args, config);
  const candidate = await analyzeInput(candidatePath, args, config);
  const comparison = compareReceipts(baseline, candidate);
  if (args.flags.json) return emit(args, JSON.stringify(comparison, null, 2));
  if (args.flags.markdown) {
    return emit(args, renderReceiptMarkdown(candidate, {
      tier: resolveTier(args, config),
      title: "PAU Comparison",
      comparison
    }));
  }
  printComparison(comparison);
  if (comparison.verdict === "regressed" && args.flags["fail-on-regression"]) process.exitCode = 2;
}

async function checkCommand(args, config) {
  const receipt = await analyzeInput(firstPath(args), args, config);
  const thresholds = resolveThresholds(args, config);
  if (Object.keys(thresholds).length === 0) {
    throw new Error(
      "check requires at least one threshold, from a flag or a budget block in the config file."
    );
  }
  const result = evaluateBudget(receipt, thresholds);
  if (args.flags.json) emit(args, JSON.stringify(result, null, 2));
  else if (args.flags.markdown) {
    emit(args, renderReceiptMarkdown(receipt, { tier: resolveTier(args, config), budget: result }));
  } else printBudget(result);
  if (!result.passed) process.exitCode = 2;
}

async function seriesCommand(args, config) {
  if (args.positional.length === 0) throw new Error("series requires one or more trace paths.");
  const traces = [];
  for (const target of args.positional) {
    traces.push(await readTrace(target, args, config));
  }
  const series = analyzeTraceSeries(traces, analyzeOptions(args, config));
  if (args.flags.json) {
    // Receipts are large; the series view is about growth, so summarize by default.
    const payload = args.flags["include-receipts"] ? series : { ...series, receipts: undefined };
    return emit(args, JSON.stringify(payload, null, 2));
  }
  printSeries(series);
}

async function reportCommand(args, config) {
  const receipt = await analyzeInput(firstPath(args), args, config);
  const plan = buildOptimizationPlan(receipt, resolvePolicy(args, config));
  const thresholds = resolveThresholds(args, config);
  const options = { tier: resolveTier(args, config), plan };
  if (Object.keys(thresholds).length > 0) options.budget = evaluateBudget(receipt, thresholds);
  if (args.options.title) options.title = args.options.title;
  emit(args, renderReceiptMarkdown(receipt, options));
}

async function validateCommand(args) {
  const input = JSON.parse(await readInput(firstPath(args)));
  const result = validatePAUTrace(input);
  if (args.flags.json) emit(args, JSON.stringify(result, null, 2));
  else printValidation(result);
  if (!result.valid) process.exitCode = 2;
}

async function profileCommand(args, config) {
  const name = args.positional[0] ?? args.options.profile ?? config.profile ?? "core-heuristic";
  const manifest = describeProfile(await resolveProfile(name, undefined, config));
  if (args.flags.json) return emit(args, JSON.stringify(manifest, null, 2));
  printManifest(manifest);
}

async function convertCommand(args, config) {
  const trace = await readTrace(firstPath(args), args, config);
  emit(args, JSON.stringify(trace, null, 2));
}

async function analyzeInput(target, args, config) {
  const trace = await readTrace(target, args, config);
  const profile = await resolveProfile(
    args.options.profile ?? config.profile,
    trace.analysisMode,
    config
  );
  return analyzeTrace(trace, { ...analyzeOptions(args, config), profile });
}

async function readTrace(target, args, config) {
  const input = JSON.parse(await readInput(target));
  return normalizeTrace(input, normalizationOptions(args, config));
}

function analyzeOptions(args, config) {
  const options = {
    nearDuplicates: args.flags["no-near-duplicates"] ? false : config.nearDuplicates ?? true
  };
  const tolerance = numberOption(args, "tolerance") ?? config.evictionTolerance;
  if (tolerance !== undefined) options.evictionTolerance = tolerance;
  return options;
}

function normalizationOptions(args, config) {
  const format = args.options.format ?? config.format ?? "auto";
  if (!FORMATS.includes(format)) throw new Error(`--format must be one of: ${FORMATS.join(", ")}.`);
  const options = { format };
  const contextWindow = numberOption(args, "context-window") ?? config.contextWindow;
  if (contextWindow !== undefined) options.contextWindow = contextWindow;
  const model = args.options.model ?? config.model;
  if (model !== undefined) options.model = model;
  const runId = args.options["run-id"];
  if (runId !== undefined) options.runId = runId;
  return options;
}

async function resolveProfile(name, mode, config) {
  if (config.customProfile && (!name || name === config.customProfile.id)) {
    return defineProfile(config.customProfile);
  }
  if (!name) return profileFor(mode ?? "heuristic");
  if (name === "basic" || name === "heuristic") return profileFor(name);
  if (name.endsWith(".json")) {
    return defineProfile(JSON.parse(await fs.readFile(name, "utf8")));
  }
  return getProfile(name, mode);
}

function resolvePolicy(args, config) {
  const policy = args.options.policy ?? config.policy ?? "balanced";
  if (!POLICIES.includes(policy)) throw new Error(`--policy must be one of: ${POLICIES.join(", ")}.`);
  return policy;
}

function resolveTier(args, config) {
  const tier = args.options.tier ?? config.tier ?? "developer";
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of: ${TIERS.join(", ")}.`);
  return tier;
}

function resolveThresholds(args, config) {
  const budget = config.budget ?? {};
  const thresholds = {
    maxTokens: numberOption(args, "max-tokens") ?? budget.maxTokens,
    maxRawUtilization: numberOption(args, "max-raw", "max-raw-utilization") ?? budget.maxRawUtilization,
    maxPAUUtilization: numberOption(args, "max-pau", "max-pau-utilization") ?? budget.maxPAUUtilization,
    maxDuplicateTokenRatio:
      numberOption(args, "max-duplicate", "max-duplicate-ratio") ?? budget.maxDuplicateTokenRatio,
    maxReplayOverheadRatio:
      numberOption(args, "max-replay", "max-replay-overhead") ?? budget.maxReplayOverheadRatio,
    maxHogScore: numberOption(args, "max-hog", "max-hog-score") ?? budget.maxHogScore,
    minContextHealthScore:
      numberOption(args, "min-health", "min-context-health") ?? budget.minContextHealthScore,
    minPigEfficiency:
      numberOption(args, "min-efficiency", "min-pig-efficiency") ?? budget.minPigEfficiency
  };
  for (const key of Object.keys(thresholds)) {
    if (thresholds[key] === undefined) delete thresholds[key];
  }
  return thresholds;
}

/**
 * Reads a JSON payload from a path, or from stdin when the target is "-" or absent and
 * stdin is piped. Supporting stdin lets pau sit in a pipeline next to jq and the harness.
 */
async function readInput(target) {
  if (target && target !== "-") return fs.readFile(target, "utf8");
  if (target !== "-" && process.stdin.isTTY) {
    throw new Error("a JSON file path is required, or pipe a trace on stdin.");
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) throw new Error("stdin was empty.");
  return text;
}

async function loadConfig(args) {
  const explicit = args.options.config;
  if (explicit) return readConfigFile(explicit);
  if (args.flags["no-config"]) return {};
  for (const candidate of DEFAULT_CONFIG_FILES) {
    const resolved = path.resolve(process.cwd(), candidate);
    try {
      await fs.access(resolved);
      return readConfigFile(resolved);
    } catch {
      // Absent default config files are expected; keep looking.
    }
  }
  return {};
}

async function readConfigFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`could not read config ${file}: ${error instanceof Error ? error.message : error}`);
  }
}

async function emit(args, text) {
  const target = args.options.out;
  if (!target) {
    console.log(text);
    return;
  }
  await fs.writeFile(target, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  console.error(`Wrote ${target}`);
}

/** Splits argv into positional paths, `--key value` options, and boolean `--flag` entries. */
function parseArgs(values) {
  const positional = [];
  const options = {};
  const flags = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positional, options, flags };
}

function firstPath(args) {
  return args.positional[0];
}

function numberOption(args, ...keys) {
  for (const key of keys) {
    const raw = args.options[key];
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`--${key} must be numeric.`);
    return parsed;
  }
  return undefined;
}

async function packageVersion() {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  return `pau-profiler ${manifest.version}`;
}

function printUsage() {
  console.log(`PAU Profiler - context utilization accounting for AI agents

USAGE
  pau <command> [path...] [options]

  Any path may be "-" to read JSON from stdin.

COMMANDS
  analyze <trace>              Context receipt: load, composition, hogs, evictable PAU
  plan <trace>                 Protected-context-safe optimization plan
  compare <baseline> <cand>    Run-to-run regression comparison
  check <trace>                Enforce budget thresholds; exits 2 on violation
  series <trace...>            Multi-turn growth and replay accumulation
  report <trace>               Markdown receipt for a PR comment or job summary
  validate <trace>             Structural validation; exits 2 when invalid
  profile [name]               PAU Core profile manifest
  convert <messages>           Normalize provider messages into a PAU trace

OUTPUT
  --json                       Machine-readable JSON
  --markdown                   Markdown receipt
  --tier <user|developer|auditor>   Disclosure level for markdown output
  --out <file>                 Write to a file instead of stdout

MEASUREMENT
  --profile <name|file.json>   ${Object.keys(profiles).join(", ")}, or a custom profile file
  --context-window <tokens>    Enables utilization percentages
  --model <name>               Recorded in the receipt
  --tolerance <0-1>            Quality-loss budget for evictable PAU (default 0.05)
  --no-near-duplicates         Disable local near-duplicate detection
  --format <${FORMATS.join("|")}>

PLANNING
  --policy <${POLICIES.join("|")}>

BUDGET THRESHOLDS
  --max-tokens, --max-raw-utilization, --max-pau-utilization,
  --max-duplicate-ratio, --max-replay-overhead, --max-hog-score,
  --min-context-health, --min-pig-efficiency

CONFIG
  --config <file>              Defaults to ./pau.config.json or ./.paurc.json
  --no-config                  Ignore config files

EXAMPLES
  pau analyze examples/research-agent.json
  pau report trace.json --tier developer --out receipt.md
  cat payload.json | pau analyze - --format openai --context-window 128000
  pau check trace.json --max-hog-score 7 --min-context-health 65
  pau series turn-*.json
`);
}
