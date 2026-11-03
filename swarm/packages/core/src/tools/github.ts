import { ToolError, type SwarmTool, type ToolContext, type ToolResult } from "./types.js";

const API_BASE = "https://api.github.com";
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

async function githubRequest(
  context: ToolContext,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; data: unknown }> {
  const token = context.getIntegrationSecret("github");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "SWARM/0.1",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Keep plain text.
    }
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : text.slice(0, 500);
      throw new ToolError(`GitHub API returned HTTP ${response.status}: ${message}`, "github_error");
    }
    return { response, data };
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (context.signal?.aborted) throw new ToolError("GitHub request was cancelled.", "cancelled");
    throw new ToolError(`GitHub request failed: ${(error as Error).message}`, "github_error");
  } finally {
    clearTimeout(timer);
  }
}

export function createGitHubTools(): SwarmTool[] {
  return [
    {
      name: "github_get_repo",
      description:
        "Read public metadata about a GitHub repository: description, stars, language, topics, license, and recent activity counts. A connected GitHub integration raises rate limits.",
      risk: "read",
      requiresApproval: false,
      source: "native",
      readOnlyHint: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "repo"],
        properties: {
          owner: { type: "string", maxLength: 100 },
          repo: { type: "string", maxLength: 100 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const owner = typeof input.owner === "string" ? input.owner.trim() : "";
        const repo = typeof input.repo === "string" ? input.repo.trim() : "";
        if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) {
          throw new ToolError("Invalid GitHub owner or repository name.", "invalid_input");
        }
        const { data } = await githubRequest(context, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
        const record = (data ?? {}) as Record<string, unknown>;
        const summary = {
          fullName: record.full_name,
          description: record.description,
          stars: record.stargazers_count,
          forks: record.forks_count,
          language: record.language,
          topics: record.topics,
          license: (record.license as Record<string, unknown> | null)?.spdx_id ?? null,
          openIssues: record.open_issues_count,
          defaultBranch: record.default_branch,
          updatedAt: record.updated_at,
          htmlUrl: record.html_url,
        };
        return {
          content: `GitHub repository ${owner}/${repo}:\n${JSON.stringify(summary, null, 2)}`,
          data: summary as ToolResult["data"],
        };
      },
    },
    {
      name: "github_create_issue",
      description:
        "Create an issue in a GitHub repository. This is an external write and always requires user approval. Requires a connected GitHub integration with a token.",
      risk: "external",
      requiresApproval: true,
      source: "native",
      isWrite: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "repo", "title", "body"],
        properties: {
          owner: { type: "string", maxLength: 100 },
          repo: { type: "string", maxLength: 100 },
          title: { type: "string", minLength: 1, maxLength: 256 },
          body: { type: "string", minLength: 1, maxLength: 20_000 },
          labels: { type: "array", items: { type: "string", maxLength: 50 }, maxItems: 10 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        if (!context.getIntegrationSecret("github")) {
          throw new ToolError(
            "A GitHub integration with a token is required before creating issues.",
            "integration_required",
          );
        }
        const owner = typeof input.owner === "string" ? input.owner.trim() : "";
        const repo = typeof input.repo === "string" ? input.repo.trim() : "";
        const title = typeof input.title === "string" ? input.title.trim() : "";
        const body = typeof input.body === "string" ? input.body.trim() : "";
        if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) {
          throw new ToolError("Invalid GitHub owner or repository name.", "invalid_input");
        }
        if (!title || !body) throw new ToolError("Issue title and body are required.", "invalid_input");
        const labels = Array.isArray(input.labels)
          ? input.labels.filter((label): label is string => typeof label === "string").slice(0, 10)
          : [];
        const { data } = await githubRequest(
          context,
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, body, labels }),
          },
        );
        const record = (data ?? {}) as Record<string, unknown>;
        return {
          content: `Issue created: ${String(record.html_url ?? record.url ?? "unknown")}`,
          data: {
            number: typeof record.number === "number" ? record.number : null,
            url: typeof record.html_url === "string" ? record.html_url : null,
          },
        };
      },
    },
  ];
}
