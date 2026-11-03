import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  maskSecret,
} from "../src/security/crypto.js";
import { decideToolPolicy, type ToolPolicyInput } from "../src/security/policy.js";
import { redactString, redactValue } from "../src/security/redact.js";
import { ensureEncryptionKey } from "../src/security/secrets.js";
import {
  assertSafeUrl,
  isPrivateAddress,
  UnsafeUrlError,
} from "../src/security/ssrf.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-security-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("secret encryption", () => {
  it("round-trips with a base64 key", () => {
    const key = generateEncryptionKey();
    const encrypted = encryptSecret("hello, swarm", key);
    expect(encrypted.version).toBe(1);
    expect(encrypted.ciphertext).not.toContain("hello");
    expect(decryptSecret(encrypted, key)).toBe("hello, swarm");
  });

  it("round-trips with a 64-character hex key", () => {
    const key = crypto.randomBytes(32).toString("hex");
    const encrypted = encryptSecret("hex-key secret", key);
    expect(decryptSecret(encrypted, key)).toBe("hex-key secret");
  });

  it("uses a fresh IV for every encryption", () => {
    const key = generateEncryptionKey();
    const first = encryptSecret("same", key);
    const second = encryptSecret("same", key);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects tampered ciphertext", () => {
    const key = generateEncryptionKey();
    const encrypted = encryptSecret("tamper me", key);
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(() =>
      decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") }, key),
    ).toThrow();
  });

  it("rejects tampered authentication tags and wrong keys", () => {
    const key = generateEncryptionKey();
    const encrypted = encryptSecret("tag", key);
    const tag = Buffer.from(encrypted.tag, "base64");
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    expect(() => decryptSecret({ ...encrypted, tag: tag.toString("base64") }, key)).toThrow();
    expect(() => decryptSecret(encrypted, generateEncryptionKey())).toThrow();
  });

  it("rejects invalid key lengths and versions", () => {
    expect(() => encryptSecret("x", "too-short")).toThrow(/32-byte key/);
    const key = generateEncryptionKey();
    const encrypted = encryptSecret("x", key);
    expect(() => decryptSecret({ ...encrypted, version: 2 as 1 }, key)).toThrow(/version/);
  });

  it("masks secrets without leaking their middle", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("short")).toBe("••••••••");
    expect(maskSecret("abcdefghijklmnop")).toBe("abc••••••nop");
  });

  it("persists an auto-generated encryption key and reuses it", () => {
    const dir = tempDir();
    const first = ensureEncryptionKey(null, dir);
    const second = ensureEncryptionKey(null, dir);
    expect(first).toBe(second);
    expect(fs.readFileSync(path.join(dir, ".encryption-key"), "utf8").trim()).toBe(first);
    expect(ensureEncryptionKey("configured-key", dir)).toBe("configured-key");
  });
});

describe("tool policy", () => {
  const base: ToolPolicyInput = {
    toolName: "web_fetch",
    risk: "read",
    requiresApproval: false,
    source: "native",
    workspacePolicy: {
      autoApproveReadOnlyMcp: false,
      allowExternalHttpWrites: false,
    },
  };

  function decide(overrides: Partial<ToolPolicyInput>) {
    return decideToolPolicy({ ...base, ...overrides });
  }

  it("denies shell, exec and filesystem tools unconditionally", () => {
    for (const toolName of ["bash", "shell", "exec", "code_exec", "file_write", "process_spawn"]) {
      expect(decide({ toolName, risk: "read" }).action).toBe("deny");
    }
  });

  it("allows read and internal write actions", () => {
    expect(decide({ risk: "read" }).action).toBe("allow");
    expect(decide({ risk: "internal_write", toolName: "artifact_write" }).action).toBe("allow");
  });

  it("always requires approval for purchases and destructive actions", () => {
    expect(decide({ risk: "purchase", toolName: "telegraph_purchase" }).action).toBe("approval");
    expect(decide({ risk: "destructive", toolName: "delete_remote" }).action).toBe("approval");
  });

  it("denies purchases and destructive actions in health workflows", () => {
    expect(decide({ risk: "purchase", domainPack: "health" }).action).toBe("deny");
    expect(decide({ risk: "destructive", domainPack: "health" }).action).toBe("deny");
  });

  it("honours declared approval requirements", () => {
    expect(decide({ risk: "external", requiresApproval: true }).action).toBe("approval");
  });

  it("auto-approves read-only MCP only when the workspace opts in", () => {
    const input = {
      risk: "external" as const,
      source: "mcp" as const,
      readOnlyHint: true,
    };
    expect(decide(input).action).toBe("approval");
    expect(
      decide({
        ...input,
        workspacePolicy: { autoApproveReadOnlyMcp: true, allowExternalHttpWrites: false },
      }).action,
    ).toBe("allow");
    expect(
      decide({
        ...input,
        readOnlyHint: false,
        workspacePolicy: { autoApproveReadOnlyMcp: true, allowExternalHttpWrites: false },
      }).action,
    ).toBe("approval");
  });

  it("requires approval for extension tools", () => {
    expect(decide({ risk: "external", source: "extension" }).action).toBe("approval");
  });

  it("denies external HTTP writes unless the workspace enables them", () => {
    expect(
      decide({ toolName: "http_request", risk: "external", isWrite: true }).action,
    ).toBe("deny");
    expect(
      decide({
        toolName: "http_request",
        risk: "external",
        isWrite: true,
        workspacePolicy: { autoApproveReadOnlyMcp: false, allowExternalHttpWrites: true },
      }).action,
    ).toBe("approval");
  });

  it("requires approval for other external native actions", () => {
    expect(decide({ toolName: "github_write", risk: "external" }).action).toBe("approval");
  });
});

