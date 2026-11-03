import type { ToolRisk } from "../contracts/common.js";

export interface WorkspacePolicy {
  autoApproveReadOnlyMcp: boolean;
  allowExternalHttpWrites: boolean;
}

export interface ToolPolicyInput {
  toolName: string;
  risk: ToolRisk;
  requiresApproval: boolean;
  source: "native" | "mcp" | "extension";
  readOnlyHint?: boolean;
  isWrite?: boolean;
  domainPack?: string;
  workspacePolicy: WorkspacePolicy;
}

export type PolicyDecision =
  | { action: "allow"; reason: string }
  | { action: "approval"; reason: string }
  | { action: "deny"; reason: string };

const ALWAYS_DENIED = new Set([
  "bash",
  "shell",
  "exec",
  "code_exec",
  "file_write",
  "filesystem_write",
  "process_spawn",
]);

export function decideToolPolicy(input: ToolPolicyInput): PolicyDecision {
  if (ALWAYS_DENIED.has(input.toolName)) {
    return { action: "deny", reason: "This tool is not available inside SWARM." };
  }

  if (input.domainPack === "health" && (input.risk === "purchase" || input.risk === "destructive")) {
    return {
      action: "deny",
      reason: "Health workflows may not make purchases or perform destructive actions.",
    };
  }

  if (input.risk === "purchase" || input.risk === "destructive") {
    return {
      action: "approval",
      reason: "Purchases and destructive actions always require explicit user approval.",
    };
  }

  if (input.requiresApproval) {
    return { action: "approval", reason: "This tool is declared as requiring approval." };
  }

  if (input.risk === "read" || input.risk === "internal_write") {
    return { action: "allow", reason: "Read-only or internal workspace action." };
  }

  if (input.source === "mcp") {
    if (input.readOnlyHint && input.workspacePolicy.autoApproveReadOnlyMcp) {
      return { action: "allow", reason: "Read-only MCP tool auto-approved by workspace policy." };
    }
    return {
      action: "approval",
      reason: "MCP tools require approval unless the workspace explicitly auto-approves read-only tools.",
    };
  }

  if (input.source === "extension") {
    return {
      action: "approval",
      reason: "External extension tools always require approval in the initial operating model.",
    };
  }

  if (input.toolName === "http_request" && input.isWrite) {
    if (!input.workspacePolicy.allowExternalHttpWrites) {
      return {
        action: "deny",
        reason: "External HTTP writes are disabled in workspace settings.",
      };
    }
    return { action: "approval", reason: "External HTTP writes require approval." };
  }

  return { action: "approval", reason: "External actions require approval." };
}
