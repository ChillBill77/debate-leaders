/**
 * Public barrel — re-exports the debate API so downstream imports
 * (`mcp-server.ts`, tests, future consumers) can keep using
 * `from "./debate.js"` without caring about the internal module split.
 *
 * Implementation lives under `./debate/`:
 *   - config.ts   — env vars and model slugs
 *   - types.ts    — public types + CallContext + DebateAbortError
 *   - util.ts     — pure helpers (tested in tests/debate.test.ts)
 *   - pipeline.ts — runDebate + stages + safePersonaCall
 *   - render.ts   — buildMarkdown + section renderers
 *   - cli.ts      — `debate()` wrapper, parseSelectionFromArgs
 *
 * CLI entry point is `./cli.ts` — it parses env-override flags before
 * importing this barrel, so `DEBATE_*` knobs can be set via CLI flags.
 */

// Load .env BEFORE any other import — `client.ts` reads API keys at module
// init, and ESM evaluates `./debate/cli.js` (which transitively imports
// client) before `./debate/config.js` (where dotenv lives). Without this
// line the CLI silently falls through to Anthropic-direct when only
// `ANTHROPIC_API_KEY` is in shell env, and `getOpenRouterBalance()` returns
// null because `openrouterKey` was captured as undefined at client init.
import "dotenv/config";

// ---- Public re-exports --------------------------------------------------

export {
  DEBATE_AUTO_PANEL_SIZE,
  DEBATE_ROUNDS,
  STARTER_OPENROUTER_MODEL,
  openRouterSlugToAnthropic,
} from "./debate/config.js";

export {
  DebateAbortError,
} from "./debate/types.js";
export type {
  DebateEvents,
  DebateResult,
  DebateTiming,
  PanelResponse,
  PersonaSelection,
  RoundResponse,
} from "./debate/types.js";

export {
  adjacentPairs,
  buildCostLine,
  collectBoldSpans,
  ensureAllPersonasInSynthesis,
  extractFirstJsonObject,
  fmtMs,
  looksLikeReasoningLeak,
  parseAbstention,
  personaCoveredByBoldSpans,
  pickNextOrder,
  slugify,
  timestamp,
} from "./debate/util.js";

export { resolveSelection, runDebate } from "./debate/pipeline.js";

export { buildMarkdown } from "./debate/render.js";

export {
  copyTranscriptToExtraDir,
  debate,
  parseSelectionFromArgs,
} from "./debate/cli.js";

