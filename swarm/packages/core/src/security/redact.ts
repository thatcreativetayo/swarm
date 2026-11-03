const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

export function redactString(value: string, maxLength = 2000): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  if (redacted.length > maxLength) {
    redacted = `${redacted.slice(0, maxLength)}… [truncated ${redacted.length - maxLength} chars]`;
  }
  return redacted;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max-depth]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactValue(entry, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/key|token|secret|password|authorization|credential|cookie|header/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactValue(entry, depth + 1);
      }
    }
    return result;
  }
  return value;
}
