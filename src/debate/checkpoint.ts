/**
 * Crash-safe per-round checkpoints. `runDebate` writes the accumulated
 * transcript-so-far to a file keyed by a SHA hash of the question after each
 * round, so a run that dies partway (process crash, abort, fatal error) leaves
 * its partial results on disk. On successful completion the checkpoint is
 * removed — the full transcript supersedes it.
 *
 * Everything here is best-effort: a failed checkpoint write/delete logs to
 * stderr but never throws, so checkpointing can never take down a live debate.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Persona } from "../personas/index.js";
import type { PanelResponse, RoundResponse } from "./types.js";

/** Short, stable hex digest of the question. Keys a run's checkpoint file so
 *  its partial results are recoverable and a re-run of the same question
 *  overwrites its own stale checkpoint instead of piling up copies. */
export function questionHash(question: string): string {
  return createHash("sha256").update(question, "utf8").digest("hex").slice(0, 12);
}

/** Checkpoints live in the same `debates/` folder the final transcript lands
 *  in, so recovery files sit right next to the real ones. */
function checkpointDir(): string {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return resolve(projectRoot, "debates");
}

export function checkpointPath(question: string): string {
  return resolve(checkpointDir(), `debate-checkpoint-${questionHash(question)}.md`);
}

export interface CheckpointState {
  question: string;
  /** Human label of the last completed stage, e.g. "round 2" or "standpoints". */
  stage: string;
  participants: Persona[];
  starter: string;
  standpoints: string;
  rounds: RoundResponse[];
  /** Present only once the consensus round has completed. */
  consensus?: PanelResponse[];
}

function renderResponse(r: PanelResponse): string {
  const head = `### ${r.persona}`;
  if (r.failed) return `${head}\n\n*Call failed:* ${r.answer}`;
  if (r.abstained) return `${head}\n\n*Abstained:* ${r.abstainReason ?? "(no reason given)"}`;
  return `${head}\n\n${r.answer}`;
}

function renderCheckpoint(s: CheckpointState): string {
  const keys = s.participants.map((p) => p.name.split(" — ")[0]).join(", ");
  const parts: string[] = [
    `# Debate checkpoint — ${s.stage} complete`,
    "",
    `> ⚠️ Partial transcript from a run that has not finished. If the run crashed, this is everything captured up to and including **${s.stage}**.`,
    "",
    `**Question:** ${s.question}`,
    "",
    `**Question hash:** \`${questionHash(s.question)}\``,
    "",
    `**Panel (${s.participants.length}):** ${keys}`,
    "",
    "---",
    "",
    "## Starter",
    "",
    s.starter || "_(not yet produced)_",
  ];

  if (s.standpoints) {
    parts.push("", "---", "", "## Major Standpoints", "", s.standpoints);
  }

  for (const round of s.rounds) {
    parts.push("", "---", "", `## Round ${round.round}`, "");
    parts.push(round.responses.map(renderResponse).join("\n\n"));
  }

  if (s.consensus && s.consensus.length > 0) {
    parts.push("", "---", "", "## Consensus round", "");
    parts.push(s.consensus.map(renderResponse).join("\n\n"));
  }

  return parts.join("\n") + "\n";
}

/** Write the current partial transcript to the question's checkpoint file.
 *  Writes to a `.tmp` sibling first and renames, so a crash mid-write can't
 *  leave a half-written checkpoint. Never throws. */
export async function writeCheckpoint(s: CheckpointState): Promise<void> {
  try {
    await mkdir(checkpointDir(), { recursive: true });
    const path = checkpointPath(s.question);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, renderCheckpoint(s), "utf8");
    await rename(tmp, path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[checkpoint] write failed (${s.stage}): ${reason}`);
  }
}

/** Remove the question's checkpoint file. Called on successful completion —
 *  the full transcript supersedes it. Never throws. */
export async function clearCheckpoint(question: string): Promise<void> {
  try {
    await rm(checkpointPath(question), { force: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[checkpoint] clear failed: ${reason}`);
  }
}

