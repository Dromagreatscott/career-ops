import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { answerHash, upsertCompanyAnswerEntry } from "@/lib/command-center/answer-library";
import { invalidatePackagesForAnswer } from "@/lib/command-center/application-packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;
  const { id } = await params;
  let body: { entry?: { answerType?: string; title?: string; content?: string; classification?: "SAFE_AUTOFILL" | "REVIEW_REQUIRED" | "USER_REQUIRED"; verificationState?: "verified" | "needs_review" | "missing"; length?: "short" | "medium" | "long"; useCase?: string; id?: string; lastReviewedAt?: string } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const entry = body.entry;
  if (!entry?.answerType || !entry.title || !entry.content) {
    return Response.json({ error: "answerType, title, and content are required" }, { status: 400 });
  }
  const pack = upsertCompanyAnswerEntry(id, {
    id: entry.id,
    answerType: entry.answerType,
    title: entry.title,
    content: entry.content,
    classification: entry.classification,
    verificationState: entry.verificationState,
    length: entry.length,
    useCase: entry.useCase,
    lastReviewedAt: entry.lastReviewedAt,
  }, auth.auth);
  if (!pack) return Response.json({ error: "company answer pack not found" }, { status: 404 });
  const saved = pack.entries.find((item) => item.answerType === entry.answerType && item.title === entry.title && item.content === entry.content);
  const invalidated = saved ? invalidatePackagesForAnswer(saved.id, answerHash(saved)) : [];
  return Response.json({ pack, invalidatedPackages: invalidated.map((pkg) => pkg.id) });
}
