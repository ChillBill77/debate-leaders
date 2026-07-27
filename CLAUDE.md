# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run debate -- "<question>"` — run the debate pipeline against a custom question (via `tsx src/cli.ts`). Falls back to a built-in default question if no argument is passed.
- `npm run debate -- "<question>" --personas auto|all|key1,key2,…` — override panel selection. `auto` (default) picks a diverse subset; `all` runs the full panel; comma-separated keys force an exact list.
- `npm run debate -- "<question>" --test` — starter + round 1 only (skips standpoints, R2+, consensus, synthesis). Fast dry-run for new personas or prompt tweaks.
- `npm run debate -- "<question>" --rounds N --panel-size N --starter-model SLUG --synthesizer-model SLUG --standpoints-model SLUG --output-dir PATH --fallback-est-usd N` — per-run overrides of the corresponding `DEBATE_*` env vars (flag > inline env > `.env`).
- `npm run typecheck` — `tsc --noEmit` over `src/` and `tests/`.
- `npm test` — runs node:test suites in `tests/` via the tsx loader. No watch mode; re-run after edits.
- Requires `OPENROUTER_API_KEY` (primary) and/or `ANTHROPIC_API_KEY` (fallback) in `.env`. `client.ts` throws at startup if both are missing.

## Environment variables

All optional, all read by `src/debate/config.ts` at module load.

- `DEBATE_STARTER_MODEL` — OpenRouter slug for the nine-lens starter. Shipped `.env.example` sets `anthropic/claude-sonnet-5`; code fallback when unset is `anthropic/claude-haiku-4.5`.
- `DEBATE_SYNTHESIZER_MODEL` — OpenRouter slug for the final synthesis. Shipped `.env.example` sets `anthropic/claude-sonnet-5`; code fallback when unset is `anthropic/claude-haiku-4.5`.
- `DEBATE_STANDPOINTS_MODEL` — separate slug for the cheap round-1 distillation step. Shipped `.env.example` pins it to `anthropic/claude-haiku-4.5` so the distill step stays cheap while starter/synth run on Sonnet; code fallback when unset inherits `DEBATE_SYNTHESIZER_MODEL`.
- `DEBATE_ROUNDS` — total debate rounds, clamped to `[2, 10]` (default `4`). Round 1 is parallel, R2..N sequential.
- `DEBATE_AUTO_PANEL_SIZE` — target size for `auto` selection, clamped to `[2, 12]` (default `6`).
- `DEBATE_OUTPUT_DIR` — where `copyTranscriptToExtraDir` writes its second copy. Defaults to `~/Downloads`.
- `MCP_HOT_RELOAD=1` — enables `fs.watch` on `src/` so the MCP server swaps modules on save (see `src/mcp-server.ts`).

## Architecture

Multi-module pipeline. Public barrel at `src/debate.ts` re-exports from `src/debate/` (config + types + util + pipeline + render + cli); CLI entry at `src/cli.ts` (parses env-override flags before dynamic-importing the barrel so `DEBATE_*` knobs can be set via CLI flags); persona registry in `src/personas/`; dual-provider LLM client in `src/client.ts`; MCP stdio entry at `src/mcp-server.ts` with handlers under `src/mcp/` (context + runs + tools + resources + prompts + hot-reload).

Module map:

```
src/
  debate.ts              — public barrel (re-exports from ./debate/*)
  cli.ts                 — CLI entry: parses --rounds/--panel-size/--starter-model/… flags, mutates process.env, then dynamic-imports the barrel
  debate/
    config.ts            — env vars + model slug constants
    types.ts             — DebateResult, DebateEvents, DebateAbortError, CallContext
    util.ts              — pure helpers (tested in tests/debate.test.ts)
    pipeline.ts          — runDebate + stages + safePersonaCall
    render.ts            — buildMarkdown + section renderers
    cli.ts               — debate() wrapper + parseSelectionFromArgs
  client.ts              — OpenRouter primary / Anthropic fallback w/ retries
  mcp-server.ts          — thin entry: dotenv, Server, transport, delegate
  mcp/
    context.ts           — Mods type, loadModules, PROJECT_ROOT, safeLog
    runs.ts              — RunState, registry Map, pruning, trailer builder
    tools.ts             — ListTools + CallTool handlers for all 7 tools
    resources.ts         — transcripts exposed as debate://transcripts/<name>
    prompts.ts           — run-debate prompt
    hot-reload.ts        — fs.watch src/ and swap mods on save
  personas/
    index.ts             — auto-discovering FOUNDER_PERSONAS registry
    types.ts             — Persona interface
    _template.ts         — starter template for new personas
    <shortkey>.ts        — one file per persona (auto-registered by filename)
```

