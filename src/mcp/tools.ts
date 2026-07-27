/**
 * Tool handlers — registers `ListTools` + `CallTool` with the MCP server
 * and defines every `handle*` function. Centralised so the tool surface
 * is easy to iterate on without touching module wiring.
 *
 * The registration function captures a mutable `mods` reference so
 * hot-reload's field-swap is picked up transparently.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Mods, Persona, PersonaSelection } from "./context.js";
import { safeLog } from "./context.js";
import {
  buildSavedFileTrailer,
  formatElapsed,
  handleDebateStatusFromDisk,
  newRunId,
  pruneRuns,
  runs,
  safeTranscriptName,
  type RunPhase,
  type RunState,
} from "./runs.js";

/** Safe upper bound for server-side blocking. Claude Desktop times tool
 *  calls out at ~4 minutes, so we stop well under that to leave room for
 *  serialization + transport. */
const DEBATE_STATUS_MAX_WAIT_SEC = 180;
/** Default wait so agents that forget to pass `waitSec` still benefit
 *  from the polling reduction — each call covers ~45 seconds instead of
 *  returning immediately, cutting polls significantly on a 15–20 min debate. */
const DEBATE_STATUS_DEFAULT_WAIT_SEC = 45;

interface ToolExtra {
  sendNotification?: (notification: {
    method: string;
    params?: Record<string, unknown>;
  }) => Promise<void>;
}

/** Rough cost estimate — linear in panel size. Default models are Haiku
 *  across the board (starter, standpoints, synthesizer), so $ / persona
 *  tracks Haiku token pricing. Operators pointing `DEBATE_SYNTHESIZER_MODEL`
 *  at Opus should expect the high end to blow past this band; run
 *  `estimate_cost` before committing a full-panel Opus synth. */
function estimateCostUSD(participantCount: number): { low: number; high: number } {
  return { low: 0.03 * participantCount, high: 0.06 * participantCount };
}

/** Empirical wall-time buckets. Each persona in rounds 1–3 takes 20–45s
 *  of sequential LLM time, so wall time grows roughly linearly with the
 *  panel size. Buckets are padded for slow vendor slugs + synthesis. */
function runtimeBucket(count: number): string {
  if (count <= 4) return "~1–3 min";
  if (count <= 10) return "~3–7 min";
  if (count <= 20) return "~8–15 min";
  return "~15–20 min";
}

function callCountEstimate(mods: Mods, participantCount: number): number {
  // starter + round 1 parallel (p) + standpoints distillation +
  // (DEBATE_ROUNDS - 1) sequential rounds × p + consensus (p) + synthesis
  return 3 + mods.debate.DEBATE_ROUNDS * participantCount + participantCount;
}

/** Dedupe a persona key array (case-insensitive), drop unknown keys, preserve
 *  first-seen order. */
function resolvePersonaArray(
  mods: Mods,
  keys: string[]
): { personas: Persona[]; unknown: string[]; duplicates: string[] } {
  const registry = mods.personas.FOUNDER_PERSONAS;
  const seen = new Set<string>();
  const personas: Persona[] = [];
  const unknown: string[] = [];
  const duplicates: string[] = [];
  for (const raw of keys) {
    const k = raw.trim().toLowerCase();
    if (!k) continue;
    const p = registry[k];
    if (!p) {
      unknown.push(raw);
      continue;
    }
    if (seen.has(k)) {
      duplicates.push(k);
      continue;
    }
    seen.add(k);
    personas.push(p);
  }
  return { personas, unknown, duplicates };
}

function parseSelectionArg(mods: Mods, raw: unknown): PersonaSelection {
  if (raw === undefined || raw === null) return "auto";
  if (raw === "all" || raw === "auto") return raw;
  if (Array.isArray(raw)) {
    const strs = raw.filter((x): x is string => typeof x === "string");
    const { personas, unknown, duplicates } = resolvePersonaArray(mods, strs);
    if (personas.length === 0) {
      throw new Error(
        `No valid persona keys. Available: ${Object.keys(mods.personas.FOUNDER_PERSONAS).join(", ")}`
      );
    }
    if (unknown.length > 0) {
      console.error(`[mcp] ignoring unknown persona keys: ${unknown.join(", ")}`);
    }
    if (duplicates.length > 0) {
      console.error(`[mcp] ignoring duplicate persona keys: ${duplicates.join(", ")}`);
    }
    return personas;
  }
  throw new Error(
    `Invalid 'personas' argument. Expected "all", "auto", or array of persona keys.`
  );
}

