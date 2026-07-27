/**
 * Pure / near-pure helpers used by `pipeline.ts` and `render.ts`. Everything
 * here should be unit-testable in isolation — no network, no environment
 * state beyond what `config.ts` already captured at module load.
 */

import type { Persona } from "../personas/index.js";
import { ANTHROPIC_FALLBACK_EST_USD } from "./config.js";
import type { PanelResponse, RoundResponse } from "./types.js";
import { DebateAbortError } from "./types.js";

/** Parallelism for parallel rounds (R1, consensus): roughly one third of the
 *  panel at a time. Keeps wall-clock linear in panel size (3 batches) while
 *  giving OpenRouter breathing room on burst rate-limits. */
export function parallelConcurrency(participants: number): number {
  return Math.max(1, Math.ceil(participants / 3));
}

/** Minimal concurrency limiter — map over `items` at most `limit` at a time,
 *  preserving input order in the result. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/** Throw a `DebateAbortError` tagged with the stage name if the signal is
 *  already aborted. Call at every round/stage boundary — in-flight LLM
 *  calls still finish (we don't pass the signal down to the SDK), but the
 *  next stage won't start. */
export function throwIfAborted(
  signal: AbortSignal | undefined,
  stage: string
): void {
  if (signal?.aborted) throw new DebateAbortError(stage);
}

/** Extract the first top-level JSON object from a string by walking braces.
 *  Tolerates surrounding prose, code fences, and nested objects. Returns
 *  the raw substring of the first matched `{…}` or null if none found.
 *  Exported for unit testing. */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Detect whether a persona response contains leaked reasoning / planning /
 *  drafting chatter instead of (or alongside) the actual answer. Some
 *  OpenRouter-routed reasoning models (notably `openai/gpt-5-mini`)
 *  occasionally emit their internal chain-of-thought as part of the
 *  `content` field — meta-commentary like `**Evaluating user instructions**`
 *  and multiple drafted copies of the same section. The debate pipeline
 *  retries once on a hit with a tightened prompt. Exported for tests.
 *
 *  Detection is deliberately conservative — we want to catch obvious
 *  draft-and-retry leaks without false-positiving on a persona legitimately
 *  reasoning in prose (e.g. "Let me be clear" / "I need to be direct"). */
export function looksLikeReasoningLeak(answer: string): boolean {
  // Meta-commentary bold headers are very unusual in real persona output —
  // a persona writes in-voice, not about its writing process.
  const metaHeader =
    /\*\*(Evaluating|Crafting|Finaliz\w*|Drafting|Planning\s+bullet|Rewriting|Refining\s+(answer|response))\b/i;
  if (metaHeader.test(answer)) return true;

  // Draft iteration — the same required section emitted more than once.
  const positivesCount = (answer.match(/^\s*\*\*Positives\*\*/gm) ?? []).length;
  if (positivesCount >= 2) return true;
  const negativesCount = (answer.match(/^\s*\*\*Negatives\*\*/gm) ?? []).length;
  if (negativesCount >= 2) return true;

  return false;
}

/** Detect whether a persona chose to abstain, by looking for the `[ABSTAIN]`
 *  tag at (or near) the start of the response. Returns `null` when the
 *  response is a normal participation. Exported for unit testing. */
export function parseAbstention(rawAnswer: string): string | null {
  const trimmed = rawAnswer.trim();
  // Accept any reasonable casing and optional markdown emphasis around the tag.
  const regex = /^[*_`]*\[?\s*ABSTAIN\s*\]?[*_`]*\s*[:\-–—]?\s*/i;
  if (!regex.test(trimmed)) return null;
  const reason = trimmed.replace(regex, "").trim();
  return reason || "(no reason given)";
}

/** Fisher-Yates shuffle that returns a new array without mutating input. */
export function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Set of unordered `"a|b"` keys for every consecutive pair in `order`.
 *  Exported for unit testing. */
export function adjacentPairs(order: readonly Persona[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i].name;
    const b = order[i + 1].name;
    s.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return s;
}

/** Pick a speaking order for the next sequential round that shares as few
 *  adjacent pairs as possible with `prev`. Runs a bounded random search and
 *  returns the candidate with the fewest carry-over adjacencies; ties are
 *  broken by dissimilarity to `prev` so the same order isn't re-drawn. For
 *  small panels it may be mathematically impossible to avoid every prev
 *  adjacency (e.g. 3 personas share the full pair space) — in that case the
 *  function still returns the best available candidate. Exported for tests. */
export function pickNextOrder(
  participants: readonly Persona[],
  prev: readonly Persona[]
): Persona[] {
  if (participants.length <= 2) return [...participants];
  const prevAdj = adjacentPairs(prev);
  let best: Persona[] = [...participants];
  let bestScore = Infinity;
  const attempts = 200;
  for (let i = 0; i < attempts; i++) {
    const cand = shuffled(participants);
    const candAdj = adjacentPairs(cand);
    let overlap = 0;
    for (const pair of candAdj) if (prevAdj.has(pair)) overlap++;
    const identical = cand.every((p, idx) => p === prev[idx]);
    // Huge penalty for an identical order — defeats the whole point of
    // rotation. Otherwise score is just the adjacency overlap.
    const score = overlap + (identical ? 1000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = cand;
      if (bestScore === 0) break;
    }
  }
  return best;
}

/** Collect every *line-leading* bold span (`**…**` at the start of a trimmed
 *  line) in the text, trimmed + lower-cased. Used by the coverage check,
 *  which cares about persona-label bolds that live on their own line (as
 *  the synthesizer prompt requires). Inline emphasis (`…**word**…`) is
 *  intentionally skipped so a random `**emphasis**` in prose can't
 *  accidentally count as persona coverage. Exported for tests. */
