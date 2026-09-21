import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { NextRequest } from "next/server";
import { updateApplicationPackageQuestion } from "@/lib/command-center/application-packages";
import { logInternalError } from "@/lib/security/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;

  const { id } = await params;
  let body: { packageHash?: string; version?: number; questionId?: string; answer?: string };
  try {
    body = (await req.json()) as { packageHash?: string; version?: number; questionId?: string; answer?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const packageHash = String(body.packageHash ?? "").trim();
  const expectedVersion = body.version;
  const questionId = String(body.questionId ?? "").trim();
  const answer = typeof body.answer === "string" ? body.answer : "";
  if (!packageHash) return Response.json({ error: "packageHash is required" }, { status: 400 });
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return Response.json({ error: "package version is required" }, { status: 400 });
  }
  if (!questionId) return Response.json({ error: "questionId is required" }, { status: 400 });

  try {
    const result = updateApplicationPackageQuestion(id, packageHash, Number(expectedVersion), questionId, answer);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ package: result.package, changed: result.changed });
  } catch (error) {
    logInternalError("applications.packages.questions", error, { packageId: id });
    return Response.json({ error: "answer could not be saved" }, { status: 500 });
  }
}
