import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
}

function decodeKey(key: string): Buffer {
  const trimmed = key.trim();
  let buffer: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    buffer = Buffer.from(trimmed, "hex");
  } else {
    buffer = Buffer.from(trimmed, "base64");
  }
  if (buffer.length !== 32) {
    throw new Error(
      "SWARM_ENCRYPTION_KEY must be a base64-encoded or 64-character hex 32-byte key.",
    );
  }
  return buffer;
}

export function encryptSecret(plaintext: string, key: string): EncryptedSecret {
  const keyBuffer = decodeKey(key);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    version: 1,
  };
}

export function decryptSecret(secret: EncryptedSecret, key: string): string {
  if (secret.version !== 1) throw new Error(`Unsupported secret version: ${secret.version}`);
  const keyBuffer = decodeKey(key);
  const iv = Buffer.from(secret.iv, "base64");
  const tag = Buffer.from(secret.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Encrypted secret has an invalid IV or authentication tag.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}••••••${value.slice(-3)}`;
}
