const TOKEN_KEY = "swarm.apiToken";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function getApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setApiToken(token: string): void {
  try {
    if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage can be unavailable in hardened browsers.
  }
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getApiToken();
  return {
    ...extra,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders({
    accept: "application/json",
    ...(init.body ? { "content-type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  });
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    throw new ApiError(0, `Cannot reach the SWARM API. Is the server running? (${(error as Error).message})`);
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 500) };
  }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record.error === "string" ? record.error : `Request failed with HTTP ${response.status}.`,
      record.details,
    );
  }
  return payload as T;
}

export async function downloadArtifact(artifactId: string, filename: string): Promise<void> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/download`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed with HTTP ${response.status}.`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export async function streamRunEvents(
  runId: string,
  signal: AbortSignal,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
    headers: authHeaders({ accept: "text/event-stream" }),
    signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status, `Live stream failed with HTTP ${response.status}.`);
  }
  if (!response.body) throw new ApiError(0, "Live stream is unavailable in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let index = buffer.indexOf("\n\n");
    while (index >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon >= 0 ? line.slice(0, colon) : line;
        const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, "") : "";
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length > 0) onEvent(event, data.join("\n"));
      index = buffer.indexOf("\n\n");
    }
  }
}