describe("SSRF guard", () => {
  const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

  it("classifies private, loopback, link-local, CGNAT and reserved IPv4 addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "224.0.0.1",
      "not-an-ip",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("classifies IPv6 loopback, link-local, unique-local and multicast addresses", () => {
    for (const address of ["::", "::1", "fe80::1", "fc00::1", "fd12::1", "ff02::1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("allows public https URLs", async () => {
    const url = await assertSafeUrl("https://example.com/path?q=1", {
      resolver: publicResolver,
    });
    expect(url.hostname).toBe("example.com");
  });

  it("normalises a trailing dot before checking hostnames", async () => {
    await expect(
      assertSafeUrl("https://example.com./path", { resolver: publicResolver }),
    ).resolves.toBeInstanceOf(URL);
  });

  it("rejects local and private hostnames without DNS", async () => {
    for (const value of [
      "https://localhost/",
      "https://api.localhost/",
      "https://printer.local/",
      "https://metadata.google.internal/",
    ]) {
      await expect(assertSafeUrl(value), value).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("rejects literal private addresses", async () => {
    for (const value of [
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://169.254.169.254/latest/meta-data",
      "http://192.168.0.1/",
    ]) {
      await expect(assertSafeUrl(value), value).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    await expect(
      assertSafeUrl("https://evil.example/", {
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).rejects.toThrow(/private or reserved/);
  });

  it("rejects empty DNS answers, credentials, bad protocols and http when disallowed", async () => {
    await expect(
      assertSafeUrl("https://empty.example/", { resolver: async () => [] }),
    ).rejects.toThrow(/did not resolve/);
    await expect(
      assertSafeUrl("https://user:pass@example.com/", { resolver: publicResolver }),
    ).rejects.toThrow(/credentials/);
    await expect(
      assertSafeUrl("file:///etc/passwd", { resolver: publicResolver }),
    ).rejects.toThrow(/http and https/);
    await expect(
      assertSafeUrl("http://example.com/", { allowHttp: false, resolver: publicResolver }),
    ).rejects.toThrow(/https/);
    await expect(assertSafeUrl("not a url")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("redaction", () => {
  it("redacts common provider tokens and bearer headers", () => {
    const token = `sk-${"a".repeat(24)}`;
    const github = `ghp_${"b".repeat(24)}`;
    const text = `keys ${token} ${github} Authorization: Bearer abcdefghijklmnop`;
    const redacted = redactString(text);
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain(github);
    expect(redacted).not.toContain("abcdefghijklmnop");
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("redacts private key blocks and truncates long strings", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
    expect(redactString(pem)).toBe("[REDACTED]");
    const truncated = redactString("x".repeat(40), 10);
    expect(truncated).toContain("[truncated 30 chars]");
  });

  it("redacts sensitive object keys recursively", () => {
    const result = redactValue({
      name: "visible",
      password: "hunter2",
      authorization: "Bearer x",
      headers: { cookie: "session=1" },
      nested: [{ apiToken: "abc" }],
    }) as Record<string, unknown>;
    expect(result.name).toBe("visible");
    expect(result.password).toBe("[REDACTED]");
    expect(result.authorization).toBe("[REDACTED]");
    expect(result.headers).toBe("[REDACTED]");
    expect((result.nested as Array<Record<string, unknown>>)[0]?.apiToken).toBe("[REDACTED]");
  });

  it("bounds recursion depth", () => {
    let value: Record<string, unknown> = { end: true };
    for (let index = 0; index < 10; index += 1) value = { nested: value };
    const redacted = redactValue(value);
    expect(JSON.stringify(redacted)).toContain("[max-depth]");
  });
});
