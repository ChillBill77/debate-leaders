/**
 * Dynamic persona registry.
 *
 * Every `.ts` file in this directory that (a) is not `index`, `types`, or a
 * file starting with `_` (convention for templates/helpers), and that (b)
 * exports a value matching the Persona shape is auto-registered.
 *
 * To add a persona: copy `_template.ts`, rename to `<shortkey>.ts`, fill in
 * the body, save. The registry picks it up on the next run — no edits needed
 * in this file. The filename (without extension) becomes the persona's key
 * used by the CLI's `--personas` flag and by the MCP `personas` parameter.
 *
 * Ordering: personas are sorted alphabetically by key. If you want a specific
 * order, prefix filenames with digits (e.g. `01-jensen.ts`, `02-elon.ts`).
 */

import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Persona } from "./types.js";

export type { Persona } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

function isPersona(v: unknown): v is Persona {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<Persona>;
  if (typeof p.name !== "string" || typeof p.system !== "string") return false;
  // `model` and `openrouterModel` are both optional on the type, but a
  // persona must have at least one routable model or it can't be called.
  if (p.model !== undefined && typeof p.model !== "string") return false;
  if (p.openrouterModel !== undefined && typeof p.openrouterModel !== "string") return false;
  return typeof p.model === "string" || typeof p.openrouterModel === "string";
}

async function discoverPersonas(): Promise<Record<string, Persona>> {
  const entries = await readdir(here);
  // Sort for deterministic panel order. Users can prefix filenames with
  // numbers (e.g. `01-jensen.ts`) to override default alphabetical ordering.
  const files = entries
    .filter((f) => /\.(ts|js)$/.test(f))
    .filter((f) => {
      const base = f.replace(/\.(ts|js)$/, "");
      return base !== "index" && base !== "types" && !base.startsWith("_");
    })
    .sort();

  const registry: Record<string, Persona> = {};
  for (const f of files) {
    const key = f.replace(/\.(ts|js)$/, "");
    const url = pathToFileURL(resolve(here, f)).href;
    try {
      const mod = (await import(url)) as Record<string, unknown>;
      const persona = Object.values(mod).find(isPersona);
      if (persona) {
        registry[key] = persona;
      } else {
        console.error(
          `⚠️  Skipping personas/${f} — no export matched the Persona shape.`
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`⚠️  Failed to load personas/${f}: ${reason}`);
    }
  }
  return registry;
}

/** Top-level-await: the registry is resolved at module import time so that
 *  synchronous consumers (debate.ts, mcp-server.ts) can treat it as a ready
 *  `Record<string, Persona>`. ESM + Node 22 support this out of the box. */
export const FOUNDER_PERSONAS: Record<string, Persona> = await discoverPersonas();

export function getPersona(name: string): Persona | undefined {
  return FOUNDER_PERSONAS[name.toLowerCase()];
}

export function getAllPersonas(): Persona[] {
  return Object.values(FOUNDER_PERSONAS);
}

/** Reverse lookup: persona → key (for CLI messages / auto-selector output). */
export function getPersonaKey(persona: Persona): string | undefined {
  return Object.entries(FOUNDER_PERSONAS).find(([, p]) => p === persona)?.[0];
}

export default FOUNDER_PERSONAS;

