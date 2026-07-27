import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface CallArgs {
  /** Anthropic-native model ID; used for Anthropic direct calls and as the
   *  auto-namespaced default on OpenRouter. */
  model: string;
  /** Optional OpenRouter slug override (e.g. "x-ai/grok-4"). Ignored when
   *  falling back to Anthropic direct. */
  openrouterModel?: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Fired once if this call falls back from OpenRouter to Anthropic direct.
   *  Lets the caller tally fallbacks per-debate instead of relying on a
   *  module-global counter (which races across concurrent MCP runs). */
  onFallback?: () => void;
}

/** First-tier fallback: when a persona's intended OpenRouter model fails, we
 *  retry on this shared OpenRouter slug before crossing providers. Most
 *  failures are model-specific (dead slug, model overload, empty content) with
 *  OpenRouter itself still up, so a strong general model here keeps the persona
 *  on OpenRouter. */
const OPENROUTER_FALLBACK_MODEL = "deepseek/deepseek-v4-pro";

/** Last-resort fallback: used only when both the intended model AND the
 *  OpenRouter Deepseek fallback fail (e.g. a total OpenRouter outage). Goes
 *  through the Anthropic SDK — a different provider — so the run survives even
 *  when OpenRouter is entirely unreachable. Haiku keeps it cheap and fast. */
const ANTHROPIC_FALLBACK_MODEL = "claude-haiku-4-5";

/** Retry config for OpenRouter calls. Each attempt costs real latency, so we
 *  cap at 3 tries total with exponential backoff. 429/5xx/timeouts get
 *  retried; 4xx other than 429 fail fast (no point retrying a bad request). */
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 500;

/** @deprecated Use `onFallback` callback on `callModel` args instead. This
 *  module-global counter races across concurrent runs (e.g. two MCP debates
 *  in flight simultaneously) — kept only for back-compat with callers that
 *  haven't migrated to the callback. */
let anthropicFallbackCount = 0;

export function getAndResetFallbackCount(): number {
  const n = anthropicFallbackCount;
  anthropicFallbackCount = 0;
  return n;
}

export interface OpenRouterBalance {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
}

/** Query OpenRouter's credits endpoint. Returns null if OpenRouter is not
 *  configured or the request fails — the caller should treat this as "cost
 *  unknown" rather than erroring the whole run. */
export async function getOpenRouterBalance(): Promise<OpenRouterBalance | null> {
  if (!openrouterKey) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${openrouterKey}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data: { total_credits: number; total_usage: number };
    };
    const totalCredits = json.data.total_credits;
    const totalUsage = json.data.total_usage;
    return {
      totalCredits,
      totalUsage,
      remaining: totalCredits - totalUsage,
    };
  } catch {
    return null;
  }
}

const openrouterKey = process.env.OPENROUTER_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!openrouterKey && !anthropicKey) {
  throw new Error(
    "No API key found. Set OPENROUTER_API_KEY (primary) and/or ANTHROPIC_API_KEY (fallback) in .env"
  );
}

const openrouter = openrouterKey
  ? new OpenAI({
      apiKey: openrouterKey,
      baseURL: "https://openrouter.ai/api/v1",
    })
  : null;

const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

// Convert Anthropic-native model IDs (e.g. "claude-sonnet-4-6") to OpenRouter's
// namespaced form (e.g. "anthropic/claude-sonnet-4.6"). Pass-through if the slug
// is already namespaced (contains "/").
function toOpenRouterModel(id: string): string {
  if (id.includes("/")) return id;
  return "anthropic/" + id.replace(/-(\d+)-(\d+)$/, "-$1.$2");
}

/** Decide whether an error from OpenRouter is worth retrying. Retry: network
 *  errors, 408, 409, 425, 429, 5xx. Don't retry: 4xx (except the ones above)
 *  — a bad request won't become a good one on the next try. Exported for
 *  unit testing. */
export function isRetryable(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (/econnreset|etimedout|econnrefused|socket hang up|network|fetch failed/.test(msg)) {
      return true;
    }
  }
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 409 || status === 425 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }
  return false;
}

