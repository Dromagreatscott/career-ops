export type ExternalUrlValidation =
  | { ok: true; url: string; parsed: URL }
  | { ok: false; error: "empty" | "malformed" | "unsupported_protocol" };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function validateExternalUrl(value: unknown): ExternalUrlValidation {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, error: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: "unsupported_protocol" };
  }
  if (!parsed.hostname) return { ok: false, error: "malformed" };
  return { ok: true, url: parsed.toString(), parsed };
}

export function normalizeExternalUrl(value: unknown): string | undefined {
  const result = validateExternalUrl(value);
  return result.ok ? result.url : undefined;
}

export function safeExternalHref(value: unknown): string | undefined {
  return normalizeExternalUrl(value);
}
