import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { JsonValue } from "../contracts/common.js";
import { assertSafeUrl, UnsafeUrlError } from "../security/ssrf.js";
import { slugify } from "../utils/id.js";
import { ToolError, type SwarmTool, type ToolResult } from "../tools/types.js";

const ExtensionToolSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/).max(48),
  description: z.string().min(1).max(1000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: z.string().startsWith("/").max(500),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object", properties: {} }),
  timeoutMs: z.number().int().min(1000).max(60_000).default(20_000),
});

const ExtensionManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).max(48),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(32),
  description: z.string().max(2000).default(""),
  baseUrl: z.string().url(),
  tools: z.array(ExtensionToolSchema).min(1).max(50),
});
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

export interface ExtensionLoadResult {
  tools: SwarmTool[];
  manifests: Array<{ id: string; name: string; version: string; tools: number }>;
  errors: Array<{ file: string; error: string }>;
}

function fillPath(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = input[key];
    if (value === undefined || value === null || typeof value === "object") {
      throw new ToolError(`Missing or invalid path parameter '${key}'.`, "invalid_input");
    }
    return encodeURIComponent(String(value));
  });
}

async function executeExtensionTool(
  manifest: ExtensionManifest,
  tool: ExtensionManifest["tools"][number],
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const url = new URL(`${manifest.baseUrl.replace(/\/+$/, "")}${fillPath(tool.path, input)}`);
  if (tool.method === "GET" || tool.method === "DELETE") {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        if (!tool.path.includes(`{${key}}`)) url.searchParams.set(key, String(value));
      }
    }
  }
  await assertSafeUrl(url.toString(), { allowHttp: false }).catch((error) => {
    if (error instanceof UnsafeUrlError) throw new ToolError(error.message, "unsafe_url");
    throw error;
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tool.timeoutMs);
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    const response = await fetch(url, {
      method: tool.method,
      headers: {
        accept: "application/json, text/plain, text/markdown",
        "user-agent": "SWARM/0.1 extension",
        ...(tool.method !== "GET" && tool.method !== "DELETE" ? { "content-type": "application/json" } : {}),
      },
      body: tool.method === "GET" || tool.method === "DELETE" ? undefined : JSON.stringify(input),
      signal: combined,
      redirect: "error",
    });
    const text = (await response.text()).slice(0, 200_000);
    if (!response.ok) {
      throw new ToolError(
        `Extension returned HTTP ${response.status}: ${text.slice(0, 500)}`,
        "extension_error",
      );
    }
    return {
      content: text,
      data: { status: response.status, url: url.toString() } as JsonValue,
    };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (signal?.aborted) throw new ToolError("Extension call was cancelled.", "cancelled");
    throw new ToolError(`Extension call failed: ${(error as Error).message}`, "extension_error");
  } finally {
    clearTimeout(timer);
  }
}

export function loadExtensions(dir: string, enabled: boolean): ExtensionLoadResult {
  if (!enabled) return { tools: [], manifests: [], errors: [] };
  if (!fs.existsSync(dir)) return { tools: [], manifests: [], errors: [] };

  const tools: SwarmTool[] = [];
  const manifests: ExtensionLoadResult["manifests"] = [];
  const errors: ExtensionLoadResult["errors"] = [];
  const usedNames = new Set<string>();

  const files = fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith(".json")).sort();
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as unknown;
      const manifest = ExtensionManifestSchema.parse(raw);
      manifests.push({ id: manifest.id, name: manifest.name, version: manifest.version, tools: manifest.tools.length });
      for (const tool of manifest.tools) {
        let name = `ext_${manifest.id}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
        if (usedNames.has(name)) name = `${name.slice(0, 55)}_${tools.length}`;
        usedNames.add(name);
        tools.push({
          name,
          description: `[Extension: ${manifest.name}] ${tool.description}`,
          inputSchema: tool.inputSchema,
          risk: "external",
          requiresApproval: true,
          source: "extension",
          isWrite: tool.method !== "GET",
          async execute(input, context) {
            return executeExtensionTool(manifest, tool, input, context.signal);
          },
        });
      }
    } catch (error) {
      errors.push({
        file,
        error: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("; ") : (error as Error).message,
      });
    }
  }

  return { tools, manifests, errors };
}

export function extensionToolSlug(value: string): string {
  return slugify(value).replaceAll("-", "_");
}