function participantCountFor(mods: Mods, selection: PersonaSelection): number {
  if (selection === "all") return Object.keys(mods.personas.FOUNDER_PERSONAS).length;
  if (selection === "auto") return mods.debate.DEBATE_AUTO_PANEL_SIZE;
  return selection.length;
}

/* ------------------------------------------------------------------------ */
/* Simple handlers                                                          */
/* ------------------------------------------------------------------------ */

function handleListPersonas(mods: Mods) {
  const registry = mods.personas.FOUNDER_PERSONAS;
  const lines = Object.entries(registry).map(([key, p]) => {
    const slug = p.openrouterModel ?? `(auto → anthropic/${p.model})`;
    return `- \`${key}\` — ${p.name}  \n  model: \`${slug}\``;
  });
  return {
    content: [
      {
        type: "text" as const,
        text: `# Available personas (${Object.keys(registry).length})\n\n${lines.join("\n")}`,
      },
    ],
  };
}

function handleEstimateCost(mods: Mods, args: Record<string, unknown>) {
  const selection = parseSelectionArg(mods, args.personas);
  const count = participantCountFor(mods, selection);
  const { low, high } = estimateCostUSD(count);
  const calls = callCountEstimate(mods, count);
  const mode =
    selection === "all" ? "all" : selection === "auto" ? "auto" : "manual";
  const text =
    `Estimate for **${mode}** selection (${count} persona${count === 1 ? "" : "s"}):\n` +
    `- calls: ~${calls}\n` +
    `- cost: $${low.toFixed(2)} – $${high.toFixed(2)}\n` +
    `- wall time: ${runtimeBucket(count)}`;
  return { content: [{ type: "text" as const, text }] };
}

async function handleGetTranscript(
  opts: { debatesDir: string; transcriptUriPrefix: string },
  args: Record<string, unknown>
) {
  const { debatesDir, transcriptUriPrefix } = opts;
  let filename = args.filename;
  if (!filename || filename === "latest") {
    try {
      const entries = (await readdir(debatesDir)).filter((f) => f.endsWith(".md"));
      if (entries.length === 0) {
        throw new Error("No transcripts in debates/ yet.");
      }
      const stats = await Promise.all(
        entries.map(async (f) => ({
          f,
          mtime: (await stat(resolve(debatesDir, f))).mtimeMs,
        }))
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      filename = stats[0].f;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  if (typeof filename !== "string" || !filename) {
    throw new Error("Missing required argument: filename");
  }
  const name = safeTranscriptName(`${transcriptUriPrefix}${filename}`, transcriptUriPrefix);
  if (!name) throw new Error(`Invalid transcript filename: ${filename}`);
  const full = resolve(debatesDir, name);
  const text = await readFile(full, "utf8");
  const trailer = buildSavedFileTrailer(
    `Transcript \`${name}\`.`,
    full,
    name,
    transcriptUriPrefix
  );
  return {
    content: [{ type: "text" as const, text: text + trailer }],
  };
}

function handleDebateCancel(server: Server, args: Record<string, unknown>) {
  const runId = (args.runId ?? args.run_id ?? args.id) as unknown;
  if (typeof runId !== "string" || !runId) {
    throw new Error(
      "Missing required argument: runId (also accepted: run_id, id)."
    );
  }
  const run = runs.get(runId);
  if (!run) {
    const known = [...runs.keys()];
    throw new Error(
      `No run with id "${runId}"${known.length ? ` (known: ${known.join(", ")})` : ""}.`
    );
  }
  const terminal =
    run.phase === "done" || run.phase === "error" || run.phase === "cancelled";
  if (terminal) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Run \`${runId}\` already ${run.phase}; nothing to cancel.`,
        },
      ],
    };
  }
  run.controller.abort();
  run.latestStatus = "Cancellation requested — will stop at the next round boundary.";
  run.recentEvents.push("cancel requested");
  if (run.recentEvents.length > 20) run.recentEvents.shift();
  void safeLog(server, "info", `Cancellation requested for run ${runId}.`);
  return {
    content: [
      {
        type: "text" as const,
        text: `Cancellation requested for run \`${runId}\`. The run will flip to \`cancelled\` at the next round boundary. Poll \`debate_status({runId: "${runId}"})\` to see it land.`,
      },
    ],
  };
}

