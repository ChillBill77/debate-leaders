/**
 * Shared context for the MCP server modules — type aliases for the three
 * app modules (debate, personas, client), a module loader that supports
 * hot-reload cache-busting, and path/URI constants used across tools and
 * resources.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export type DebateModule = typeof import("../debate.js");
export type PersonasModule = typeof import("../personas/index.js");
export type ClientModule = typeof import("../client.js");
export type Persona = import("../personas/index.js").Persona;
export type PersonaSelection = import("../debate.js").PersonaSelection;
export type DebateResult = import("../debate.js").DebateResult;

/** Mutable module holder so hot-reload can swap implementations without
 *  restarting the stdio server. Never destructure these at call sites —
 *  always go through the passed-in `mods` reference so callers see the
 *  latest reloaded code. */
export interface Mods {
  debate: DebateModule;
  personas: PersonasModule;
  client: ClientModule;
}

/** Absolute path to the project root, derived from this module's location.
 *  Stable across both direct tsx invocation and hot-reloaded imports. */
export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export const DEBATES_DIR = resolve(PROJECT_ROOT, "debates");

/** URI scheme for transcript resources the server exposes. Every transcript
 *  file in DEBATES_DIR is listed under `debate://transcripts/<filename>`. */
export const TRANSCRIPT_URI_PREFIX = "debate://transcripts/";

/** Load the three app modules with an optional cache-busting query string.
 *  ESM has no first-class cache invalidation — appending a unique query gives
 *  Node's module loader a fresh key and so a fresh module instance. This
 *  leaks the previous instance into memory; fine for dev, avoid in prod. */
export async function loadModules(bust?: string): Promise<Mods> {
  const debateUrl = pathToFileURL(resolve(PROJECT_ROOT, "src/debate.ts")).href;
  const personasUrl = pathToFileURL(
    resolve(PROJECT_ROOT, "src/personas/index.ts")
  ).href;
  const clientUrl = pathToFileURL(resolve(PROJECT_ROOT, "src/client.ts")).href;
  const q = bust ? `?t=${bust}` : "";
  const [debate, personas, client] = await Promise.all([
    import(`${debateUrl}${q}`) as Promise<DebateModule>,
    import(`${personasUrl}${q}`) as Promise<PersonasModule>,
    import(`${clientUrl}${q}`) as Promise<ClientModule>,
  ]);
  return { debate, personas, client };
}

/** Send a logging message to the MCP client; swallow failures so a
 *  disconnected client doesn't crash the server. */
export async function safeLog(
  server: Server,
  level: "debug" | "info" | "notice" | "warning" | "error",
  data: string
): Promise<void> {
  try {
    await server.sendLoggingMessage({ level, data });
  } catch {
    /* swallow */
  }
}

