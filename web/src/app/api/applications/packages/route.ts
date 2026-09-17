import { NextRequest } from "next/server";
import { prepareApplicationPackage } from "@/lib/command-center/application-packages";
import { commandCenterData } from "@/lib/command-center/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { jobId?: string };
  try {
    body = (await req.json()) as { jobId?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return Response.json({ error: "jobId is required" }, { status: 400 });

  const data = commandCenterData();
  const job = data.jobs.find((item) => item.id === jobId);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });

  const pkg = prepareApplicationPackage(job, data.profile);
  return Response.json({ package: pkg });
}
