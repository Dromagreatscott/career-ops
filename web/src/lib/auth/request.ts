import { NextResponse, type NextRequest } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || forwarded || "unknown";
}

function configuredOrigins(): string[] {
  return [
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.CAREER_OPS_ALLOWED_ORIGINS,
  ]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function originOf(req: Request): string | null {
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/icon.svg" ||
    pathname === "/bimi-logo.svg" ||
    pathname.startsWith("/_next/")
  );
}

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}

export function sameOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  const requestOrigin = originOf(req);
  const allowed = new Set([requestOrigin, ...configuredOrigins()].filter(Boolean));
  if (origin) return allowed.has(origin);

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  return true;
}

export function securityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export function sameOriginFailure(): Response {
  return Response.json({ error: "same-origin request required" }, { status: 403 });
}

export function proxySameOriginFailure(req: NextRequest): NextResponse {
  return securityHeaders(
    NextResponse.json({ error: "same-origin request required" }, { status: 403, headers: { "Cache-Control": "no-store" } }),
  );
}

