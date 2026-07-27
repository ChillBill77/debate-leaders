/**
 * Markdown rendering — split into focused helpers so each section is
 * independently testable and `buildMarkdown` reads top-to-bottom as a table
 * of contents. No side effects; all helpers are string-in / string-out.
 */

import { FOUNDER_PERSONAS, getPersonaKey } from "../personas/index.js";
import {
  DEBATE_AUTO_PANEL_SIZE,
  DEBATE_ROUNDS,
  STANDPOINTS_OPENROUTER_MODEL,
  STARTER_OPENROUTER_MODEL,
  SYNTHESIZER_MAX_TOKENS,
  SYNTHESIZER_OPENROUTER_MODEL,
} from "./config.js";
import type { DebateResult } from "./types.js";
import { fmtMs } from "./util.js";

function renderQuestionSection(question: string): string[] {
  return [`# Question`, "", question, "", "---", ""];
}

function renderTestBanner(): string[] {
  return [
    `> **Test run** — starter + round 1 only. Standpoints distillation, sequential rounds 2–${DEBATE_ROUNDS}, consensus, and synthesis were skipped.`,
    "",
    "---",
    "",
  ];
}

function renderExecSummary(result: DebateResult): string[] {
  return [
    `# Executive Summary`,
    "",
    `*Per-persona verdicts, consensus model, and action recommendation synthesized by \`${SYNTHESIZER_OPENROUTER_MODEL}\`.*`,
    "",
    result.synthesis,
    "",
    "---",
    "",
  ];
}

function renderStarterSection(starter: string): string[] {
  return [
    `# Starter Framing`,
    "",
    `*Nine-lens framing by \`${STARTER_OPENROUTER_MODEL}\` — military, diplomatic, economic, ecological, humanitarian, informational, technological, scientific, and governance/institutional dimensions.*`,
    "",
    starter,
    "",
    "---",
    "",
  ];
}

function renderStandpointsSection(standpoints: string): string[] {
  return [
    `# Major Standpoints`,
    "",
    `*Distilled from round 1's parallel, independent responses and injected as shared context into rounds 2–${DEBATE_ROUNDS}.*`,
    "",
    standpoints,
    "",
    "---",
    "",
  ];
}

function renderRoundsSection(result: DebateResult, isTest: boolean): string[] {
  const parts: string[] = [`# Full Debate`, ""];
  for (const round of result.rounds) {
    const label =
      round.round === 1
        ? `## Round 1 — Parallel (independent responses)`
        : `## Round ${round.round}`;
    parts.push(label, "");
    for (const r of round.responses) {
      parts.push(`**${r.persona}**`, "", r.answer, "");
    }
  }
  if (!isTest) {
    parts.push(`## Round ${DEBATE_ROUNDS + 1} — Consensus`, "");
    parts.push(
      `*Each persona independently listed positives and negatives of the emerging consensus.*`,
      ""
    );
    for (const r of result.consensus) {
      parts.push(`**${r.persona}**`, "", r.answer, "");
    }
  }
  parts.push("", "---", "");
  return parts;
}

function renderTimingTable(result: DebateResult, isTest: boolean): string[] {
  const parts: string[] = [];
  parts.push("", `- **Timing (total ${fmtMs(result.timing.totalMs)}):**`);
  parts.push(`    - Starter: ${fmtMs(result.timing.starterMs)}`);
  if (!isTest) {
    parts.push(
      `    - Standpoints distillation: ${fmtMs(result.timing.standpointsMs)}`
    );
    parts.push(`    - Synthesis: ${fmtMs(result.timing.synthesisMs)}`);
  }

  const roundHeader = result.rounds.map((r) => {
    const wall = r.durationMs ?? 0;
    return `R${r.round} (${fmtMs(wall)})`;
  });
  const header = isTest
    ? ["Persona", ...roundHeader, "Total"]
    : [
        "Persona",
        ...roundHeader,
        `Consensus (${fmtMs(result.timing.consensusMs)})`,
        "Total",
      ];
  const separator = header.map(() => "---");

  const durationGrid: (number | null)[][] = result.participants.map((p) => {
    const roundDurations = result.rounds.map((round) => {
      const hit = round.responses.find((r) => r.persona === p.name);
      return hit?.durationMs ?? null;
    });
    if (isTest) return roundDurations;
    const consensusHit = result.consensus.find((r) => r.persona === p.name);
    return [...roundDurations, consensusHit?.durationMs ?? null];
  });

  const rows: string[][] = result.participants.map((p, idx) => {
    const key = getPersonaKey(p);
    const label = key ? `\`${key}\`` : p.name;
    const cells = durationGrid[idx].map((d) => (d ? fmtMs(d) : "–"));
    const personaTotal = durationGrid[idx].reduce<number>(
      (sum, d) => sum + (d ?? 0),
      0
    );
    return [label, ...cells, personaTotal > 0 ? fmtMs(personaTotal) : "–"];
  });

  const columnCount = isTest ? roundHeader.length : roundHeader.length + 1;
  const columnTotals: number[] = Array(columnCount).fill(0);
  for (const personaDurations of durationGrid) {
    personaDurations.forEach((d, ci) => {
      columnTotals[ci] += d ?? 0;
    });
  }
  const grandTotal = columnTotals.reduce((s, v) => s + v, 0);
  const totalRow = [
    "**Total**",
    ...columnTotals.map((v) => (v > 0 ? fmtMs(v) : "–")),
    grandTotal > 0 ? fmtMs(grandTotal) : "–",
  ];

  parts.push("", `| ${header.join(" | ")} |`);
  parts.push(`| ${separator.join(" | ")} |`);
  for (const row of rows) {
    parts.push(`| ${row.join(" | ")} |`);
  }
  parts.push(`| ${totalRow.join(" | ")} |`);
  parts.push("");
  return parts;
}

