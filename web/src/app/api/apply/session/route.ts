import { openSession } from "@/lib/apply/session";
import { logInternalError } from "@/lib/security/errors";
import { normalizeExternalUrl } from "@/lib/security/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the agentic drive + interpretation fallbacks spawn a planner

// Open a persistent apply session: headed-but-off-screen Chrome opens the real
// form, we extract + tag its fields. The session stays open for fill + handoff.
// cliId enables the agentic fallback (the AI interprets the live form) when
// deterministic extraction is low-confidence.
export async function POST(req: Request) {
  let body: { url?: string; cliId?: string; agent?: boolean; _noApplyBtn?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const url = normalizeExternalUrl(body.url);
  if (!url) return Response.json({ error: "A valid http or https application URL is required" }, { status: 400 });
  try {
    const session = await openSession(url, body.cliId, body.agent, body._noApplyBtn);
    return Response.json(session);
  } catch (error) {
    logInternalError("apply.session.open", error);
    return Response.json({ error: "Could not open the application form." }, { status: 500 });
  }
}
