import fs from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export interface StaticResult {
  status: number;
  body: string | Buffer;
  headers: Record<string, string>;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves a static file from the built web app. Unknown non-asset paths fall
 * back to index.html so client-side routes survive a refresh.
 */
export function resolveStatic(webDist: string | null, pathname: string): StaticResult | null {
  if (!webDist) return null;
  const root = path.resolve(webDist);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = "/";
  }
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const candidate = path.resolve(root, `.${normalized}`);
  const isAsset = path.extname(normalized) !== "" && !normalized.endsWith(".html");

  if (inside(root, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return {
      status: 200,
      body: fs.readFileSync(candidate),
      headers: {
        "content-type": MIME[path.extname(candidate).toLowerCase()] ?? "application/octet-stream",
        "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
        ...SECURITY_HEADERS,
      },
    };
  }

  if (!isAsset) {
    const index = path.join(root, "index.html");
    if (fs.existsSync(index)) {
      return {
        status: 200,
        body: fs.readFileSync(index),
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          ...SECURITY_HEADERS,
        },
      };
    }
  }

  return null;
}

export function findWebDist(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, "index.html"))) return resolved;
  }
  return null;
}
