import { NextResponse, type NextRequest } from "next/server";
import { auth } from "../auth";
import {
  isMutatingMethod,
  isPublicPath,
  proxySameOriginFailure,
  safeNextPath,
  sameOriginAllowed,
  securityHeaders,
} from "@/lib/auth/request";

export const proxy = auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return securityHeaders(NextResponse.next());

  if (!req.auth) {
    if (pathname.startsWith("/api/")) {
      return securityHeaders(
        NextResponse.json({ error: "authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
      );
    }
    const loginUrl = new URL("/login", req.url);
    const next = safeNextPath(`${pathname}${req.nextUrl.search}`);
    if (next !== "/") loginUrl.searchParams.set("next", next);
    return securityHeaders(NextResponse.redirect(loginUrl));
  }

  if (pathname.startsWith("/api/") && isMutatingMethod(req.method) && !sameOriginAllowed(req)) {
    return proxySameOriginFailure(req);
  }

  return securityHeaders(NextResponse.next());
});

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.ico).*)"],
};
