/**
 * Run registry — background debate runs live here, keyed by `runId`. The
 * MCP server returns from the `debate` tool immediately with an id and
 * does the actual work as a detached promise; clients poll `debate_status`
 * (or `debate_cancel`) to interact with the run.
 *
 * Also contains the helpers that format run-related output (elapsed time,
 * saved-file trailer, on-disk fallback lookup when the in-memory state
 * has been evicted).
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Persona } from "./context.js";

export type RunPhase =
  | "pending"
  | "starter"
  | "rounds"
  | "standpoints"
  | "consensus"
  | "synthesis"
  | "done"
  | "error"
  | "cancelled";

export interface RunState {
  id: string;
  question: string;
  /** Concrete panel after selection resolution. */
  participants: Persona[];
  selectionMode: "all" | "auto" | "manual";
  selectionRationale?: string;
  startedAt: number;
  completedAt?: number;
  phase: RunPhase;
  latestStatus: string;
  step: number;
  totalSteps: number;
  /** Markdown transcript available after `phase === "done"`. */
  markdown?: string;
  transcriptFilename?: string;
  /** Absolute path on the host filesystem — useful for Desktop users who
   *  want to open or download the saved transcript directly. */
  transcriptPath?: string;
  /** Optional absolute path of the second copy written to
   *  `DEBATE_OUTPUT_DIR` (or `~/Downloads` by default). */
  extraCopyPath?: string;
  error?: string;
  /** Last 20 event lines captured from the debate (starter, round-persona, etc.). */
  recentEvents: string[];
  /** AbortController wired into `runDebate`. `debate_cancel` calls
   *  `controller.abort()` which flips the run to `cancelled` at the next
   *  stage boundary. In-flight LLM calls still finish (we don't propagate
   *  the signal into the SDKs), but no new calls will be started. */
  controller: AbortController;
}

/** Keep the last N runs in memory so late pollers (or a re-opened Desktop
 *  session) can still retrieve the transcript via `debate_status`. */
export const RUN_RETENTION = 20;

/** Process-wide registry. One MCP server instance per process, so a module-
 *  level Map is safe; hot-reload keeps the same registry reference because
 *  mcp-server.ts itself isn't reloaded. */
export const runs = new Map<string, RunState>();

export function newRunId(): string {
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4)
  );
}

/** Evict the oldest terminal runs once the registry exceeds RUN_RETENTION.
 *  Active runs are never evicted — they might still be polled. */
export function pruneRuns(): void {
  if (runs.size <= RUN_RETENTION) return;
  const entries = [...runs.entries()].sort(
    (a, b) => (a[1].completedAt ?? a[1].startedAt) - (b[1].completedAt ?? b[1].startedAt)
  );
  const excess = entries.length - RUN_RETENTION;
  for (let i = 0; i < excess; i++) {
    const [id, state] = entries[i];
    if (state.phase !== "done" && state.phase !== "error" && state.phase !== "cancelled") continue;
    runs.delete(id);
  }
}

export function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m${sec.toString().padStart(2, "0")}s`;
}

/** Validate a transcript URI and return the bare filename, or null if the
 *  URI doesn't match our prefix / looks like a path-traversal attempt. */
export function safeTranscriptName(
  uri: string,
  prefix: string
): string | null {
  if (!uri.startsWith(prefix)) return null;
  const name = uri.slice(prefix.length);
  if (!name.endsWith(".md")) return null;
  if (name.includes("/") || name.includes("..") || name.includes("\\")) return null;
  return name;
}

/** Render a save-location footer for any tool response that returns a
 *  completed transcript. Gives the user three ways to find the file:
 *  absolute path (copy-paste into Finder / editor), `file://` URI
 *  (clickable in some Desktop surfaces), and the MCP resource URI. */
export function buildSavedFileTrailer(
  lead: string,
  absolutePath: string | undefined,
  filename: string | undefined,
  transcriptUriPrefix: string,
  extraCopyPath?: string
): string {
  if (!absolutePath && !filename) return `\n\n---\n\n*${lead}*`;
  const lines: string[] = [`\n\n---\n\n*${lead}*`, "", `## Saved transcript`];
  if (absolutePath) {
    lines.push(
      `- **Path:** \`${absolutePath}\``,
      `- **Open:** [${filename ?? "transcript"}](file://${absolutePath})`
    );
  }
  if (extraCopyPath) {
    lines.push(
      `- **Copy at \`DEBATE_OUTPUT_DIR\`:** \`${extraCopyPath}\` · [open](file://${extraCopyPath})`
    );
  }
  if (filename) {
    lines.push(`- **MCP resource:** \`${transcriptUriPrefix}${filename}\``);
  }
  return lines.join("\n");
}

/** Fallback for when the in-memory RunState is gone (server restart or
 *  eviction) but the transcript was saved with the runId embedded in its
 *  filename. Reads the file and returns a tool response mimicking a live
 *  completed run. Returns null when no matching file is found. */
export async function handleDebateStatusFromDisk(
  runId: string,
  debatesDir: string,
  transcriptUriPrefix: string
): Promise<{ content: { type: "text"; text: string }[] } | null> {
  try {
    const entries = await readdir(debatesDir);
    const match = entries.find(
      (f) => f.endsWith(".md") && f.includes(`-${runId}-`)
    );
    if (!match) return null;
    const fullPath = resolve(debatesDir, match);
    const text = await readFile(fullPath, "utf8");
    const trailer = buildSavedFileTrailer(
      `Run \`${runId}\` recovered from disk — in-memory state was lost, but the transcript was persisted.`,
      fullPath,
      match,
      transcriptUriPrefix
    );
    return {
      content: [{ type: "text" as const, text: text + trailer }],
    };
  } catch {
    return null;
  }
}

