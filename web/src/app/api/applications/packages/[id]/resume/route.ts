import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { NextRequest } from "next/server";
import { overrideApplicationPackageResume } from "@/lib/command-center/application-packages";
import { commandCenterData } from "@/lib/command-center/service";
import { logInternalError } from "@/lib/security/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;

  const { id } = await params;
  let body: { packageHash?: string; version?: number; resumeId?: string };
  try {
    body = (await req.json()) as { packageHash?: string; version?: number; resumeId?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const packageHash = String(body.packageHash ?? "").trim();
  const expectedVersion = body.version;
  const resumeId = String(body.resumeId ?? "").trim();
  if (!packageHash) return Response.json({ error: "packageHash is required" }, { status: 400 });
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return Response.json({ error: "package version is required" }, { status: 400 });
  }
  if (!resumeId) return Response.json({ error: "resumeId is required" }, { status: 400 });

  try {
    const data = commandCenterData();
    const pkg = data.applicationPackages.find((item) => item.id === id);
    if (!pkg) return Response.json({ error: "application package not found" }, { status: 404 });
    const job = data.jobs.find((item) => item.id === pkg.jobId);
    if (!job) return Response.json({ error: "job not found" }, { status: 404 });

    const result = overrideApplicationPackageResume(id, packageHash, Number(expectedVersion), resumeId, data.profile, job);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ package: result.package });
  } catch (error) {
    logInternalError("applications.packages.resume", error, { packageId: id });
    return Response.json({ error: "resume override could not be saved" }, { status: 500 });
  }
}
