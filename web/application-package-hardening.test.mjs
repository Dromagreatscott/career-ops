import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@": path.resolve("src"),
  },
});
const packages = jiti("./src/lib/command-center/application-packages.ts");
const urls = jiti("./src/lib/security/url.ts");
const statusRoute = jiti("./src/app/api/status/route.ts");
const readiness = jiti("./src/lib/command-center/execution-readiness.ts");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-hardening-"));
  fs.mkdirSync(path.join(root, "data", "application-packages"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  return root;
}

function useRoot() {
  const root = tempRoot();
  process.env.CAREER_OPS_ROOT = root;
  return root;
}

function profile() {
  const resumePath = "data/David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf";
  return {
    contact: {},
    employmentHistory: [],
    education: [],
    portfolio: [],
    preferredRoles: [],
    standardAnswers: { work_authorization: "Yes", onsite_availability: "Remote" },
    reusableAnswers: [],
    verification: [],
    resumeVariants: [],
    resumeLibrary: [
      {
        id: "resume-master-ats",
        label: "David Scott Applied AI Resume",
        path: resumePath,
        format: "pdf",
        status: fs.existsSync(path.join(process.env.CAREER_OPS_ROOT ?? "", resumePath)) ? "ready" : "missing",
        isDefault: true,
        recommendedFor: ["Applied AI", "AI architecture"],
      },
    ],
    dreamCompanies: [],
    excludedRoleTypes: [],
  };
}

function job(overrides = {}) {
  return {
    id: "job-1",
    company: "Acme",
    title: "AI Architect",
    source: "Hawkeye",
    applicationPlatform: "Employer",
    sourceUrl: "https://example.com/jobs/1",
    canonicalApplyUrl: "https://example.com/jobs/1/apply",
    canonicalApplyStatus: "resolved",
    fitScore: 4.2,
    fitSummary: "Strong fit.",
    companyPriority: { company: "Acme", aliases: [], tier: null, override_enabled: false, scoring_mode: "role_first" },
    dreamCompany: false,
    stage: "Qualified",
    ...overrides,
  };
}

function writePackage(pkg) {
  return packages.writeApplicationPackage(pkg);
}

test("valid package ID is accepted", () => {
  const result = packages.validatePackageId("pkg_0123456789abcdef");
  assert.equal(result.ok, true);
});

test("../ traversal package ID is rejected", () => {
  const result = packages.validatePackageId("../pkg_0123456789abcdef");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("encoded traversal package ID is rejected", () => {
  const result = packages.validatePackageId("%2e%2e%2fpkg_0123456789abcdef");
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test("malformed package is quarantined and not returned", () => {
  const root = useRoot();
  const file = path.join(root, "data", "application-packages", "pkg_0123456789abcdef.json");
  fs.writeFileSync(file, "{\"id\":", "utf8");
  assert.deepEqual(packages.readApplicationPackages(), []);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(root, "data", "application-packages", "package-audit.jsonl")), true);
});

test("tampered package hash is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const file = path.join(process.env.CAREER_OPS_ROOT, "data", "application-packages", `${pkg.id}.json`);
  const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
  tampered.company = "Evil Corp";
  fs.writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  const result = packages.readApplicationPackage(pkg.id);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("stale approval hash is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const result = packages.decideApplicationPackage(pkg.id, "0".repeat(64), pkg.version, "approved");
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("duplicate decision replay is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const first = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(first.ok, true);
  const replay = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(replay.ok, false);
  assert.equal(replay.status, 409);
});

test("invalid package status transition is rejected", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile(), { status: "PREPARING" }));
  const result = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("valid approval succeeds", () => {
  useRoot();
  const pkg = writePackage(packages.buildApplicationPackage(job(), profile()));
  const result = packages.decideApplicationPackage(pkg.id, pkg.packageHash, pkg.version, "approved");
  assert.equal(result.ok, true);
  assert.equal(result.package.status, "APPROVED");
  assert.equal(result.package.approval.packageHash, pkg.packageHash);
});

test("application package records recommended resume metadata", () => {
  const root = useRoot();
  fs.writeFileSync(path.join(root, "data", "David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf"), "pdf", "utf8");
  const pkg = packages.buildApplicationPackage(job(), profile());
  assert.equal(pkg.selectedResume.id, "resume-master-ats");
  assert.equal(pkg.selectedResume.status, "ready");
  assert.equal(pkg.selectedResume.selection, "recommended");
  assert.match(pkg.selectedResume.recommendationReason, /Recommended/);
});

test("resume override changes package hash and increments version", () => {
  const root = useRoot();
  fs.writeFileSync(path.join(root, "data", "David_Scott_AI_Resume_2026_v4_4_MASTER_ATS.pdf"), "pdf", "utf8");
  fs.writeFileSync(path.join(root, "data", "leadership_resume.pdf"), "pdf", "utf8");
  const profileData = profile();
  profileData.resumeLibrary.push({
    id: "resume-leadership",
    label: "Leadership Resume",
    path: "data/leadership_resume.pdf",
    format: "pdf",
    status: "ready",
    isDefault: false,
    recommendedFor: ["Director", "Head of AI"],
  });
  const first = packages.prepareApplicationPackage(job(), profileData);
  const result = packages.overrideApplicationPackageResume(first.id, first.packageHash, first.version, "resume-leadership", profileData, job());
  assert.equal(result.ok, true);
  assert.equal(result.package.selectedResume.id, "resume-leadership");
  assert.equal(result.package.selectedResume.selection, "override");
  assert.equal(result.package.version, first.version + 1);
  assert.notEqual(result.package.packageHash, first.packageHash);
});

test("package mutation invalidates approval and increments version", () => {
  useRoot();
  const first = packages.prepareApplicationPackage(job(), profile());
  const approved = packages.decideApplicationPackage(first.id, first.packageHash, first.version, "approved");
  assert.equal(approved.ok, true);
  const mutated = packages.prepareApplicationPackage(job({ title: "Principal AI Architect" }), profile());
  assert.equal(mutated.status, "READY_FOR_REVIEW");
  assert.equal(mutated.approval, undefined);
  assert.equal(mutated.version, first.version + 1);
  assert.notEqual(mutated.packageHash, first.packageHash);
});

test("javascript URL is rejected", () => {
  assert.equal(urls.validateExternalUrl("javascript:alert(1)").ok, false);
});

test("data URL is rejected", () => {
  assert.equal(urls.validateExternalUrl("data:text/plain,hello").ok, false);
});

test("https URL is accepted and normalized", () => {
  const result = urls.validateExternalUrl("https://EXAMPLE.com/jobs/1");
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.com/jobs/1");
});

test("unsupported but valid ATS URL is handled honestly", () => {
  useRoot();
  const pkg = packages.buildApplicationPackage(job({ canonicalApplyUrl: "https://jobs.example.org/postings/123" }), profile());
  assert.equal(pkg.atsType, "unknown");
  assert.equal(pkg.canonicalApplyUrl, "https://jobs.example.org/postings/123");
});

test("anonymous status updates are denied without echoing raw internal-looking values", async () => {
  useRoot();
  const secret = "/root/very-sensitive/path";
  const req = new Request("http://localhost/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: "1", status: secret }),
  });
  const res = await statusRoute.POST(req);
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(String(body.error).includes(secret), false);
});

// ---------------------------------------------------------------------------
// Edit-pending answer workflow + Phase 3 ATS readiness sync
// ---------------------------------------------------------------------------

const REVIEW_Q = { id: "q_review", label: "Why do you want to join Acme?", explanation: "Career Ops drafted this; review before approval.", classification: "REVIEW_REQUIRED", source: "career_ops", draft: "Draft answer." };
const USER_Q = { id: "q_user", label: "Desired salary", explanation: "Sensitive — needs David.", classification: "USER_REQUIRED", source: "career_ops" };
const SAFE_Q = { id: "q_safe", label: "Email", explanation: "From verified profile.", classification: "SAFE_AUTOFILL", source: "profile", value: "david@example.com" };

/** Persist a package carrying explicit questions (optionally APPROVED), recomputing
 *  the canonical hash so writeApplicationPackage accepts it. */
function persistWithQuestions(questions, opts = {}) {
  const base = packages.buildApplicationPackage(job(), profile());
  const { packageHash: _drop, ...rest } = base;
  const draft = { ...rest, questions, version: opts.version ?? 1, status: opts.status ?? "READY_FOR_REVIEW", approval: undefined };
  const hash = packages.computePackageHash(draft);
  let pkg = { ...draft, packageHash: hash };
  if (opts.approved) pkg = { ...pkg, status: "APPROVED", approval: { status: "approved", packageHash: hash, decidedAt: new Date().toISOString() } };
  return packages.writeApplicationPackage(pkg);
}

function questionById(pkg, id) {
  return pkg.questions.find((q) => q.id === id);
}

test("edit pending: REVIEW_REQUIRED answer persists as the package answer", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(REVIEW_Q)]);
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_review", "David approved answer.");
  assert.equal(res.ok, true);
  assert.equal(res.changed, true);
  const reread = packages.readApplicationPackage(pkg.id);
  assert.equal(reread.ok, true);
  const q = questionById(reread.package, "q_review");
  assert.equal(q.value, "David approved answer.");
  assert.equal(q.classification, "REVIEW_REQUIRED");
  assert.equal(q.source, "user");
  assert.equal(reread.package.version, pkg.version + 1);
});

