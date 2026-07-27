/**
 * Public types for the debate pipeline — shared across `pipeline.ts`,
 * `render.ts`, `cli.ts`, and downstream consumers (MCP server, tests).
 */

import type { Persona } from "../personas/index.js";

export interface PanelResponse {
  persona: string;
  answer: string;
  /** True when the persona chose to opt out of this round/consensus. */
  abstained?: boolean;
  /** The one-line reason the persona gave for opting out. */
  abstainReason?: string;
  /** True when the persona's LLM call failed outright (retries + fallback
   *  exhausted). The debate continues and the downstream synth treats it as
   *  "no answer this round" rather than letting one bad call kill the run. */
  failed?: boolean;
  /** Wall-clock milliseconds from when this persona's LLM call started to
   *  when the answer was returned. Used for per-persona timing in nerdstats. */
  durationMs?: number;
}

export interface RoundResponse {
  round: number;
  responses: PanelResponse[];
  /** Wall-clock milliseconds for the whole round (first call start → last
   *  call finish). For parallel rounds this ≈ the slowest persona; for
   *  sequential rounds this ≈ the sum of per-persona durations. */
  durationMs?: number;
}

/** Top-level stage timings captured during the run. All values are
 *  wall-clock milliseconds measured around the corresponding LLM call(s). */
export interface DebateTiming {
  starterMs: number;
  standpointsMs: number;
  /** One entry per debate round, in order. */
  roundsMs: number[];
  /** Whole consensus round (parallel, so ≈ slowest persona). */
  consensusMs: number;
  synthesisMs: number;
  /** End-to-end wall clock for the full `runDebate` call. */
  totalMs: number;
}

export interface DebateResult {
  /** Personas that actually participated in this debate. */
  participants: Persona[];
  /** How the participants were selected (for transparency in the transcript). */
  selectionMode: "all" | "auto" | "manual";
  /** Non-null when auto-select was used; explains the selector's reasoning. */
  selectionRationale?: string;
  starter: string;
  /** Distilled "Major Standpoints" + "Key Tensions" derived from the parallel,
   *  independent round-1 responses. Injected as context into rounds 2+.
   *  Empty string in test mode. */
  standpoints: string;
  rounds: RoundResponse[];
  /** Empty in test mode (no consensus round was run). */
  consensus: PanelResponse[];
  /** Empty string in test mode (no synthesis call was made). */
  synthesis: string;
  timing: DebateTiming;
  /** Count of calls that fell back from OpenRouter to Anthropic-direct
   *  during this run. Per-run so concurrent MCP runs don't cross-contaminate. */
  fallbackCount: number;
  /** Persona names that the synthesizer omitted from Part 1 and whose
   *  verdicts were auto-filled from their round/consensus answers.
   *  Empty when coverage was complete. */
  autoFilledVerdicts: string[];
  /** True when the run stopped after starter + round 1 (see `--test`). */
  testMode?: boolean;
}

export type ProgressFn = (msg: string) => void;

/** Fine-grained callbacks emitted as the debate unfolds. Let the MCP server
 *  stream Starter / round responses / consensus / synthesis to Desktop as
 *  soon as each is available, instead of waiting for the whole run to finish
 *  before the user sees anything. */
export interface DebateEvents {
  onStarter?: (starter: string) => void;
  onPersonaResponse?: (round: number, response: PanelResponse) => void;
  /** Fires once, between round 1 and round 2, when the distilled
   *  "Major Standpoints" doc is ready. */
  onStandpoints?: (standpoints: string) => void;
  onConsensusResponse?: (response: PanelResponse) => void;
  onSynthesis?: (synthesis: string) => void;
}

/** How personas should be chosen. `"all"` runs the full panel,
 *  `"auto"` (the default) asks a lightweight model to pick a diverse set, and
 *  an explicit Persona[] forces exactly those to speak. */
export type PersonaSelection = "all" | "auto" | Persona[];

/** Per-run context threaded through every helper that calls `callModel`. The
 *  `onFallback` callback is fired once per OpenRouter→Anthropic fallback so
 *  each `runDebate` call gets its own fallback count (the module-global in
 *  `client.ts` races across concurrent runs). Optional `signal` carries
 *  the debate-level abort — checked at round boundaries via
 *  `throwIfAborted` so in-flight LLM calls finish but the next stage won't
 *  start after a cancellation. */
export interface CallContext {
  onFallback: () => void;
  signal?: AbortSignal;
}

/** Standardised error class so callers (CLI, MCP server) can distinguish a
 *  user-requested cancellation from any other runtime error. Matches
 *  `AbortError` naming convention used by Node's AbortController. */
export class DebateAbortError extends Error {
  readonly name = "DebateAbortError";
  constructor(stage: string) {
    super(`Debate aborted before ${stage}`);
  }
}

/** Internal return type of the auto-selector — kept in types so both
 *  `pipeline.ts` (which produces it) and `cli.ts` / MCP (if they ever want
 *  to surface it directly) can reference the same shape. */
export interface AutoSelection {
  personas: Persona[];
  rationale: string;
}

