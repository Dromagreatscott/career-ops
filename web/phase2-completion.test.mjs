import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") } });
const profileStore = jiti("./src/lib/command-center/profile-store.ts");
const answerLibrary = jiti("./src/lib/command-center/answer-library.ts");
const resumeLibrary = jiti("./src/lib/command-center/resume-library.ts");
const packages = jiti("./src/lib/command-center/application-packages.ts");
const profileRoute = jiti("./src/app/api/profile/route.ts");
const resumesRoute = jiti("./src/app/api/resumes/route.ts");

function useRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-phase2-"));
  fs.mkdirSync(path.join(root, "data", "web"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "application-packages"), { recursive: true });
  process.env.CAREER_OPS_ROOT = root;
  return root;
}

const ctx = { userId: "u1", profileScope: "scope1" };

function profileView() {
  const record = profileStore.readProfileRecord(ctx.userId, ctx.profileScope);
  return {
    userId: ctx.userId,
    profileScope: ctx.profileScope,
    version: record.version,
    contact: {},
    employmentHistory: [],
    education: [],
    portfolio: [],
    preferredRoles: [],
    standardAnswers: { work_authorization: "Yes", onsite_availability: "Remote" },
    reusableAnswers: answerLibrary.readReusableAnswers(ctx.userId, ctx.profileScope),
    verification: [],
    resumeVariants: [],
    resumeLibrary: resumeLibrary.readResumeLibrary(ctx.userId, ctx.profileScope),
    dreamCompanies: [],
    excludedRoleTypes: [],
  };
}

function job(overrides = {}) {
  return {
    id: "job-1",
    company: "Anthropic",
    title: "Applied AI Architect",
    source: "Hawkeye",
    applicationPlatform: "Employer",
    sourceUrl: "https://example.com/jobs/1",
    canonicalApplyUrl: "https://example.com/jobs/1/apply",
    canonicalApplyStatus: "resolved",
    fitScore: 4.2,
    fitSummary: "Strong fit.",
    companyPriority: { company: "Anthropic", aliases: [], tier: 1, override_enabled: true, scoring_mode: "role_first" },
    dreamCompany: true,
    stage: "Qualified",
    ...overrides,
  };
}

test("anonymous profile GET is denied", async () => {
  useRoot();
  const res = await profileRoute.GET();
  assert.equal(res.status, 401);
});

test("anonymous resume API is denied", async () => {
  useRoot();
  const res = await resumesRoute.GET();
  assert.equal(res.status, 401);
});

test("profile mutation persists verification states and user scope", () => {
  useRoot();
  const updated = profileStore.updateProfileRecord(ctx.userId, ctx.profileScope, {
    personal: { name: { value: "David Scott", verificationState: "verified" } },
    workAuthorization: { sponsorshipNow: { value: "No", verificationState: "verified" } },
  });
  assert.equal(updated.userId, ctx.userId);
  assert.equal(updated.profileScope, ctx.profileScope);
  assert.equal(updated.personal.name.value, "David Scott");
  assert.equal(updated.personal.name.verificationState, "verified");
  assert.equal(profileStore.readProfileRecord(ctx.userId, ctx.profileScope).version, 2);
});

test("answers persist classification and USER_REQUIRED cannot silently become SAFE_AUTOFILL", () => {
  useRoot();
  const first = answerLibrary.upsertReusableAnswer({
    answerType: "sponsorship",
    title: "Sponsorship",
    content: "Needs review",
    classification: "USER_REQUIRED",
  }, ctx);
  const second = answerLibrary.upsertReusableAnswer({
    id: first.id,
    answerType: "sponsorship",
    title: "Sponsorship",
    content: "Needs review",
    classification: "SAFE_AUTOFILL",
  }, ctx);
  assert.equal(second.classification, "REVIEW_REQUIRED");
  assert.equal(answerLibrary.readReusableAnswers(ctx.userId, ctx.profileScope).length, 1);
});

test("company answer pack persists and resolves company-specific answers", () => {
  useRoot();
  const pack = answerLibrary.upsertCompanyAnswerPack({ company: "Anthropic", aliases: ["Anthropic"] }, ctx);
  const updated = answerLibrary.upsertCompanyAnswerEntry(pack.id, {
    answerType: "why_company",
    title: "Why Anthropic",
    content: "Approved answer.",
    classification: "REVIEW_REQUIRED",
    verificationState: "verified",
  }, ctx);
  assert.equal(updated.entries.length, 1);
  const resolved = answerLibrary.resolveApplicationAnswers({ ...ctx, company: "Anthropic", answerType: "why_company" });
  assert.equal(resolved.company.title, "Why Anthropic");
  assert.equal(resolved.references[0].packId, pack.id);
});