export function collectBoldSpans(text: string): string[] {
  const spans: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    // First bold at line start; optional trailing punctuation afterwards.
    const m = /^\*\*([^*\n]+?)\*\*/.exec(line);
    if (!m) continue;
    const body = m[1].trim().toLowerCase();
    if (body) spans.push(body);
  }
  return spans;
}

function isWholeWordMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const before = idx === 0 ? " " : haystack[idx - 1];
  const afterIdx = idx + needle.length;
  const after = afterIdx >= haystack.length ? " " : haystack[afterIdx];
  return !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after);
}

/** Persona names are formatted `"Short Name — Tagline"`. The selector prompt
 *  asks the synthesizer to bold the full name, but small drift (trailing
 *  punctuation, missing em-dash, truncated tagline) is common. Match a
 *  bold span against a persona by: exact-name substring OR short-name
 *  (first token before " — ") substring, case-insensitive. Returns true
 *  when any bold span covers this persona. Exported for tests. */
export function personaCoveredByBoldSpans(
  persona: Persona,
  boldSpans: readonly string[]
): boolean {
  const full = persona.name.trim().toLowerCase();
  const short = persona.name.split(" — ")[0].trim().toLowerCase();
  if (!short) return false;
  for (const span of boldSpans) {
    if (span.includes(full)) return true;
    // Guard against picking up generic bold words like "**Positives**" that
    // happen to share a prefix — require the persona's short name to be a
    // whole-word hit inside the span.
    if (isWholeWordMatch(span, short)) return true;
  }
  return false;
}

/** Pick out the persona's most recent substantive answer (non-abstain,
 *  non-failed) across rounds, walking backwards. Returns null if they never
 *  contributed anything substantive. */
function lastSubstantiveAnswer(
  persona: Persona,
  rounds: RoundResponse[]
): PanelResponse | null {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const hit = rounds[i].responses.find((r) => r.persona === persona.name);
    if (hit && !hit.abstained && !hit.failed) return hit;
  }
  return null;
}

/** Take the first N sentences of `text`. Cheap heuristic — splits on ". ",
 *  "? ", "! ". Used only for auto-filled verdict summaries. */
function firstSentences(text: string, n: number): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(" ");
}

/** Ensure every participant appears in the synthesizer's Part 1. For any
 *  missing persona, build an "Auto-filled" verdict from their last round
 *  answer plus consensus and append it to the synthesis. This guarantees
 *  the final report captures every opinion even if the synthesizer drops
 *  one. Returns the (possibly extended) synthesis plus the list of names
 *  that were auto-filled. Match is tolerant — persona is considered
 *  covered if any bold span contains their full name or their short-name
 *  (text before " — ") as a whole word. */
export function ensureAllPersonasInSynthesis(
  synthesis: string,
  participants: Persona[],
  rounds: RoundResponse[],
  consensus: PanelResponse[]
): { synthesis: string; autoFilled: string[] } {
  const boldSpans = collectBoldSpans(synthesis);
  const missing: Persona[] = [];
  for (const p of participants) {
    if (!personaCoveredByBoldSpans(p, boldSpans)) missing.push(p);
  }
  if (missing.length === 0) {
    return { synthesis, autoFilled: [] };
  }
  const lines: string[] = [
    "",
    "",
    "### Auto-filled verdicts",
    "",
    `*The synthesizer omitted ${missing.length} persona verdict${missing.length === 1 ? "" : "s"}. Filled automatically from their round and consensus answers so no panelist is dropped from the final report.*`,
    "",
  ];
  for (const p of missing) {
    const last = lastSubstantiveAnswer(p, rounds);
    const cons = consensus.find((c) => c.persona === p.name);
    lines.push(`**${p.name}**`, "");
    if (last) {
      lines.push(
        `_Last substantive position (round ${
          rounds.find((r) => r.responses.includes(last))?.round ?? "?"
        }):_ ${firstSentences(last.answer, 2)}`,
        ""
      );
    } else {
      lines.push(
        `_No substantive round contribution recorded (all rounds abstained or failed)._`,
        ""
      );
    }
    if (cons && !cons.failed) {
      lines.push(`_Consensus positives/negatives:_`, "", cons.answer, "");
    } else if (cons?.failed) {
      lines.push(`_Consensus call failed: ${cons.answer}_`, "");
    } else {
      lines.push(`_No consensus contribution recorded._`, "");
    }
  }
  return {
    synthesis: synthesis + lines.join("\n"),
    autoFilled: missing.map((p) => p.name),
  };
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "debate"
  );
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Compact human-readable duration: `5.2s`, `1m 23s`, `12m 04s`. Exported
 *  for unit testing. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "–";
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec - m * 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Compose a cost line from the before/after balance pair plus the per-run
 *  fallback count. Handles the two failure modes (no balance endpoint, no
 *  fallbacks) cleanly so the rendered nerdstats line is always readable. */
export function buildCostLine(
  balanceBefore: { totalUsage: number } | null,
  balanceAfter: { totalUsage: number; remaining: number } | null,
  fallbackCount: number
): string {
  let line: string;
  if (balanceBefore && balanceAfter) {
    const cost = balanceAfter.totalUsage - balanceBefore.totalUsage;
    line = `Cost: $${cost.toFixed(4)}  (OpenRouter remaining: $${balanceAfter.remaining.toFixed(2)})`;
  } else {
    line = "Cost: unknown (OpenRouter balance unavailable)";
  }
  if (fallbackCount > 0) {
    const est = fallbackCount * ANTHROPIC_FALLBACK_EST_USD;
    line += `  · ${fallbackCount} Anthropic fallback${fallbackCount === 1 ? "" : "s"} (~$${est.toFixed(4)} est., not in OpenRouter total)`;
  }
  return line;
}