/** Parse a `Retry-After` header value into a sleep duration in milliseconds.
 *  The RFC allows either a non-negative integer number of seconds or an
 *  HTTP-date. Returns `null` for missing / malformed / negative values.
 *  Dates in the past return 0 (retry immediately). Exported for tests. */
export function parseRetryAfterMs(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // Reject sign-prefixed values outright — `Date.parse("-5")` happens to
  // succeed in some runtimes (interpreted as year -5) which would give a
  // spurious 0ms delay for a clearly-malformed header.
  if (/^[+-]/.test(str)) return null;
  // Integer (or decimal) seconds?
  if (/^\d+(\.\d+)?$/.test(str)) {
    const secs = Number.parseFloat(str);
    if (!Number.isFinite(secs) || secs < 0) return null;
    return Math.round(secs * 1000);
  }
  // HTTP-date? Require at least one alphabetic character (day-name or
  // month-name) so bare numeric-looking strings aren't accidentally parsed.
  if (!/[a-z]/i.test(str)) return null;
  const ts = Date.parse(str);
  if (Number.isFinite(ts)) {
    return Math.max(0, ts - Date.now());
  }
  return null;
}

/** Pull the `Retry-After` header off an SDK error object. Both the OpenAI
 *  SDK (`APIError`) and the Anthropic SDK expose headers as a lower-cased
 *  plain object on `err.headers`. Returns null if not present. */