function handleListRuns() {
  if (runs.size === 0) {
    return {
      content: [{ type: "text" as const, text: "No debate runs in memory." }],
    };
  }
  const rows = [...runs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((r) => {
      const elapsed = formatElapsed((r.completedAt ?? Date.now()) - r.startedAt);
      const shortQ =
        r.question.length > 80 ? r.question.slice(0, 77) + "…" : r.question;
      return `- \`${r.id}\` · ${r.phase} · step ${r.step}/${r.totalSteps} · ${elapsed} · "${shortQ}"`;
    })
    .join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text: `# Debate runs (${runs.size})\n\n${rows}`,
      },
    ],
  };
}

async function handleDebateStatus(
  opts: { debatesDir: string; transcriptUriPrefix: string },
  args: Record<string, unknown>
) {
  const { debatesDir, transcriptUriPrefix } = opts;
  const runId = (args.runId ?? args.run_id ?? args.id) as unknown;
  if (typeof runId !== "string" || !runId) {
    throw new Error(
      "Missing required argument: runId (also accepted: run_id, id)."
    );
  }
  const rawWait = args.waitSec ?? args.wait_sec ?? args.wait;
  const parsedWait = Number(rawWait);
  const waitSec =
    rawWait === undefined || Number.isNaN(parsedWait)
      ? DEBATE_STATUS_DEFAULT_WAIT_SEC
      : Math.min(DEBATE_STATUS_MAX_WAIT_SEC, Math.max(0, Math.floor(parsedWait)));

  const run = runs.get(runId);
  if (!run) {
    const fromDisk = await handleDebateStatusFromDisk(runId, debatesDir, transcriptUriPrefix);
    if (fromDisk) return fromDisk;
    const known = [...runs.keys()];
    throw new Error(
      `No run with id "${runId}"${known.length ? ` (known: ${known.join(", ")})` : ""}. ` +
        `If the server was restarted mid-run, check \`debates/*-${runId}-*.md\` on disk.`
    );
  }

  const isTerminal = (p: RunPhase) =>
    p === "done" || p === "error" || p === "cancelled";

  if (waitSec > 0 && !isTerminal(run.phase)) {
    const deadline = Date.now() + waitSec * 1000;
    while (Date.now() < deadline) {
      if (isTerminal(run.phase)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const elapsedMs = (run.completedAt ?? Date.now()) - run.startedAt;
  const elapsed = formatElapsed(elapsedMs);
  const pct =
    run.totalSteps > 0
      ? `${Math.min(100, Math.round((run.step / run.totalSteps) * 100))}%`
      : "?";

  if (run.phase === "done" && run.markdown) {
    const trailer = buildSavedFileTrailer(
      `Run \`${runId}\` completed in ${elapsed}.`,
      run.transcriptPath,
      run.transcriptFilename,
      transcriptUriPrefix,
      run.extraCopyPath
    );
    return {
      content: [{ type: "text" as const, text: run.markdown + trailer }],
    };
  }

  if (run.phase === "error") {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            `Run \`${runId}\` failed after ${elapsed}:\n\n` +
            `\`\`\`\n${run.error ?? "(no error captured)"}\n\`\`\``,
        },
      ],
    };
  }

  if (run.phase === "cancelled") {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Run \`${runId}\` was cancelled after ${elapsed}.\n\n` +
            `**Latest:** ${run.latestStatus}\n\n` +
            `No transcript was written — cancellation stops the run before synthesis.`,
        },
      ],
    };
  }

  const tail =
    run.recentEvents.slice(-10).map((e) => `- ${e}`).join("\n") || "(no events yet)";
  const text =
    `# Debate Run \`${runId}\` — ${run.phase}\n\n` +
    `**Question:** ${run.question}\n\n` +
    `**Progress:** step ${run.step} / ${run.totalSteps} (${pct}) · elapsed ${elapsed}\n\n` +
    `**Latest:** ${run.latestStatus}\n\n` +
    `**Recent events:**\n${tail}\n\n` +
    `Still running — call \`debate_status\` again in 30-60s. When \`phase\` becomes \`done\` the next call will return the full transcript.`;
  return { content: [{ type: "text" as const, text }] };
}

