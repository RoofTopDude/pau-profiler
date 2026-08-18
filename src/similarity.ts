import { clamp } from "./math.js";
import type { ContextSegmentInput, NearDuplicateOptions } from "./types.js";

export interface NearDuplicateMatch {
  duplicateOf: string;
  similarity: number;
}

interface IndexedSegment {
  id: string;
  shingles: Set<string>;
}

const DEFAULT_THRESHOLD = 0.78;
const DEFAULT_SHINGLE_SIZE = 3;
const DEFAULT_MAX_COMPARISONS = 2_000;

export function findNearDuplicateMatches(
  segments: ContextSegmentInput[],
  options: NearDuplicateOptions = {}
): Map<string, NearDuplicateMatch> {
  const threshold = clamp(options.threshold ?? DEFAULT_THRESHOLD, 0, 1);
  const shingleSize = Math.max(1, Math.floor(options.shingleSize ?? DEFAULT_SHINGLE_SIZE));
  const maxComparisons = Math.max(1, Math.floor(options.maxComparisons ?? DEFAULT_MAX_COMPARISONS));
  const indexed: IndexedSegment[] = [];
  const matches = new Map<string, NearDuplicateMatch>();
  let comparisons = 0;

  for (const segment of segments) {
    if (!segment.content || segment.content.trim().length === 0) continue;
    const shingles = textShingles(segment.content, shingleSize);
    if (shingles.size === 0) continue;

    let best: NearDuplicateMatch | undefined;
    for (let i = indexed.length - 1; i >= 0 && comparisons < maxComparisons; i -= 1) {
      const candidate = indexed[i];
      if (!candidate) continue;
      comparisons += 1;
      const similarity = jaccard(shingles, candidate.shingles);
      if (similarity >= threshold && (!best || similarity > best.similarity)) {
        best = { duplicateOf: candidate.id, similarity };
      }
    }

    if (best) matches.set(segment.id, best);
    indexed.push({ id: segment.id, shingles });
  }

  return matches;
}

export function normalizedText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, " <url> ")
    .replace(/\b\d+(?:\.\d+)?\b/gu, " <number> ")
    .replace(/[^\p{L}\p{N}_./:-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function textShingles(text: string, size = DEFAULT_SHINGLE_SIZE): Set<string> {
  const tokens = normalizedText(text).split(" ").filter(Boolean);
  if (tokens.length === 0) return new Set();
  if (tokens.length <= size) return new Set(tokens);
  const shingles = new Set<string>();
  for (let i = 0; i <= tokens.length - size; i += 1) {
    shingles.add(tokens.slice(i, i + size).join(" "));
  }
  return shingles;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of smaller) {
    if (larger.has(value)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}
