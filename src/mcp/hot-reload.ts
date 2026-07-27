/**
 * Hot reload — watches `src/` and swaps `mods` fields on change. Lets the
 * server pick up new personas, tweaked prompts, or fixed bugs without a
 * Desktop restart. Intentionally skips `mcp-server.ts` itself because
 * replacing the handler registration mid-flight is ambiguous.
 */

import { watch as fsWatch } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Mods } from "./context.js";
import { PROJECT_ROOT, loadModules, safeLog } from "./context.js";

/** Watch `src/**\/*.ts` and swap `mods` on change. Desktop sees the update
 *  because we emit `notifications/tools/list_changed` (and a log message).
 *  `mods` is passed by reference — the handler mutates its fields rather
 *  than replacing the object, so every closure that captured `mods` keeps
 *  seeing the latest code. */
export function enableHotReload(server: Server, mods: Mods): void {
  const srcDir = resolve(PROJECT_ROOT, "src");
  let timer: NodeJS.Timeout | null = null;
  let reloading = false;
  const debounceMs = 250;

  const doReload = async (why: string) => {
    if (reloading) return;
    reloading = true;
    try {
      const next = await loadModules(String(Date.now()));
      const beforeKeys = Object.keys(mods.personas.FOUNDER_PERSONAS).length;
      mods.debate = next.debate;
      mods.personas = next.personas;
      mods.client = next.client;
      const afterKeys = Object.keys(mods.personas.FOUNDER_PERSONAS).length;
      const delta = afterKeys - beforeKeys;
      const deltaStr =
        delta === 0
          ? "no change"
          : `${delta > 0 ? "+" : ""}${delta} persona${Math.abs(delta) === 1 ? "" : "s"}`;
      await safeLog(
        server,
        "info",
        `[hot-reload] ${why} — registry now ${afterKeys} personas (${deltaStr}).`
      );
      try {
        await server.sendToolListChanged();
      } catch {
        /* client may not support list_changed */
      }
      console.error(`[mcp] hot-reload ok (${why}) — ${afterKeys} personas`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[mcp] hot-reload failed (${why}): ${msg}`);
      await safeLog(server, "error", `[hot-reload] failed: ${msg}`);
    } finally {
      reloading = false;
    }
  };

  const handler = (event: string, filename: string | null) => {
    if (!filename) return;
    if (!filename.endsWith(".ts")) return;
    if (filename.endsWith(".d.ts")) return;
    // Don't reload ourselves — a change to mcp-server.ts (or any file in
    // src/mcp/) needs a Desktop restart to re-register handlers.
    if (filename === "mcp-server.ts" || filename.endsWith("/mcp-server.ts")) return;
    if (filename.startsWith("mcp/") || filename.includes("/mcp/")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void doReload(`${event} ${filename}`), debounceMs);
  };

  try {
    fsWatch(srcDir, { recursive: true }, handler);
    console.error(`[mcp] hot-reload enabled (watching ${srcDir})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] hot-reload disabled — fs.watch failed: ${msg}`);
  }
}