### Pipeline stages (`runDebate` in `src/debate/pipeline.ts`)

1. **Panel selection** (`resolveSelection`): `"all"` → full registry; `"auto"` → `autoSelectPersonas` asks a lightweight model to pick `DEBATE_AUTO_PANEL_SIZE` maximally contrasting voices; `Persona[]` → manual. Auto-selector parses its JSON output via `extractFirstJsonObject` (balanced-brace walker, not a greedy regex).
2. **Starter** (`getStarter`): one call to the starter model that produces a nine-lens neutral framing (military, diplomatic, economic, ecological, humanitarian, informational, technological, scientific, governance).
3. **Round 1** (`runRound1Parallel`): every persona answers in parallel, each seeing only the starter. Concurrency is capped at `parallelConcurrency(N) = ceil(N/3)` to avoid OpenRouter burst rate-limits on a 19+ panel.
4. **Standpoints distillation** (`distillStandpoints`): one call using `DEBATE_STANDPOINTS_MODEL` that produces a "Major Standpoints" + "Key Tensions" document from R1's parallel answers. Injected as shared context into R2..N.
5. **Rounds 2..DEBATE_ROUNDS** (`runRoundSequential`): sequential, cumulative. Speaking order is picked by `pickNextOrder` — a bounded random search (200 attempts) that minimizes adjacent-pair carry-over from the previous round so no two personas stay side-by-side round after round.
6. **Consensus** (`runConsensus`): parallel (same `parallelConcurrency` cap). Each persona emits `Positives`/`Negatives` bullets. Abstention is not allowed here; any `[ABSTAIN]` output is kept verbatim (the mandatory-participation rule is enforced only via prompt).
7. **Synthesis** (`synthesize`): one call to `DEBATE_SYNTHESIZER_MODEL` that produces per-persona verdicts (Part 1) + a consensus model and action recommendation (Part 2).
8. **Coverage check** (`ensureAllPersonasInSynthesis`): scans the synthesis for every participant's `**Name**` bold wrapper. Any missing persona is appended as an "Auto-filled verdict" block built mechanically from their last substantive round answer + consensus bullets. Backfilled names are listed in `result.autoFilledVerdicts` and surfaced in the nerdstats.

### Fault tolerance

- **Per-persona** — every persona call is wrapped in `safePersonaCall` (or inline try/catch for the consensus round). A failed call becomes a `failed: true` `PanelResponse` with the error message as its body; the run continues. Failures are counted in the nerdstats footer.
- **Retry + backoff** — `callModel` in `client.ts` retries OpenRouter and Anthropic calls up to 3 times with exponential backoff + jitter on retryable errors (429, 5xx, timeouts, connection errors). Non-retryable 4xx fails fast so we fall over to Anthropic-direct immediately.
- **Two-tier fallback** — when a persona's intended OpenRouter model exhausts retries, `callModel` first retries on OpenRouter with `deepseek/deepseek-v4-pro` (`OPENROUTER_FALLBACK_MODEL`) — most failures are model-specific (dead slug, overload, empty content) with OpenRouter itself up. Only if that also fails (e.g. a total OpenRouter outage) does it cross to the Anthropic SDK pinned to `claude-haiku-4-5` (`ANTHROPIC_FALLBACK_MODEL`). If OpenRouter has no key at all, `callModel` goes straight to Anthropic. The per-run `onFallback` callback fires once at the first deviation from the intended model (regardless of which tier answers) and is surfaced on `DebateResult.fallbackCount`. The module-global `anthropicFallbackCount` counts only the Anthropic-tier fallbacks, is retained for back-compat, and is not used by `runDebate`.
- **Per-round checkpoints** (`checkpoint.ts`) — after each round (round 1, standpoints, each sequential round, consensus) `runDebate` writes the accumulated partial transcript to `debates/debate-checkpoint-<sha12>.md`, where `<sha12>` is the first 12 hex chars of `sha256(question)`. Writes go through a `.tmp` sibling + rename so a crash mid-write can't leave a half file. On successful completion the checkpoint is deleted (the full transcript supersedes it); if the run crashes, aborts, or throws, the checkpoint survives with everything captured up to the last completed stage. All checkpoint I/O is best-effort — failures log to stderr and never take down the debate. A re-run of the same question overwrites its own checkpoint (stable hash), so they don't pile up.
- **Truncation warnings** — both `callOpenRouter` and `callAnthropic` log a stderr warning when the response stopped at `max_tokens`, so an operator can spot persona replies that were cut mid-argument.
- **Reasoning field fallback** — some OpenRouter reasoning models route the answer into `reasoning` / `reasoning_content` with empty `content`. `callOpenRouter` accepts that content + logs a warning; if both are empty it throws so the outer `callModel` falls back.

