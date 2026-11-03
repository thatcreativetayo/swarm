import { useEffect, useState } from "react";

export interface Route {
  name: string;
  params: Record<string, string>;
}

export function parseRoute(hash: string): Route {
  const clean = (hash || "#/").replace(/^#/, "") || "/";
  const [pathname = "/"] = clean.split("?");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "command", params: {} };
  if (parts[0] === "run" && parts[1]) return { name: "run", params: { id: parts[1] } };
  if (parts[0] === "workforce") return { name: "workforce", params: {} };
  if (parts[0] === "tasks") return { name: "tasks", params: {} };
  if (parts[0] === "approvals") return { name: "approvals", params: {} };
  if (parts[0] === "artifacts") return { name: "artifacts", params: {} };
  if (parts[0] === "activity") return { name: "activity", params: {} };
  if (parts[0] === "integrations") return { name: "integrations", params: {} };
  if (parts[0] === "settings") return { name: "settings", params: {} };
  return { name: "command", params: {} };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

export function navigate(path: string): void {
  if (window.location.hash === `#${path}`) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = path;
}
