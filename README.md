<p align="center">
  <img src="./download.jpeg" alt="Debate Leaders logo" width="200" height="200" />
</p>

# Universal Debating Engine

A multi-round debate engine. A neutral nine-lens framing of the question, a parallel Round 1 of independent takes, a distilled "Major Standpoints + Key Tensions" doc fed into the sequential reaction rounds, a mandatory per-persona consensus round, and a synthesized consensus model with per-persona verdicts and an action recommendation. 43 distinct personas, each speaking through a vendor-aligned model on OpenRouter.

Runs as a CLI or as an MCP server for Claude Desktop.

## Demo

[![asciicast](https://asciinema.org/a/JT7zl3pOwWlHBk2f.svg)](https://asciinema.org/a/JT7zl3pOwWlHBk2f)

## Quick Start

```bash
npm install
cp .env.example .env          # paste your OPENROUTER_API_KEY
npm run debate -- "Your question here"
```

## The Panel

Current panel (43 personas, all auto-discovered from `src/personas/*.ts`):

| Key | Persona | Frame | OpenRouter Model |
|---|---|---|---|
| `avicii` | Avicii (DJ) | Melodic Joy, Authenticity & Inner Balance | `meta-llama/llama-4-maverick` |
| `borlaug` | Norman Borlaug (Agronomist) | Green Revolution, Hunger Fighter & Pragmatic Humanist | `openai/gpt-5.4` |
| `buffett` | Warren Buffett (Berkshire Hathaway) | Value Investing, Patience & Economic Moats | `minimax/minimax-m2.5` |
| `chesky` | Brian Chesky (Airbnb CEO) | Co-founder of Airbnb & Designer of Belonging | `google/gemini-3.1-pro-preview` |
| `churchill` | Winston Churchill (British Statesman) | Defiance, Leadership & Strategic Courage | `deepseek/deepseek-v3.2` |
| `dario` | Dario Amodei (Anthropic) | Precise Definition + Vision Futurist | `anthropic/claude-opus-4.7` |
| `dick` | Dick Cheney (US Vice President) | Architect of American Power | `x-ai/grok-4.20-multi-agent` |
| `diogenes` | Diogenes of Sinope | The Cynic Philosopher | `anthropic/claude-haiku-4.5` |
| `draghi` | Mario Draghi | Technocratic Institutionalist & Guardian of Stability | `anthropic/claude-haiku-4.5` |
| `elon` | Elon Musk (SpaceX, Tesla, xAI) | Architect of Multi-Planetary Civilization | `x-ai/grok-4.20-multi-agent` |
| `fleming` | Alexander Fleming (Bacteriologist) | Serendipity, Observation & Antibiotic Revolution | `openai/gpt-5-mini` |
| `foucault` | Michel Foucault | Philosopher of Power & Knowledge | `anthropic/claude-haiku-4.5` |
| `friedman` | Milton Friedman (Economist) | Free Markets, Monetarism & Individual Freedom | `minimax/minimax-m2.5` |
| `gandhi` | Mahatma Gandhi (Indian Leader) | Apostle of Non-Violence & Truth | `openai/gpt-5.4` |
| `geert` | Geert Wilders (Dutch Politician) | Dutch Patriot & Defender of the West | `x-ai/grok-4.20-multi-agent` |
| `genghis` | Genghis Khan (Mongol Leader) | Conqueror of the Known World | `x-ai/grok-4.20-multi-agent` |
| `golda` | Golda Meir (Israeli Prime Minister) | Iron Lady of Israel | `google/gemini-3.1-pro-preview` |
| `graham` | Paul Graham (Y Combinator) | Founder Mode Ownership Thinker | `deepseek/deepseek-v4-pro` |
| `greta` | Greta Thunberg (Climate Activist) | Climate Emergency & Moral Clarity | `google/gemini-3.1-pro-preview` |
| `jensen` | Jensen Huang (NVIDIA CEO) | Speed-of-Light Systems Thinker | `deepseek/deepseek-v4-pro` |
| `jesus` | Jesus Christ (Christian Theologian) | Compassion, Authority & Kingdom Wisdom | `deepseek/deepseek-v3.2` |
| `jobs` | Steve Jobs | Visionary Founder of Apple \| Obsessive Product Artist | `anthropic/claude-sonnet-4-6` |
| `johan` | Johan Cruijff (Eeuwige Nr.14) | Total Football & Simplicity Philosophy | `minimax/minimax-m2.5` |
| `keynes` | John Maynard Keynes (Economist) | Demand Management & Pragmatic Economics | `z-ai/glm-5.1` |
| `kingsnorth` | Paul Kingsnorth | Writer, Former Environmentalist & Civilizational Skeptic | `anthropic/claude-haiku-4.5` |
| `kissinger` | Henry Kissinger | Master of Realpolitik | `openai/gpt-5-mini` |
| `land` | Nick Land | Accelerationist Philosopher | `anthropic/claude-haiku-4.5` |
| `larry` | Larry Ellison (Oracle) | Business Model + Competitive Ruthlessness | `deepseek/deepseek-v4-pro` |
| `leekuanyew` | Lee Kuan Yew (Singaporean Politician) | Pragmatic Authoritarian Modernization | `openai/gpt-5-mini` |
| `linus` | Linus Torvalds | Creator of Linux & Git \| Benevolent Dictator for Life | `openai/gpt-5-mini` |
| `mandela` | Nelson Mandela (Anti-Apartheid Revolutionary) | Reconciliation, Dignity & Moral Courage | `deepseek/deepseek-v3.2` |
| `marie` | Marie Curie (Scientist) | Pioneer of Radioactivity & Relentless Scientific Passion | `openai/gpt-5-mini` |
| `mark` | Mark Zuckerberg (Meta) | Network Effects + Long-Horizon Platform Builder | `meta-llama/llama-4-maverick` |
| `obama` | Barack Obama (Former President) | Hope, Unity & Pragmatic Leadership | `anthropic/claude-opus-4.7` |
| `paris` | Paris Hilton (Celebrity) | Icon, Entrepreneur & Unapologetic Fame Architect | `openai/gpt-5-mini` |
| `rutte` | Mark Rutte (Former PM of the Netherlands) | Pragmatic No-Nonsense Dutch Realism | `minimax/minimax-m2.7` |
| `sam` | Sam Altman (OpenAI) | Long-Horizon Leverage Strategist | `openai/gpt-5.4` |
| `shoichiro` | Shoichiro Toyoda (Toyota Executive) | Deming-Inspired Quality & Respect for People | `minimax/minimax-m2.5` |
| `thiel` | Peter Thiel | Contrarian Founder & Zero-to-One Thinker | `openai/gpt-5-mini` |
| `tyson` | Neil deGrasse Tyson (Astrophysicist) | Cosmic Perspective & Scientific Wonder | `z-ai/glm-5.1` |
| `xi` | Xi Jinping (Chinese Politician) | Centralized Vision + Strategic State Power + 30-Year Horizon | `z-ai/glm-5.1` |
| `yamamoto` | Isoroku Yamamoto (Japanese Admiral) | Strategic Boldness & Naval Mastery | `deepseek/deepseek-v3.2` |
| `yarvin` | Curtis Yarvin (Mencius Moldbug) | Neoreactionary Thinker | `anthropic/claude-haiku-4.5` |

Pipeline models (not personas):

| Stage | Shipped `.env.example` value | Env var | Code fallback when unset |
|---|---|---|---|
| Starter (nine-lens framing) | `anthropic/claude-sonnet-5` | `DEBATE_STARTER_MODEL` | `anthropic/claude-haiku-4.5` |
| Standpoints distillation | `anthropic/claude-haiku-4.5` | `DEBATE_STANDPOINTS_MODEL` | inherits `DEBATE_SYNTHESIZER_MODEL` |
| Synthesizer | `anthropic/claude-sonnet-5` | `DEBATE_SYNTHESIZER_MODEL` | `anthropic/claude-haiku-4.5` |
| Auto-selector | `anthropic/claude-haiku-4.5` | — (hard-coded) | — |

The two highest-value stages — the starter framing and the final synthesis — ship on Claude Sonnet in `.env` / `.env.example`; the mechanical steps (standpoints distill, selector) stay on Haiku for a cost-balanced profile. The selector is fixed in `src/debate/config.ts` and not env-configurable.

Output caps: `4096` max tokens for every stage (starter, selector, round answers, distillation, consensus), `8192` for the final synthesis.

## How It Works

1. **Starter (1 call).** The starter model produces a nine-lens framing (Military, Diplomatic, Economic, Ecological, Humanitarian, Informational, Technological, Scientific, Governance/Institutional) closing with a **Debate-Opening Tensions** paragraph naming the sharpest tradeoffs.
2. **Panel selection.** Either `auto` (**default** — a lightweight selector picks `DEBATE_AUTO_PANEL_SIZE` (default 6) maximally contrasting voices for the specific question with a one-sentence rationale), `all` (run the full panel), or a manual subset like `elon,jesus`. The selector's JSON is parsed with a balanced-brace walker, so surrounding prose or code fences don't break it; on a parse failure it falls back to the first ≤3 personas in registry order and dumps the raw output to stderr.
3. **Round 1 — Parallel, independent (p calls).** Every persona answers the starter without seeing any other panelist. Concurrency is capped at `ceil(p/3)` so a full-panel run doesn't burst-request OpenRouter. Overlap between replies reflects genuine convergence, not in-round echo.
4. **Standpoints distillation (1 call).** A distill pass reads the parallel R1 answers and produces a structured **Major Standpoints** (3–6 positions, each with a `*Held by:*` line) + **Key Tensions** doc. It is injected into every later round so the sequential debate shares an explicit map of the landscape.
5. **Rounds 2…`DEBATE_ROUNDS` — Sequential ((R-1)p calls).** Each persona sees the standpoints doc, every prior round, and every persona who has already spoken in the current round. Speaking order is re-picked per round by a bounded random search (200 attempts) that minimizes adjacency carry-over from the previous round — so no two personas who were adjacent last round stay adjacent (panel size permitting), and an identical order is heavily penalized. Any persona may abstain for a specific round by beginning with `[ABSTAIN] <one-sentence reason>` if the topic is genuinely outside their expertise.
6. **Consensus round — Parallel, mandatory (p calls).** Each persona independently lists `**Positives**` and `**Negatives**` of the emerging consensus as bullets, same `ceil(p/3)` concurrency cap. Abstention is **not** allowed in this round — the response is taken verbatim, so any `[ABSTAIN]` text is treated as literal content, not a structured opt-out.
7. **Synthesis (1 call).** The synthesizer receives an explicit numbered roster and produces per-persona 3-sentence verdicts (tracing evolution from the independent R1 opener through the sequential rounds) and a ≤600-word consensus model ending with a bulleted `**Action Recommendation**`.
8. **Coverage check (0 calls).** Every participant is guaranteed a verdict — the synthesis is scanned for each persona's line-leading bold name (full name or short name as a whole word). Anyone missing gets an "Auto-filled verdicts" block built mechanically from their last substantive round answer + consensus bullets, and their name is listed in the nerdstats.
9. **Cost report.** OpenRouter credits are queried before and after; the delta prints as `Cost: $X.XXXX`. Fallback calls (see [Provider Routing](#provider-routing)) are counted via a per-run callback and a rough per-call estimate (`DEBATE_FALLBACK_EST_USD`, default $0.002) is appended to the cost line.

Total calls per run: `1 (starter) + p (R1) + 1 (distill) + (R-1)p (R2..R{DEBATE_ROUNDS}) + p (consensus) + 1 (synthesis) = 3 + (R+1)p` where `R = DEBATE_ROUNDS`. With defaults (`R=4`) this is the familiar `3 + 5p`. `--test` mode is `1 + p`.

### Provider Routing

Every model call is routed through `src/client.ts`:

- **Primary** — OpenRouter (`https://openrouter.ai/api/v1`) using each persona's vendor-aligned `openrouterModel` slug. A persona with only an Anthropic-native `model` gets it auto-namespaced (`claude-sonnet-4-6` → `anthropic/claude-sonnet-4.6`).
- **Retry** — Up to 3 attempts per call with exponential backoff (500ms base) + jitter on retryable errors (408, 409, 425, 429, 5xx, network). If the server returns a `Retry-After` header, that value is honored (capped at 60s) instead of exponential backoff for the next attempt. Other 4xx fail fast — a bad request won't become a good one.
- **Two-tier fallback** — Once a persona's intended model exhausts its OpenRouter retries (or the slug is invalid), the call first retries on OpenRouter with `deepseek/deepseek-v4-pro` — most failures are model-specific with OpenRouter itself still up. Only if that **also** fails (e.g. a full OpenRouter outage) does it cross to **Anthropic direct**, pinned to `claude-haiku-4-5`. With no OpenRouter key at all, calls go straight to Anthropic. A fallback is counted once per persona on `DebateResult.fallbackCount` at the first deviation from its intended model (whichever tier ultimately answers) and surfaced in the cost line. A `⚠️` alert prints to **stderr** with the attempted slug and reason so the MCP stdout stream (JSON-RPC) stays clean.
- **Empty-content recovery** — some reasoning models route the answer into `reasoning` / `reasoning_content` with an empty `content` field. That is accepted as the response with a stderr warning; if both are empty the call throws so the fallback chain engages rather than emitting a blank persona reply.
- **Truncation warnings** — both providers log a stderr warning when a response stopped at `max_tokens`, so an operator can spot persona replies cut mid-argument.
- **Reasoning-leak retry** — if a persona's answer looks like leaked planning chatter (meta bold headers like `**Evaluating**` / `**Finalizing**`, or a duplicated `**Positives**` / `**Negatives**` section), the call is retried **once** with an appended output-discipline instruction. The second answer is kept either way.
- **Per-persona fault tolerance** — a single persona call that fails outright (retries + fallback exhausted) becomes a `*Call failed*` response and the debate continues. The failed-call count is surfaced in the nerdstats.

### Crash-Safe Checkpoints

After every completed stage (round 1, standpoints, each sequential round, consensus) the accumulated partial transcript is written to `debates/debate-checkpoint-<sha12>.md`, where `<sha12>` is the first 12 hex chars of `sha256(question)`. Writes go to a `.tmp` sibling and are renamed, so a crash mid-write can't leave a half file. On successful completion the checkpoint is deleted — the full transcript supersedes it. If the run crashes, aborts, or throws, the checkpoint survives with everything up to the last completed stage. All checkpoint I/O is best-effort: failures log to stderr and never take down the debate. Re-running the same question overwrites its own checkpoint (stable hash), so they don't pile up.

## CLI Usage

```bash
# Auto-select 6 maximally contrasting personas (default — omit --personas)
npm run debate -- "Should the four-day workweek become the new standard?"

# Full 43-persona panel
npm run debate -- "Should AI replace software engineers?" --personas all

# Manual subset — pairwise debate
npm run debate -- "Should AI replace software engineers?" --personas elon,jesus

# Verbose SDK logs
OPENAI_LOG=debug ANTHROPIC_LOG=debug npm run debate -- "..."
```

Each run writes a full Markdown transcript to `debates/debate-<timestamp>-<slug>.md` (`debate-TEST-<timestamp>-<slug>.md` in test mode). A second copy goes to `DEBATE_OUTPUT_DIR` (or `--output-dir`) — useful for piping transcripts into Obsidian, iCloud, OneDrive, etc.; without it the mirror goes to `~/Downloads`. A failing extra-copy is logged but never fails the run.

Omit the question entirely and a built-in default is used (`"Should AI systems be allowed to make autonomous decisions in high-stakes medical contexts?"`).

### CLI Flags

All flags go **after** the `--` separator so `npm` forwards them to the debate script.

**Run shape:**

| Flag | Values | Effect |
|---|---|---|
| `--personas` | `auto` (default), `all`, or comma-separated keys (`elon,jesus`) | Pick the panel — see [Selecting Personas](#selecting-personas). |
| `--test` | boolean | Starter + round 1 only. Skips standpoints, R2+, consensus, synthesis. Fast dry-run for new personas or prompt tweaks. |
| `--no-stream` | boolean | Silence the per-persona `[stream]` stderr progress lines (on by default). Use in CI / scripted runs where only the final markdown on stdout matters. |

**Env-var overrides** (flag takes precedence over `.env`, accepts `--flag value` or `--flag=value`):

| Flag | Overrides | Example |
|---|---|---|
| `--rounds` | `DEBATE_ROUNDS` | `--rounds 6` |
| `--panel-size` | `DEBATE_AUTO_PANEL_SIZE` | `--panel-size 8` |
| `--starter-model` | `DEBATE_STARTER_MODEL` | `--starter-model anthropic/claude-opus-4.7` |
| `--synthesizer-model` | `DEBATE_SYNTHESIZER_MODEL` | `--synthesizer-model anthropic/claude-opus-4.7` |
| `--standpoints-model` | `DEBATE_STANDPOINTS_MODEL` | `--standpoints-model anthropic/claude-haiku-4.5` |
| `--output-dir` | `DEBATE_OUTPUT_DIR` | `--output-dir ~/Obsidian/Debates` |
| `--fallback-est-usd` | `DEBATE_FALLBACK_EST_USD` | `--fallback-est-usd 0.006` |

A flag passed without a value logs a warning and is ignored. Full env-var reference is in [Configuration Reference](#configuration-reference).

### Selecting Personas

Three modes for `--personas`:

**1. `auto` (default, omit the flag).** A lightweight selector model picks `DEBATE_AUTO_PANEL_SIZE` (default 6, clamp `[2, 12]`) maximally contrasting voices for the specific question and writes a one-sentence rationale into the nerdstats. Good for ad-hoc questions where you want variety without hand-picking.

```bash
npm run debate -- "Should we tax robot labor?"                    # 6 personas
npm run debate -- "Should we tax robot labor?" --panel-size 10    # 10 personas
```

**2. `all`.** Runs the full 43-persona panel. Expensive but gives every vendor lens on the question.

```bash
npm run debate -- "Should AI replace software engineers?" --personas all
```

**3. Manual keys.** Comma-separated persona keys (no spaces). Keys are the filenames under `src/personas/` without the `.ts` extension — see [the table above](#the-panel). Unknown keys log a warning and are skipped; if all keys are unknown the CLI falls back to `auto`.

```bash
npm run debate -- "Should AI replace SWEs?" --personas elon,jesus                 # 2
npm run debate -- "Euro vs USD in 2030?"   --personas draghi,buffett,friedman,xi  # 4
npm run debate -- "Climate policy?"        --personas=greta,kingsnorth,borlaug    # = form works too
```

**List available keys:** `ls src/personas/*.ts`, or run `npm run debate -- "ping" --personas=__unknown__ --test` — the warning prints the offending key and falls back to auto.

**Test-drive a new panel without paying for the full run:** combine with `--test` to run only starter + round 1 (parallel), skipping standpoints/R2+/consensus/synthesis.

```bash
npm run debate -- "Quick sanity check" --personas elon,jesus,greta --test
```

## Claude Desktop (MCP) Usage

The MCP server entry point is `src/mcp-server.ts`. It exposes **seven tools**:

- `debate` — starts a background run and returns a `runId` with the chosen panel and runtime/cost estimates. Optional `interactive: true` shows an MCP elicitation dialog confirming panel + cost before launching.
- `debate_status` — polls a run. By default it blocks up to **45 s** (configurable via `waitSec`, min 0 / max 180) so Desktop's ~4-minute synchronous-tool cap is respected while each poll still covers meaningful wall time. Returns the full transcript once `phase === "done"`; otherwise returns phase / latest status / elapsed / step counter. Spends no API credits.
- `debate_cancel` — aborts an in-flight run at the next round boundary. In-flight LLM calls still finish, but no new stages start. Idempotent; returns the run's final phase.
- `list_personas` — dump the persona registry with keys, names, and model slugs.
- `estimate_cost` — dry-run cost + call estimate for a given selection without running the debate. Accepts the same `personas` shape as `debate`.
- `list_runs` — list debates still kept in memory on this server (running or recently completed), for when a `runId` was lost.
- `get_transcript` — read a saved transcript by filename, or `"latest"` / omitted for the newest one.

Every transcript under `debates/` is also exposed as an MCP **resource** at `debate://transcripts/<filename>`, and a `run-debate` **prompt** is registered as a saved template (arguments: `question` required, `personas` optional).

`debate` / `estimate_cost` inputs:

- `question` (string, required for `debate`)
- `personas` (optional): `"all"`, `"auto"` (default — picks `DEBATE_AUTO_PANEL_SIZE` maximally contrasting voices), or an array of persona keys (e.g. `["elon","jesus"]`). Unknown and duplicate keys are dropped with a stderr note; an array with no valid keys is an error.
- `interactive` (optional, `debate` only, default `false`)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`:

```json
"debate_engine": {
  "command": "/absolute/path/to/p3agents/node_modules/.bin/tsx",
  "args": ["/absolute/path/to/p3agents/src/mcp-server.ts"],
  "env": {
    "DOTENV_CONFIG_QUIET": "true"
  }
}
```

`DOTENV_CONFIG_QUIET=true` silences tsx's dotenv banner that would otherwise pollute stdout JSON-RPC. Fully quit Claude Desktop (⌘Q) and relaunch — the tools appear under the tools icon. Fallback alerts land in `~/Library/Logs/Claude/mcp-server-p3agents-debate.log`.

### Hot Reload (dev)

Set `MCP_HOT_RELOAD=1` to have the server `fs.watch` `src/` and swap the `debate`, `personas`, and `client` modules on save (250 ms debounce), then emit `notifications/tools/list_changed`. New personas and prompt tweaks land without a Desktop restart. `src/mcp-server.ts` and everything under `src/mcp/` are excluded from the watcher — changing those still requires a restart, because handler registration can't be safely replaced mid-flight.

## Adding or Editing Personas

Personas are **auto-discovered** from `src/personas/*.ts`. To add one:

1. Copy `src/personas/_template.ts` to `src/personas/<shortkey>.ts` (e.g. `ada.ts`).
2. Fill in `name`, `openrouterModel` and/or `model`, the `system` prompt, and `redFlags` (optional).
3. Save. Done — next run picks it up. The filename (without `.ts`) becomes the CLI/MCP key.

Rules:

- `index.ts`, `types.ts`, and any file starting with `_` are ignored (so `_template.ts` is safe to keep as a starter).
- A file must export a value matching the `Persona` shape, with **at least one** of `openrouterModel` / `model` — a persona with neither can't be routed and is skipped with a stderr warning.
- Ordering in the panel array is alphabetical by filename — prefix with digits (e.g. `01-jensen.ts`) to force a specific order. Round speaking order is re-randomized per sequential round regardless.
- To retire a persona temporarily, rename it to start with `_` (e.g. `_jensen.ts`).

### Persona Shape

```ts
interface Persona {
  name: string;              // Printed verbatim above every response; "Short Name — Tagline"
  model?: string;            // Optional Anthropic-native ID
  openrouterModel?: string;  // Preferred slug for normal calls
  system: string;            // Full system prompt (400–800 words works)
  redFlags?: string[];       // Anti-patterns; not sent to the model, but the first two
                             // are fed to the auto-selector's catalog to sharpen contrast
}
```

The `name` field's `" — "` split matters: the text before it is the short name used in progress logs and the synthesis coverage check; the text after it is the tagline shown to the auto-selector.

## Opt-Out Per Round

Rounds 1…`DEBATE_ROUNDS` tell each persona they may abstain with `[ABSTAIN] <reason>` if the question is genuinely outside their expertise — preferable to faking noise. The tag is parsed tolerantly (any casing, optional markdown emphasis or brackets). Abstentions are recorded in the transcript as `*Abstained: <reason>*`, shown to later personas so they can react, and handled explicitly by the synthesizer (one-sentence verdict instead of three). The **consensus round is mandatory** — abstention is not accepted there.

## Nerdstats

Every transcript ends with a `# Nerdstats` block:

- Panel selection mode, participant keys, and selector rationale (for `auto`).
- Starter, standpoints (when it differs from the synthesizer), and synthesizer model IDs + synthesis `max_tokens`.
- `DEBATE_ROUNDS`, and `DEBATE_AUTO_PANEL_SIZE` on auto runs.
- Run cost (OpenRouter delta) plus the estimated Anthropic-fallback cost if any.
- Auto-filled verdict names, if the synthesizer dropped anyone.
- Failed persona-call count, if any.
- **Per-persona model routing:** `openrouterModel` → Anthropic-fallback `model` for every participant.
- **Timing breakdown:** starter, standpoints, synthesis, and run total, plus a Markdown table with personas as rows and rounds + consensus as columns. Each cell is that persona's wall-clock in that round; the rightmost column totals per persona, the bottom row per round (parallel rounds sum > wall-clock, which is intended).

## Setup

```bash
npm install
cp .env.example .env
```

`.env` needs at least one provider key — `src/client.ts` throws at startup if both are missing:

```
OPENROUTER_API_KEY=sk-or-v1-...
ANTHROPIC_API_KEY=sk-ant-...                        # optional but recommended (fallback target)
DEBATE_OUTPUT_DIR=/path/to/Obsidian/Debate-Output   # optional second copy
```

Other commands:

```bash
npm run typecheck    # tsc --noEmit over src/ and tests/
npm test             # node:test suites in tests/ via the tsx loader
```

## File Layout

```
src/
  debate.ts            Public barrel: re-exports from ./debate/*
  cli.ts               CLI entry: parses env-override flags, then dynamic-imports the barrel
  debate/
    config.ts          Env vars + model slug constants (all DEBATE_* knobs live here)
    types.ts           Public types: DebateResult, DebateEvents, DebateAbortError, CallContext
    util.ts            Pure helpers: parseAbstention, pickNextOrder, fmtMs, buildCostLine, …
    pipeline.ts        runDebate() + stages + safePersonaCall
    render.ts          buildMarkdown() + section renderers
    checkpoint.ts      Crash-safe per-round partial transcripts
    cli.ts             debate() wrapper, parseSelectionFromArgs, copyTranscriptToExtraDir
  client.ts            Provider abstraction (OpenRouter primary, two-tier fallback)
  mcp-server.ts        Stdio MCP server — thin entry that wires ./mcp/*
  mcp/
    context.ts         Mods type, loadModules, PROJECT_ROOT, safeLog
    runs.ts            RunState + registry Map + pruning + saved-file trailer
    tools.ts           ListTools + CallTool handlers for all 7 tools
    resources.ts       Transcript resources (debate://transcripts/<name>)
    prompts.ts         run-debate prompt
    hot-reload.ts      fs.watch src/ and swap mods on save (MCP_HOT_RELOAD=1)
  personas/
    index.ts           Auto-discovering FOUNDER_PERSONAS registry
    types.ts           Persona interface
    _template.ts       Starter template for new personas
    <shortkey>.ts      One file per persona (auto-registered by filename)
tests/
  debate.test.ts       Unit coverage for the pure helpers
  checkpoint.test.ts   Checkpoint path / hash behaviour
debates/               Transcripts + checkpoints written here per run (*.md, gitignored)
```

## Cost & Timing Notes

Calls per run: `3 + (R+1)p` in full mode, `1 + p` with `--test`, where `R = DEBATE_ROUNDS` (default 4, clamped `[2, 10]`) and `p` = panel size.

The MCP `estimate_cost` tool models spend as **$0.03–0.06 per persona** and buckets wall-clock as `~1–3 min` (≤4 personas), `~3–7 min` (≤10), `~8–15 min` (≤20), `~15–20 min` (above). Those bands assume Haiku-class pipeline models; pointing `DEBATE_SYNTHESIZER_MODEL` at Opus will blow past the high end, so run `estimate_cost` before committing a full-panel Opus synth.

| Shape | Calls (R=4) |
|---|---|
| Full 43-persona panel | 218 |
| Auto (6 contrasting) | 33 |
| Manual 5-persona | 28 |
| Manual 3-persona | 18 |
| 2-persona pairwise | 13 |
| `--test` full panel (starter + R1 only) | 44 |

R1 and the consensus round run in parallel batches of `ceil(p/3)`, so their wall-clock is roughly three times the slowest persona rather than the sum of the panel. Sequential rounds 2…R dominate total wall time — each persona waits on the previous one, adding roughly `(R-1) × sum(per-persona_ms)`. A single slow vendor slug can add minutes on its own; check the nerdstats timing table after each run to spot the dragger.

Anthropic-fallback cost is not included in the OpenRouter balance delta; the cost line appends `fallbackCount × DEBATE_FALLBACK_EST_USD` (default $0.002/call) so the total isn't blind to fallback spend.

## Configuration Reference

Every knob has three equivalent forms: `.env` file, inline shell env, or CLI flag. Precedence: **CLI flag > inline env > `.env` > default**. Config is read at module load, so inline env and `.env` must be set before the process starts; CLI flags are parsed in `src/cli.ts` and mutate `process.env` before the config module evaluates. Malformed numeric values log a warning and fall back to the default rather than erroring.

**Keys** — at least one must be set; `client.ts` throws at startup otherwise.

| Variable | CLI flag | Default | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | — | — | Primary provider key. |
| `ANTHROPIC_API_KEY` | — | — | Fallback-only provider key (Haiku-direct). |

**Run shape** — tune per run via CLI flag.

| Variable | CLI flag | Default | Purpose |
|---|---|---|---|
| `DEBATE_ROUNDS` | `--rounds` | `4` (clamped 2–10) | Total rounds (R1 parallel + R2..N sequential). |
| `DEBATE_AUTO_PANEL_SIZE` | `--panel-size` | `6` (clamped 2–12) | Target panel size for `--personas auto`. |
| `DEBATE_STARTER_MODEL` | `--starter-model` | `anthropic/claude-haiku-4.5` (`.env.example`: Sonnet) | Starter (nine-lens framing) slug. |
| `DEBATE_SYNTHESIZER_MODEL` | `--synthesizer-model` | `anthropic/claude-haiku-4.5` (`.env.example`: Sonnet) | Final synthesis slug. |
| `DEBATE_STANDPOINTS_MODEL` | `--standpoints-model` | inherits `DEBATE_SYNTHESIZER_MODEL` (`.env.example`: Haiku) | Standpoints distillation slug. |
| `DEBATE_FALLBACK_EST_USD` | `--fallback-est-usd` | `0.002` | Rough per-call est. for the Anthropic-direct fallback cost line. |
| `DEBATE_OUTPUT_DIR` | `--output-dir` | `~/Downloads` | Second-copy transcript destination. |

**MCP-only** — no CLI flag; read at MCP server startup.

| Variable | Default | Purpose |
|---|---|---|
| `MCP_HOT_RELOAD` | unset | Set to `1` to enable `fs.watch` hot-reload on `src/` (MCP server only). |
| `DOTENV_CONFIG_QUIET` | unset | Set to `true` in the Desktop config so dotenv's banner can't pollute stdout JSON-RPC. |

Examples — same run, three surfaces:

```bash
# CLI flag (per-run override)
npm run debate -- "Question?" --rounds 6 --synthesizer-model anthropic/claude-opus-4.7

# Inline shell env (per-run override)
DEBATE_ROUNDS=6 DEBATE_SYNTHESIZER_MODEL=anthropic/claude-opus-4.7 npm run debate -- "Question?"

# .env file (durable override)
echo "DEBATE_ROUNDS=6"                                     >> .env
echo "DEBATE_SYNTHESIZER_MODEL=anthropic/claude-opus-4.7"  >> .env
npm run debate -- "Question?"
```

