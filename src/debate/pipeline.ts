/**
 * Pipeline — the multi-stage debate orchestrator. This file contains every
 * function that actually makes an LLM call (starter, selector, round-1
 * parallel, rounds 2..N sequential, standpoints distillation, consensus,
 * synthesis) plus the top-level `runDebate` that wires them together.
 *
 * All LLM-calling helpers accept a `CallContext` so the per-run fallback
 * counter and abort signal thread cleanly through each stage.
 */

import { callModel } from "../client.js";
import {
  FOUNDER_PERSONAS,
  getAllPersonas,
  type Persona,
} from "../personas/index.js";
import { clearCheckpoint, writeCheckpoint } from "./checkpoint.js";
import {
  ABSTAIN_TAG,
  DEBATE_AUTO_PANEL_SIZE,
  DEBATE_ROUNDS,
  SELECTOR_ANTHROPIC_MODEL,
  SELECTOR_OPENROUTER_MODEL,
  STANDPOINTS_ANTHROPIC_MODEL,
  STANDPOINTS_OPENROUTER_MODEL,
  STARTER_ANTHROPIC_MODEL,
  STARTER_OPENROUTER_MODEL,
  SYNTHESIZER_ANTHROPIC_MODEL,
  SYNTHESIZER_MAX_TOKENS,
  STAGE_MAX_TOKENS,
  SYNTHESIZER_OPENROUTER_MODEL,
} from "./config.js";
import type {
  AutoSelection,
  CallContext,
  DebateEvents,
  DebateResult,
  DebateTiming,
  PanelResponse,
  PersonaSelection,
  ProgressFn,
  RoundResponse,
} from "./types.js";
import {
  ensureAllPersonasInSynthesis,
  extractFirstJsonObject,
  looksLikeReasoningLeak,
  mapLimit,
  parallelConcurrency,
  parseAbstention,
  pickNextOrder,
  throwIfAborted,
} from "./util.js";

async function getStarter(question: string, ctx: CallContext): Promise<string> {
  return callModel({
    model: STARTER_ANTHROPIC_MODEL,
    openrouterModel: STARTER_OPENROUTER_MODEL,
    onFallback: ctx.onFallback,
    system: `You are an impartial, well-informed analyst. Weigh the user's question through **nine structured lenses**, then frame the debate that follows. Do not advocate for a specific position — your job is to map the terrain, not to decide.

Use Markdown. For each of the nine dimensions below, emit a bold header on its own line followed by **2–3 focused sentences** capturing the core stakes, constraints, and open questions the question raises within that lens. If a dimension is genuinely low-signal for the question at hand, say so briefly rather than padding.

**Military** — force, deterrence, security posture, escalation dynamics, armed conflict considerations.
**Diplomatic** — alliances, negotiation, international relations, soft power, signalling.
**Economic** — trade, markets, costs, resource allocation, financial incentives, distributive impact.
**Ecological** — environmental impact, climate, biodiversity, long-term planetary constraints.
**Humanitarian** — human welfare, dignity, rights, vulnerable populations, ethical weight.
**Informational** — media, narratives, perception, propaganda, public understanding.
**Technological** — tools, infrastructure, capability, technical feasibility, innovation paths.
**Scientific** — evidence, empirical grounding, research base, testable hypotheses, known unknowns.
**Governance & Institutional** — law, regulation, accountability, institutional design, rule enforcement.

After the nine sections, close with a short paragraph titled **Debate-Opening Tensions** that names the two or three sharpest tradeoffs the panel must contend with. Keep the whole starter readable in under two minutes — density over exhaustiveness.`,
    user: question,
    maxTokens: STAGE_MAX_TOKENS,
  });
}

function buildPersonaCatalog(): string {
  return Object.entries(FOUNDER_PERSONAS)
    .map(([key, p]) => {
      const tagline = p.name.split(" — ").slice(1).join(" — ") || p.name;
      // `redFlags` are per-persona anti-patterns / topics the persona reacts
      // strongly to. Feeding the first two into the selector catalog sharpens
      // contrast-picking without meaningfully bloating token cost.
      const flags = p.redFlags?.slice(0, 2).join("; ");
      return flags
        ? `- ${key}: ${tagline} (flags: ${flags})`
        : `- ${key}: ${tagline}`;
    })
    .join("\n");
}

