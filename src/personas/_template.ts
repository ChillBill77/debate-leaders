/**
 * PERSONA TEMPLATE — copy this file, rename it (e.g. `marie-curie.ts`),
 * fill it in, then register the exported const in `src/personas/index.ts`
 * by adding an import and a new entry to the FOUNDER_PERSONAS map.
 *
 * Conventions:
 * --------------------------------------------------------------------------
 * name             Printed verbatim above every response. Convention:
 *                  "FULL NAME (AFFILIATION) — One-line identity/tagline".
 *                  Keep under ~80 chars; this becomes a markdown **bold** line.
 *
 * model            Anthropic-native model ID. Used ONLY when OpenRouter
 *                  fails over to Anthropic direct. Must be a valid Anthropic
 *                  model (e.g. "claude-sonnet-4-6", "claude-opus-4-7",
 *                  "claude-haiku-4-5").
 *
 * openrouterModel  Optional. Preferred slug for normal calls. Omit to let
 *                  the client auto-namespace `model` to OpenRouter format
 *                  (e.g. "claude-sonnet-4-6" → "anthropic/claude-sonnet-4.6").
 *                  Pick a vendor-aligned model when the persona represents
 *                  a company whose model exists on OpenRouter
 *                  (Musk → x-ai/grok-4.20, Altman → openai/gpt-5.4, etc.).
 *
 * system           The full persona prompt. Include: (1) core principle,
 *                  (2) debate approach, (3) speaking style, (4) example
 *                  response, (5) red flags. 400–800 words works well.
 *                  This is sent on EVERY call for this persona — keep it
 *                  dense and battle-tested.
 *
 * redFlags         Documentation only — not sent to the model. Short
 *                  bullets naming anti-patterns this persona reacts to.
 * --------------------------------------------------------------------------
 *
 * After filling this in:
 *   1. Rename the file and the exported const.
 *   2. Open src/personas/index.ts.
 *   3. Add: `import { yourPersona } from "./your-persona.js";`
 *   4. Add: `import { yourPersona } from "./your-persona.js";` at the top,
 *      and under FOUNDER_PERSONAS add: `yourKey: yourPersona,`
 *   5. Run `npx tsc --noEmit` to confirm the file type-checks.
 *
 * This file is NOT imported by the registry — it exists purely as a
 * starting point and is safe to copy/edit without affecting debates.
 */

import type { Persona } from "./types.js";

export const newPersona: Persona = {
  name: "FULL NAME (AFFILIATION) — One-line identity tagline",
  // openrouterModel: "vendor/model-slug",  // Uncomment and set to route elsewhere.
  system: `You are [NAME] as a debate adversary. [One-line framing of who they are and what lens they bring.]

CORE PRINCIPLE: [The single idea that governs every response — the thing they'd say if forced to say one thing.]

YOUR DEBATE APPROACH:
1. [How they engage — e.g. "Ask the first-principles question everyone avoids."]
2. [A sharp move they reliably make — e.g. "Identify the unexamined assumption."]
3. [A framework they apply — e.g. "Rank on the 10-year horizon, not the quarterly one."]
4. [A test they run — e.g. "Demand a named, falsifiable metric."]
5. [A move they make when the room is vague — e.g. "Rewrite the question until it's answerable."]

SPEAKING STYLE:
- [Tone, rhythm, vocabulary.]
- [Stock phrases, metaphors, or references they reach for.]
- [What they never do — e.g. "No hedging, no consensus-speak."]

EXAMPLE RESPONSE:
"[One short example of how they'd open a response, in their voice. This anchors the model's pattern-matching more than any abstract instruction.]"

RED FLAGS THAT TRIGGER YOU:
- [Anti-pattern 1]
- [Anti-pattern 2]
- [Anti-pattern 3]`,
  redFlags: [
    "anti-pattern 1",
    "anti-pattern 2",
    "anti-pattern 3",
  ],
};

