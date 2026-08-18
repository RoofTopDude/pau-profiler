import {
  analyzeTrace,
  buildOptimizationPlan,
  compareReceipts,
  getProfile,
  normalizeTrace,
  profileFor
} from "./lib/index.js";

const sampleTrace = {
  version: "0.2",
  runId: "blacksite-agent-turn-42",
  provider: "multi-provider",
  model: "agent-model",
  tokenizer: "harness-provided",
  traceBoundary: "final-provider-payload",
  contextWindow: 128000,
  turn: 8,
  analysisMode: "heuristic",
  segments: [
    { id: "system.runtime", type: "system", source: "blacksite.runtime", tokens: 6200, utility: 0.98, protected: true, turnAdded: 1 },
    { id: "developer.workspace-policy", type: "developer", source: "workspace.policy", tokens: 4100, utility: 0.96, protected: true, turnAdded: 1 },
    { id: "user.current", type: "user", source: "chat", tokens: 1350, utility: 1, protected: true, turnAdded: 8 },
    { id: "history.session", type: "history", source: "conversation", tokens: 9800, utility: 0.48, turnAdded: 2 },
    { id: "tool.github.repository-dump", type: "tool", source: "github", tokens: 18400, utility: 0.08, relevance: 0.35, duplicateRatio: 0.44, replayCount: 4, turnAdded: 4 },
    { id: "rag.architecture-docs", type: "rag", source: "workspace-rag", tokens: 9200, utility: 0.82, relevance: 0.92, density: 1.15, replayCount: 1, turnAdded: 7 },
    { id: "browser.dom-snapshot", type: "browser", source: "browser", tokens: 7600, utility: 0.22, relevance: 0.45, duplicateRatio: 0.25, replayCount: 2, turnAdded: 6 },
    { id: "code.agent-loop", type: "code", source: "workspace.read", tokens: 4800, utility: 0.9, relevance: 0.95, density: 1.25, turnAdded: 8 }
  ]
};

const sampleCandidate = {
  ...sampleTrace,
  runId: "blacksite-agent-turn-42-optimized",
  segments: [
    sampleTrace.segments[0],
    sampleTrace.segments[1],
    sampleTrace.segments[2],
    { id: "history.session-summary", type: "summary", source: "conversation", tokens: 3100, utility: 0.78, turnAdded: 8 },
    { id: "tool.github.targeted-symbols", type: "tool", source: "github", tokens: 3900, utility: 0.78, relevance: 0.9, replayCount: 0, turnAdded: 8 },
    { id: "rag.architecture-docs", type: "rag", source: "workspace-rag", tokens: 6100, utility: 0.88, relevance: 0.94, density: 1.15, turnAdded: 8 },
    { id: "browser.accessibility-excerpt", type: "browser", source: "browser", tokens: 1800, utility: 0.72, relevance: 0.85, turnAdded: 8 },
    sampleTrace.segments[7]
  ]
};

const elements = {
  traceInput: document.querySelector("#trace-input"),
  candidateInput: document.querySelector("#candidate-input"),
  candidatePanel: document.querySelector("#candidate-panel"),
  profile: document.querySelector("#profile-select"),
  policy: document.querySelector("#policy-select"),
  contextWindow: document.querySelector("#context-window"),
  nearDuplicates: document.querySelector("#near-duplicates"),
  analyze: document.querySelector("#analyze-button"),
  sample: document.querySelector("#sample-button"),
  file: document.querySelector("#file-input"),
  error: document.querySelector("#editor-error"),
  results: document.querySelector("#results"),
  modeButtons: [...document.querySelectorAll("[data-mode]")]
};

let mode = "single";
let lastExport = null;

elements.traceInput.value = pretty(sampleTrace);
elements.candidateInput.value = pretty(sampleCandidate);

for (const button of elements.modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}
elements.analyze.addEventListener("click", runAnalysis);
elements.sample.addEventListener("click", () => {
  elements.traceInput.value = pretty(sampleTrace);
  elements.candidateInput.value = pretty(sampleCandidate);
  runAnalysis();
});
elements.file.addEventListener("change", importFile);

