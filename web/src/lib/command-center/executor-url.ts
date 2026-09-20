import dns from "node:dns/promises";
import net from "node:net";
import { validateExternalUrl } from "@/lib/security/url";

export type ExecutionUrlValidation =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; code: "bad_url" | "private_host" | "dns_failed"; error: string };

function isPrivateIp(host: string): boolean {
  const ipVersion = net.isIP(host);
  if (ipVersion === 0) return false;
  if (ipVersion === 6) {
    const lower = host.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 0) ||
    (a >= 224)
  );
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIp(host)
  );
}

export async function validateExecutionUrl(value: unknown, resolveDns = true): Promise<ExecutionUrlValidation> {
  const parsed = validateExternalUrl(value);
  if (!parsed.ok) return { ok: false, code: "bad_url", error: "application URL must be a valid http(s) URL" };
  if (isPrivateHostname(parsed.parsed.hostname)) return { ok: false, code: "private_host", error: "application URL cannot target private hosts" };
  if (!resolveDns) return parsed;
  try {
    const records = await dns.lookup(parsed.parsed.hostname, { all: true, verbatim: true });
    if (records.some((record) => isPrivateIp(record.address))) {
      return { ok: false, code: "private_host", error: "application URL resolves to a private address" };
    }
  } catch {
    return { ok: false, code: "dns_failed", error: "application URL hostname could not be resolved" };
  }
  return parsed;
}

export function validateExecutionUrlSyncForTest(value: unknown): ExecutionUrlValidation {
  const parsed = validateExternalUrl(value);
  if (!parsed.ok) return { ok: false, code: "bad_url", error: "application URL must be a valid http(s) URL" };
  if (isPrivateHostname(parsed.parsed.hostname)) return { ok: false, code: "private_host", error: "application URL cannot target private hosts" };
  return parsed;
}
