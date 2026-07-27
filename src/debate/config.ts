/**
 * Config — all environment-derived constants the debate pipeline reads at
 * module load. Kept in one file so operators (and new contributors) have a
 * single place to see which env knobs exist and what their defaults are.
 */

import "dotenv/config";

/** Best-effort OpenRouter-slug → Anthropic-native-ID mapping. Only used to
 *  keep the `model` field on `callModel()` sensible for the Anthropic-direct
 *  fallback path; the actual fallback is forced to Haiku in `client.ts`. */
export function openRouterSlugToAnthropic(slug: string): string {
  if (!slug.startsWith("anthropic/")) return "claude-haiku-4-5";
  // anthropic/claude-foo-1.2 → claude-foo-1-2
  return slug.replace(/^anthropic\//, "").replace(/\./g, "-");
}

/** Parse a positive integer env var within [min, max]. Returns `fallback`
 *  when the var is unset, empty, non-numeric, or out of range. Keeps env
 *  configuration quiet — the default wins on malformed input. */
function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(
      `⚠️  ${name}="${raw}" ignored (expected integer in [${min}, ${max}]); using ${fallback}.`
    );
    return fallback;
  }
  return n;
}

/** OpenRouter slug used for the neutral nine-lens starter framing. Set via
 *  `DEBATE_STARTER_MODEL` in `.env` (the shipped `.env.example` points it at
 *  Claude Sonnet); the code fallback when unset is Haiku. */
export const STARTER_OPENROUTER_MODEL =
  process.env.DEBATE_STARTER_MODEL?.trim() || "anthropic/claude-haiku-4.5";
/** Anthropic-native ID derived from the OpenRouter slug so Anthropic-direct
 *  fallback hits a sensible model rather than a hard-coded default. */
export const STARTER_ANTHROPIC_MODEL = openRouterSlugToAnthropic(
  STARTER_OPENROUTER_MODEL
);

/** OpenRouter slug for the post-run synthesizer (per-persona verdicts +
 *  consensus model + action recommendation). Set via `DEBATE_SYNTHESIZER_MODEL`
 *  in `.env` (the shipped `.env.example` points it at Claude Sonnet); the code
 *  fallback when unset is Haiku. */
export const SYNTHESIZER_OPENROUTER_MODEL =
  process.env.DEBATE_SYNTHESIZER_MODEL?.trim() || "anthropic/claude-haiku-4.5";
export const SYNTHESIZER_ANTHROPIC_MODEL = openRouterSlugToAnthropic(
  SYNTHESIZER_OPENROUTER_MODEL
);

/** Separate knob for the standpoints-distillation step between rounds 1 and 2.
 *  Distillation is cheap and mechanical, so the shipped `.env.example` keeps it
 *  on Haiku even while starter/synth run on Sonnet. Set via
 *  `DEBATE_STANDPOINTS_MODEL`; the code fallback when unset inherits the
 *  synthesizer model. */
export const STANDPOINTS_OPENROUTER_MODEL =
  process.env.DEBATE_STANDPOINTS_MODEL?.trim() || SYNTHESIZER_OPENROUTER_MODEL;
export const STANDPOINTS_ANTHROPIC_MODEL = openRouterSlugToAnthropic(
  STANDPOINTS_OPENROUTER_MODEL
);

/** Output cap for the final synthesis call. Haiku's practical ceiling is
 *  well under Opus's 64K, and a 6-persona auto run fits comfortably in 8K —
 *  so 8192 is the safe default. */
export const SYNTHESIZER_MAX_TOKENS = 8192;

/** Output cap for every non-synthesis stage (starter, selector, round
 *  answers, standpoints distillation, consensus). 4096 leaves headroom for a
 *  large panel's structured markdown without truncating mid-argument; only the
 *  final synthesis needs more (see `SYNTHESIZER_MAX_TOKENS`). */
export const STAGE_MAX_TOKENS = 4096;

/** Auto-selector model — fixed, not env-configurable (lightweight + cheap
 *  enough that there's no reason to upgrade it). */
export const SELECTOR_OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";
export const SELECTOR_ANTHROPIC_MODEL = "claude-haiku-4-5";

/** Total debate rounds (round 1 parallel + R2..N sequential). Env-override
 *  via `DEBATE_ROUNDS`; clamped to [2, 10]. */
export const DEBATE_ROUNDS = envInt("DEBATE_ROUNDS", 4, 2, 10);

/** Target size for the auto-selected panel. Env-override via
 *  `DEBATE_AUTO_PANEL_SIZE`; clamped to [2, 12] — the selector has to emit
 *  the requested count and very large panels make contrast selection fuzzy. */
export const DEBATE_AUTO_PANEL_SIZE = envInt("DEBATE_AUTO_PANEL_SIZE", 6, 2, 12);

/** Rough avg cost of a single Anthropic-direct Haiku call used for fallback.
 *  Used only to annotate the cost line when OpenRouter is the primary but
 *  some calls fell back — the real number would need per-call token counts.
 *  Override via `DEBATE_FALLBACK_EST_USD` in `.env` (e.g. set to 0.006 if
 *  running long system prompts that push fallback calls higher). */
export const ANTHROPIC_FALLBACK_EST_USD = (() => {
  const raw = process.env.DEBATE_FALLBACK_EST_USD?.trim();
  if (!raw) return 0.002;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(
      `⚠️  DEBATE_FALLBACK_EST_USD="${raw}" ignored (expected non-negative number); using 0.002.`
    );
    return 0.002;
  }
  return n;
})();

/** Literal tag a persona uses to opt out of a non-consensus round. */
export const ABSTAIN_TAG = "[ABSTAIN]";

