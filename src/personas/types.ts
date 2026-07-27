export interface Persona {
  name: string;
  /** Optional Anthropic-native model ID. Kept for completeness but no longer
   *  required — `openrouterModel` is what actually drives the call, and the
   *  Anthropic-direct fallback in `client.ts` is hard-pinned to Haiku. */
  model?: string;
  /** OpenRouter slug. When set, this drives the OpenRouter call — lets each
   *  persona speak through their "own" vendor's model (e.g. Musk → Grok,
   *  Altman → GPT). Ignored when falling back to Anthropic direct. */
  openrouterModel?: string;
  system: string;
  /** Optional metadata: triggers / anti-patterns this persona reacts to. Not
   *  sent to the model — used for documentation and future tooling. */
  redFlags?: string[];
}

