/**
 * CLI wrapper — everything `tsx src/debate.ts "…"` needs on top of
 * `runDebate`: progress logging to stderr, rough runtime + cost warnings
 * before the first call, post-run transcript write, extra-directory copy,
 * and CLI arg parsing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getOpenRouterBalance } from "../client.js";
import { FOUNDER_PERSONAS, type Persona } from "../personas/index.js";
import {
  DEBATE_AUTO_PANEL_SIZE,
  DEBATE_ROUNDS,
  STARTER_OPENROUTER_MODEL,
} from "./config.js";
import { runDebate } from "./pipeline.js";
import { buildMarkdown } from "./render.js";
import type { DebateEvents, PersonaSelection } from "./types.js";
import { buildCostLine, slugify, timestamp } from "./util.js";

/** Cheap first-sentence extract used by the `--stream` progress hook so the
 *  operator sees the shape of each answer as it lands rather than waiting
 *  for the full transcript at the end of the run. Trims whitespace and
 *  collapses inner whitespace so multi-line markdown reads cleanly on one
 *  stderr line. */
function firstSentenceFor(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^.*?[.!?](?=\s|$)/.exec(flat);
  const first = (match?.[0] ?? flat).trim();
  return first.length > 200 ? first.slice(0, 197) + "…" : first;
}

/** Build DebateEvents callbacks that emit a one-line summary per persona
 *  (round responses + consensus) + fixed lines for starter / standpoints /
 *  synthesis. Used only when `--stream` is passed. */
function buildStreamEvents(): DebateEvents {
  return {
    onStarter: () => console.error(`[stream] starter emitted`),
    onPersonaResponse: (round, r) => {
      if (r.failed) {
        console.error(`[stream] R${round} ${r.persona}: ⚠️ call failed`);
      } else if (r.abstained) {
        console.error(
          `[stream] R${round} ${r.persona}: [abstain] ${r.abstainReason ?? "(no reason)"}`
        );
      } else {
        console.error(`[stream] R${round} ${r.persona}: ${firstSentenceFor(r.answer)}`);
      }
    },
    onStandpoints: () => console.error(`[stream] standpoints distilled`),
    onConsensusResponse: (r) => {
      if (r.failed) {
        console.error(`[stream] consensus ${r.persona}: ⚠️ call failed`);
      } else {
        console.error(`[stream] consensus ${r.persona}: ${firstSentenceFor(r.answer)}`);
      }
    },
    onSynthesis: () => console.error(`[stream] synthesis complete`),
  };
}

/** Write a second copy of the transcript into `DEBATE_OUTPUT_DIR` if set,
 *  otherwise into `~/Downloads`. Useful for piping transcripts into note
 *  systems (Obsidian, iCloud, OneDrive) or just keeping them somewhere the
 *  user already opens regularly. Errors are logged to stderr but never
 *  thrown — a misconfigured extra directory should never fail a completed
 *  debate. Returns the copied path on success, `undefined` on error. */
