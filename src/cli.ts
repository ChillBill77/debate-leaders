/**
 * CLI entry point for `npm run debate`.
 *
 * Parses env-override flags from argv FIRST, mutates `process.env`, then
 * dynamically imports `./debate/cli.js` so that `./debate/config.js`
 * observes the overridden values at its module-load reads. Static imports
 * are hoisted and would run before the mutations, so the config-dependent
 * modules must be imported lazily.
 *
 * The re-export barrel stays in `./debate.ts` for programmatic consumers
 * (MCP server, tests). This file exists only so CLI flags can take
 * precedence over `.env` without forcing a refactor of the barrel.
 */

import "dotenv/config";

/** CLI flag → env var mapping. Each flag accepts either
 *  `--flag value` or `--flag=value`. Flags take precedence over `.env`. */
const ENV_FLAGS: Record<string, string> = {
  "--rounds": "DEBATE_ROUNDS",
  "--panel-size": "DEBATE_AUTO_PANEL_SIZE",
  "--starter-model": "DEBATE_STARTER_MODEL",
  "--synthesizer-model": "DEBATE_SYNTHESIZER_MODEL",
  "--standpoints-model": "DEBATE_STANDPOINTS_MODEL",
  "--output-dir": "DEBATE_OUTPUT_DIR",
  "--fallback-est-usd": "DEBATE_FALLBACK_EST_USD",
};

/** Strip env-override flags from argv, applying each as `process.env[X] = Y`.
 *  Returns the remaining argv so the standard CLI parser
 *  (`parseSelectionFromArgs`, `--test`, `--no-stream`) sees only flags it
 *  knows. Unknown flags pass through untouched. */
function applyEnvOverrides(args: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eqIdx = a.indexOf("=");
    const flag = eqIdx >= 0 ? a.slice(0, eqIdx) : a;
    const envName = ENV_FLAGS[flag];
    if (!envName) {
      kept.push(a);
      continue;
    }
    let value: string | undefined;
    if (eqIdx >= 0) {
      value = a.slice(eqIdx + 1);
    } else if (i + 1 < args.length) {
      value = args[i + 1];
      i++;
    }
    if (value === undefined || value.length === 0) {
      console.error(`⚠️  ${flag} passed without a value — ignored.`);
      continue;
    }
    process.env[envName] = value;
  }
  return kept;
}

const rawArgs = process.argv.slice(2);
const cliArgs = applyEnvOverrides(rawArgs);

// Dynamic import AFTER env overrides so ./debate/config.js picks them up.
const { debate, parseSelectionFromArgs } = await import("./debate/cli.js");

const question =
  cliArgs.find((a) => !a.startsWith("--")) ??
  "Should AI systems be allowed to make autonomous decisions in high-stakes medical contexts?";
const selection = parseSelectionFromArgs(cliArgs);
const testMode = cliArgs.includes("--test");
// Streaming is on by default — every persona response emits `[stream]
// R{n} {persona}: {first sentence}` to stderr as it lands, so the
// operator can watch the debate unfold instead of waiting for the final
// transcript. Pass `--no-stream` to silence it (CI, scripted runs where
// only the final markdown on stdout matters). Stderr only, no API cost.
const stream = !cliArgs.includes("--no-stream");

debate(question, selection, testMode, stream).catch((err) => {
  console.error(err);
  process.exit(1);
});

