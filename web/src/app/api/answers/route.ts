import { requireAuth, requireSameOrigin } from "@/lib/auth/guards";
import { answerHash, archiveReusableAnswer, readCompanyAnswerPacks, readReusableAnswers, resolveApplicationAnswers, upsertCompanyAnswerPack, upsertReusableAnswer } from "@/lib/command-center/answer-library";
import { invalidatePackagesForAnswer } from "@/lib/command-center/application-packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const answerType = url.searchParams.get("answerType");
  const company = url.searchParams.get("company") ?? undefined;
  if (answerType) {
    return Response.json({ resolved: resolveApplicationAnswers({ userId: auth.auth.userId, profileScope: auth.auth.profileScope, answerType, company }) });
  }
  return Response.json({
    answers: readReusableAnswers(auth.auth.userId, auth.auth.profileScope),
    companyPacks: readCompanyAnswerPacks(auth.auth.userId, auth.auth.profileScope),
  });
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const origin = requireSameOrigin(req);
  if (!origin.ok) return origin.response;
  let body: { action?: string; answer?: Record<string, unknown>; pack?: { company?: string; aliases?: string[] }; id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (body.action === "archive_answer") {
    if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });
    const ok = archiveReusableAnswer(body.id, auth.auth);
    return ok ? Response.json({ ok }) : Response.json({ error: "answer not found" }, { status: 404 });
  }
  if (body.action === "upsert_pack") {
    const company = String(body.pack?.company ?? "").trim();
    if (!company) return Response.json({ error: "company is required" }, { status: 400 });
    return Response.json({ pack: upsertCompanyAnswerPack({ company, aliases: body.pack?.aliases ?? [] }, auth.auth) });
  }
  if (!body.answer) return Response.json({ error: "answer is required" }, { status: 400 });
  const answer = upsertReusableAnswer(body.answer, auth.auth);
  const invalidated = invalidatePackagesForAnswer(answer.id, answerHash(answer));
  return Response.json({ answer, invalidatedPackages: invalidated.map((pkg) => pkg.id) });
}
