import { NextRequest } from "next/server";
import { decideApplicationPackage } from "@/lib/command-center/application-packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { packageHash?: string; version?: number; decision?: "approved" | "rejected" };
  try {
    body = (await req.json()) as { packageHash?: string; version?: number; decision?: "approved" | "rejected" };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const packageHash = String(body.packageHash ?? "").trim();
  const expectedVersion = body.version;
  const decision = body.decision;
  if (!packageHash) return Response.json({ error: "packageHash is required" }, { status: 400 });
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    return Response.json({ error: "package version is required" }, { status: 400 });
  }
  if (decision !== "approved" && decision !== "rejected") {
    return Response.json({ error: "decision must be approved or rejected" }, { status: 400 });
  }

  const result = decideApplicationPackage(id, packageHash, Number(expectedVersion), decision);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ package: result.package });
}