/* ------------------------------------------------------------------------ */
/* The main debate tool — kicks a background run and returns a runId        */
/* ------------------------------------------------------------------------ */

async function handleDebateTool(
  server: Server,
  mods: Mods,
  opts: { debatesDir: string; transcriptUriPrefix: string },
  request: {
    params: {
      arguments?: Record<string, unknown>;
      _meta?: { progressToken?: string | number };
    };
  },
  extra: ToolExtra
) {
  const { debatesDir } = opts;
  // Snapshot the currently-loaded modules for the entire call. In-flight
  // debates therefore run on the code they started with, even if a reload
  // fires mid-run.
  const { debate, client } = mods;

  const args = request.params.arguments ?? {};
  const question = args.question;
  if (typeof question !== "string" || !question.trim()) {
    throw new Error("Missing required argument: question");
  }

  const rawSelection = parseSelectionArg(mods, args.personas);
  const interactive = args.interactive === true;
  const progressToken = request.params._meta?.progressToken;
  const clientCaps = server.getClientCapabilities();
  const canElicit = interactive && !!clientCaps?.elicitation;

  let selection: PersonaSelection = rawSelection;
  let selectionRationale: string | undefined;
  let selectionMode: "all" | "auto" | "manual" = "all";

  if (rawSelection === "auto") {
    await safeLog(server, "info", "Auto-selecting panel…");
    const resolved = await debate.resolveSelection(question, "auto", (m) =>
      void safeLog(server, "info", m)
    );
    selection = resolved.participants;
    selectionRationale = resolved.rationale;
    selectionMode = "auto";
  } else if (rawSelection === "all") {
    selectionMode = "all";
  } else {
    selectionMode = "manual";
  }

  const participantsPreview: Persona[] =
    rawSelection === "all"
      ? Object.values(mods.personas.FOUNDER_PERSONAS)
      : (selection as Persona[]);
  const count = participantsPreview.length;
  const { low, high } = estimateCostUSD(count);

  if (canElicit) {
    const keysList = participantsPreview
      .map((p) => mods.personas.getPersonaKey(p) ?? p.name)
      .join(", ");
    const balance = await client.getOpenRouterBalance();
    const balanceStr = balance
      ? `$${balance.remaining.toFixed(2)} OpenRouter remaining`
      : "OpenRouter balance unavailable";

    const confirm = await server.elicitInput({
      mode: "form",
      message: `Proposed panel (${selectionMode}): ${keysList}.
Estimated cost: $${low.toFixed(2)}–$${high.toFixed(2)}, ~${callCountEstimate(mods, count)} calls. ${balanceStr}.
Proceed, or override the panel?`,
      requestedSchema: {
        type: "object",
        properties: {
          proceed: {
            type: "boolean",
            title: "Proceed with this panel",
            description: "Uncheck and fill 'override' below to change the panel.",
            default: true,
          },
          override: {
            type: "string",
            title: "Override panel (optional)",
            description: `Comma-separated persona keys, or "all" or "auto". Leave blank to keep the proposed panel. Available: ${Object.keys(mods.personas.FOUNDER_PERSONAS).join(", ")}.`,
          },
        },
      },
    });

    if (confirm.action === "cancel") {
      return {
        content: [{ type: "text" as const, text: "Debate cancelled by user." }],
      };
    }
    const content = (confirm.content ?? {}) as {
      proceed?: boolean;
      override?: string;
    };
    const override = (content.override ?? "").trim();
    if (override) {
      const lower = override.toLowerCase();
      if (lower === "all") {
        selection = "all";
        selectionMode = "all";
        selectionRationale = undefined;
      } else if (lower === "auto") {
        await safeLog(server, "info", "Re-running auto-select after override…");
        const resolved = await debate.resolveSelection(question, "auto", (m) =>
          void safeLog(server, "info", m)
        );
        selection = resolved.participants;
        selectionRationale = resolved.rationale;
        selectionMode = "auto";
      } else {
        const { personas, unknown } = resolvePersonaArray(mods, override.split(","));
        if (personas.length === 0) {
          throw new Error(
            `Override contained no valid persona keys (got: ${unknown.join(", ")}).`
          );
        }
        selection = personas;
        selectionMode = "manual";
        selectionRationale = undefined;
        if (unknown.length > 0) {
          await safeLog(
            server,
            "warning",
            `Override ignored unknown keys: ${unknown.join(", ")}`
          );
        }
      }
    } else if (content.proceed === false) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Debate declined by user (unchecked 'proceed' with no override).",
          },
        ],
      };
    }
  }

  const finalCount =
    selection === "all"
      ? Object.keys(mods.personas.FOUNDER_PERSONAS).length
      : Array.isArray(selection)
        ? selection.length
        : mods.debate.DEBATE_AUTO_PANEL_SIZE;
  const totalSteps = callCountEstimate(mods, finalCount);
  let phaseStart = Date.now();

  const fmtElapsed = () => {
    const s = Math.round((Date.now() - phaseStart) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m${sec.toString().padStart(2, "0")}s`;
  };

  // Diagnostic: dump every progress/heartbeat to stderr so users can verify
  // the server is actually emitting updates by tailing the Desktop log file:
  //   log stream --predicate 'subsystem contains "mcp-server-p3agents-debate"'
  //   or: tail -f ~/Library/Logs/Claude/mcp-server-p3agents-debate.log
  const trace = (phase: string, message: string) => {
    console.error(`[mcp][${fmtElapsed()}][${phase}] ${message}`);
  };

  if (progressToken === undefined) {
    console.error(
      "[mcp] no progressToken from client — progress notifications will be skipped. " +
        "Logging messages still fire (visible in Desktop's Developer → MCP Logs pane)."
    );
  }

  // Resolve the concrete persona list we'll actually speak through — even
  // for selection === "all", we need this for the plan announcement.
  const finalPanel: Persona[] =
    selection === "all"
      ? Object.values(mods.personas.FOUNDER_PERSONAS)
      : (selection as Persona[]);
  const runtimeEstimate = runtimeBucket(finalCount);
  const { low: costLow, high: costHigh } = estimateCostUSD(finalCount);
  const balanceBefore = await client.getOpenRouterBalance();
  const balanceStr = balanceBefore
    ? `OpenRouter balance: $${balanceBefore.remaining.toFixed(2)}`
    : "OpenRouter balance unavailable";

  const panelLines = finalPanel
    .map((p) => {
      const key = mods.personas.getPersonaKey(p) ?? "?";
      const displayName = p.name.split(" — ")[0] ?? p.name;
      return `- \`${key}\` — ${displayName}`;
    })
    .join("\n");
  const rationaleLine = selectionRationale
    ? `\n\n**Selector rationale:** ${selectionRationale}`
    : "";
  const planMarkdown =
    `## Debate Plan\n\n` +
    `**Question:** ${question}\n\n` +
    `**Panel (${finalCount} persona${finalCount === 1 ? "" : "s"}, ${selectionMode}):**\n${panelLines}` +
    rationaleLine +
    `\n\n**Estimates:**\n` +
    `- runtime: ${runtimeEstimate}\n` +
    `- API calls: ~${totalSteps}\n` +
    `- cost: $${costLow.toFixed(2)} – $${costHigh.toFixed(2)}\n` +
    `- ${balanceStr}\n\n` +
    `Starter (${debate.STARTER_OPENROUTER_MODEL}) → round 1 parallel → standpoints distillation → ${debate.DEBATE_ROUNDS - 1} sequential rounds → consensus → synthesis. ` +
    `Starting now…`;

  await safeLog(server, "info", planMarkdown);
  const initialStatus = `Running ${finalCount}-persona debate (${runtimeEstimate}, ~$${costLow.toFixed(2)}–$${costHigh.toFixed(2)})…`;
  phaseStart = Date.now();

  // Register the run and kick it off in the background.
  const runId = newRunId();
  const controller = new AbortController();
  const run: RunState = {
    id: runId,
    question,
    participants: finalPanel,
    selectionMode,
    selectionRationale,
    startedAt: Date.now(),
    phase: "pending",
    latestStatus: initialStatus,
    step: 0,
    totalSteps,
    recentEvents: [],
    controller,
  };
  runs.set(runId, run);
  pruneRuns();

  const pushEvent = (line: string) => {
    run.recentEvents.push(line);
    if (run.recentEvents.length > 20) run.recentEvents.shift();
  };

  // Wire the debate events to mutate RunState in place. Progress
  // notifications tied to the original tool call aren't valid past the
  // initial return — background work falls back to `safeLog` + stderr trace.
  const bgEvents: import("../debate.js").DebateEvents = {
    onStarter: (text) => {
      run.phase = "starter";
      pushEvent(`starter (${text.length} chars)`);
      void safeLog(server, "info", `## Starter\n\n${text}`);
    },
    onPersonaResponse: (round, r) => {
      run.phase = "rounds";
      const body = r.abstained
        ? `*Abstained:* ${r.abstainReason ?? "(no reason)"}`
        : r.answer;
      pushEvent(
        r.abstained
          ? `round ${round} — ${r.persona}: abstained`
          : `round ${round} — ${r.persona}: ${r.answer.length} chars`
      );
      void safeLog(server, "info", `## Round ${round} — ${r.persona}\n\n${body}`);
    },
    onStandpoints: (text) => {
      run.phase = "standpoints";
      pushEvent(`standpoints distilled (${text.length} chars)`);
      void safeLog(server, "info", `## Major Standpoints\n\n${text}`);
    },
    onConsensusResponse: (r) => {
      run.phase = "consensus";
      const body = r.abstained
        ? `*Abstained:* ${r.abstainReason ?? "(no reason)"}`
        : r.answer;
      pushEvent(`consensus — ${r.persona}`);
      void safeLog(server, "info", `## Consensus — ${r.persona}\n\n${body}`);
    },
    onSynthesis: (text) => {
      run.phase = "synthesis";
      pushEvent(`synthesis (${text.length} chars)`);
      void safeLog(server, "info", `## Synthesis\n\n${text}`);
    },
  };

  const bgOnProgress = (msg: string) => {
    run.step++;
    run.latestStatus = msg;
    trace(`bg-progress ${run.step}/${run.totalSteps}`, msg);
    void safeLog(server, "info", msg);
  };

  const bgHeartbeat = setInterval(() => {
    const secs = Math.round((Date.now() - run.startedAt) / 1000);
    const hbMsg = `[${secs}s | ${run.phase} | step ${run.step}/${run.totalSteps}] ${run.latestStatus}`;
    trace("bg-heartbeat", hbMsg);
    void safeLog(server, "info", hbMsg);
  }, 10_000);

  // Fire-and-forget. Any error is captured on the RunState so polling can
  // surface it rather than disappearing silently. A DebateAbortError thrown
  // from `runDebate` flips the run to `cancelled` rather than `error` so
  // callers can tell a user-initiated stop from a real failure.
  void (async () => {
    try {
      const result = await debate.runDebate(
        question,
        selection,
        bgOnProgress,
        bgEvents,
        false,
        controller.signal
      );
      const balanceAfter = await client.getOpenRouterBalance();
      const fallbacks = result.fallbackCount;

      if (!result.selectionRationale && selectionRationale) {
        result.selectionRationale = selectionRationale;
      }
      if (result.selectionMode === "manual" && selectionMode !== "manual") {
        result.selectionMode = selectionMode;
      }

      const costLine = debate.buildCostLine(balanceBefore, balanceAfter, fallbacks);
      const markdown = debate.buildMarkdown(question, result, costLine);
      await mkdir(debatesDir, { recursive: true });
      const filename = `debate-${debate.timestamp()}-${runId}-${debate.slugify(question)}.md`;
      const filepath = resolve(debatesDir, filename);
      await writeFile(filepath, markdown, "utf8");

      run.markdown = markdown;
      run.transcriptFilename = filename;
      run.transcriptPath = filepath;
      run.extraCopyPath = await debate.copyTranscriptToExtraDir(filename, markdown);
      run.phase = "done";
      run.completedAt = Date.now();
      run.latestStatus = "Completed.";
      pushEvent(`done — transcript saved as ${filename}`);
      void safeLog(server, "info", `Transcript saved: ${filename}`);
      try {
        await server.sendResourceListChanged();
      } catch {
        /* client may not support resources/list_changed */
      }
      trace("bg-done", `runId ${runId} — ${filename} (${filepath})`);
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      const isAbort =
        err instanceof Error &&
        (err.name === "DebateAbortError" || err.message.includes("Debate aborted"));
      if (isAbort) {
        run.phase = "cancelled";
        run.completedAt = Date.now();
        run.latestStatus = `Cancelled: ${err instanceof Error ? err.message : String(err)}`;
        pushEvent(`cancelled — ${run.latestStatus}`);
        console.error(`[mcp] runId ${runId} cancelled: ${msg}`);
        void safeLog(server, "info", `Debate run ${runId} cancelled: ${msg}`);
      } else {
        run.phase = "error";
        run.completedAt = Date.now();
        run.error = msg;
        run.latestStatus = `Errored: ${err instanceof Error ? err.message : String(err)}`;
        pushEvent(`error — ${run.latestStatus}`);
        console.error(`[mcp] runId ${runId} failed: ${msg}`);
        void safeLog(server, "error", `Debate run ${runId} failed: ${msg}`);
      }
    } finally {
      clearInterval(bgHeartbeat);
    }
  })();
  // Silence "extra unused" lint — kept in signature for future per-call
  // progress notifications from inside the bg task.
  void extra;

  const replyText =
    planMarkdown +
    `\n\n---\n\n` +
    `**runId:** \`${runId}\`\n\n` +
    `The debate is running in the background. Call \`debate_status\` with this runId to retrieve progress or the final transcript; by default that call BLOCKS for up to 45 seconds waiting for completion. Desktop caps tool uses per turn, so never poll faster than the server-side wait — just call \`debate_status\` again as soon as the previous call returns.`;

  return {
    content: [{ type: "text" as const, text: replyText }],
  };
}