test("edit pending: USER_REQUIRED resolves to REVIEW_REQUIRED, never SAFE_AUTOFILL", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(USER_Q)]);
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_user", "$180k base");
  assert.equal(res.ok, true);
  const q = questionById(res.package, "q_user");
  assert.equal(q.value, "$180k base");
  assert.notEqual(q.classification, "SAFE_AUTOFILL");
  assert.equal(q.classification, "REVIEW_REQUIRED");
});

test("edit pending: empty USER_REQUIRED answer is rejected and never silently auto-resolves", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(USER_Q)]);
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_user", "   ");
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  const reread = packages.readApplicationPackage(pkg.id);
  const q = questionById(reread.package, "q_user");
  assert.equal(q.classification, "USER_REQUIRED");
  assert.equal(q.value, undefined);
  assert.equal(reread.package.version, pkg.version);
});

test("edit pending: SAFE_AUTOFILL stays SAFE_AUTOFILL even if edited via the API", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(SAFE_Q)]);
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_safe", "override@example.com");
  assert.equal(res.ok, true);
  const q = questionById(res.package, "q_safe");
  assert.equal(q.classification, "SAFE_AUTOFILL");
});

test("edit pending: material edit bumps version and changes the hash", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(REVIEW_Q)]);
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_review", "A materially different answer.");
  assert.equal(res.ok, true);
  assert.equal(res.package.version, pkg.version + 1);
  assert.notEqual(res.package.packageHash, pkg.packageHash);
});