### Per-persona model routing

Each `Persona` has an optional `openrouterModel` slug (e.g. `x-ai/grok-4`) and/or Anthropic-native `model`. `callModel` prefers the OpenRouter slug; if OpenRouter is unreachable the call falls back to Anthropic direct, pinned to Haiku. Personas must expose at least one of the two (`personas/index.ts:isPersona` enforces this).

### Persona registry (`src/personas/`)

Dynamic — every `.ts` file in the directory that isn't `index`, `types`, or `_*` is auto-loaded at module init and its Persona export is keyed by filename. To add a persona: copy `_template.ts`, rename, fill in, save. Default order is alphabetical by key; prefix filenames with digits (`01-foo.ts`) to force a specific order.

### MCP server (`src/mcp-server.ts` + `src/mcp/`)

Runs a stdio MCP server exposing `debate`, `list_personas`, `estimate_cost`, `debate_status`, `list_runs`, `get_transcript`. `debate` kicks work off as a background run keyed by `runId` (Claude Desktop caps synchronous tool calls at ~4 min); clients poll `debate_status` which blocks server-side up to 180s waiting for completion. The MCP tool calls `runDebate` the same way the CLI does and reads `result.fallbackCount` / `result.autoFilledVerdicts` for cost-line construction (via `buildCostLine`) and coverage disclosure.

Hot-reload (`MCP_HOT_RELOAD=1`) watches `src/` and swaps the `debate`, `personas`, and `client` modules on change by re-importing with a cache-busting query. `mcp-server.ts` itself is excluded from the watcher — editing it still requires a Desktop restart.

### Markdown output (`buildMarkdown`)

Splits into focused section renderers (`renderQuestionSection`, `renderExecSummary`, `renderStarterSection`, `renderStandpointsSection`, `renderRoundsSection`, `renderNerdstats`, `renderTimingTable`). Each is independently testable. The nerdstats footer surfaces panel metadata, per-persona model routing, rounds / auto-panel-size env values, auto-filled verdict names (if any), failed-call count (if any), and a per-persona × per-round timing grid.

## Testing

Tests live in `tests/` and run under the built-in `node --test` runner via the tsx loader. Pure functions get unit coverage (`parseAbstention`, `pickNextOrder`, `adjacentPairs`, `slugify`, `fmtMs`, `openRouterSlugToAnthropic`, `parseSelectionFromArgs`, `extractFirstJsonObject`, `ensureAllPersonasInSynthesis`, `buildCostLine`). Adding a test: create `tests/<name>.test.ts`, import from `../src/…js` (note the `.js` extension — TS `moduleResolution: "bundler"` tolerates it and node runs it through tsx), use `node:test` + `node:assert/strict`.

## Module system

ESM throughout (`"type": "module"` in `package.json`, `moduleResolution: "bundler"` in `tsconfig.json`). Run directly with `tsx` — no pre-compilation. The persona registry uses top-level await at import time so synchronous consumers can treat `FOUNDER_PERSONAS` as a ready `Record<string, Persona>`.