function renderNerdstats(
  result: DebateResult,
  costLine: string,
  isTest: boolean
): string[] {
  const parts: string[] = [];
  const totalPersonas = Object.keys(FOUNDER_PERSONAS).length;
  const panelLabel =
    result.selectionMode === "all"
      ? `Full panel (${result.participants.length} of ${totalPersonas})`
      : result.selectionMode === "auto"
        ? `Auto-selected — ${result.participants.length} of ${totalPersonas}`
        : `Manually selected — ${result.participants.length} of ${totalPersonas}`;
  const participantList = result.participants
    .map((p) => `\`${getPersonaKey(p)}\``)
    .join(", ");

  parts.push(`# Nerdstats`, "");
  if (isTest) {
    parts.push(
      `- **Mode:** Test run (starter + round 1 only; no distillation / sequential / consensus / synthesis).`
    );
  }
  parts.push(`- **Panel:** ${panelLabel}: ${participantList}.`);
  if (result.selectionRationale) {
    parts.push(`- **Selector rationale:** ${result.selectionRationale}`);
  }
  parts.push(`- **Starter model:** \`${STARTER_OPENROUTER_MODEL}\``);
  if (!isTest) {
    if (STANDPOINTS_OPENROUTER_MODEL !== SYNTHESIZER_OPENROUTER_MODEL) {
      parts.push(`- **Standpoints model:** \`${STANDPOINTS_OPENROUTER_MODEL}\``);
    }
    parts.push(
      `- **Synthesizer model:** \`${SYNTHESIZER_OPENROUTER_MODEL}\` (max_tokens ${SYNTHESIZER_MAX_TOKENS})`
    );
  }
  parts.push(`- **Rounds:** ${DEBATE_ROUNDS} (env \`DEBATE_ROUNDS\`)`);
  if (result.selectionMode === "auto") {
    parts.push(
      `- **Auto panel size:** ${DEBATE_AUTO_PANEL_SIZE} (env \`DEBATE_AUTO_PANEL_SIZE\`)`
    );
  }
  parts.push(`- **${costLine}**`);

  if (result.autoFilledVerdicts.length > 0) {
    parts.push(
      `- **Auto-filled verdicts:** ${result.autoFilledVerdicts.length} (synthesizer omitted; backfilled from round/consensus answers) — ${result.autoFilledVerdicts.join(", ")}`
    );
  }

  const failedCalls =
    result.rounds.reduce(
      (sum, r) => sum + r.responses.filter((x) => x.failed).length,
      0
    ) + result.consensus.filter((c) => c.failed).length;
  if (failedCalls > 0) {
    parts.push(
      `- **Failed persona calls:** ${failedCalls} (retries + fallback exhausted; debate continued without those answers)`
    );
  }

  parts.push("", `- **Persona models (OpenRouter → Anthropic fallback):**`);
  for (const p of result.participants) {
    const key = getPersonaKey(p);
    const label = key ? `\`${key}\`` : p.name;
    const primary = p.openrouterModel
      ? `\`${p.openrouterModel}\``
      : p.model
        ? `\`anthropic/${p.model}\``
        : "`claude-haiku-4-5` (registry default)";
    // When a persona omits `model`, `client.ts` pins the Anthropic-direct
    // fallback to Haiku regardless. Render that explicit default rather
    // than leaking a literal `undefined` into the transcript.
    const fallback = p.model ?? "claude-haiku-4-5";
    parts.push(`    - ${label}: ${primary} → \`${fallback}\``);
  }

  parts.push(...renderTimingTable(result, isTest));
  return parts;
}

export function buildMarkdown(
  question: string,
  result: DebateResult,
  costLine: string
): string {
  const parts: string[] = [];
  const isTest = result.testMode === true;

  parts.push(...renderQuestionSection(question));
  if (isTest) {
    parts.push(...renderTestBanner());
  } else {
    parts.push(...renderExecSummary(result));
  }
  parts.push(...renderStarterSection(result.starter));
  if (!isTest) {
    parts.push(...renderStandpointsSection(result.standpoints));
  }
  parts.push(...renderRoundsSection(result, isTest));
  parts.push(...renderNerdstats(result, costLine, isTest));

  return parts.join("\n");
}

