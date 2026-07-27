/**
 * Prompts — MCP exposes a `run-debate` prompt that Desktop can surface as
 * a saved template. Keeps this separate from tools so the prompt surface
 * is easy to iterate on without touching the main tool dispatcher.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export function registerPromptHandlers(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "run-debate",
        description:
          "Kick off a multi-persona debate on a given question, optionally constraining the panel.",
        arguments: [
          { name: "question", description: "The question to debate.", required: true },
          {
            name: "personas",
            description:
              "Panel selection: 'all', 'auto', or an array of persona keys (e.g. [\"elon\",\"jesus\"]).",
            required: false,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "run-debate") {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }
    const args = request.params.arguments ?? {};
    const question = args.question;
    const personas = args.personas;
    if (!question) {
      throw new Error("Missing required argument: question");
    }
    const personaClause = personas
      ? ` Use this panel selection for the \`personas\` argument: \`${personas}\` (one of \`"all"\`, \`"auto"\`, or an array of persona keys like \`["elon","jesus"]\`).`
      : "";
    return {
      description: `Run a debate on: ${question}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Call the \`debate\` tool on this MCP server with the following question:\n\n` +
              `> ${question}\n\n` +
              `Set \`interactive: true\` so I can confirm the panel and cost before you run it.${personaClause}\n\n` +
              `When the tool returns, surface the synthesis section and the action recommendation verbatim.`,
          },
        },
      ],
    };
  });
}

