import { auth } from "../../../auth";
import type { Session } from "next-auth";
import { sameOriginAllowed, sameOriginFailure } from "./request";

export type AuthContext = {
  userId: string;
  profileScope: string;
  email?: string | null;
  name?: string | null;
};

export type RequireAuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: Response };

export async function requireAuth(): Promise<RequireAuthResult> {
  let session: Session | null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = session?.user?.id;
  const profileScope = session?.user?.profileScope;
  if (!userId || !profileScope) {
    return {
      ok: false,
      response: Response.json({ error: "authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
    };
  }
  return {
    ok: true,
    auth: {
      userId,
      profileScope,
      email: session?.user?.email,
      name: session?.user?.name,
    },
  };
}

export function requireSameOrigin(req: Request): { ok: true } | { ok: false; response: Response } {
  if (sameOriginAllowed(req)) return { ok: true };
  return { ok: false, response: sameOriginFailure() };
}