/* ------------------------------------------------------------------------ */
/* Registration                                                             */
/* ------------------------------------------------------------------------ */

export function registerToolHandlers(
  server: Server,
  mods: Mods,
  opts: { debatesDir: string; transcriptUriPrefix: string }
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const keys = Object.keys(mods.personas.FOUNDER_PERSONAS);
    const fullCount = keys.length;
    return {
      tools: [
        {
          name: "debate",
          description: `Kick off a multi-round debate as a BACKGROUND RUN. Returns immediately with the chosen panel, runtime/cost estimates, and a \`runId\`. The debate itself takes minutes to tens of minutes (~15-25 min for the full ${fullCount}-persona panel at ${mods.debate.DEBATE_ROUNDS} rounds) which is longer than Claude Desktop's 4-minute synchronous-tool timeout, so after calling this tool you MUST poll \`debate_status({runId})\` every 30-60 seconds until \`phase\` becomes \`done\` — the final Markdown transcript (starter, all rounds, consensus, synthesis with action recommendation) comes back in that last status call. Call \`debate_cancel({runId})\` to abort a runaway run at the next round boundary.

How the debate unfolds: a neutral starter (\`${mods.debate.STARTER_OPENROUTER_MODEL}\`) frames the question through nine lenses (military, diplomatic, economic, ecological, humanitarian, informational, technological, scientific, governance). Round 1 runs in PARALLEL — every persona answers independently without seeing the others, so their overlap reflects genuine convergence. A synthesizer then distills those parallel answers into a "Major Standpoints" + "Key Tensions" doc, which is injected into rounds 2–${mods.debate.DEBATE_ROUNDS} as shared context — these later rounds run sequentially, with each persona reacting to everything before. Finally a mandatory consensus round captures positives/negatives per persona (abstentions not allowed), and a synthesizer produces per-persona verdicts plus a consensus model with action recommendations. Rounds 1..${mods.debate.DEBATE_ROUNDS} still allow abstention when the topic sits entirely outside a persona's expertise.

Available personas (use the 'personas' parameter to pick a subset, or omit for the full panel): ${keys.join(", ")}.

The 'personas' parameter accepts "auto" (DEFAULT — a lightweight model selects ${mods.debate.DEBATE_AUTO_PANEL_SIZE} MAXIMALLY CONTRASTING voices for the specific question, ${runtimeBucket(mods.debate.DEBATE_AUTO_PANEL_SIZE)}, ~${callCountEstimate(mods, mods.debate.DEBATE_AUTO_PANEL_SIZE)} calls), "all" (full ${fullCount}-voice panel, ${runtimeBucket(fullCount)}, ~${callCountEstimate(mods, fullCount)} calls), or an array of persona keys for a manual subset (e.g. ["elon","jesus"] for a focused pairwise debate). Omit the parameter to get "auto". Each persona speaks through a vendor-aligned model on OpenRouter with automatic fallback to Anthropic Haiku.

Set 'interactive' to true to have the server confirm the auto-selected panel and the estimated cost via an MCP elicitation dialog before starting the background run.`,
          inputSchema: {
            type: "object",
            properties: {
              question: { type: "string", description: "The question to debate." },
              personas: {
                description: `Panel selection. 'auto' (DEFAULT, omit to get this) lets a lightweight model pick ${mods.debate.DEBATE_AUTO_PANEL_SIZE} MAXIMALLY CONTRASTING voices for the specific question; 'all' runs the full panel; an array of persona keys runs exactly those.`,
                oneOf: [
                  { type: "string", enum: ["all", "auto"] },
                  {
                    type: "array",
                    items: { type: "string", enum: keys },
                    minItems: 1,
                  },
                ],
              },
              interactive: {
                type: "boolean",
                description:
                  "When true (and the client supports elicitation), confirm panel + cost before running. Default: false.",
                default: false,
              },
            },
            required: ["question"],
          },
        },
        {
          name: "list_personas",
          description:
            "List all available debate personas with their keys, names, and configured models. Use this before calling `debate` if you want to pick a manual panel.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "estimate_cost",
          description:
            "Return a rough cost + call-count estimate for a given selection without running the debate. Accepts the same 'personas' shape as `debate`.",
          inputSchema: {
            type: "object",
            properties: {
              personas: {
                oneOf: [
                  { type: "string", enum: ["all", "auto"] },
                  {
                    type: "array",
                    items: { type: "string", enum: keys },
                    minItems: 1,
                  },
                ],
              },
            },
          },
        },
        {
          name: "debate_status",
          description:
            "Poll a debate that was started by `debate`. By DEFAULT the server will BLOCK for up to 45 seconds waiting for the run to finish, and return the moment it completes. Returns the full Markdown transcript when the run is complete, or the current phase / latest status / elapsed time / step counter if the wait expires first. Cheap — does not spend API credits.",
          inputSchema: {
            type: "object",
            properties: {
              runId: {
                type: "string",
                description: "The `runId` returned by `debate`.",
              },
              waitSec: {
                type: "number",
                description:
                  "Seconds the server will block waiting for the run to complete before returning a progress snapshot. Default 45, max 180, min 0 (return immediately). Designed to stay under Desktop's ~4-minute per-tool-call timeout.",
                default: 45,
                minimum: 0,
                maximum: 180,
              },
            },
            required: ["runId"],
          },
        },
        {
          name: "list_runs",
          description:
            "List all debates still kept in memory on this server (running or recently completed). Useful when the user lost track of a runId.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "debate_cancel",
          description:
            "Abort an in-flight debate run at the next round boundary. In-flight LLM calls still finish (the signal isn't propagated into the SDKs), but no new rounds or stages will start after the cancellation. Idempotent — calling it on an already-completed or already-cancelled run is a no-op. Returns the run's final phase.",
          inputSchema: {
            type: "object",
            properties: {
              runId: {
                type: "string",
                description: "The `runId` returned by `debate`.",
              },
            },
            required: ["runId"],
          },
        },
        {
          name: "get_transcript",
          description:
            "Read a saved debate transcript by filename, or pass \"latest\" (or omit filename) to return the most recently written transcript — handy when a background run finished but the Desktop session never polled debate_status. Also accessible as an MCP resource.",
          inputSchema: {
            type: "object",
            properties: {
              filename: {
                type: "string",
                description:
                  "Transcript filename (e.g. 'debate-20260420-123456-abc123-foo.md'), or \"latest\" / omitted for the newest transcript.",
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      switch (request.params.name) {
        case "debate":
          return await handleDebateTool(server, mods, opts, request, extra);
        case "list_personas":
          return handleListPersonas(mods);
        case "estimate_cost":
          return handleEstimateCost(mods, request.params.arguments ?? {});
        case "debate_status":
          return await handleDebateStatus(opts, request.params.arguments ?? {});
        case "list_runs":
          return handleListRuns();
        case "debate_cancel":
          return handleDebateCancel(server, request.params.arguments ?? {});
        case "get_transcript":
          return await handleGetTranscript(opts, request.params.arguments ?? {});
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mcp] tool "${request.params.name}" failed: ${msg}`);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${msg}` }],
      };
    }
  });
}

