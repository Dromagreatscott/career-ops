import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { readResumeLibrary, uploadResume } from "@/lib/command-center/resume-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  return Response.json({ resumes: readResumeLibrary(auth.auth.userId, auth.auth.profileScope, true) });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "multipart form data required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = uploadResume({
    userId: auth.auth.userId,
    profileScope: auth.auth.profileScope,
    originalFilename: file.name,
    contentType: file.type,
    bytes,
    name: String(form.get("name") ?? ""),
    category: String(form.get("category") ?? ""),
    notes: String(form.get("notes") ?? ""),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ resume: result.resume });
}
