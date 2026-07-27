import test from "node:test";
import assert from "node:assert/strict";
import {
  adjacentPairs,
  buildCostLine,
  collectBoldSpans,
  DebateAbortError,
  ensureAllPersonasInSynthesis,
  extractFirstJsonObject,
  fmtMs,
  looksLikeReasoningLeak,
  openRouterSlugToAnthropic,
  parseAbstention,
  parseSelectionFromArgs,
  personaCoveredByBoldSpans,
  pickNextOrder,
  slugify,
} from "../src/debate.js";
import { isRetryable, parseRetryAfterMs } from "../src/client.js";
import type { Persona } from "../src/personas/types.js";
import { FOUNDER_PERSONAS, getAllPersonas } from "../src/personas/index.js";

// ---- parseAbstention ----

test("parseAbstention: plain tag with reason", () => {
  assert.equal(
    parseAbstention("[ABSTAIN] outside my lane"),
    "outside my lane"
  );
});

test("parseAbstention: markdown-wrapped tag", () => {
  assert.equal(parseAbstention("**[ABSTAIN]** - no angle"), "no angle");
  assert.equal(parseAbstention("`[ABSTAIN]`: no angle"), "no angle");
});

test("parseAbstention: normal answer returns null", () => {
  assert.equal(parseAbstention("This is my actual argument."), null);
});

test("parseAbstention: bare tag gets default reason", () => {
  assert.equal(parseAbstention("[ABSTAIN]"), "(no reason given)");
});

test("parseAbstention: only matches at start", () => {
  // Tag mentioned mid-sentence should NOT trigger abstention.
  assert.equal(
    parseAbstention("I would [ABSTAIN] except I have thoughts."),
    null
  );
});

// ---- fmtMs ----

test("fmtMs: under 60s prints seconds with 1 decimal", () => {
  assert.equal(fmtMs(5200), "5.2s");
  assert.equal(fmtMs(999), "1.0s");
});

test("fmtMs: over 60s prints minutes + padded seconds", () => {
  assert.equal(fmtMs(63000), "1m 03s");
  assert.equal(fmtMs(724000), "12m 04s");
});

test("fmtMs: zero / invalid returns dash", () => {
  assert.equal(fmtMs(0), "–");
  assert.equal(fmtMs(-10), "–");
  assert.equal(fmtMs(Number.NaN), "–");
});

// ---- openRouterSlugToAnthropic ----

test("openRouterSlugToAnthropic: anthropic slug unmapped", () => {
  assert.equal(
    openRouterSlugToAnthropic("anthropic/claude-sonnet-4.6"),
    "claude-sonnet-4-6"
  );
  assert.equal(
    openRouterSlugToAnthropic("anthropic/claude-haiku-4.5"),
    "claude-haiku-4-5"
  );
});

test("openRouterSlugToAnthropic: non-anthropic slug falls back to Haiku", () => {
  assert.equal(openRouterSlugToAnthropic("x-ai/grok-4"), "claude-haiku-4-5");
  assert.equal(openRouterSlugToAnthropic("openai/gpt-5"), "claude-haiku-4-5");
});

// ---- slugify ----

test("slugify: spaces + punctuation collapse to hyphens", () => {
  assert.equal(
    slugify("Should AI decide? Maybe!"),
    "should-ai-decide-maybe"
  );
});

test("slugify: empty / garbage returns fallback", () => {
  assert.equal(slugify(""), "debate");
  assert.equal(slugify("!!!"), "debate");
});

test("slugify: truncates at 50 chars", () => {
  const long = "a".repeat(80);
  const out = slugify(long);
  assert.equal(out.length, 50);
});

// ---- extractFirstJsonObject ----

test("extractFirstJsonObject: plain JSON", () => {
  assert.equal(
    extractFirstJsonObject('{"a": 1}'),
    '{"a": 1}'
  );
});

test("extractFirstJsonObject: surrounded by prose", () => {
  assert.equal(
    extractFirstJsonObject('blah blah {"x": [1, 2]} trailing'),
    '{"x": [1, 2]}'
  );
});

test("extractFirstJsonObject: handles nested braces", () => {
  assert.equal(
    extractFirstJsonObject('{"outer": {"inner": 1}} then {"junk": 2}'),
    '{"outer": {"inner": 1}}'
  );
});

test("extractFirstJsonObject: ignores braces inside strings", () => {
  assert.equal(
    extractFirstJsonObject('{"text": "has } in it"}'),
    '{"text": "has } in it"}'
  );
});

test("extractFirstJsonObject: null on no object", () => {
  assert.equal(extractFirstJsonObject("no json here"), null);
});