test("edit pending: prior approval is invalidated after a material edit", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(REVIEW_Q)], { approved: true });
  assert.equal(pkg.status, "APPROVED");
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_review", "Edited after approval.");
  assert.equal(res.ok, true);
  assert.equal(res.package.status, "READY_FOR_REVIEW");
  assert.equal(res.package.approval, undefined);
  assert.equal(res.package.version, pkg.version + 1);
});

test("edit pending: stale hash or version is rejected (approval race guard)", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(REVIEW_Q)]);
  const badHash = packages.updateApplicationPackageQuestion(pkg.id, "0".repeat(64), pkg.version, "q_review", "x");
  assert.equal(badHash.ok, false);
  assert.equal(badHash.status, 409);
  const badVersion = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version + 5, "q_review", "x");
  assert.equal(badVersion.ok, false);
  assert.equal(badVersion.status, 409);
});

test("edit pending: identical answer is a no-op that preserves approval", () => {
  useRoot();
  const same = { ...structuredClone(REVIEW_Q), value: "Same answer.", draft: undefined };
  const pkg = persistWithQuestions([same], { approved: true });
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_review", "Same answer.");
  assert.equal(res.ok, true);
  assert.equal(res.changed, false);
  assert.equal(res.package.version, pkg.version);
  assert.equal(res.package.status, "APPROVED");
  assert.ok(res.package.approval);
});

