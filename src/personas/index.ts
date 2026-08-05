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

/** Walk `dir` recursively, returning the basename-key + absolute file URL for
 *  every `.ts`/`.js` file that isn't `index`/`types` or an `_`-prefixed
 *  template/helper. Subfolders (e.g. `NL_Parties/`) are descended into so
 *  personas can be grouped in directories; the key is still the bare filename
 *  so `--personas vvd` works regardless of which folder the file lives in. */
async function collectPersonaFiles(
  dir: string
): Promise<Array<{ key: string; url: string }>> {
  const out: Array<{ key: string; url: string }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectPersonaFiles(full)));
      continue;
    }
    if (!/\.(ts|js)$/.test(entry.name)) continue;
    const base = entry.name.replace(/\.(ts|js)$/, "");
    if (base === "index" || base === "types" || base.startsWith("_")) continue;
    // Keys are lowercased so CLI/MCP lookups (which lowercase their input)
    // match regardless of filename casing — e.g. `NL_VVD.ts` → key `nl_vvd`.
    out.push({ key: base.toLowerCase(), url: pathToFileURL(full).href });
  }
  return out;
}

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

/** Default OpenRouter slug for Dutch-party personas (keys prefixed `nl_`,
 *  grouped under `personas/NL_Parties/`). A persona in that group that doesn't
 *  set its own `openrouterModel` speaks through Kimi K3. */
const NL_PARTY_DEFAULT_MODEL = "moonshotai/kimi-k3";

async function discoverPersonas(): Promise<Record<string, Persona>> {
  // Sort by key for deterministic panel order. Users can prefix filenames with
  // numbers (e.g. `01-jensen.ts`) to override default alphabetical ordering.
  const files = (await collectPersonaFiles(here)).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );

  const registry: Record<string, Persona> = {};
  for (const { key, url } of files) {
    try {
      const mod = (await import(url)) as Record<string, unknown>;
      const persona = Object.values(mod).find(isPersona);
      if (persona) {
        // NL_ party personas default to Kimi K3 unless they pin their own slug.
        if (key.startsWith("nl_") && !persona.openrouterModel) {
          persona.openrouterModel = NL_PARTY_DEFAULT_MODEL;
        }
        registry[key] = persona;
      } else {
        console.error(
          `⚠️  Skipping personas/${key} — no export matched the Persona shape.`
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`⚠️  Failed to load personas/${key}: ${reason}`);
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

