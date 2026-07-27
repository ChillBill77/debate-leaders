/**
 * Resources — every markdown transcript under `debates/` is exposed as an
 * MCP resource at `debate://transcripts/<filename>`. Desktop can list them
 * in its resource picker and read them on demand.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { safeTranscriptName } from "./runs.js";

export function registerResourceHandlers(
  server: Server,
  opts: { debatesDir: string; transcriptUriPrefix: string }
): void {
  const { debatesDir, transcriptUriPrefix } = opts;

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    let files: string[] = [];
    try {
      const entries = await readdir(debatesDir);
      files = entries.filter((f) => f.endsWith(".md")).sort().reverse();
    } catch (err) {
      const reason =
        err && typeof err === "object" && "code" in err
          ? String((err as NodeJS.ErrnoException).code)
          : String(err);
      if (reason !== "ENOENT") {
        console.error(`[mcp] listResources failed: ${reason}`);
      }
    }
    const resources = await Promise.all(
      files.map(async (name) => {
        let size: number | undefined;
        try {
          size = (await stat(resolve(debatesDir, name))).size;
        } catch {
          /* ignore */
        }
        return {
          uri: `${transcriptUriPrefix}${name}`,
          name: basename(name, ".md"),
          mimeType: "text/markdown",
          description:
            size !== undefined
              ? `Debate transcript (${size} bytes)`
              : "Debate transcript",
        };
      })
    );
    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const name = safeTranscriptName(uri, transcriptUriPrefix);
    if (!name) {
      throw new Error(`Unknown or unsafe resource URI: ${uri}`);
    }
    const full = resolve(debatesDir, name);
    const text = await readFile(full, "utf8");
    return {
      contents: [{ uri, mimeType: "text/markdown", text }],
    };
  });
}