// ---- adjacentPairs + pickNextOrder ----

function fakePersona(name: string): Persona {
  return { name, system: "", model: "claude-haiku-4-5" };
}

test("adjacentPairs: returns unordered pair keys", () => {
  const a = fakePersona("A");
  const b = fakePersona("B");
  const c = fakePersona("C");
  const s = adjacentPairs([a, b, c]);
  assert.equal(s.size, 2);
  assert.ok(s.has("A|B"));
  assert.ok(s.has("B|C"));
});

test("pickNextOrder: 2-element panel is returned as-is", () => {
  const a = fakePersona("A");
  const b = fakePersona("B");
  const next = pickNextOrder([a, b], [a, b]);
  assert.deepEqual(next.map((p) => p.name), ["A", "B"]);
});

test("pickNextOrder: avoids reusing adjacent pairs when possible", () => {
  // 5 personas have 5!=120 permutations; the search is bounded to 200
  // attempts, so for a 5-panel we should reliably find an order with zero
  // carry-over adjacencies.
  const ps = ["A", "B", "C", "D", "E"].map(fakePersona);
  const prev = [ps[0], ps[1], ps[2], ps[3], ps[4]];
  const next = pickNextOrder(ps, prev);
  const prevAdj = adjacentPairs(prev);
  const nextAdj = adjacentPairs(next);
  let overlap = 0;
  for (const p of nextAdj) if (prevAdj.has(p)) overlap++;
  assert.equal(overlap, 0, `expected no carry-over; got ${overlap}`);
});

test("pickNextOrder: never returns identical order", () => {
  const ps = ["A", "B", "C", "D"].map(fakePersona);
  const prev = [...ps];
  const next = pickNextOrder(ps, prev);
  const identical = next.every((p, i) => p === prev[i]);
  assert.equal(identical, false);
});

// ---- parseSelectionFromArgs ----

test("parseSelectionFromArgs: no flag defaults to auto", () => {
  assert.equal(parseSelectionFromArgs(["just", "a", "question"]), "auto");
});

test("parseSelectionFromArgs: --personas all", () => {
  assert.equal(parseSelectionFromArgs(["--personas", "all"]), "all");
  assert.equal(parseSelectionFromArgs(["--personas=all"]), "all");
});

test("parseSelectionFromArgs: --personas auto", () => {
  assert.equal(parseSelectionFromArgs(["--personas", "auto"]), "auto");
});

test("parseSelectionFromArgs: comma-separated persona keys", () => {
  const keys = Object.keys(FOUNDER_PERSONAS).slice(0, 2);
  if (keys.length < 2) return;
  const result = parseSelectionFromArgs(["--personas", keys.join(",")]);
  assert.ok(Array.isArray(result));
  assert.equal((result as Persona[]).length, 2);
});

test("parseSelectionFromArgs: advances past consumed value", () => {
  // With the i++ fix, the value should not be reinterpreted as a flag. If
  // the second --personas were revisited as an arg and parsed as a key
  // list, "all" would stay "all"; we still want that, so use a persona
  // key to prove the loop didn't re-enter on the value.
  const firstKey = Object.keys(FOUNDER_PERSONAS)[0];
  if (!firstKey) return;
  const result = parseSelectionFromArgs([
    "--personas",
    firstKey,
    "--other-flag",
  ]);
  assert.ok(Array.isArray(result));
  assert.equal((result as Persona[]).length, 1);
});

test("parseSelectionFromArgs: all-unknown keys falls back to auto", () => {
  const result = parseSelectionFromArgs(["--personas", "nobody,nowhere"]);
  assert.equal(result, "auto");
});

// ---- buildCostLine ----

test("buildCostLine: with both balances shows delta", () => {
  const before = { totalUsage: 10 };
  const after = { totalUsage: 12.5, remaining: 7.5 };
  const line = buildCostLine(before, after, 0);
  assert.match(line, /\$2\.5000/);
  assert.match(line, /remaining: \$7\.50/);
});

test("buildCostLine: unknown balance", () => {
  const line = buildCostLine(null, null, 0);
  assert.match(line, /Cost: unknown/);
});

test("buildCostLine: appends fallback estimate when > 0", () => {
  const before = { totalUsage: 0 };
  const after = { totalUsage: 1, remaining: 9 };
  const line = buildCostLine(before, after, 3);
  assert.match(line, /3 Anthropic fallbacks/);
  assert.match(line, /\$0\.006/);
});

