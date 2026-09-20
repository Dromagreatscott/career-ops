import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { replaceResumeVersion } from "@/lib/command-center/resume-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;
  const { id } = await params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "multipart form data required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  const result = replaceResumeVersion(id, {
    userId: auth.auth.userId,
    profileScope: auth.auth.profileScope,
    originalFilename: file.name,
    contentType: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ resume: result.resume });
}
