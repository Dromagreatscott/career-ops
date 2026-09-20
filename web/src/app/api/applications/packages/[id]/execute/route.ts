import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { executeApplicationPackage, type ExecuteAction } from "@/lib/command-center/ats-executor/executor";

const ACTIONS = new Set<ExecuteAction>(["dry-run", "start-live", "resume", "status"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const sameOrigin = requireSameOrigin(req);
  if (!sameOrigin.ok) return sameOrigin.response;

  const { id } = await params;
  let body: {
    action?: string;
    packageHash?: string;
    version?: number;
    sessionId?: string;
    fill?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const action = body.action as ExecuteAction;
  if (!ACTIONS.has(action)) return Response.json({ error: "invalid executor action" }, { status: 400 });

  const result = await executeApplicationPackage({
    packageId: id,
    packageHash: body.packageHash,
    version: body.version,
    sessionId: body.sessionId,
    fill: Boolean(body.fill),
    action,
  });
  if (!result.ok) return Response.json({ error: result.error, code: result.code }, { status: result.status });
  return Response.json({
    session: result.session,
    report: result.report,
    blockers: result.blockers ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}