test("buildCostLine: singular fallback phrasing", () => {
  const line = buildCostLine(null, null, 1);
  assert.match(line, /1 Anthropic fallback \(/);
});

// ---- ensureAllPersonasInSynthesis ----

test("ensureAllPersonasInSynthesis: all present → unchanged", () => {
  const a = fakePersona("Alpha — the builder");
  const b = fakePersona("Beta — the breaker");
  const synthesis =
    "## Part 1 — Persona Verdicts\n\n**Alpha — the builder**\n\nthree sentences. more. final.\n\n**Beta — the breaker**\n\nthree sentences. more. final.\n";
  const out = ensureAllPersonasInSynthesis(synthesis, [a, b], [], []);
  assert.equal(out.synthesis, synthesis);
  assert.deepEqual(out.autoFilled, []);
});

test("ensureAllPersonasInSynthesis: missing persona gets auto-filled", () => {
  const a = fakePersona("Alpha — the builder");
  const b = fakePersona("Beta — the breaker");
  const synthesis =
    "## Part 1 — Persona Verdicts\n\n**Alpha — the builder**\n\none two three.\n";
  const rounds = [
    {
      round: 1,
      responses: [
        { persona: "Beta — the breaker", answer: "I disagree strongly. Beta's take." },
      ],
    },
  ];
  const consensus = [
    { persona: "Beta — the breaker", answer: "**Positives**\n- fine\n**Negatives**\n- meh" },
  ];
  const out = ensureAllPersonasInSynthesis(synthesis, [a, b], rounds, consensus);
  assert.deepEqual(out.autoFilled, ["Beta — the breaker"]);
  assert.match(out.synthesis, /Auto-filled verdicts/);
  assert.match(out.synthesis, /\*\*Beta — the breaker\*\*/);
  assert.match(out.synthesis, /Beta's take/);
});

test("ensureAllPersonasInSynthesis: handles empty rounds for missing persona", () => {
  const a = fakePersona("Alpha");
  const synthesis = "## Part 1\n\n(no verdicts at all)\n";
  const out = ensureAllPersonasInSynthesis(synthesis, [a], [], []);
  assert.deepEqual(out.autoFilled, ["Alpha"]);
  assert.match(out.synthesis, /No substantive round contribution/);
});

// ---- collectBoldSpans / personaCoveredByBoldSpans (tolerant match) ----

test("collectBoldSpans: extracts line-leading spans", () => {
  const md = "**One**\n\nbody text\n\n**Two — tagline**\n\nmore body";
  assert.deepEqual(collectBoldSpans(md), ["one", "two — tagline"]);
});

test("collectBoldSpans: only matches line-leading bolds", () => {
  // Inline emphasis mid-paragraph must NOT count as a persona label — the
  // synthesizer prompt puts each persona name on its own line, so anything
  // mid-paragraph is just emphasis and should be ignored.
  const md = "**Leading**\n\nsome prose with **inline** emphasis\n**Also Leading**";
  assert.deepEqual(collectBoldSpans(md), ["leading", "also leading"]);
});

test("personaCoveredByBoldSpans: exact full-name match", () => {
  const p = fakePersona("Alpha — the builder");
  const spans = ["alpha — the builder"];
  assert.equal(personaCoveredByBoldSpans(p, spans), true);
});

test("personaCoveredByBoldSpans: short-name whole-word match tolerates drift", () => {
  const p = fakePersona("Alpha — the builder");
  // Synthesizer dropped the em-dash — coverage check should still pass.
  const spans = ["alpha the builder"];
  assert.equal(personaCoveredByBoldSpans(p, spans), true);
  // Trailing punctuation, same story.
  assert.equal(personaCoveredByBoldSpans(p, ["alpha."]), true);
});

test("personaCoveredByBoldSpans: rejects substring false-positives", () => {
  const p = fakePersona("Ada — lovelace");
  // "Adaptive" contains "ada" but not as a whole word.
  assert.equal(personaCoveredByBoldSpans(p, ["adaptive planning"]), false);
});

test("personaCoveredByBoldSpans: returns false when no span covers", () => {
  const p = fakePersona("Alpha — the builder");
  const spans = ["positives", "negatives"];
  assert.equal(personaCoveredByBoldSpans(p, spans), false);
});

test("ensureAllPersonasInSynthesis: drift-tolerant — no false auto-fill", () => {
  const a = fakePersona("Alpha — the builder");
  const b = fakePersona("Beta — the breaker");
  // Synthesizer dropped the em-dash on Beta but still emitted a verdict.
  const synthesis =
    "## Part 1 — Persona Verdicts\n\n**Alpha — the builder**\n\nthree. two. one.\n\n**Beta the breaker**\n\nthree. two. one.\n";
  const out = ensureAllPersonasInSynthesis(synthesis, [a, b], [], []);
  assert.deepEqual(out.autoFilled, []);
});

// ---- looksLikeReasoningLeak ----

test("looksLikeReasoningLeak: clean persona output → false", () => {
  const clean =
    "**Positives**\n- A clear endorsement.\n\n**Negatives**\n- A clear reservation.";
  assert.equal(looksLikeReasoningLeak(clean), false);
});

test("looksLikeReasoningLeak: meta-header `**Evaluating` → true", () => {
  const leaked =
    "**Evaluating user instructions**\n\nI'm tasked with ensuring I present my thoughts accurately...\n\n**Positives**\n- something";
  assert.equal(looksLikeReasoningLeak(leaked), true);
});

test("looksLikeReasoningLeak: meta-header `**Crafting` → true", () => {
  assert.equal(
    looksLikeReasoningLeak("**Crafting concise bullets**\n\n- foo"),
    true
  );
});

test("looksLikeReasoningLeak: meta-header `**Finalizing` → true", () => {
  assert.equal(
    looksLikeReasoningLeak("**Finalizing bullet points**\n\n- foo"),
    true
  );
});

test("looksLikeReasoningLeak: duplicate **Positives** → true", () => {
  const duped =
    "**Positives**\n- first draft\n\n**Positives**\n- second draft\n\n**Negatives**\n- only one";
  assert.equal(looksLikeReasoningLeak(duped), true);
});

test("looksLikeReasoningLeak: duplicate **Negatives** → true", () => {
  const duped =
    "**Positives**\n- one\n\n**Negatives**\n- a\n\n**Negatives**\n- b";
  assert.equal(looksLikeReasoningLeak(duped), true);
});

test("looksLikeReasoningLeak: persona saying 'Let me be clear' → false", () => {
  // Legit in-voice reasoning must NOT trigger — only meta-headers / drafts.
  const legit = "Let me be clear: the real issue is bureaucracy.";
  assert.equal(looksLikeReasoningLeak(legit), false);
});

test("looksLikeReasoningLeak: inline bold emphasis → false", () => {
  // Inline `**word**` emphasis is common in persona answers and must not
  // be flagged — the detector only cares about meta-headers.
  const inline =
    "We must **delete** first, then **observe**, then **automate**.";
  assert.equal(looksLikeReasoningLeak(inline), false);
});

// ---- DebateAbortError ----

test("DebateAbortError: name + stage", () => {
  const err = new DebateAbortError("round 3");
  assert.equal(err.name, "DebateAbortError");
  assert.match(err.message, /round 3/);
});

// ---- parseRetryAfterMs ----

test("parseRetryAfterMs: integer seconds", () => {
  assert.equal(parseRetryAfterMs("5"), 5000);
  assert.equal(parseRetryAfterMs("0"), 0);
});

test("parseRetryAfterMs: HTTP date in the future", () => {
  const future = new Date(Date.now() + 2000).toUTCString();
  const ms = parseRetryAfterMs(future);
  assert.ok(ms !== null && ms > 0 && ms <= 3000, `got ${ms}`);
});

test("parseRetryAfterMs: HTTP date in the past → 0", () => {
  const past = new Date(Date.now() - 60_000).toUTCString();
  assert.equal(parseRetryAfterMs(past), 0);
});

test("parseRetryAfterMs: null / empty / garbage", () => {
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs(undefined), null);
  assert.equal(parseRetryAfterMs(""), null);
  assert.equal(parseRetryAfterMs("not a date"), null);
});

test("parseRetryAfterMs: negative rejected", () => {
  assert.equal(parseRetryAfterMs("-5"), null);
});

// ---- isRetryable ----

test("isRetryable: 429 retry", () => {
  assert.equal(isRetryable({ status: 429 }), true);
});

test("isRetryable: 5xx retry", () => {
  assert.equal(isRetryable({ status: 502 }), true);
  assert.equal(isRetryable({ statusCode: 503 }), true);
});

test("isRetryable: 4xx non-retry (except the allowlist)", () => {
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable({ status: 401 }), false);
  assert.equal(isRetryable({ status: 404 }), false);
});

test("isRetryable: network errors retry", () => {
  assert.equal(isRetryable(new Error("ECONNRESET something")), true);
  assert.equal(isRetryable(new Error("fetch failed")), true);
});

// ---- sanity: persona registry loaded ----

test("persona registry: non-empty", () => {
  const all = getAllPersonas();
  assert.ok(all.length > 0, "expected at least one persona");
});