/** Ask a lightweight model to pick `DEBATE_AUTO_PANEL_SIZE` personas most
 *  relevant to the question. Returns the chosen Persona[] plus a short
 *  rationale string. Falls back to the first N personas (registry order) if
 *  the response can't be parsed. */
async function autoSelectPersonas(
  question: string,
  log: ProgressFn,
  ctx: CallContext
): Promise<AutoSelection> {
  log(
    `Auto-selecting ${DEBATE_AUTO_PANEL_SIZE} personas (${SELECTOR_OPENROUTER_MODEL})…`
  );
  const catalog = buildPersonaCatalog();
  const raw = await callModel({
    model: SELECTOR_ANTHROPIC_MODEL,
    openrouterModel: SELECTOR_OPENROUTER_MODEL,
    onFallback: ctx.onFallback,
    system:
      "You assemble debate panels for MAXIMUM CONTRAST. Your goal is the sharpest possible disagreement on the specific question: pick voices whose worldviews collide head-on, not voices who merely bring different flavors of the same position. A panel of six allies is a failure, even if each one is brilliant. Always respond with exactly one JSON object and nothing else.",
    user: `QUESTION: ${question}

AVAILABLE PERSONAS (key: tagline):
${catalog}

Select EXACTLY ${DEBATE_AUTO_PANEL_SIZE} persona keys whose perspectives will clash most sharply on THIS specific question. Selection rules, in priority order:
1. Maximum contrast: pick opposites — hawk vs. dove, capitalist vs. socialist, believer vs. skeptic, idealist vs. pragmatist — whichever axes actually matter for this question.
2. Cover at least 3 distinct schools of thought / moral frames relevant to the question. If two candidates would make essentially the same argument, keep only the stronger one.
3. Relevance second: a contrarian who has nothing to say about the topic is worse than a slightly less-contrarian expert who does.
4. Avoid redundancy: never pick two personas who would agree on both the diagnosis and the prescription.

Respond with exactly this JSON shape and NOTHING else — no prose, no code fences:
{"personas": ["key1", "key2", ...], "rationale": "one-sentence explanation naming the main axes of disagreement this panel covers"}`,
    maxTokens: STAGE_MAX_TOKENS,
  });

  try {
    const jsonStr = extractFirstJsonObject(raw);
    if (!jsonStr) throw new Error("no JSON object in selector output");
    const parsed = JSON.parse(jsonStr) as {
      personas: string[];
      rationale?: string;
    };
    const personas = parsed.personas
      .map((k) => FOUNDER_PERSONAS[k.toLowerCase()])
      .filter((p): p is Persona => !!p)
      .slice(0, DEBATE_AUTO_PANEL_SIZE);
    if (personas.length < 2) throw new Error("selector returned < 2 valid keys");
    return {
      personas,
      rationale: parsed.rationale ?? "(selector returned no rationale)",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Dump the first 500 chars of the selector's raw output to stderr so
    // auto-select regressions (model changed its JSON format, wrapped in a
    // code fence, added preamble, etc.) are debuggable without rerunning.
    const snippet = raw.slice(0, 500).replace(/\s+/g, " ");
    console.error(
      `⚠️  Auto-select parse failed (${reason}). Raw selector output (first 500 chars): ${snippet}${raw.length > 500 ? " …[truncated]" : ""}`
    );
    const fallback = getAllPersonas().slice(0, Math.min(3, DEBATE_AUTO_PANEL_SIZE));
    log(
      `  · auto-select failed (${reason}); falling back to first ${fallback.length} personas (registry order)`
    );
    return {
      personas: fallback,
      rationale: `Auto-select failed (${reason}); using first ${fallback.length} personas as a safe default.`,
    };
  }
}

export async function resolveSelection(
  question: string,
  selection: PersonaSelection,
  log: ProgressFn = () => {}
): Promise<{
  participants: Persona[];
  mode: DebateResult["selectionMode"];
  rationale?: string;
}> {
  if (selection === "all") {
    return { participants: getAllPersonas(), mode: "all" };
  }
  if (selection === "auto") {
    // A one-off context for the selector call — its fallbacks aren't part of
    // a live `runDebate` yet so they're silently absorbed.
    const auto = await autoSelectPersonas(question, log, { onFallback: () => {} });
    return { participants: auto.personas, mode: "auto", rationale: auto.rationale };
  }
  if (selection.length === 0) {
    log("  · empty manual selection; falling back to all personas");
    return { participants: getAllPersonas(), mode: "all" };
  }
  return { participants: selection, mode: "manual" };
}

function formatHistory(
  question: string,
  starter: string,
  standpoints: string | null,
  priorRounds: RoundResponse[],
  currentRoundSoFar: PanelResponse[]
): string {
  const sections: string[] = [
    `ORIGINAL QUESTION: ${question}`,
    "",
    "=== STARTER ANALYSIS (neutral framing) ===",
    starter,
  ];
  if (standpoints) {
    sections.push(
      "",
      "=== MAJOR STANDPOINTS (distilled from round 1's independent responses) ===",
      standpoints
    );
  }
  const renderResponse = (r: PanelResponse): string => {
    if (r.failed) return `${r.persona} CALL FAILED: ${r.answer}`;
    if (r.abstained) {
      return `${r.persona} ABSTAINED: ${r.abstainReason ?? "(no reason given)"}`;
    }
    return `${r.persona} said:\n${r.answer}`;
  };
  for (const round of priorRounds) {
    sections.push("", `=== ROUND ${round.round} ===`);
    for (const r of round.responses) {
      sections.push("", renderResponse(r));
    }
  }
  if (currentRoundSoFar.length > 0) {
    sections.push("", "=== CURRENT ROUND (so far) ===");
    for (const r of currentRoundSoFar) {
      sections.push("", renderResponse(r));
    }
  }
  return sections.join("\n");
}

/** Build the user-prompt body for a persona in a given round. Extracted so
 *  parallel (R1) and sequential (R2+) callers share the exact same wording
 *  below the history block. */
function buildRoundUserPrompt(
  history: string,
  roundInstruction: string,
  personaName: string
): string {
  return `${history}

---

${roundInstruction}

**Opt-out rule:** If this question is genuinely outside your domain of expertise and you have nothing useful to add, respond with a single line starting with \`${ABSTAIN_TAG}\` followed by a one-sentence reason (e.g. \`${ABSTAIN_TAG} This is a pure theological question with no systems-engineering angle I can meaningfully address.\`). Only abstain when you truly would add noise, not because the topic is merely unfamiliar.

You are ${personaName}. Respond now.`;
}

function toPanelResponse(
  persona: Persona,
  rawAnswer: string,
  durationMs: number
): PanelResponse {
  const abstainReason = parseAbstention(rawAnswer);
  const base =
    abstainReason !== null
      ? {
          persona: persona.name,
          answer: `*Abstained:* ${abstainReason}`,
          abstained: true as const,
          abstainReason,
        }
      : { persona: persona.name, answer: rawAnswer };
  return { ...base, durationMs };
}

/** Appended to a persona's user prompt when we're retrying a
 *  reasoning-leak — spelled out in uppercase so even reasoning-heavy
 *  models notice it. Kept as a constant so tests can check the retry
 *  path exercises the extra instruction. */
const LEAK_RETRY_SUFFIX = `

IMPORTANT — OUTPUT DISCIPLINE:
Your previous attempt included meta-commentary, planning notes, or multiple draft copies of the required sections. Do NOT do that.

Respond with ONLY the in-voice final answer. No planning prose, no bold headers like \`**Evaluating**\` / \`**Crafting**\` / \`**Finalizing**\`, no self-commentary, no duplicate sections, no preamble. Just the persona's answer in the requested format.`;

/** Wrap a persona LLM call so one failure (network, 500s exhausted, model
 *  error after fallback) doesn't kill the whole debate. Returns a synthetic
 *  `failed` response with the error message as the body, captures timing
 *  for the table, and logs to stderr so operators still see what broke.
 *  When `parseAbstain` is false, the response is taken verbatim (used by
 *  the mandatory consensus round).
 *
 *  Also retries ONCE (and only once) when the first answer looks like a
 *  reasoning-chain leak — some OpenRouter-routed reasoning models
 *  occasionally emit their internal planning chatter as `content`. The
 *  retry appends a strict output-discipline instruction. If the second
 *  attempt still looks leaky, the fresher (second) answer is kept anyway
 *  on the theory that it's at least as good as the first. */
async function safePersonaCall(
  persona: Persona,
  user: string,
  log: ProgressFn,
  ctx: CallContext,
  maxTokens: number,
  stage: string,
  parseAbstain: boolean = true
): Promise<PanelResponse> {
  const personaStart = Date.now();
  try {
    let answer = await callModel({
      model: persona.model ?? "claude-haiku-4-5",
      openrouterModel: persona.openrouterModel,
      onFallback: ctx.onFallback,
      system: persona.system,
      user,
      maxTokens,
    });
    if (looksLikeReasoningLeak(answer)) {
      const short = persona.name.split(" — ")[0];
      log(`    ↳ ⚠️  ${stage} ${short}: reasoning-chain leak detected; retrying once…`);
      console.error(
        `⚠️  ${stage} ${persona.name}: reasoning-chain leak detected (meta headers or duplicate sections); retrying once with a tightened prompt.`
      );
      const retryAnswer = await callModel({
        model: persona.model ?? "claude-haiku-4-5",
        openrouterModel: persona.openrouterModel,
        onFallback: ctx.onFallback,
        system: persona.system,
        user: user + LEAK_RETRY_SUFFIX,
        maxTokens,
      });
      // Use the retry answer regardless. If still leaky the leak log has
      // already fired once; spamming doesn't help, and the retry's output
      // is no worse than the first.
      answer = retryAnswer;
      if (looksLikeReasoningLeak(retryAnswer)) {
        log(`    ↳ ⚠️  ${stage} ${short}: second attempt still leaky; keeping it anyway.`);
      }
    }
    if (parseAbstain) {
      return toPanelResponse(persona, answer, Date.now() - personaStart);
    }
    return {
      persona: persona.name,
      answer,
      durationMs: Date.now() - personaStart,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const short = persona.name.split(" — ")[0];
    log(`    ↳ ⚠️  ${stage} call for ${short} failed: ${reason}`);
    console.error(`⚠️  ${stage} call for ${persona.name} failed: ${reason}`);
    return {
      persona: persona.name,
      answer: `*Call failed (${stage}): ${reason}*`,
      failed: true,
      durationMs: Date.now() - personaStart,
    };
  }
}

/** Round 1 — every persona responds in parallel, seeing only the starter.
 *  No persona sees any other persona's answer, so the responses are genuinely
 *  independent and the downstream standpoint-distillation reflects real
 *  convergence rather than in-round echo. Concurrency is capped at ~1/3 of
 *  the panel so a 19-persona full run doesn't fire 19 simultaneous requests
 *  at OpenRouter and trigger burst rate-limits. */
async function runRound1Parallel(
  participants: Persona[],
  question: string,
  starter: string,
  log: ProgressFn,
  ctx: CallContext,
  events?: DebateEvents
): Promise<RoundResponse> {
  const concurrency = parallelConcurrency(participants.length);
  log(
    `Round 1 (parallel, ${participants.length} personas — up to ${concurrency} in flight at once)…`
  );
  const history = formatHistory(question, starter, null, [], []);
  const instruction =
    "This is ROUND 1 of the debate. You are responding IN PARALLEL with the rest of the panel — you have NOT seen any other panelist's reply and they have not seen yours. Respond independently: react to the starter analysis, stake out your distinctive position, and name the assumption(s) you believe most need scrutiny. Keep it to 2–3 tight paragraphs.";
  const roundStart = Date.now();
  const responses = await mapLimit(participants, concurrency, async (persona) => {
    log(`  Round 1: ${persona.name.split(" — ")[0]}…`);
    const response = await safePersonaCall(
      persona,
      buildRoundUserPrompt(history, instruction, persona.name),
      log,
      ctx,
      STAGE_MAX_TOKENS,
      "R1"
    );
    if (response.abstained) log(`    ↳ abstained: ${response.abstainReason}`);
    events?.onPersonaResponse?.(1, response);
    return response;
  });
  return { round: 1, responses, durationMs: Date.now() - roundStart };
}

/** Rounds 2..DEBATE_ROUNDS — sequential. Each persona sees the distilled
 *  Major Standpoints doc, every prior round, and every persona who has
 *  already spoken in the current round. */
async function runRoundSequential(
  order: Persona[],
  roundNum: number,
  question: string,
  starter: string,
  standpoints: string,
  priorRounds: RoundResponse[],
  log: ProgressFn,
  ctx: CallContext,
  events?: DebateEvents
): Promise<RoundResponse> {
  const responses: PanelResponse[] = [];
  const instruction = `This is ROUND ${roundNum} of ${DEBATE_ROUNDS}. You have seen the distilled Major Standpoints, Round 1's independent responses, every later round, and everyone who has already spoken in this round. Advance the debate: concede what's been proven, attack what remains weak, and sharpen your position. Don't repeat yourself. Keep it to 2–3 tight paragraphs.`;
  const orderLabel = order.map((p) => p.name.split(" — ")[0]).join(" → ");
  log(`  Round ${roundNum} order: ${orderLabel}`);
  const roundStart = Date.now();
  for (const persona of order) {
    const history = formatHistory(
      question,
      starter,
      standpoints,
      priorRounds,
      responses
    );
    log(`  Round ${roundNum}: ${persona.name.split(" — ")[0]}…`);
    const response = await safePersonaCall(
      persona,
      buildRoundUserPrompt(history, instruction, persona.name),
      log,
      ctx,
      STAGE_MAX_TOKENS,
      `R${roundNum}`
    );
    if (response.abstained) log(`    ↳ abstained: ${response.abstainReason}`);
    responses.push(response);
    events?.onPersonaResponse?.(roundNum, response);
  }
  return { round: roundNum, responses, durationMs: Date.now() - roundStart };
}

/** One synthesis call that reads round-1's parallel responses and produces a
 *  structured "Major Standpoints" + "Key Tensions" doc. That doc is injected
 *  into rounds 2+ so the sequential debate has a shared, explicit map of the
 *  landscape instead of re-deriving it from raw R1 text each time. */
async function distillStandpoints(
  question: string,
  starter: string,
  round1: RoundResponse,
  log: ProgressFn,
  ctx: CallContext
): Promise<string> {
  log(`Distilling major standpoints from round 1 (${STANDPOINTS_OPENROUTER_MODEL})…`);
  const round1Text = round1.responses
    .map((r) => {
      if (r.failed) return `${r.persona} CALL FAILED: ${r.answer}`;
      if (r.abstained) {
        return `${r.persona} ABSTAINED: ${r.abstainReason ?? "(no reason given)"}`;
      }
      return `${r.persona}:\n${r.answer}`;
    })
    .join("\n\n");
  return callModel({
    model: STANDPOINTS_ANTHROPIC_MODEL,
    openrouterModel: STANDPOINTS_OPENROUTER_MODEL,
    onFallback: ctx.onFallback,
    maxTokens: STAGE_MAX_TOKENS,
    system: `You are distilling the major standpoints from a panel's PARALLEL, INDEPENDENT round-1 responses. Each panelist wrote their reply without seeing any other panelist's reply, so overlap between them is genuine convergence — not in-round echo.

Produce a Markdown document with exactly this structure, and nothing else:

**Major Standpoints**

For each distinct position you identify (aim for 3–6), emit:
- A bolded one-line label for the standpoint
- 2–3 sentences summarizing the argument
- A line starting with \`*Held by:*\` listing the persona names that advanced it (or a close variant). If a standpoint is held by only one persona, list only that name.

**Key Tensions**

2–4 bullets naming the sharpest disagreements between the standpoints — the questions the remaining debate rounds must resolve.

No preamble, no closing line. Keep the whole document under ~500 words — density over exhaustiveness.`,
    user: `ORIGINAL QUESTION: ${question}

=== STARTER ANALYSIS ===
${starter}

=== ROUND 1 — INDEPENDENT RESPONSES ===
${round1Text}`,
  });
}

async function runConsensus(
  participants: Persona[],
  question: string,
  starter: string,
  standpoints: string,
  rounds: RoundResponse[],
  log: ProgressFn,
  ctx: CallContext,
  events?: DebateEvents
): Promise<{ responses: PanelResponse[]; durationMs: number }> {
  const history = formatHistory(question, starter, standpoints, rounds, []);
  const concurrency = parallelConcurrency(participants.length);
  log(
    `Round ${DEBATE_ROUNDS + 1} (consensus) — ${participants.length} personas, up to ${concurrency} in parallel (~1/3 of the panel)…`
  );
  const start = Date.now();
  const responses = await mapLimit(participants, concurrency, async (persona) => {
    const userBody = `${history}

---

CONSENSUS ROUND

The ${DEBATE_ROUNDS} debate rounds are complete and a consensus position is emerging. As ${persona.name}, respond in this exact markdown format:

**Positives**
- (1–3 bullets — elements of the emerging consensus you endorse and would back publicly)

**Negatives**
- (1–3 bullets — points you dispute or would refuse to compromise on)

Each bullet is one crisp sentence. No preamble, no closing line, no extra sections — just the two bold headers and their bullets.

**Mandatory participation:** Abstention is NOT allowed in the consensus round. Even if parts of the question sit outside your core expertise, you have heard ${DEBATE_ROUNDS} full rounds of panel discussion — pick the elements of the emerging consensus you can reasonably endorse and the elements you most distrust, and answer in the format above. Do not use \`${ABSTAIN_TAG}\`.`;
    // parseAbstain=false: consensus is mandatory, so any `[ABSTAIN]` in the
    // response is just literal text, not a structured opt-out.
    const response = await safePersonaCall(
      persona,
      userBody,
      log,
      ctx,
      STAGE_MAX_TOKENS,
      "consensus",
      false
    );
    events?.onConsensusResponse?.(response);
    return response;
  });
  return { responses, durationMs: Date.now() - start };
}

async function synthesize(
  participants: Persona[],
  question: string,
  starter: string,
  standpoints: string,
  rounds: RoundResponse[],
  consensus: PanelResponse[],
  ctx: CallContext
): Promise<string> {
  const historyText = formatHistory(question, starter, standpoints, rounds, []);
  const consensusText = consensus
    .map((c) => {
      if (c.failed) return `## ${c.persona}\n*Call failed: ${c.answer}*`;
      if (c.abstained) return `## ${c.persona}\n*Abstained: ${c.abstainReason}*`;
      return `## ${c.persona}\n${c.answer}`;
    })
    .join("\n\n---\n\n");
  const personaCount = participants.length;
  // Pre-fill the list of names the synthesizer MUST emit. The coverage check
  // after this call backfills any that still end up missing, but giving the
  // model the explicit roster up front dramatically cuts the miss rate.
  const rosterLines = participants
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");

  return callModel({
    model: SYNTHESIZER_ANTHROPIC_MODEL,
    openrouterModel: SYNTHESIZER_OPENROUTER_MODEL,
    onFallback: ctx.onFallback,
    maxTokens: SYNTHESIZER_MAX_TOKENS,
    system: `You are a master synthesizer for a multi-round debate. The input you receive contains:
- An opening starter analysis
- Round 1: ${personaCount} distinct personas who each responded IN PARALLEL, without seeing any other panelist — their overlap is genuine convergence, not echo
- A distilled "Major Standpoints" + "Key Tensions" doc extracted from those parallel round-1 responses
- Rounds 2–${DEBATE_ROUNDS}: sequential reactions — each persona saw all prior rounds, the standpoints doc, and everyone earlier in the same round before speaking
- A consensus round where each persona independently listed positives and negatives of the emerging consensus

Some personas may have abstained from specific rounds (opting out because the topic was outside their expertise). Treat abstentions as data — note them briefly but do not pad with fake verdicts. A small number of persona calls may have failed entirely (network / model errors); note failures exactly once but still emit a verdict based on whatever rounds they did participate in.

Produce the final consensus model in Markdown with exactly this structure:

## Part 1 — Persona Verdicts

YOU MUST emit EXACTLY ONE verdict block for EVERY persona listed in the roster below — none skipped, none merged. Each persona's name must appear wrapped in double asterisks on its own line (so it renders as bold), followed by a blank line, followed by **exactly 3 sentences** covering: (a) how their position evolved from their independent round-1 opener through the sequential rounds, (b) their strongest endorsement of the consensus, (c) their most important remaining reservation. Not 2, not 4 — three complete sentences.

If a persona abstained from one or more rounds, still emit their bold name, but follow it with a single sentence noting which rounds they abstained from and why — not three. If a persona's call failed, emit their bold name followed by a single sentence naming the stage that failed. Do NOT use \`###\` headings for personas — personas must be bold, not headings.

ROSTER (EMIT IN THIS ORDER, NO OMISSIONS):
${rosterLines}

## Part 2 — The Consensus Model

A single integrated conclusion ≤ 600 words, written as flowing prose with no subheadings. Describe the position the panel has converged on, the key tradeoffs it resolves, and the strongest remaining objections. Close with a bulleted "Action Recommendation" containing 3–5 concrete, actionable bullets — what someone would actually do based on the panel's consensus. Use \`**Action Recommendation**\` on its own line before the bullets.

Start your entire response with \`## Part 1 — Persona Verdicts\` and do not add any preamble before it.`,
    user: `Original question: ${question}

---

${historyText}

---

# Consensus Round (positives / negatives per persona)

${consensusText}

---

Produce the final consensus model now.`,
  });
}

/** The top-level orchestrator. See `CLAUDE.md` → Architecture → Pipeline
 *  stages for a narrative walkthrough of what each stage does and why. */
export async function runDebate(
  question: string,
  selection: PersonaSelection = "auto",
  onProgress?: ProgressFn,
  events?: DebateEvents,
  testMode: boolean = false,
  signal?: AbortSignal
): Promise<DebateResult> {
  const log: ProgressFn = onProgress ?? (() => {});

  // Per-run fallback tally — isolated from any other `runDebate` call that
  // happens to be in flight simultaneously (e.g. two MCP background runs).
  const fallbackCounter = { count: 0 };
  const ctx: CallContext = {
    onFallback: () => { fallbackCounter.count++; },
    signal,
  };

  const {
    participants,
    mode: selectionMode,
    rationale: selectionRationale,
  } = await resolveSelection(question, selection, log);

  log(
    `Panel: ${participants.length} persona${participants.length === 1 ? "" : "s"} (${selectionMode})`
  );

  const runStart = Date.now();

  throwIfAborted(signal, "starter");
  log(`Starter (${STARTER_OPENROUTER_MODEL})…`);
  const starterStart = Date.now();
  const starter = await getStarter(question, ctx);
  const starterMs = Date.now() - starterStart;
  events?.onStarter?.(starter);

  throwIfAborted(signal, "round 1");
  const round1 = await runRound1Parallel(
    participants,
    question,
    starter,
    log,
    ctx,
    events
  );
  const rounds: RoundResponse[] = [round1];
  await writeCheckpoint({
    question,
    stage: "round 1",
    participants,
    starter,
    standpoints: "",
    rounds,
  });

  if (testMode) {
    log("Test mode — skipping standpoints, sequential rounds, consensus, synthesis.");
    await clearCheckpoint(question);
    const timing: DebateTiming = {
      starterMs,
      standpointsMs: 0,
      roundsMs: [round1.durationMs ?? 0],
      consensusMs: 0,
      synthesisMs: 0,
      totalMs: Date.now() - runStart,
    };
    return {
      participants,
      selectionMode,
      selectionRationale,
      starter,
      standpoints: "",
      rounds,
      consensus: [],
      synthesis: "",
      timing,
      fallbackCount: fallbackCounter.count,
      autoFilledVerdicts: [],
      testMode: true,
    };
  }

  throwIfAborted(signal, "standpoints distillation");
  const standpointsStart = Date.now();
  const standpoints = await distillStandpoints(question, starter, round1, log, ctx);
  const standpointsMs = Date.now() - standpointsStart;
  events?.onStandpoints?.(standpoints);
  await writeCheckpoint({
    question,
    stage: "standpoints",
    participants,
    starter,
    standpoints,
    rounds,
  });

  let prevOrder: Persona[] = participants;
  for (let i = 2; i <= DEBATE_ROUNDS; i++) {
    throwIfAborted(signal, `round ${i}`);
    const order = pickNextOrder(participants, prevOrder);
    log(
      `Round ${i} of ${DEBATE_ROUNDS} (sequential, ${participants.length} personas)…`
    );
    const round = await runRoundSequential(
      order,
      i,
      question,
      starter,
      standpoints,
      rounds,
      log,
      ctx,
      events
    );
    rounds.push(round);
    prevOrder = order;
    await writeCheckpoint({
      question,
      stage: `round ${i}`,
      participants,
      starter,
      standpoints,
      rounds,
    });
  }

  throwIfAborted(signal, "consensus round");
  const { responses: consensus, durationMs: consensusMs } = await runConsensus(
    participants,
    question,
    starter,
    standpoints,
    rounds,
    log,
    ctx,
    events
  );
  await writeCheckpoint({
    question,
    stage: "consensus",
    participants,
    starter,
    standpoints,
    rounds,
    consensus,
  });

  throwIfAborted(signal, "synthesis");
  log("Synthesizing final consensus model…");
  const synthesisStart = Date.now();
  const rawSynthesis = await synthesize(
    participants,
    question,
    starter,
    standpoints,
    rounds,
    consensus,
    ctx
  );
  const { synthesis, autoFilled } = ensureAllPersonasInSynthesis(
    rawSynthesis,
    participants,
    rounds,
    consensus
  );
  if (autoFilled.length > 0) {
    log(
      `⚠️  Synthesizer omitted ${autoFilled.length} persona verdict${autoFilled.length === 1 ? "" : "s"}; auto-filled: ${autoFilled.join(", ")}`
    );
    console.error(
      `⚠️  Synthesizer missed ${autoFilled.length} persona verdict${autoFilled.length === 1 ? "" : "s"} — auto-filled from round/consensus answers: ${autoFilled.join(", ")}`
    );
  }
  const synthesisMs = Date.now() - synthesisStart;
  events?.onSynthesis?.(synthesis);

  // Run completed successfully — the full transcript supersedes the partial
  // checkpoint, so drop it.
  await clearCheckpoint(question);

  const timing: DebateTiming = {
    starterMs,
    standpointsMs,
    roundsMs: rounds.map((r) => r.durationMs ?? 0),
    consensusMs,
    synthesisMs,
    totalMs: Date.now() - runStart,
  };

  return {
    participants,
    selectionMode,
    selectionRationale,
    starter,
    standpoints,
    rounds,
    consensus,
    synthesis,
    timing,
    fallbackCount: fallbackCounter.count,
    autoFilledVerdicts: autoFilled,
  };
}