export async function copyTranscriptToExtraDir(
  filename: string,
  markdown: string
): Promise<string | undefined> {
  const configured = process.env.DEBATE_OUTPUT_DIR?.trim();
  const dir =
    configured && configured.length > 0
      ? configured
      : resolve(homedir(), "Downloads");
  try {
    await mkdir(dir, { recursive: true });
    const dest = resolve(dir, filename);
    await writeFile(dest, markdown, "utf8");
    return dest;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[debate] extra-copy failed (${dir}): ${reason}`);
    return undefined;
  }
}

export async function debate(
  question: string,
  selection: PersonaSelection = "auto",
  testMode: boolean = false,
  stream: boolean = true
): Promise<void> {
  const participantCountEstimate =
    selection === "all"
      ? Object.keys(FOUNDER_PERSONAS).length
      : selection === "auto"
        ? DEBATE_AUTO_PANEL_SIZE
        : selection.length;
  // Test mode: starter (1) + round 1 parallel (p) = 1 + p
  // Full mode: starter (1) + R1 (p) + standpoints (1) + (R-1) sequential × p +
  //            consensus (p) + synthesis (1) = 3 + DEBATE_ROUNDS * p + p
  const callEstimate = testMode
    ? 1 + participantCountEstimate
    : 3 + DEBATE_ROUNDS * participantCountEstimate + participantCountEstimate;

  if (testMode) {
    console.error(
      `TEST RUN: starter (${STARTER_OPENROUTER_MODEL}) + round 1 parallel × ~${participantCountEstimate} personas. (Standpoints, sequential rounds, consensus, and synthesis are skipped.)`
    );
  } else {
    console.error(
      `Multi-round debate: starter (${STARTER_OPENROUTER_MODEL}) + round 1 parallel × ~${participantCountEstimate} personas + standpoints distillation + ${DEBATE_ROUNDS - 1} sequential rounds × ~${participantCountEstimate} personas + consensus round + synthesis.`
    );
  }
  // Rough wall-clock guess: starter (~15s) + R1 parallel (~45s worst
  // persona) + standpoints (~15s) + sequential rounds (persona_count *
  // ~35s * (rounds-1)) + consensus (~45s) + synthesis (~30s). Scale the
  // envelope with DEBATE_ROUNDS so a `DEBATE_ROUNDS=8` run doesn't claim
  // the same 1-3 min budget a default 4-round run gets.
  const lowMin = testMode
    ? 1
    : Math.max(
        1,
        Math.round(
          ((15 +
            45 +
            15 +
            participantCountEstimate * 35 * (DEBATE_ROUNDS - 1) +
            45 +
            30) /
            60) *
            0.6
        )
      );
  const highMin = testMode
    ? 3
    : Math.max(
        lowMin + 1,
        Math.round(
          ((15 +
            45 +
            15 +
            participantCountEstimate * 50 * (DEBATE_ROUNDS - 1) +
            60 +
            45) /
            60) *
            1.2
        )
      );
  console.error(
    `Expect ${lowMin}–${highMin} minutes and ~${callEstimate} API calls.\n`
  );

  const balanceBefore = await getOpenRouterBalance();
  const events = stream ? buildStreamEvents() : undefined;
  const result = await runDebate(
    question,
    selection,
    (msg) => console.error(`  · ${msg}`),
    events,
    testMode
  );

  const balanceAfter = await getOpenRouterBalance();
  const costLine = buildCostLine(balanceBefore, balanceAfter, result.fallbackCount);

  const markdown = buildMarkdown(question, result, costLine);
  console.log(markdown);

  if (result.fallbackCount > 0) {
    console.error(
      `\nNote: ${result.fallbackCount} call(s) fell back to Anthropic direct — cost of those calls is estimated in the nerdstats line (OpenRouter balance delta excludes them).`
    );
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outDir = resolve(projectRoot, "debates");
  await mkdir(outDir, { recursive: true });
  const file = resolve(
    outDir,
    `debate-${testMode ? "TEST-" : ""}${timestamp()}-${slugify(question)}.md`
  );
  await writeFile(file, markdown, "utf8");
  console.error(`\nTranscript saved: ${file}\n`);

  const basename = file.split("/").pop() ?? `debate-${timestamp()}.md`;
  const extraCopy = await copyTranscriptToExtraDir(basename, markdown);
  if (extraCopy) console.error(`Copied to: ${extraCopy}\n`);
}

/** Parse CLI args following the question.
 *  Supported: `--personas all|auto|key1,key2,...` or `--personas=...`.
 *  Exported for unit testing. */
export function parseSelectionFromArgs(args: string[]): PersonaSelection {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let raw: string | undefined;
    let consumedPair = false;
    if (a === "--personas" && i + 1 < args.length) {
      raw = args[i + 1];
      consumedPair = true;
    } else if (a.startsWith("--personas=")) {
      raw = a.slice("--personas=".length);
    }
    if (raw === undefined) continue;
    // Advance past the value when we consumed a `--personas VAL` pair so the
    // loop doesn't re-examine the value as its own flag.
    if (consumedPair) i++;
    const value = raw.trim().toLowerCase();
    if (value === "all") return "all";
    if (value === "auto") return "auto";
    const keys = value.split(",").map((k) => k.trim()).filter(Boolean);
    const personas: Persona[] = [];
    for (const k of keys) {
      const p = FOUNDER_PERSONAS[k];
      if (p) personas.push(p);
      else console.error(`⚠️  unknown persona key: "${k}" — skipping`);
    }
    if (personas.length === 0) {
      console.error("⚠️  no valid persona keys — falling back to auto");
      return "auto";
    }
    return personas;
  }
  return "auto";
}