function retryAfterMsFromError(err: unknown): number | null {
  const headers = (err as { headers?: Record<string, string | string[] | undefined> })?.headers;
  if (!headers) return null;
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return parseRetryAfterMs(first);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Cap honored `Retry-After` at 60s so a pathological header from a
 *  misbehaving proxy can't stall the whole run. */
const MAX_RETRY_AFTER_MS = 60_000;

async function callOpenRouterOnce(args: CallArgs): Promise<string> {
  const slug = args.openrouterModel ?? toOpenRouterModel(args.model);
  const res = await openrouter!.chat.completions.create({
    model: slug,
    max_tokens: args.maxTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  const choice = res.choices[0];
  const finish = choice?.finish_reason ?? "unknown";
  const message = choice?.message as
    | {
        content?: string | null;
        reasoning?: string | null;
        reasoning_content?: string | null;
      }
    | undefined;
  const primary = typeof message?.content === "string" ? message.content.trim() : "";

  // Warn when the response was cut off at max_tokens — persona reply may be
  // mid-argument. Visible in stderr so the operator can bump maxTokens if it
  // keeps happening.
  if (finish === "length") {
    console.error(
      `⚠️  OpenRouter "${slug}" stopped at max_tokens (${args.maxTokens}); response may be truncated.`
    );
  }

  if (primary) return primary;
  // Some reasoning models (e.g. GLM, DeepSeek) route the final answer into a
  // `reasoning` / `reasoning_content` field when `content` comes back empty.
  // Accept that as the response and log a warning so routing stays visible.
  const reasoning =
    (typeof message?.reasoning === "string" ? message.reasoning.trim() : "") ||
    (typeof message?.reasoning_content === "string"
      ? message.reasoning_content.trim()
      : "");
  if (reasoning) {
    console.error(
      `⚠️  OpenRouter "${slug}" returned empty content; using reasoning field (${reasoning.length} chars).`
    );
    return reasoning;
  }
  // Nothing usable — throw so the outer callModel falls back to Anthropic
  // rather than silently producing an empty persona response.
  throw new Error(
    `OpenRouter "${slug}" returned empty content (finish_reason=${finish})`
  );
}

/** Call OpenRouter with up to MAX_ATTEMPTS and exponential backoff on
 *  retryable errors (429, 5xx, network). Honors a `Retry-After` header when
 *  present (polite + avoids bans) instead of exponential backoff for that
 *  attempt. Non-retryable errors bubble up on the first failure so
 *  callModel can fall back to Anthropic immediately. */
async function callOpenRouter(args: CallArgs): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callOpenRouterOnce(args);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isRetryable(err)) throw err;
      const slug = args.openrouterModel ?? toOpenRouterModel(args.model);
      const retryAfter = retryAfterMsFromError(err);
      let wait: number;
      let source: string;
      if (retryAfter !== null) {
        wait = Math.min(retryAfter, MAX_RETRY_AFTER_MS);
        source = `Retry-After header (${retryAfter}ms → capped at ${wait}ms)`;
      } else {
        const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        wait = backoff + jitter;
        source = `exp backoff`;
      }
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `⚠️  OpenRouter "${slug}" attempt ${attempt}/${MAX_ATTEMPTS} failed (${reason}); retrying in ${wait}ms [${source}]…`
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function callAnthropicOnce(
  args: CallArgs,
  modelOverride?: string
): Promise<string> {
  const res = await anthropic!.messages.create({
    model: modelOverride ?? args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  if (res.stop_reason === "max_tokens") {
    console.error(
      `⚠️  Anthropic "${modelOverride ?? args.model}" stopped at max_tokens (${args.maxTokens}); response may be truncated.`
    );
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function callAnthropic(
  args: CallArgs,
  modelOverride?: string
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callAnthropicOnce(args, modelOverride);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isRetryable(err)) throw err;
      const model = modelOverride ?? args.model;
      const retryAfter = retryAfterMsFromError(err);
      let wait: number;
      let source: string;
      if (retryAfter !== null) {
        wait = Math.min(retryAfter, MAX_RETRY_AFTER_MS);
        source = `Retry-After header (${retryAfter}ms → capped at ${wait}ms)`;
      } else {
        const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        wait = backoff + jitter;
        source = `exp backoff`;
      }
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `⚠️  Anthropic "${model}" attempt ${attempt}/${MAX_ATTEMPTS} failed (${reason}); retrying in ${wait}ms [${source}]…`
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

export async function callModel(args: CallArgs): Promise<string> {
  if (openrouter) {
    try {
      return await callOpenRouter(args);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const attemptedSlug = args.openrouterModel ?? toOpenRouterModel(args.model);
      // The persona's intended model failed — it's no longer speaking through
      // its own model, so this counts as a fallback regardless of which tier
      // ultimately answers. Fire the per-run callback once, here.
      args.onFallback?.();

      // Tier 1: retry on OpenRouter with the Deepseek fallback, unless the
      // intended model already WAS that slug (no point re-calling the same one).
      // stderr so MCP stdout (JSON-RPC) stays clean.
      if (attemptedSlug !== OPENROUTER_FALLBACK_MODEL) {
        try {
          console.error(
            `⚠️  OpenRouter failed for "${attemptedSlug}" after retries — falling back to OpenRouter ${OPENROUTER_FALLBACK_MODEL}. Reason: ${reason}`
          );
          return await callOpenRouter({
            ...args,
            openrouterModel: OPENROUTER_FALLBACK_MODEL,
          });
        } catch (err2) {
          if (!anthropic) throw err2;
          const reason2 = err2 instanceof Error ? err2.message : String(err2);
          console.error(
            `⚠️  OpenRouter fallback "${OPENROUTER_FALLBACK_MODEL}" also failed — falling back to Anthropic ${ANTHROPIC_FALLBACK_MODEL}. Reason: ${reason2}`
          );
          anthropicFallbackCount++;
          return callAnthropic(args, ANTHROPIC_FALLBACK_MODEL);
        }
      }

      // Intended model already was the Deepseek fallback (or Tier 1 skipped):
      // go straight to Anthropic as the last resort.
      if (!anthropic) throw err;
      console.error(
        `⚠️  OpenRouter failed for "${attemptedSlug}" after retries — falling back to Anthropic ${ANTHROPIC_FALLBACK_MODEL}. Reason: ${reason}`
      );
      anthropicFallbackCount++;
      return callAnthropic(args, ANTHROPIC_FALLBACK_MODEL);
    }
  }
  return callAnthropic(args);
}