test("resume upload validation accepts PDF and DOCX and rejects invalid inputs", () => {
  useRoot();
  const pdf = resumeLibrary.uploadResume({
    ...ctx,
    originalFilename: "resume.pdf",
    contentType: "application/pdf",
    bytes: Buffer.from("%PDF-1.4"),
    category: "Applied AI",
  });
  assert.equal(pdf.ok, true);
  const docx = resumeLibrary.uploadResume({
    ...ctx,
    originalFilename: "resume.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: Buffer.from("docx"),
    category: "Executive / Leadership",
  });
  assert.equal(docx.ok, true);
  assert.equal(resumeLibrary.assertResumeUploadForTest({ ...ctx, originalFilename: "bad.pdf", contentType: "application/x-msdownload", bytes: Buffer.from("x") }).ok, false);
  assert.equal(resumeLibrary.assertResumeUploadForTest({ ...ctx, originalFilename: "bad.exe", contentType: "application/pdf", bytes: Buffer.from("x") }).ok, false);
  assert.equal(resumeLibrary.assertResumeUploadForTest({ ...ctx, originalFilename: "../resume.pdf", contentType: "application/pdf", bytes: Buffer.alloc(6 * 1024 * 1024) }).status, 413);
});

test("resume archive default and replacement versioning persist", () => {
  useRoot();
  const uploaded = resumeLibrary.uploadResume({ ...ctx, originalFilename: "resume.pdf", contentType: "application/pdf", bytes: Buffer.from("pdf") });
  assert.equal(uploaded.ok, true);
  const setDefault = resumeLibrary.updateResumeMetadata(uploaded.resume.id, ctx, { isDefault: true, category: "Applied AI" });
  assert.equal(setDefault.isDefault, true);
  const replaced = resumeLibrary.replaceResumeVersion(uploaded.resume.id, { ...ctx, originalFilename: "resume-v2.pdf", contentType: "application/pdf", bytes: Buffer.from("pdf2") });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.resume.version, 2);
  const archived = resumeLibrary.updateResumeMetadata(uploaded.resume.id, ctx, { isArchived: true });
  assert.equal(archived.isArchived, true);
});

test("package captures profile answer and resume references", () => {
  useRoot();
  profileStore.updateProfileRecord(ctx.userId, ctx.profileScope, {
    personal: { name: { value: "David Scott", verificationState: "verified" } },
  });
  const resume = resumeLibrary.uploadResume({ ...ctx, originalFilename: "resume.pdf", contentType: "application/pdf", bytes: Buffer.from("pdf") });
  assert.equal(resume.ok, true);
  const answer = answerLibrary.upsertReusableAnswer({ answerType: "why_company", title: "Why", content: "Approved.", classification: "REVIEW_REQUIRED" }, ctx);
  const pack = answerLibrary.upsertCompanyAnswerPack({ company: "Anthropic" }, ctx);
  answerLibrary.upsertCompanyAnswerEntry(pack.id, { answerType: "why_company", title: "Why Anthropic", content: "Approved.", classification: "REVIEW_REQUIRED", verificationState: "verified" }, ctx);
  const pkg = packages.writeApplicationPackage(packages.buildApplicationPackage(job(), profileView()));
  assert.equal(pkg.userId, ctx.userId);
  assert.equal(pkg.profileScope, ctx.profileScope);
  assert.equal(pkg.profileSnapshot.version, 2);
  assert.equal(pkg.selectedResume.id, resume.resume.id);
  assert.equal(pkg.selectedResume.version, 1);
  assert.equal(pkg.reusableAnswerRefs.some((ref) => ref.id === answer.id), true);
  assert.equal(pkg.companyAnswerRefs.some((ref) => ref.packId === pack.id), true);
  assert.equal(pkg.packageIssues.userRequiredFields.includes("desired_salary"), true);
});

test("material answer edits invalidate approved package hash and version", () => {
  useRoot();
  const resume = resumeLibrary.uploadResume({ ...ctx, originalFilename: "resume.pdf", contentType: "application/pdf", bytes: Buffer.from("pdf") });
  assert.equal(resume.ok, true);
  const answer = answerLibrary.upsertReusableAnswer({ answerType: "why_company", title: "Why", content: "Approved.", classification: "REVIEW_REQUIRED" }, ctx);
  const pkg = packages.writeApplicationPackage(packages.buildApplicationPackage(job(), profileView()));
  const approved = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(approved.ok, true);
  const changed = answerLibrary.upsertReusableAnswer({ id: answer.id, answerType: "why_company", title: "Why", content: "Changed.", classification: "REVIEW_REQUIRED" }, ctx);
  const invalidated = packages.invalidatePackagesForAnswer(changed.id, answerLibrary.answerHash(changed));
  assert.equal(invalidated.length, 1);
  assert.equal(invalidated[0].status, "READY_FOR_REVIEW");
  assert.equal(invalidated[0].version, pkg.version + 1);
  assert.notEqual(invalidated[0].packageHash, pkg.packageHash);
});
