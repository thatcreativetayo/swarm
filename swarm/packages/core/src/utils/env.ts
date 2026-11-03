import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads .env files without overriding variables already present in the
 * process environment. Later files do not override earlier ones.
 */
export function loadEnvFiles(candidates: string[]): string[] {
  const loaded: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const filename = path.resolve(candidate);
    if (!fs.existsSync(filename)) continue;
    const parsed = parseEnv(fs.readFileSync(filename, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(filename);
  }
  return loaded;
}

export function defaultEnvCandidates(): string[] {
  return [
    process.env.SWARM_ENV_FILE ?? "",
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(process.cwd(), "../.env"),
  ].filter(Boolean);
}
