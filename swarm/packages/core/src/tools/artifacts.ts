import type { ArtifactFormat } from "../contracts/common.js";
import { slugify } from "../utils/id.js";
import { ToolError, type SwarmTool, type ToolContext, type ToolResult } from "./types.js";

const FORMAT_MIME: Record<ArtifactFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
};

const FORMAT_EXT: Record<ArtifactFormat, string> = {
  markdown: "md",
  text: "txt",
  json: "json",
  csv: "csv",
  html: "html",
};

export function isArtifactFormat(value: unknown): value is ArtifactFormat {
  return value === "markdown" || value === "text" || value === "json" || value === "csv" || value === "html";
}

export function createArtifactTools(): SwarmTool[] {
  return [
    {
      name: "artifact_write",
      description:
        "Save a supporting document, dataset, or draft as an artifact in the workspace. Use this for research notes, tables, drafts, and evidence that should be visible to the user. The final task deliverable is saved automatically.",
      risk: "internal_write",
      requiresApproval: false,
      source: "native",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "content"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          format: { type: "string", enum: ["markdown", "text", "json", "csv", "html"] },
          content: { type: "string", minLength: 1, maxLength: 400_000 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const title = typeof input.title === "string" ? input.title.trim() : "";
        const content = typeof input.content === "string" ? input.content : "";
        const format: ArtifactFormat = isArtifactFormat(input.format) ? input.format : "markdown";
        if (!title) throw new ToolError("artifact_write requires a title.", "invalid_input");
        if (!content.trim()) throw new ToolError("artifact_write requires content.", "invalid_input");
        if (content.length > 400_000) throw new ToolError("Artifact exceeds the 400,000 character limit.", "too_large");

        const artifact = context.store.createArtifact({
          runId: context.runId,
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          agentId: context.agentId,
          kind: "supporting",
          format,
          title,
          filename: `${slugify(title).slice(0, 60)}.${FORMAT_EXT[format]}`,
          mimeType: FORMAT_MIME[format],
          content,
        });
        return {
          content: `Artifact saved: "${artifact.title}" (${artifact.id}, ${artifact.sizeBytes} bytes).`,
          data: { artifactId: artifact.id, title: artifact.title, format: artifact.format },
        };
      },
    },
  ];
}

export function createMemoryTools(): SwarmTool[] {
  return [
    {
      name: "workspace_memory_search",
      description:
        "Search durable workspace memory for facts, preferences, prior decisions, and reusable context. Use before asking the user for information they may have already provided.",
      risk: "read",
      requiresApproval: false,
      source: "native",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const query = typeof input.query === "string" ? input.query : "";
        if (!query.trim()) throw new ToolError("memory search requires a query.", "invalid_input");
        const limit = typeof input.limit === "number" ? Math.min(20, Math.max(1, Math.trunc(input.limit))) : 8;
        const memories = context.store.searchMemories(context.workspaceId, query, limit);
        if (memories.length === 0) return { content: "No matching workspace memories." };
        return {
          content: memories
            .map((memory) => `- [${memory.key}] ${memory.content}${memory.tags.length ? ` (tags: ${memory.tags.join(", ")})` : ""}`)
            .join("\n"),
          data: memories.map((memory) => ({ key: memory.key, content: memory.content, tags: memory.tags })),
        };
      },
    },
    {
      name: "workspace_memory_write",
      description:
        "Store a durable, reusable fact or decision in workspace memory. Use sparingly for information that will matter in future runs. Do not store secrets or personal data.",
      risk: "internal_write",
      requiresApproval: false,
      source: "native",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["key", "content"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 120, pattern: "^[a-zA-Z0-9._:-]+$" },
          content: { type: "string", minLength: 1, maxLength: 20_000 },
          tags: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 12 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const key = typeof input.key === "string" ? input.key.trim() : "";
        const content = typeof input.content === "string" ? input.content.trim() : "";
        const tags = Array.isArray(input.tags)
          ? input.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12)
          : [];
        if (!key || !/^[a-zA-Z0-9._:-]+$/.test(key)) {
          throw new ToolError("Memory key must use letters, numbers, dots, colons, underscores, or hyphens.", "invalid_input");
        }
        if (!content) throw new ToolError("Memory content cannot be empty.", "invalid_input");
        const memory = context.store.upsertMemory(context.workspaceId, key, content, tags);
        return { content: `Memory saved under "${memory.key}".`, data: { key: memory.key } };
      },
    },
  ];
}