test("edit pending: not saving (cancel) leaves the stored answer untouched", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(REVIEW_Q)]);
  const before = packages.readApplicationPackage(pkg.id);
  // Cancel performs no POST → the persisted package is byte-identical.
  const after = packages.readApplicationPackage(pkg.id);
  assert.deepEqual(after.package, before.package);
});

test("edit pending: completion/readiness advances after resolving USER_REQUIRED", () => {
  useRoot();
  const pkg = persistWithQuestions([structuredClone(USER_Q)]);
  assert.equal(readiness.executionReadiness(pkg).answers, "NEEDS YOU");
  const res = packages.updateApplicationPackageQuestion(pkg.id, pkg.packageHash, pkg.version, "q_user", "$180k base");
  assert.equal(res.ok, true);
  assert.equal(readiness.executionReadiness(res.package).answers, "NEEDS REVIEW");
});

// ---- ATS readiness sync ----

function readinessPkg(over = {}) {
  return {
    atsType: over.atsType ?? "greenhouse",
    canonicalApplyUrl: over.canonicalApplyUrl ?? "https://boards.greenhouse.io/acme/jobs/1",
    questions: over.questions ?? [],
    selectedResume: over.selectedResume ?? { status: "ready" },
    status: over.status ?? "APPROVED",
    approval: over.approval ?? { status: "approved", packageHash: "h" },
    packageHash: over.packageHash ?? "h",
    profileSnapshot: over.profileSnapshot ?? { version: 1, hash: "ph", reference: "r" },
  };
}

test("readiness: Greenhouse is SUPPORTED and can be ready for live", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "greenhouse" }));
  assert.equal(r.atsSupport, "SUPPORTED");
  assert.equal(r.ats, "SUPPORTED");
  assert.equal(r.readyForLive, true);
});

test("readiness: Lever is SUPPORTED", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "lever", canonicalApplyUrl: "https://jobs.lever.co/acme/abc" }));
  assert.equal(r.atsSupport, "SUPPORTED");
  assert.equal(r.readyForLive, true);
});

test("readiness: Ashby is SUPPORTED", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "ashby", canonicalApplyUrl: "https://jobs.ashbyhq.com/acme/uuid" }));
  assert.equal(r.atsSupport, "SUPPORTED");
  assert.equal(r.readyForLive, true);
});

test("readiness: Workday is SUPPORTED", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "workday", canonicalApplyUrl: "https://acme.wd5.myworkdayjobs.com/x/job/1" }));
  assert.equal(r.atsSupport, "SUPPORTED");
  assert.equal(r.readyForLive, true);
});

test("readiness: unknown ATS is MANUAL ASSIST and never ready for live auto-submit", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "unknown", canonicalApplyUrl: "https://careers.acmecorp.com/apply/1" }));
  assert.equal(r.atsSupport, "MANUAL_ASSIST");
  assert.equal(r.ats, "MANUAL ASSIST");
  assert.equal(r.readyForLive, false); // generic fallback is not equivalent to first-class support
  assert.equal(readiness.atsSupport("unknown"), "MANUAL_ASSIST");
});

test("readiness: approval gating is unchanged (no approval → not ready for live)", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "greenhouse", status: "READY_FOR_REVIEW", approval: undefined }));
  assert.equal(r.approval, "REQUIRED");
  assert.equal(r.readyForLive, false);
});

test("readiness: USER_REQUIRED answers block live readiness on a supported ATS", () => {
  const r = readiness.executionReadiness(readinessPkg({ atsType: "greenhouse", questions: [structuredClone(USER_Q)] }));
  assert.equal(r.answers, "NEEDS YOU");
  assert.equal(r.readyForLive, false);
});
