/**
 * MCP server entry point.
 *
 * Responsibilities:
 *   1. Load `.env` BEFORE importing modules that read env at module init
 *      (client.ts, debate/config.ts).
 *   2. Instantiate the Server with its capability set.
 *   3. Wire process-level error handlers (stderr only — the stdout stream
 *      is reserved for JSON-RPC).
 *   4. Delegate handler registration to `mcp/tools.ts`, `mcp/resources.ts`,
 *      and `mcp/prompts.ts`.
 *   5. Kick off hot-reload (dev) and connect the stdio transport.
 *
 * The heavy lifting lives under `src/mcp/`. This file is intentionally
 * thin so restart-required changes stay restart-required.
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  DEBATES_DIR,
  PROJECT_ROOT,
  TRANSCRIPT_URI_PREFIX,
  loadModules,
  type Mods,
} from "./mcp/context.js";
import { enableHotReload } from "./mcp/hot-reload.js";
import { registerPromptHandlers } from "./mcp/prompts.js";
import { registerResourceHandlers } from "./mcp/resources.js";
import { registerToolHandlers } from "./mcp/tools.js";

// Load .env from the project root regardless of where the desktop app launches us.
loadEnv({ path: resolve(PROJECT_ROOT, ".env") });

// Initial module load — happens AFTER dotenv so client.ts sees OPENROUTER_API_KEY /
// ANTHROPIC_API_KEY at module init.
const mods: Mods = await loadModules();

const HOT_RELOAD = process.env.MCP_HOT_RELOAD === "1";

const server = new Server(
  { name: "p3agents-debate", version: "1.3.0" },
  {
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: {},
      logging: {},
    },
  }
);

server.onerror = (err) => {
  console.error(`[mcp] server error: ${err.message}`);
};

process.on("uncaughtException", (err) => {
  console.error(`[mcp] uncaught exception: ${err?.stack ?? err}`);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[mcp] unhandled rejection: ${String(reason)}`);
});

const toolOpts = {
  debatesDir: DEBATES_DIR,
  transcriptUriPrefix: TRANSCRIPT_URI_PREFIX,
};

registerToolHandlers(server, mods, toolOpts);
registerResourceHandlers(server, toolOpts);
registerPromptHandlers(server);

if (HOT_RELOAD) enableHotReload(server, mods);

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  console.error(
    `[mcp] failed to connect transport: ${err instanceof Error ? err.stack : err}`
  );
  process.exit(1);
}