document.querySelector("[data-copy-code]")?.addEventListener("click", async (event) => {
  const code = document.querySelector("#integration-code")?.textContent ?? "";
  await navigator.clipboard.writeText(code);
  event.currentTarget.textContent = "Copied";
  window.setTimeout(() => { event.currentTarget.textContent = "Copy"; }, 1200);
});

setMode("single");
runAnalysis();

function setMode(nextMode) {
  mode = nextMode === "compare" ? "compare" : "single";
  for (const button of elements.modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  elements.candidatePanel.hidden = mode !== "compare";
  elements.analyze.textContent = mode === "compare" ? "Compare runs" : "Analyze context";
}

async function importFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  if (mode === "compare" && document.activeElement === elements.candidateInput) elements.candidateInput.value = text;
  else elements.traceInput.value = text;
  runAnalysis();
  event.target.value = "";
}

function runAnalysis() {
  clearError();
  try {
    if (mode === "compare") {
      const baseline = analyzePayload(elements.traceInput.value);
      const candidate = analyzePayload(elements.candidateInput.value);
      const comparison = compareReceipts(baseline, candidate);
      const plan = buildOptimizationPlan(candidate, elements.policy.value);
      lastExport = { baseline, candidate, comparison, candidateOptimizationPlan: plan };
      renderComparison(baseline, candidate, comparison, plan);
    } else {
      const receipt = analyzePayload(elements.traceInput.value);
      const plan = buildOptimizationPlan(receipt, elements.policy.value);
      lastExport = { receipt, optimizationPlan: plan };
      renderReceipt(receipt, plan);
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function analyzePayload(text) {
  const parsed = JSON.parse(text);
  const profile = selectedProfile();
  const contextWindow = Number(elements.contextWindow.value);
  const trace = normalizeTrace(parsed, {
    format: "auto",
    analysisMode: profile.mode,
    ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {})
  });
  return analyzeTrace(trace, {
    profile,
    nearDuplicates: elements.nearDuplicates.checked
  });
}

function selectedProfile() {
  const value = elements.profile.value;
  if (value === "basic") return profileFor("basic");
  if (value === "heuristic") return profileFor("heuristic");
  return getProfile(value);
}

function renderReceipt(receipt, plan) {
  const hogs = [...receipt.segments].sort((a, b) => b.effectiveHogScore - a.effectiveHogScore).slice(0, 7);
  const categories = receipt.categories.slice(0, 8);
  const actions = plan.actions.slice(0, 6);

  elements.results.innerHTML = `
    <div class="receipt">
      <div class="receipt-head">
        <div class="receipt-title">
          <p>CONTEXT RECEIPT / ${escapeHtml(receipt.profile)}</p>
          <h3>${escapeHtml(receipt.runId ?? "Unidentified run")}</h3>
        </div>
        <div class="receipt-actions">
          <button class="button button-quiet" type="button" data-download>Download receipt</button>
          <a class="button button-quiet" href="https://github.com/RoofTopDude/pau-profiler/blob/main/spec/PAU-SPEC.md">Explain score</a>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi("Context health", `${receipt.contextHealthScore}`, "/ 100", "health")}
        ${kpi("Physical context", formatNumber(receipt.totalTokens), "tokens")}
        ${kpi("Adjusted load", formatNumber(receipt.totalPAU), "PAU")}
        ${kpi("Pig efficiency", formatPercent(receipt.pigEfficiency), "useful load")}
        ${kpi("Replay overhead", formatPercent(receipt.replayOverheadRatio), `${formatNumber(receipt.replayTokens)} tokens`)}
        ${kpi("Max hog", receipt.maxHogScore.toFixed(1), "/ 10")}
      </div>
      <div class="receipt-grid">
        <section class="result-panel">
          <div class="result-panel-head"><strong>Context composition</strong><span>${formatPercent(receipt.rawUtilization)} physical utilization</span></div>
          <div class="context-strip">
            ${receipt.segments.map(contextSegment).join("")}
          </div>
          <div class="legend">${categories.map((category) => `<span><i class="${categoryClass(category.type)}"></i>${escapeHtml(category.type)} ${formatPercent(category.tokenShare)}</span>`).join("")}</div>
        </section>
        <section class="result-panel">
          <div class="result-panel-head"><strong>PAU by category</strong><span>${formatNumber(receipt.totalPAU)} total</span></div>
          <div class="category-bars">
            ${categories.map(categoryBar).join("")}
          </div>
        </section>
        <section class="result-panel">
          <div class="result-panel-head"><strong>Context hogs</strong><span>consumption vs. utility</span></div>
          <div class="table-scroll">
            <table class="hog-table">
              <thead><tr><th>Segment</th><th>Tokens</th><th>Replay</th><th>Score</th><th>Confidence</th></tr></thead>
              <tbody>${hogs.map(hogRow).join("")}</tbody>
            </table>
          </div>
        </section>
        <section class="result-panel">
          <div class="result-panel-head"><strong>Optimization plan</strong><span>${formatNumber(plan.totalCurrentTokenSavings)} token opportunity</span></div>
          <div class="plan-list">
            ${actions.length ? actions.map(planAction).join("") : `<div class="warning-item">No unprotected optimization candidate met the selected policy threshold.</div>`}
          </div>
        </section>
        <section class="result-panel" style="grid-column:1/-1">
          <div class="result-panel-head"><strong>Measurement warnings</strong><span>${receipt.warnings.length} notice(s)</span></div>
          <div class="warning-list">
            ${receipt.warnings.length ? receipt.warnings.map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`).join("") : `<div class="warning-item" style="border-color:var(--mint)">No methodology warnings were emitted for this trace.</div>`}
          </div>
        </section>
      </div>
    </div>`;

  elements.results.querySelector("[data-download]")?.addEventListener("click", downloadLastExport);
}

function renderComparison(baseline, candidate, comparison, plan) {
  const metrics = [
    ["Physical tokens", comparison.metrics.totalTokens, false, "tokens"],
    ["PAU load", comparison.metrics.totalPAU, false, "PAU"],
    ["Context health", comparison.metrics.contextHealthScore, true, "points"],
    ["Replay overhead", comparison.metrics.replayOverheadRatio, false, "percent"]
  ];

  elements.results.innerHTML = `
    <div class="receipt">
      <div class="receipt-head">
        <div class="receipt-title"><p>RUN COMPARISON / ${escapeHtml(candidate.profile)}</p><h3>${escapeHtml(baseline.runId ?? "Baseline")} &#8594; ${escapeHtml(candidate.runId ?? "Candidate")}</h3></div>
        <div class="receipt-actions"><button class="button button-quiet" type="button" data-download>Download comparison</button></div>
      </div>
      <div class="comparison-banner ${comparison.verdict}">
        <div><small>VERDICT</small><strong>${escapeHtml(comparison.verdict)}</strong></div>
        <span>${formatNumber(plan.totalCurrentTokenSavings)} additional candidate tokens remain optimizable</span>
      </div>
      <div class="compare-grid">
        ${metrics.map(([name, metric, higher, unit]) => comparisonCard(name, metric, higher, unit)).join("")}
      </div>
      <ul class="findings">${comparison.findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>
      <div class="receipt-grid">
        <section class="result-panel">
          <div class="result-panel-head"><strong>Baseline context</strong><span>${baseline.contextHealthScore}/100 health</span></div>
          <div class="context-strip">${baseline.segments.map(contextSegment).join("")}</div>
          <div class="legend">${baseline.categories.slice(0, 8).map((category) => `<span><i class="${categoryClass(category.type)}"></i>${escapeHtml(category.type)} ${formatPercent(category.tokenShare)}</span>`).join("")}</div>
        </section>
        <section class="result-panel">
          <div class="result-panel-head"><strong>Candidate context</strong><span>${candidate.contextHealthScore}/100 health</span></div>
          <div class="context-strip">${candidate.segments.map(contextSegment).join("")}</div>
          <div class="legend">${candidate.categories.slice(0, 8).map((category) => `<span><i class="${categoryClass(category.type)}"></i>${escapeHtml(category.type)} ${formatPercent(category.tokenShare)}</span>`).join("")}</div>
        </section>
        <section class="result-panel" style="grid-column:1/-1">
          <div class="result-panel-head"><strong>Candidate optimization plan</strong><span>${plan.policy} policy</span></div>
          <div class="plan-list">${plan.actions.slice(0, 6).map(planAction).join("") || `<div class="warning-item">No remaining candidate actions meet this policy.</div>`}</div>
        </section>
      </div>
    </div>`;

  elements.results.querySelector("[data-download]")?.addEventListener("click", downloadLastExport);
}

function comparisonCard(name, metric, higherIsBetter, unit) {
  const change = metric.absolute;
  const good = change !== null && (higherIsBetter ? change > 0 : change < 0);
  const bad = change !== null && (higherIsBetter ? change < 0 : change > 0);
  let display;
  if (unit === "percent") display = change === null ? "n/a" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)} pts`;
  else display = change === null ? "n/a" : `${change >= 0 ? "+" : ""}${formatNumber(change)}`;
  return `<div class="compare-card"><small>${escapeHtml(name)}</small><strong class="${good ? "good" : bad ? "bad" : ""}">${display}</strong><em>${formatMetric(metric.baseline, unit)} &#8594; ${formatMetric(metric.candidate, unit)}</em></div>`;
}

function formatMetric(value, unit) {
  if (value === null) return "n/a";
  if (unit === "percent") return formatPercent(value);
  return `${formatNumber(value)}${unit === "points" ? "" : ` ${unit}`}`;
}

function kpi(label, value, detail, className = "") {
  return `<div class="kpi-card ${className}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(String(detail))}</span></div>`;
}

function contextSegment(segment) {
  const title = `${segment.id}\n${formatNumber(segment.tokens)} tokens\n${formatNumber(segment.pau)} PAU\nHog ${segment.effectiveHogScore.toFixed(1)}/10`;
  return `<span class="context-segment ${categoryClass(segment.type)} ${segment.effectiveHogScore >= 6 ? "is-hog" : ""}" style="--segment-size:${Math.max(segment.tokens, 1)}" title="${escapeAttribute(title)}"></span>`;
}

function categoryBar(category) {
  return `<div class="category-row"><label>${escapeHtml(category.type)}</label><div class="category-track"><span style="--bar-size:${Math.min(100, category.pauShare * 100)}%"></span></div><output>${formatPercent(category.pauShare)}</output></div>`;
}

function hogRow(segment) {
  return `<tr><td><strong title="${escapeAttribute(segment.id)}">${escapeHtml(segment.id)}</strong>${escapeHtml(segment.type)}</td><td>${formatNumber(segment.tokens)}</td><td>${formatNumber(segment.replayTokens)}</td><td><span class="score-pill severity ${escapeHtml(segment.hogSeverity)}">${segment.effectiveHogScore.toFixed(1)}</span></td><td>${escapeHtml(segment.scoreConfidence)}</td></tr>`;
}

function planAction(action, index) {
  return `<div class="plan-action"><span class="plan-index">${String((index ?? 0) + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(action.action)} / ${escapeHtml(action.segmentId)}</strong><p>${escapeHtml(action.reason)}</p></div><span class="plan-save">-${formatNumber(action.currentTokenSavings)} now<br>-${formatNumber(action.futureReplayTokenSavings)} replay</span></div>`;
}

function categoryClass(category) {
  return `cat-${String(category).replace(/[^a-z0-9_-]/gi, "-")}`;
}

function downloadLastExport() {
  if (!lastExport) return;
  const blob = new Blob([JSON.stringify(lastExport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = mode === "compare" ? "pau-comparison.json" : "pau-context-receipt.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showError(message) {
  elements.error.hidden = false;
  elements.error.textContent = message;
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10000 ? 1 : 2)}k`;
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatPercent(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}
