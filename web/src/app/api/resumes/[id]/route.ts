import fs from "node:fs";
import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { readResumeLibrary, resumeFilePath, updateResumeMetadata } from "@/lib/command-center/resume-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const resume = readResumeLibrary(auth.auth.userId, auth.auth.profileScope, true).find((item) => item.id === id);
  if (!resume) return Response.json({ error: "resume not found" }, { status: 404 });
  const file = resumeFilePath(resume);
  if (!file || !fs.existsSync(file)) return Response.json({ error: "resume file not found" }, { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: {
      "Content-Type": resume.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `inline; filename="${resume.originalFilename ?? "resume"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;
  const { id } = await params;
  let patch: Record<string, unknown>;
  try {
    patch = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const resume = updateResumeMetadata(id, auth.auth, {
    name: patch.name == null ? undefined : String(patch.name),
    label: patch.label == null ? undefined : String(patch.label),
    category: patch.category == null ? undefined : String(patch.category),
    notes: patch.notes == null ? undefined : String(patch.notes),
    isDefault: typeof patch.isDefault === "boolean" ? patch.isDefault : undefined,
    isArchived: typeof patch.isArchived === "boolean" ? patch.isArchived : undefined,
  });
  return resume ? Response.json({ resume }) : Response.json({ error: "resume not found" }, { status: 404 });
}
