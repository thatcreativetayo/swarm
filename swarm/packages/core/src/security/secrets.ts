import fs from "node:fs";
import path from "node:path";
import { decryptSecret, encryptSecret, generateEncryptionKey } from "./crypto.js";
import type { Store } from "../db/repository.js";

export function ensureEncryptionKey(configured: string | null, dataDir: string): string {
  if (configured) return configured;
  const keyPath = path.join(dataDir, ".encryption-key");
  try {
    const existing = fs.readFileSync(keyPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Generate below.
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const key = generateEncryptionKey();
  fs.writeFileSync(keyPath, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
  return key;
}

export class SecretBox {
  constructor(
    private readonly store: Store,
    private readonly key: string,
  ) {}

  put(workspaceId: string, name: string, plaintext: string): string {
    const encrypted = encryptSecret(plaintext, this.key);
    return this.store.createSecret({
      workspaceId,
      name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    });
  }

  get(secretId: string | null): string | null {
    if (!secretId) return null;
    const secret = this.store.getSecret(secretId);
    if (!secret) return null;
    try {
      return decryptSecret(secret, this.key);
    } catch {
      return null;
    }
  }

  integrationSecret(workspaceId: string, provider: string): string | null {
    const integration = this.store.getIntegration(workspaceId, provider);
    return this.get(integration?.secretId ?? null);
  }

  integrationConfig(workspaceId: string, provider: string): Record<string, unknown> | null {
    const integration = this.store.getIntegration(workspaceId, provider);
    if (!integration) return null;
    const config = integration.config;
    return config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  }

  putJson(workspaceId: string, name: string, value: Record<string, string>): string {
    return this.put(workspaceId, name, JSON.stringify(value));
  }

  getJson(secretId: string | null): Record<string, string> | null {
    const value = this.get(secretId);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const result: Record<string, string> = {};
      for (const [key, entry] of Object.entries(parsed)) {
        if (typeof entry === "string") result[key] = entry;
      }
      return result;
    } catch {
      return null;
    }
  }
}
