import type { PAUInterval } from "./types.js";

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

/**
 * Compact magnitude formatting. PAU reports deliberately avoid excessive precision:
 * "39.6k PAU" carries the same decision content as "39,564.83 PAU" without implying
 * accuracy the measurement does not have.
 */
export function formatCompact(value: number | null): string {
  if (value === null) return "n/a";
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (magnitude >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return value.toFixed(magnitude >= 100 ? 0 : 1);
}

export function formatCount(value: number | null): string {
  return value === null ? "n/a" : Math.round(value).toLocaleString("en-US");
}

export function formatInterval(interval: PAUInterval | null): string {
  if (interval === null) return "n/a";
  if (interval.sigma === 0) return "exact";
  return `${formatCompact(interval.low)}-${formatCompact(interval.high)}`;
}

export function formatSigned(value: number | null, digits = 1): string {
  if (value === null) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/** Builds a GitHub-flavored markdown table with no trailing whitespace. */
export function markdownTable(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ];
  return lines.join("\n");
}
